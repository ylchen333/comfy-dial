// StudioDoc (three independently keyed channels + easing) <-> contract Shot (one track).
// The Shot track is what rig-core's sampler and the verifier consume. Because the sampler only does
// linear/slerp between keys, eased or aim-driven stretches get extra keys (adaptive bisection) until the
// sampler reproduces the studio's own evaluation at every integer frame within tolerance.
import { Shot } from "@comfy-dial/contracts";
import {
  FPS, lookAtQuat, normalize, rotate, samplePose, sub, type Pose, type Quat, type Vec3,
} from "@comfy-dial/rig-core";
import { evalAll } from "./keys.ts";
import { focalToFov, fovToFocal } from "./lens.ts";
import type { Key, StudioDoc } from "./types.ts";

export const TOL = { posM: 1e-4, rotDeg: 0.02, fovDeg: 0.01 };

type TrackKey = Shot["track"][number];

const r9 = (n: number) => Math.round(n * 1e9) / 1e9;
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** lookAt that never returns NaN: coincident eye/aim looks down -Z, vertical aim uses -Z as up. */
export function safeLookAt(eye: Vec3, aim: Vec3): Quat {
  if (dist(eye, aim) < 1e-6) return lookAtQuat(eye, [eye[0], eye[1], eye[2] - 1]);
  const f = normalize(sub(aim, eye));
  return Math.abs(f[1]) > 0.99999 ? lookAtQuat(eye, aim, [0, 0, -1]) : lookAtQuat(eye, aim);
}

export function poseAtFrame(doc: StudioDoc, frame: number): Omit<Pose, "frame" | "t"> {
  const v = evalAll(doc, frame);
  return { position: v.position, quaternion: safeLookAt(v.position, v.aim), fov_v_deg: focalToFov(v.focal, doc.sensorHeightMm) };
}

const trackKey = (doc: StudioDoc, frame: number): TrackKey => {
  const p = poseAtFrame(doc, frame);
  return { t: r9(frame / FPS), position: p.position.map(r9) as Vec3, quaternion: p.quaternion.map(r9) as Quat, fov_v_deg: r9(p.fov_v_deg) };
};

function quatAngle(a: readonly number[], b: readonly number[]): number {
  const d = Math.min(1, Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!));
  return (2 * Math.acos(d) * 180) / Math.PI;
}

function withinTol(doc: StudioDoc, pair: [TrackKey, TrackKey], frame: number): boolean {
  const want = poseAtFrame(doc, frame);
  const got = samplePose(pair, frame / FPS);
  return dist(want.position, got.position) <= TOL.posM
    && quatAngle(want.quaternion, got.quaternion) <= TOL.rotDeg
    && Math.abs(want.fov_v_deg - got.fov_v_deg) <= TOL.fovDeg;
}

/** Frames that become Shot track keys: all authored key frames, both ends, plus bisection refinements. */
export function trackFrames(doc: StudioDoc): number[] {
  const end = doc.frames - 1;
  const set = new Set<number>([0, end]);
  for (const ch of ["position", "aim", "focal"] as const) for (const k of doc[ch] as Key<unknown>[]) if (k.frame <= end) set.add(k.frame);
  const base = [...set].sort((a, b) => a - b);
  const refine = (a: number, b: number) => {
    if (b - a <= 1) return;
    const pair: [TrackKey, TrackKey] = [trackKey(doc, a), trackKey(doc, b)];
    const probes = [...new Set([0.25, 0.5, 0.75].map((u) => Math.floor(a + (b - a) * u)))].filter((f) => f > a && f < b);
    if (probes.every((f) => withinTol(doc, pair, f))) return;
    const m = Math.floor((a + b) / 2);
    set.add(m);
    refine(a, m);
    refine(m, b);
  };
  for (let i = 0; i + 1 < base.length; i++) refine(base[i]!, base[i + 1]!);
  return [...set].sort((a, b) => a - b);
}

export function exportShot(doc: StudioDoc): Shot {
  return {
    version: 1,
    id: doc.id,
    ...(doc.name ? { name: doc.name } : {}),
    scene: doc.scene,
    fps: FPS,
    frames: doc.frames,
    resolution: { ...doc.resolution },
    track: trackFrames(doc).map((f) => trackKey(doc, f)),
    segments: doc.segments.map((s) => ({ ...s })),
  };
}

/**
 * Shot -> doc keys. Aim is a point on the camera's forward ray: at the subject's depth when that is in
 * front of the camera, else 5 m out. For tracks authored by lookAt (presets) this recovers the true target.
 */
export function docFromShot(shot: Shot, base?: Pick<StudioDoc, "sensorHeightMm">): StudioDoc {
  const sensorHeightMm = base?.sensorHeightMm ?? 24;
  const subject = shot.scene.nodes.find((n) => n.id === "subject")?.transform.position as Vec3 | undefined;
  const target: Vec3 = subject ?? [0, 1, 0];
  const byFrame = new Map<number, TrackKey>();
  for (const k of shot.track) byFrame.set(Math.min(shot.frames - 1, Math.round(k.t * shot.fps)), k);
  const frames = [...byFrame.keys()].sort((a, b) => a - b);
  const position: Key<Vec3>[] = [];
  const aim: Key<Vec3>[] = [];
  const focal: Key<number>[] = [];
  for (const frame of frames) {
    const k = byFrame.get(frame)!;
    const p = k.position as Vec3;
    const fwd = rotate(k.quaternion as Quat, [0, 0, -1]);
    const along = fwd[0] * (target[0] - p[0]) + fwd[1] * (target[1] - p[1]) + fwd[2] * (target[2] - p[2]);
    const d = along > 0.5 ? along : 5;
    position.push({ frame, value: [...p], easing: "linear" });
    aim.push({ frame, value: [p[0] + fwd[0] * d, p[1] + fwd[1] * d, p[2] + fwd[2] * d], easing: "linear" });
    focal.push({ frame, value: fovToFocal(k.fov_v_deg, sensorHeightMm), easing: "linear" });
  }
  return {
    id: shot.id,
    ...(shot.name ? { name: shot.name } : {}),
    frames: shot.frames,
    resolution: { ...shot.resolution },
    sensorHeightMm,
    scene: shot.scene,
    segments: shot.segments.map((s) => ({ ...s })),
    position, aim, focal,
  };
}
