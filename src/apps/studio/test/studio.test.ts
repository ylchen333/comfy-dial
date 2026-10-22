import { describe, expect, it } from "vitest";
import { Shot } from "@comfy-osh/contracts";
import { quatAngleDeg, sampleShot, focalMmToVFovDeg, type Quat, type Vec3 } from "@comfy-osh/rig-core";
import { exportShot, poseAtFrame, TOL } from "../src/logic/compile.ts";
import { canRedo, canUndo, commit, createHistory, redo, undo } from "../src/logic/history.ts";
import { exportShotJson, importShotJson, parsePosesJson, validateDoc } from "../src/logic/io.ts";
import {
  addKeyAtCurrent, deleteKey, evalChannel, moveKey, newDoc, setEasing, setFrames, setSensorHeight, upsertKey,
} from "../src/logic/keys.ts";
import { applyPreset, PRESET_IDS } from "../src/logic/presets.ts";
import type { StudioDoc } from "../src/logic/types.ts";

const ok = <T>(r: { ok: boolean; value?: T; error?: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value as T;
};

describe("keyframe store", () => {
  it("upserts, sorts, moves and deletes keys per channel independently", () => {
    let d = newDoc();
    d = ok(upsertKey(d, "position", 60, [1, 1.6, 4]));
    d = ok(upsertKey(d, "position", 30, [0, 1.6, 5]));
    expect(d.position.map((k) => k.frame)).toEqual([0, 30, 60]);
    expect(d.aim).toHaveLength(1);
    expect(d.focal).toHaveLength(1);
    d = ok(moveKey(d, "position", 30, 45));
    expect(d.position.map((k) => k.frame)).toEqual([0, 45, 60]);
    expect(moveKey(d, "position", 45, 60).ok).toBe(false);
    expect(moveKey(d, "position", 45, 999).ok).toBe(false);
    d = ok(deleteKey(d, "position", 45));
    expect(d.position.map((k) => k.frame)).toEqual([0, 60]);
    expect(deleteKey(newDoc(), "focal", 0).ok).toBe(false); // last key stays
  });

  it("keeps the easing when re-keying and applies per-key easing", () => {
    let d = newDoc();
    d = ok(upsertKey(d, "focal", 120, 70));
    expect(evalChannel(d, "focal", 60)).toBeCloseTo(52.5, 9);
    d = ok(setEasing(d, "focal", 0, "easeIn"));
    expect(evalChannel(d, "focal", 60)).toBeCloseTo(35 + 35 * 0.25, 9);
    d = ok(upsertKey(d, "focal", 0, 40));
    expect(d.focal[0]!.easing).toBe("easeIn");
    expect(addKeyAtCurrent(d, "focal", 0).ok).toBe(false);
    d = ok(addKeyAtCurrent(d, "aim", 50));
    expect(d.aim.map((k) => k.frame)).toEqual([0, 50]);
  });

  it("enforces 1+8k frames and drops keys past the new end", () => {
    let d = ok(upsertKey(newDoc(), "position", 120, [0, 1.6, 2]));
    expect(setFrames(d, 120).ok).toBe(false);
    expect(setFrames(d, 8).ok).toBe(false);
    expect(setFrames(d, 1).ok).toBe(false);
    d = ok(setFrames(d, 65));
    expect(d.position.map((k) => k.frame)).toEqual([0]);
    expect(validateDoc(d).ok).toBe(true);
    expect(upsertKey(d, "position", 65, [0, 0, 0]).ok).toBe(false);
    // a doc that somehow holds a bad frame count fails contract validation
    const bad: StudioDoc = { ...newDoc(), frames: 120 };
    const v = validateDoc(bad);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.join("\n")).toMatch(/1 \+ 8k/);
  });

  it("rescales focal keys so framing is kept when the sensor changes", () => {
    const d = ok(setSensorHeight(newDoc(), 12));
    expect(d.focal[0]!.value).toBeCloseTo(17.5, 9);
    expect(focalMmToVFovDeg(d.focal[0]!.value, 12)).toBeCloseTo(focalMmToVFovDeg(35, 24), 9);
  });

  it("undo / redo walks snapshots", () => {
    const d0 = newDoc();
    const d1 = ok(upsertKey(d0, "focal", 60, 50));
    const d2 = ok(upsertKey(d1, "focal", 120, 85));
    let h = commit(commit(createHistory(d0), d1), d2);
    expect(canUndo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe(d1);
    h = undo(h);
    expect(h.present).toBe(d0);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present).toBe(d1);
    expect(canRedo(h)).toBe(true);
    h = commit(h, ok(upsertKey(d1, "focal", 30, 40)));
    expect(canRedo(h)).toBe(false);
  });
});

