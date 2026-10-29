import { describe, expect, it } from "vitest";
import type { Poses } from "@comfy-osh/contracts";
import { quatToMat3, rotate, sampleShot, type Quat, type Vec3 } from "@comfy-osh/rig-core";
import { exportShot } from "../src/logic/compile.ts";
import { evalChannel, newDoc } from "../src/logic/keys.ts";
import { applyReference, keysFromReference, simplify, type RefKeys } from "../src/logic/fromReference.ts";
import { validateDoc } from "../src/logic/io.ts";
import { applyPreset } from "../src/logic/presets.ts";

const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));

/** What a monocular solve of an authored move looks like: world == camera 0, arbitrary scale k, optional time stretch. */
function solveOf(docIn: ReturnType<typeof newDoc>, k: number, secondsPerFrame = 1 / 25, every = 4): Poses {
  const poses = sampleShot(exportShot(docIn));
  const p0 = poses[0]!;
  const frames = poses.filter((p) => p.frame % every === 0).map((p, i) => ({
    index: i, t: (p.frame / 25) * (secondsPerFrame * 25),
    position: rotate(qconj(p0.quaternion as Quat), [p.position[0] - p0.position[0], p.position[1] - p0.position[1], p.position[2] - p0.position[2]] as Vec3).map((v) => v * k) as Vec3,
    quaternion: qmul(qconj(p0.quaternion as Quat), p.quaternion as Quat),
    fov_v_deg: p.fov_v_deg,
  }));
  return { schema: "comfy-osh/poses/1", fps: 25, image: { width: 768, height: 512 }, solve_ok: true, frames } as unknown as Poses;
}
const pathLen = (ps: readonly { position: Vec3 }[]) => ps.slice(1).reduce((s, p, i) => s + dist(p.position, ps[i]!.position), 0);

describe("camera from a reference video", () => {
  const orbit = applyPreset(newDoc(), "orbit");
  const truth = sampleShot(exportShot(orbit));

  it("round trip: an orbit solved at an arbitrary scale comes back as the same move once the travel is stated", () => {
    const solved = solveOf(orbit, 0.37);
    const r = keysFromReference(solved, orbit, { travelM: pathLen(truth), zoom: "keep" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rebuilt = applyReference(orbit, r.value);
    expect(validateDoc(rebuilt).ok).toBe(true);
    const got = sampleShot(exportShot(rebuilt));
    const worst = Math.max(...got.map((p, i) => dist(p.position, truth[i]!.position)));
    expect(worst).toBeLessThan(0.25); // metres, over a ~9 m orbit, with at most 12 keys
    expect(r.value.position.length).toBeLessThanOrEqual(12);
    expect(r.value.summary.maxTurnDeg).toBeGreaterThan(40);
  });

  it("scale is the user's: doubling the stated travel doubles the path", () => {
    const solved = solveOf(orbit, 0.37);
    const a = keysFromReference(solved, orbit, { travelM: 3, zoom: "keep" });
    const b = keysFromReference(solved, orbit, { travelM: 6, zoom: "keep" });
    if (!a.ok || !b.ok) throw new Error("conversion failed");
    const len = (d: RefKeys) => pathLen(sampleShot(exportShot(applyReference(orbit, d))));
    expect(len(b.value) / len(a.value)).toBeGreaterThan(1.8);
    expect(len(b.value) / len(a.value)).toBeLessThan(2.2);
  });

  it("retimes: a 2 s reference fills the whole 4.8 s shot, ending on the last frame", () => {
    const r = keysFromReference(solveOf(orbit, 1, 0.4), orbit, { travelM: 5, zoom: "keep" });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.position[0]!.frame).toBe(0);
    expect(r.value.position.at(-1)!.frame).toBe(orbit.frames - 1);
  });

  it("zoom: keep holds the authored focal length; ratio follows the change in focal length, not the biased absolute value", () => {
    const dz = applyPreset(newDoc(), "dolly-zoom");
    const solved = solveOf(dz, 0.5);
    solved.frames.forEach((f) => { f.fov_v_deg += 10; }); // DA3's measured bias
    const keep = keysFromReference(solved, dz, { travelM: 2, zoom: "keep" });
    const ratio = keysFromReference(solved, dz, { travelM: 2, zoom: "ratio" });
    if (!keep.ok || !ratio.ok) throw new Error("conversion failed");
    expect(keep.value.focal).toHaveLength(1);
    expect(keep.value.focal[0]!.value).toBeCloseTo(evalChannel(dz, "focal", 0), 6);
    const f0 = evalChannel(dz, "focal", 0);
    const last = ratio.value.focal.at(-1)!.value;
    expect(last).toBeLessThan(f0 * 0.9); // the dolly zoom shortens the lens; the +10 deg bias must not flip or hide that
  });

  it("a pan has no translation, so the scale does not matter and the position stays put", () => {
    const pan = applyPreset(newDoc(), "pan");
    const r = keysFromReference(solveOf(pan, 1), pan, { travelM: 4, zoom: "keep" });
    if (!r.ok) throw new Error(r.error);
    const start = r.value.position[0]!.value;
    for (const k of r.value.position) expect(dist(k.value, start)).toBeLessThan(1e-3);
    expect(r.value.summary.maxTurnDeg).toBeGreaterThan(5);
  });

  it("refuses a failed solve, too few frames, and a bad travel", () => {
    const ok = solveOf(orbit, 1);
    expect(keysFromReference({ ...ok, solve_ok: false }, orbit, { travelM: 3, zoom: "keep" }).ok).toBe(false);
    expect(keysFromReference({ ...ok, frames: ok.frames.slice(0, 2) }, orbit, { travelM: 3, zoom: "keep" }).ok).toBe(false);
    expect(keysFromReference(ok, orbit, { travelM: -1, zoom: "keep" }).ok).toBe(false);
  });

  it("simplify keeps a speed change: a still start then a fast move needs a key at the corner", () => {
    const f = Array.from({ length: 21 }, (_, i) => i * 6);
    const v = f.map((x) => [x < 60 ? 0 : (x - 60) * 0.1]);
    const keep = simplify(f, v, 0.01);
    expect(keep).toContain(10);
    expect(keep.length).toBeLessThanOrEqual(4);
  });

  it("works on a real recovered solve from a live LTX take", async () => {
    const fs = await import("node:fs");
    const url = new URL("../../../tests/golden/loop_runs/orbit.s4000.poses.json", import.meta.url);
    const real = JSON.parse(fs.readFileSync(url, "utf8")) as Poses;
    const r = keysFromReference(real, newDoc(), { travelM: 3, zoom: "keep" });
    if (!r.ok) throw new Error(r.error);
    expect(validateDoc(applyReference(newDoc(), r.value)).ok).toBe(true);
    expect(r.value.summary.keys.position).toBeLessThanOrEqual(12);
  });
});
