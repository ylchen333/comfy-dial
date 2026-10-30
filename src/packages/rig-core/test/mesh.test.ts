import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Shot } from "@comfy-dial/contracts";
import { countTriangles, denormalizeDepth, meshBounds, parseGltf, renderClip, type Pose, type Vec3 } from "../src/index.ts";
import { SceneKit } from "../scripts/scene-kit.ts";

const bundled = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../assets/scenes/${name}.glb`, import.meta.url))));
const IDENT = { position: [0, 0, 0] as Vec3, quaternion: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as Vec3 };

function boxGlb(node?: Parameters<SceneKit["toGlb"]>[0]): Uint8Array {
  const k = new SceneKit();
  k.box([0, 1, 0], [2, 2, 2], [1, 0, 0]);
  return k.toGlb(node);
}

describe("parseGltf", () => {
  it("reads a GLB box: 12 triangles, bounds, base colour", () => {
    const meshes = parseGltf(boxGlb());
    expect(countTriangles(meshes)).toBe(12);
    expect(meshBounds(meshes)).toEqual({ min: [-1, 0, -1], max: [1, 2, 1] });
    expect(meshes[0]!.colors[0]).toBeCloseTo(1, 6);
  });
  it("bakes the glTF node transform (translation, scale)", () => {
    const b = meshBounds(parseGltf(boxGlb({ translation: [5, 0, 0], scale: [2, 2, 2] })));
    expect(b.min).toEqual([3, 0, -2]);
    expect(b.max).toEqual([7, 4, 2]);
  });
  it("rejects junk with a readable error", () => {
    expect(() => parseGltf(new Uint8Array([1, 2, 3]))).toThrow(/not a GLB/);
    expect(() => parseGltf(new SceneKit().toGlb())).toThrow(/no triangle meshes/);
  });
  it("loads both bundled scenes as small triangle sets", () => {
    for (const n of ["courtyard", "street"]) {
      const t = countTriangles(parseGltf(bundled(n)));
      expect(t).toBeGreaterThan(100);
      expect(t).toBeLessThan(5000);
    }
  });
});

describe("huangshan set", () => {
  it("fits the upload budget and puts the stair step under the origin (subject at y = 0.9 stands on it)", () => {
    const meshes = parseGltf(bundled("huangshan"));
    expect(countTriangles(meshes)).toBeLessThan(60_000);
    const s = { resolution: { width: 48, height: 32 }, scene: { nodes: [{ id: "set", asset: "scenes/huangshan.glb", transform: IDENT }] } } as Pick<Shot, "scene" | "resolution">;
    const down: Pose = { frame: 0, t: 0, position: [0, 5, 0], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], fov_v_deg: 10 };
    const f = [...renderClip(s, [down], undefined, () => meshes)][0]!;
    expect(f.depthZ[16 * 48 + 24]).toBeCloseTo(5, 0); // ground at y = 0 within 0.5 m
  });
});

describe("mesh nodes in the depth renderer", () => {
  const shot = (transform = IDENT) =>
    ({ resolution: { width: 96, height: 64 }, scene: { nodes: [{ id: "m", asset: "scenes/box.glb", transform }] } }) as Pick<Shot, "scene" | "resolution">;
  const resolver = (asset: string) => {
    if (asset !== "scenes/box.glb") throw new Error(`no asset ${asset}`);
    return parseGltf(boxGlb());
  };
  // camera 6 m in front of the box, looking down -Z (identity quaternion)
  const pose: Pose = { frame: 0, t: 0, position: [0, 1, 6], quaternion: [0, 0, 0, 1], fov_v_deg: 40 };
  const first = (s: Pick<Shot, "scene" | "resolution">, p: Pose = pose) => [...renderClip(s, [p], undefined, resolver)][0]!;

  it("centre pixel hits the front face (box spans z -1..1, camera at z 6 -> 5 m)", () => {
    const f = first(shot());
    const c = (32 * 96) + 48;
    expect(f.depthZ[c]).toBeCloseTo(5, 3);
    expect(denormalizeDepth(f.depth8[c]! / 255)).toBeCloseTo(5, 1);
    expect(f.depthZ[0]).toBe(100); // corner sees sky
  });
  it("applies the Shot node transform on top of the model", () => {
    const f = first(shot({ ...IDENT, position: [0, 0, -4] }));
    expect(f.depthZ[(32 * 96) + 48]).toBeCloseTo(9, 3);
  });
  it("throws without a resolver instead of silently dropping the asset", () => {
    expect(() => [...renderClip(shot(), [pose])]).toThrow(/mesh resolver/);
  });
  it("renders a bundled scene fast enough for a 121-frame guide", () => {
    const meshes = parseGltf(bundled("street"));
    const s = { resolution: { width: 768, height: 512 }, scene: { nodes: [{ id: "set", asset: "scenes/street.glb", transform: IDENT }] } } as Pick<Shot, "scene" | "resolution">;
    const t0 = performance.now();
    const f = [...renderClip(s, [{ ...pose, position: [0, 1.6, 12] }], undefined, () => meshes)][0]!;
    const ms = performance.now() - t0;
    expect(f.depth8.some((v) => v > 0)).toBe(true);
    expect(ms).toBeLessThan(1500); // 121 frames would be ~3 min worst case; measured value is printed below
    console.log(`street frame at 768x512: ${ms.toFixed(0)} ms`);
  });
});

import { clipTime } from "../src/index.ts";
describe("clipTime", () => {
  const a = { start: 0.04, period: 4.84 }; // a 121-key clip at 25 fps: keys at 0.04 .. 4.84
  it("starts at the first key, loops, and a 4.8 s shot ends on the last key", () => {
    expect(clipTime(a, 0)).toBeCloseTo(0.04, 9);
    expect(clipTime(a, 4.8)).toBeCloseTo(4.84, 9);
    expect(clipTime(a, 4.84)).toBeCloseTo(0.04, 9);
    expect(clipTime(a, 5)).toBeCloseTo(0.2, 9);
  });
});