describe("presets -> keys -> Shot", () => {
  for (const id of PRESET_IDS) {
    it(`${id} lays down keys that export to a contract-valid Shot`, () => {
      const d = applyPreset(newDoc(), id);
      expect(d.position.length).toBeGreaterThanOrEqual(1);
      const shot = exportShot(d);
      expect(Shot.safeParse(shot).success).toBe(true);
      expect(shot.frames).toBe(121);
      expect(shot.track[0]!.t).toBe(0);
      expect(shot.track[shot.track.length - 1]!.t).toBeCloseTo(120 / 25, 9);
    });

    it(`${id}: rig-core sampler frames 0 and last match the keys`, () => {
      const d = applyPreset(newDoc(), id);
      const poses = sampleShot(exportShot(d));
      expect(poses).toHaveLength(121);
      for (const frame of [0, 120]) {
        const want = poseAtFrame(d, frame);
        const got = poses[frame]!;
        expect(Math.hypot(...(got.position.map((v, i) => v - want.position[i]!) as Vec3))).toBeLessThan(TOL.posM);
        expect(quatAngleDeg(got.quaternion, want.quaternion as Quat)).toBeLessThan(TOL.rotDeg);
        expect(Math.abs(got.fov_v_deg - want.fov_v_deg)).toBeLessThan(TOL.fovDeg);
      }
    });
  }

  it("dolly zoom ends at the focal length that keeps the subject framed", () => {
    const d = applyPreset(newDoc(), "dolly-zoom");
    const f0 = d.focal[0]!.value;
    const f1 = d.focal[d.focal.length - 1]!.value;
    // distance 8 -> 3 (to the target plane): focal scales by 3/8
    expect(f1 / f0).toBeCloseTo(3 / 8, 2);
  });

  it("sampler playback agrees with studio evaluation at every frame, even with easing and aim moves", () => {
    let d = newDoc();
    d = ok(upsertKey(d, "position", 120, [3, 2, 3]));
    d = ok(upsertKey(d, "aim", 60, [1, 1, 0], "easeInOut"));
    d = ok(upsertKey(d, "aim", 120, [-1, 1.5, 0]));
    d = ok(upsertKey(d, "focal", 90, 85, "easeOut"));
    d = ok(setEasing(d, "position", 0, "easeIn"));
    const shot = exportShot(d);
    expect(Shot.safeParse(shot).success).toBe(true);
    const poses = sampleShot(shot);
    for (const p of poses) {
      const want = poseAtFrame(d, p.frame);
      expect(Math.hypot(...(p.position.map((v, i) => v - want.position[i]!) as Vec3))).toBeLessThan(TOL.posM * 2);
      expect(quatAngleDeg(p.quaternion, want.quaternion as Quat)).toBeLessThan(TOL.rotDeg * 2);
      expect(Math.abs(p.fov_v_deg - want.fov_v_deg)).toBeLessThan(TOL.fovDeg * 2);
    }
  });

  it("handles a vertical aim and coincident aim without NaN", () => {
    let d = ok(upsertKey(newDoc(), "aim", 120, [0, 50, 6]));
    d = ok(upsertKey(d, "position", 120, [0, 1.6, 6]));
    expect(validateDoc(d).ok).toBe(true);
  });
});

describe("import / export", () => {
  it("round-trips: doc -> JSON -> doc -> JSON gives the same Shot poses", () => {
    const d = applyPreset(newDoc(), "orbit");
    const json = ok(exportShotJson(d));
    const imported = ok(importShotJson(json, d));
    const again = exportShot(imported);
    const orig = JSON.parse(json) as Shot;
    expect(again.frames).toBe(orig.frames);
    expect(again.resolution).toEqual(orig.resolution);
    expect(again.scene).toEqual(orig.scene);
    expect(again.segments).toEqual(orig.segments);
    const a = sampleShot(orig);
    const b = sampleShot(again);
    for (let i = 0; i < a.length; i++) {
      expect(Math.hypot(...(a[i]!.position.map((v, k) => v - b[i]!.position[k]!) as Vec3))).toBeLessThan(1e-3);
      expect(quatAngleDeg(a[i]!.quaternion, b[i]!.quaternion)).toBeLessThan(0.05);
      expect(Math.abs(a[i]!.fov_v_deg - b[i]!.fov_v_deg)).toBeLessThan(0.01);
    }
  });

  it("a simple push-in round-trips to an identical key count and focal", () => {
    const d = applyPreset(newDoc(), "push-in");
    const imported = ok(importShotJson(ok(exportShotJson(d)), d));
    expect(imported.focal[0]!.value).toBeCloseTo(d.focal[0]!.value, 6);
    expect(imported.position[0]!.value[2]).toBeCloseTo(7, 6);
    expect(imported.frames).toBe(121);
  });

  it("reports contract errors instead of importing", () => {
    expect(importShotJson("{nope").ok).toBe(false);
    const d = newDoc();
    const shot = JSON.parse(ok(exportShotJson(d))) as Record<string, unknown>;
    const r = importShotJson(JSON.stringify({ ...shot, frames: 120 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("frames"))).toBe(true);
    const r2 = importShotJson(JSON.stringify({ ...shot, fps: 24 }));
    expect(r2.ok).toBe(false);
  });

  it("parses recovered Poses and rejects failed solves", () => {
    const poses = {
      schema: "comfy-osh/poses/1", fps: 25, image: { width: 64, height: 64 }, solve_ok: true,
      frames: [
        { index: 0, t: 0, position: [0, 0, 0], quaternion: [0, 0, 0, 1], fov_v_deg: 40 },
        { index: 1, t: 0.04, position: [0, 0, -1], quaternion: [0, 0, 0, 1], fov_v_deg: 40 },
      ],
    };
    const r = parsePosesJson(JSON.stringify(poses));
    expect(r.ok && r.value.length).toBe(2);
    expect(parsePosesJson(JSON.stringify({ ...poses, solve_ok: false, frames: [] })).ok).toBe(false);
    expect(parsePosesJson("[]").ok).toBe(false);
  });
});
