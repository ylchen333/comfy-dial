// Turn the camera recovered from a reference video (a Poses file) into editable Author keys (no UI).
//
// What is trustworthy and what is not (SPEC section 6, docs/calibration.md):
//  - Rotation and path SHAPE come through well (real takes score 0.5 to 1.4 degrees).
//  - Scale is arbitrary for a monocular solve, so the user states the camera travel in metres.
//  - Recovered FOV is biased (about +10 deg) and under-tracks real zooms, so zoom is off by default; "ratio" uses only the
//    change in focal length relative to the first frame.
import type { Poses } from "@comfy-osh/contracts";
import { FPS, quatAngleDeg, rotate, type Quat, type Vec3 } from "@comfy-osh/rig-core";
import { poseAtFrame } from "./compile.ts";
import { evalChannel } from "./keys.ts";
import type { Key, Result, StudioDoc } from "./types.ts";

export interface RefOptions {
  /** Camera path length in metres (the one number a monocular solve cannot know). */
  travelM: number;
  zoom: "keep" | "ratio";
  /** Upper bound on keys per channel after simplification. */
  maxKeys?: number;
}
export interface RefKeys {
  position: Key<Vec3>[];
  aim: Key<Vec3>[];
  focal: Key<number>[];
  summary: { durationSec: number; travelM: number; maxTurnDeg: number; solvedFrames: number; keys: { position: number; aim: number; focal: number } };
}

const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const sub = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v - b[i]!);
const norm = (v: readonly number[]) => Math.hypot(...v);

/**
 * Indices to keep so that linear interpolation BETWEEN KEPT FRAMES (in time, as the studio plays keys) stays within `eps`
 * of every sample. Time-aware, so a speed change survives simplification.
 */
export function simplify(frames: readonly number[], vals: readonly (readonly number[])[], eps: number): number[] {
  const keep = new Set<number>([0, frames.length - 1]);
  const split = (a: number, b: number) => {
    let worst = -1, at = -1;
    for (let k = a + 1; k < b; k++) {
      const u = (frames[k]! - frames[a]!) / Math.max(1, frames[b]! - frames[a]!);
      const d = norm(sub(vals[k]!, vals[a]!.map((v, i) => v + (vals[b]![i]! - v) * u)));
      if (d > worst) { worst = d; at = k; }
    }
    if (worst > eps) { keep.add(at); split(a, at); split(at, b); }
  };
  if (frames.length > 2) split(0, frames.length - 1);
  return [...keep].sort((x, y) => x - y);
}

/** Simplify with the smallest tolerance (doubling from eps0) that gives at most maxKeys keys. */
function simplifyTo(frames: number[], vals: number[][], eps0: number, maxKeys: number): number[] {
  let eps = eps0, idx = simplify(frames, vals, eps);
  while (idx.length > maxKeys && eps < 1e6) { eps *= 1.6; idx = simplify(frames, vals, eps); }
  return idx;
}

