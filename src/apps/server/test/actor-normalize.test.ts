import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countTriangles, meshBounds, parseGltf, type Mesh } from "@comfy-dial/rig-core";
import { BUNDLED_ACTORS_DIR } from "../src/assets.ts";
import { normalizeActor } from "../src/actor-normalize.ts";

const stand = () => parseGltf(readFileSync(`${BUNDLED_ACTORS_DIR}/mannequin_stand.glb`));

/** The mannequin as an image-to-3D tool might hand it back: Z-up, 37x too large, off-origin. */
function rawZUp(extra: Mesh[] = []): Mesh[] {
  const moved = stand().map((m) => {
    const p = new Float32Array(m.positions.length);
    for (let i = 0; i < p.length; i += 3) {
      const [x, y, z] = [m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!];
      p[i] = x * 37 + 500; p[i + 1] = -z * 37 + 20; p[i + 2] = y * 37 - 80; // y-up -> z-up (x, -z, y)
    }
    return { ...m, positions: p };
  });
  return [...moved, ...extra];
}
const soup = (x: number, y: number, z: number, s: number): Mesh => ({ positions: Float32Array.from([x, y, z, x + s, y, z, x, y + s, z]), indices: Uint32Array.from([0, 1, 2]), colors: Float32Array.from([1, 1, 1]) });

describe("normalizeActor", () => {
  it("restores height, up axis, feet and centre from a Z-up, mis-scaled mesh", () => {
    const { glb, report } = normalizeActor(rawZUp());
    expect(report.problems).toEqual([]);
    expect(report.sourceUp).toBe("z");
    const b = meshBounds(parseGltf(glb!));
    expect(b.max[1] - b.min[1]).toBeCloseTo(1.7, 2);
    expect(b.min[1]).toBeCloseTo(-0.9, 2);
    expect(Math.abs((b.min[0] + b.max[0]) / 2)).toBeLessThan(0.15);
  });

  it("keeps the figure facing the same way when only the axes were swapped", () => {
    const ref = stand();
    const { glb } = normalizeActor(rawZUp());
    const front = (ms: Mesh[]) => { // the head's centre sits ahead of the body centre along z for a +Z-facing figure
      const b = meshBounds(ms);
      let sum = 0, n = 0;
      for (const m of ms) for (let i = 0; i < m.positions.length; i += 3) if (m.positions[i + 1]! > b.max[1] - 0.2 * (b.max[1] - b.min[1])) { sum += m.positions[i + 2]!; n++; }
      return Math.sign(sum / n);
    };
    expect(front(parseGltf(glb!))).toBe(front(ref));
  });

  it("drops stray fragments and reports them", () => {
    const { glb, report } = normalizeActor(rawZUp([soup(900, 900, 900, 1), soup(-900, 0, 0, 2)]));
    expect(report.droppedFragments).toBe(2);
    expect(report.ok).toBe(true);
    expect(countTriangles(parseGltf(glb!))).toBeLessThanOrEqual(report.sourceTriangles - 2);
  });

  it("refuses a mesh with a second object nearly as big as the first", () => {
    const twin = rawZUp().map((m) => { const p = Float32Array.from(m.positions); for (let i = 0; i < p.length; i += 3) p[i] = p[i]! + 3000; return { ...m, positions: p }; });
    const { glb, report } = normalizeActor([...rawZUp(), ...twin]);
    expect(glb).toBeNull();
    expect(report.problems.join(" ")).toContain("more than one object");
  });

  it("refuses a figure that is not standing (width close to height)", () => {
    const wide = stand().map((m) => { const p = Float32Array.from(m.positions); for (let i = 0; i < p.length; i += 3) p[i] = p[i]! * 4.2; return { ...m, positions: p }; });
    const { glb, report } = normalizeActor(wide);
    expect(glb).toBeNull();
    expect(report.problems.join(" ")).toContain("not standing upright");
  });

  it("simplifies to the triangle budget and the result still parses", () => {
    const { glb, report } = normalizeActor(rawZUp(), { maxTriangles: 300 });
    expect(report.problems).toEqual([]);
    expect(report.triangles).toBeLessThanOrEqual(300);
    expect(countTriangles(parseGltf(glb!))).toBe(report.triangles);
  });

  it("turns the figure about the vertical axis", () => {
    const a = meshBounds(parseGltf(normalizeActor(rawZUp()).glb!));
    const b = meshBounds(parseGltf(normalizeActor(rawZUp(), { turnDeg: 90 }).glb!));
    expect(b.max[0] - b.min[0]).toBeCloseTo(a.max[2] - a.min[2], 1);
  });

  it("fails cleanly on an empty mesh", () => {
    expect(normalizeActor([]).glb).toBeNull();
  });
});
