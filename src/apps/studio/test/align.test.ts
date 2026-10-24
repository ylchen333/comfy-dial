import { describe, expect, it } from "vitest";
import { sampleShot, type Quat, type Vec3 } from "@comfy-osh/rig-core";
import { alignRecovered } from "../src/logic/align.ts";
import { exportShot } from "../src/logic/compile.ts";
import { newDoc } from "../src/logic/keys.ts";
import { applyPreset } from "../src/logic/presets.ts";

const authored = (id: "push-in" | "orbit") => {
  return sampleShot(exportShot(applyPreset(newDoc(), id)));
};

// Re-express the authored path in an arbitrary rigid frame with an arbitrary scale (what DA3 hands back).
function asDa3(poses: ReturnType<typeof authored>, scale: number, yawDeg: number, shift: Vec3) {
  const c = Math.cos((yawDeg * Math.PI) / 180);
  const s = Math.sin((yawDeg * Math.PI) / 180);
  const rot = (v: Vec3): Vec3 => [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
  const q: Quat = [0, Math.sin((yawDeg * Math.PI) / 360), 0, Math.cos((yawDeg * Math.PI) / 360)];
  const mul = (a: Quat, b: Quat): Quat => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  return {
    solve_ok: true as const,
    frames: poses.filter((p) => p.frame % 4 === 0).map((p) => ({
      index: p.frame, t: p.t,
      position: rot(p.position.map((x) => x * scale) as Vec3).map((x, i) => x + shift[i]!) as Vec3,
      quaternion: mul(q, p.quaternion as Quat), fov_v_deg: p.fov_v_deg,
    })),
  };
}

describe("alignRecovered", () => {
  it.each(["push-in", "orbit"] as const)("recovers the authored %s from a rotated, shifted, rescaled copy", (id) => {
    const a = authored(id);
    const r = alignRecovered(asDa3(a, 0.37, 41, [3, -2, 8]), a)!;
    expect(r.scale).toBeCloseTo(1 / 0.37, 6);
    r.path.forEach((p, i) => {
      const want = a[i * 4]!.position;
      p.forEach((x, k) => expect(x).toBeCloseTo(want[k]!, 6));
    });
  });

  it("keeps a reversed dolly reversed (rotation is not fitted)", () => {
    const a = authored("push-in");
    const rev = { solve_ok: true as const, frames: asDa3(a, 1, 0, [0, 0, 0]).frames.map((f, i, all) => ({ ...f, position: all[all.length - 1 - i]!.position })) };
    const r = alignRecovered(rev, a)!;
    expect(r.scale).toBe(0); // the reversed path anti-correlates with the authored one, so the fit collapses instead of flipping it
    expect(r.path.every((p) => p.every((x, k) => Math.abs(x - a[0]!.position[k]!) < 1e-9))).toBe(true);
  });

  it("returns null for a failed solve", () => {
    expect(alignRecovered({ solve_ok: false, frames: [] }, authored("push-in"))).toBeNull();
  });
});


import { runBlocker } from "../src/logic/runs.ts";

describe("runBlocker", () => {
  const health = { ok: true, liveAvailable: true, calibratedResolution: { width: 768, height: 512 }, maxLiveTakes: 5 };
  const base = { valid: true, live: true, health, resolution: { width: 768, height: 512 }, confirmed: true };
  it("allows a confirmed live run at the calibrated resolution", () => expect(runBlocker(base)).toBeNull());
  it("explains each refusal", () => {
    expect(runBlocker({ ...base, health: null })).toContain("pnpm serve");
    expect(runBlocker({ ...base, valid: false })).toContain("Shot");
    expect(runBlocker({ ...base, health: { ...health, liveAvailable: false } })).toContain("COMFY_API_KEY");
    expect(runBlocker({ ...base, resolution: { width: 1120, height: 480 } })).toContain("768x512");
    expect(runBlocker({ ...base, confirmed: false })).toContain("confirmation");
    expect(runBlocker({ ...base, live: false, confirmed: false, resolution: { width: 1120, height: 480 } })).toBeNull();
  });
});

describe("alignRecovered orientation", () => {
  it("reports ~0 rotation error for an exact copy and the injected yaw for a drifted one", () => {
    const a = authored("push-in");
    const exact = alignRecovered(asDa3(a, 0.5, 33, [1, 2, 3]), a)!;
    expect(Math.max(...exact.poses.map((p) => p.rotErrDeg))).toBeLessThan(1e-3);
    const base = asDa3(a, 0.5, 33, [1, 2, 3]);
    const yaw = (deg: number): Quat => [0, Math.sin((deg * Math.PI) / 360), 0, Math.cos((deg * Math.PI) / 360)];
    const mul = (x: Quat, y: Quat): Quat => [
      x[3] * y[0] + x[0] * y[3] + x[1] * y[2] - x[2] * y[1], x[3] * y[1] - x[0] * y[2] + x[1] * y[3] + x[2] * y[0],
      x[3] * y[2] + x[0] * y[1] - x[1] * y[0] + x[2] * y[3], x[3] * y[3] - x[0] * y[0] - x[1] * y[1] - x[2] * y[2],
    ];
    const drift = { ...base, frames: base.frames.map((f, i) => (i === base.frames.length - 1 ? { ...f, quaternion: mul(f.quaternion, yaw(20)) } : f)) };
    const r = alignRecovered(drift, a)!;
    expect(r.poses[r.poses.length - 1]!.rotErrDeg).toBeGreaterThan(19.9);
    expect(r.poses[r.poses.length - 1]!.rotErrDeg).toBeLessThan(20.1);
    expect(r.poses[0]!.rotErrDeg).toBeLessThan(1e-3);
    // The path barely moves: the drift is invisible to a position-only overlay.
    expect(r.path.length).toBe(exact.path.length);
  });
});