export function keysFromReference(poses: Pick<Poses, "solve_ok" | "frames">, doc: StudioDoc, o: RefOptions): Result<RefKeys> {
  const err = (error: string): Result<RefKeys> => ({ ok: false, error });
  if (!poses.solve_ok) return err("the pose solve failed for this video, so there is no camera to copy");
  const fr = [...poses.frames].sort((a, b) => a.t - b.t);
  if (fr.length < 3) return err(`only ${fr.length} solved frames: need at least 3 to describe a move`);
  const dur = fr[fr.length - 1]!.t - fr[0]!.t;
  if (!(dur > 0)) return err("the solved frames have no time span");
  if (!(o.travelM >= 0) || !Number.isFinite(o.travelM)) return err("camera travel must be a number of metres, zero or more");
  const maxKeys = Math.max(2, o.maxKeys ?? 12);

  const a0 = poseAtFrame(doc, 0);
  const qa0 = a0.quaternion as Quat;
  const qr0 = fr[0]!.quaternion as Quat;
  const pr0 = fr[0]!.position as Vec3;
  // Path in the reference's frame-0 camera axes, so "forward" means forward of the first frame.
  const rels = fr.map((f) => rotate(qconj(qr0), sub(f.position, pr0) as Vec3));
  let L = 0;
  for (let i = 1; i < rels.length; i++) L += norm(sub(rels[i]!, rels[i - 1]!));
  const s = L > 1e-9 ? o.travelM / L : 0;

  const aimDist0 = norm(sub(evalChannel(doc, "aim", 0), a0.position));
  const D = aimDist0 > 0.5 ? aimDist0 : 5;
  const pos: Vec3[] = [], aim: Vec3[] = [], quats: Quat[] = [];
  for (let i = 0; i < fr.length; i++) {
    const w = rotate(qa0, [rels[i]![0] * s, rels[i]![1] * s, rels[i]![2] * s]);
    const p: Vec3 = [a0.position[0] + w[0], a0.position[1] + w[1], a0.position[2] + w[2]];
    const q = qmul(qa0, qmul(qconj(qr0), fr[i]!.quaternion as Quat));
    const fwd = rotate(q, [0, 0, -1]);
    pos.push(p); quats.push(q); aim.push([p[0] + fwd[0] * D, p[1] + fwd[1] * D, p[2] + fwd[2] * D]);
  }
  // Retime to the shot: the reference's whole duration becomes the shot's whole duration.
  const frames = fr.map((f) => Math.round(((f.t - fr[0]!.t) / dur) * (doc.frames - 1)));
  const uniq: number[] = [];
  frames.forEach((f, i) => { if (uniq.length && frames[uniq[uniq.length - 1]!] === f) uniq[uniq.length - 1] = i; else uniq.push(i); });
  const F = uniq.map((i) => frames[i]!);

  const pick = (vals: number[][], eps: number) => simplifyTo(F, uniq.map((i) => vals[i]!), eps, maxKeys);
  const posIdx = pick(pos, 0.02);
  const aimIdx = pick(aim, 0.01 * D);
  const key = <T>(idx: number[], vals: T[]): Key<T>[] => idx.map((k) => ({ frame: F[k]!, value: vals[uniq[k]!]!, easing: "linear" as const }));

  const focal0 = evalChannel(doc, "focal", 0);
  let focal: Key<number>[] = [{ frame: 0, value: focal0, easing: "linear" }];
  if (o.zoom === "ratio") {
    const t0 = Math.tan((fr[0]!.fov_v_deg * Math.PI) / 360);
    const f = uniq.map((i) => [Math.min(4, Math.max(0.25, t0 / Math.tan((fr[i]!.fov_v_deg * Math.PI) / 360))) * focal0]);
    const idx = simplifyTo(F, f, Math.max(0.5, focal0 * 0.015), maxKeys);
    focal = idx.map((k) => ({ frame: F[k]!, value: +f[k]![0]!.toFixed(2), easing: "linear" as const }));
  }
  const position = key(posIdx, pos.map((p) => p.map((v) => +v.toFixed(4)) as Vec3));
  const aimKeys = key(aimIdx, aim.map((p) => p.map((v) => +v.toFixed(4)) as Vec3));
  return {
    ok: true,
    value: {
      position, aim: aimKeys, focal,
      summary: {
        durationSec: dur, travelM: o.travelM, solvedFrames: fr.length,
        maxTurnDeg: Math.max(...quats.map((q) => quatAngleDeg(qa0, q))),
        keys: { position: position.length, aim: aimKeys.length, focal: focal.length },
      },
    },
  };
}

/** Replace the three channels with the reference's keys. The caller commits it, so Undo restores the old move. */
export const applyReference = (doc: StudioDoc, k: Pick<RefKeys, "position" | "aim" | "focal">): StudioDoc => ({ ...doc, position: k.position, aim: k.aim, focal: k.focal });

/** Frames per second the studio keys are measured in (re-exported so callers need not import rig-core for it). */
export const KEY_FPS = FPS;
