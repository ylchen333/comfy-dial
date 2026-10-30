import { describe, expect, it } from "vitest";
import { DEFAULT_DEPTH_NORM, lookAtQuat, meshBounds, renderClip, type Vec3 } from "@comfy-dial/rig-core";
import { AssetStore } from "../src/assets.ts";
import { tmp } from "./helpers.ts";

const store = new AssetStore(tmp());
const node = (asset: string) => ({ id: "subject", asset, transform: { position: [0, 0.9, 0] as Vec3, quaternion: [0, 0, 0, 1] as [number, number, number, number], scale: [asset.startsWith("primitive:") ? 0.6 : 1, asset.startsWith("primitive:") ? 1.8 : 1, asset.startsWith("primitive:") ? 0.6 : 1] as Vec3 } });

/** Depth guide frame of a lone subject, seen from `eye` (96x96, no ground, so the background is empty). */
function mask(asset: string, eye: Vec3) {
  const pose = { frame: 0, t: 0, position: eye, quaternion: lookAtQuat(eye, [0, 0.9, 0]), fov_v_deg: 30 };
  const f = [...renderClip({ scene: { nodes: [node(asset)] }, resolution: { width: 96, height: 96 } }, [pose], DEFAULT_DEPTH_NORM, store.resolver())][0]!;
  const rows: boolean[][] = [];
  for (let y = 0; y < f.height; y++) rows.push(Array.from({ length: f.width }, (_, x) => f.depth8[y * f.width + x]! > 0));
  return rows;
}
const runs = (row: boolean[]) => row.reduce((n, v, i) => n + (v && !row[i - 1] ? 1 : 0), 0);
const rowsWithBody = (m: boolean[][]) => m.map((r, y) => (r.some(Boolean) ? y : -1)).filter((y) => y >= 0);
const legRow = (m: boolean[][]) => { const ys = rowsWithBody(m); return m[ys[0]! + Math.round(0.85 * (ys.at(-1)! - ys[0]!))]!; };

describe("bundled actors", () => {
  it("are served only from the actors folder, by exact name", () => {
    expect(store.fileFor("actors/mannequin_stand.glb")).not.toBeNull();
    expect(store.fileFor("actors/mannequin_stride.glb")).not.toBeNull();
    expect(store.fileFor("actors/../scenes/street.glb")).toBeNull();
    expect(store.fileFor("actors/nope.glb")).toBeNull();
    expect(store.listActors().map((a) => a.asset)).toEqual(["actors/dancing_baby.glb", "actors/mannequin_stand.glb", "actors/mannequin_stride.glb"]);
  });

  it("are about 1.8 m tall with the soles 0.9 m below the origin, so a subject at y = 0.9 stands on the ground", () => {
    const b = meshBounds(store.resolver()("actors/mannequin_stand.glb"));
    expect(b.max[1] - b.min[1]).toBeGreaterThan(1.7);
    expect(b.max[1] - b.min[1]).toBeLessThan(1.9);
    expect(b.min[1]).toBeCloseTo(-0.9, 1);
  });

  it("show a person-shaped guide: seen from the side, a stride has two legs apart where a standing figure or a box has one body", () => {
    const side: Vec3 = [6, 0.9, 0];
    expect(runs(legRow(mask("actors/mannequin_stride.glb", side)))).toBe(2);
    expect(runs(legRow(mask("actors/mannequin_stand.glb", side)))).toBe(1);
    expect(runs(legRow(mask("primitive:box", side)))).toBe(1);
  });

  it("face the studio's default camera (+Z): the front is wider than the side", () => {
    const width = (m: boolean[][]) => Math.max(...m.map((r) => r.reduce((n, v) => n + (v ? 1 : 0), 0)));
    expect(width(mask("actors/mannequin_stand.glb", [0, 0.9, 6]))).toBeGreaterThan(width(mask("actors/mannequin_stand.glb", [6, 0.9, 0])));
  });
});

describe("dancing baby", () => {
  it("is a small figure with its feet at the origin, so a prop at y = 0 stands on the ground", () => {
    const b = meshBounds(store.resolver()("actors/dancing_baby.glb"));
    expect(b.max[1] - b.min[1]).toBeGreaterThan(0.6);
    expect(b.max[1] - b.min[1]).toBeLessThan(1.1);
    expect(Math.abs(b.min[1])).toBeLessThan(0.02);
  });
});

describe("animated actors in the depth guide", () => {
  it("the dancing baby moves: the guide frames differ between times, and the clip loops", () => {
    const eye: Vec3 = [0, 0.4, 3];
    const pose = (t: number) => ({ frame: Math.round(t * 25), t, position: eye, quaternion: lookAtQuat(eye, [0, 0.4, 0]), fov_v_deg: 30 });
    const shot = { scene: { nodes: [{ id: "baby", asset: "actors/dancing_baby.glb", transform: { position: [0, 0, 0] as Vec3, quaternion: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as Vec3 } }] }, resolution: { width: 96, height: 96 } };
    const frames = [...renderClip(shot, [0, 0.4, 1.2, 2.4, 4.84].map(pose), DEFAULT_DEPTH_NORM, store.resolver())];
    const diff = (a: Uint8Array, b: Uint8Array) => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);
    expect(diff(frames[0]!.depth8, frames[1]!.depth8)).toBeGreaterThan(20); // the pose changes within half a second
    expect(diff(frames[0]!.depth8, frames[3]!.depth8)).toBeGreaterThan(20);
    expect(diff(frames[0]!.depth8, frames[4]!.depth8)).toBeLessThan(diff(frames[0]!.depth8, frames[3]!.depth8)); // the loop closes: 4.84 s is back near the start
  });
  it("a static asset renders the same at every time", () => {
    const eye: Vec3 = [0, 0.9, 6];
    const pose = (t: number) => ({ frame: 0, t, position: eye, quaternion: lookAtQuat(eye, [0, 0.9, 0]), fov_v_deg: 30 });
    const shot = { scene: { nodes: [node("actors/mannequin_stand.glb")] }, resolution: { width: 64, height: 64 } };
    const [a, b] = [...renderClip(shot, [pose(0), pose(2.5)], DEFAULT_DEPTH_NORM, store.resolver())];
    expect(Buffer.compare(Buffer.from(a!.depth8), Buffer.from(b!.depth8))).toBe(0);
  });
});
