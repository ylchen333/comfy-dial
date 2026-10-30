// Authoring readouts and checks (no UI). Every check is tied to something we measured or to the verifier's own rules
// (SPEC section 6, docs/calibration.md); none is a guessed speed or taste limit.
import { FPS, quatAngleDeg, quatToMat3, type Pose, type Quat, type Vec3 } from "@comfy-dial/rig-core";
import type { DepthStats } from "./depthPreview.ts";
import { focalToFov } from "./lens.ts";

export interface Readout { frame: number; seconds: number; focalMm: number; vfovDeg: number; subjectDist: number | null; speed: number }

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Numbers for one frame. `speed` is camera speed in m/s from the neighbouring frames. */
export function frameReadout(poses: readonly Pose[], frame: number, o: { subject: Vec3 | null; sensorHeightMm: number }): Readout {
  const i = Math.min(poses.length - 1, Math.max(0, frame));
  const p = poses[i]!;
  const a = poses[Math.max(0, i - 1)]!;
  const b = poses[Math.min(poses.length - 1, i + 1)]!;
  const span = Math.max(1, Math.min(poses.length - 1, i + 1) - Math.max(0, i - 1));
  // focal (mm) from the vertical FOV: f = (sensor/2) / tan(fov/2)
  const focalMm = o.sensorHeightMm / 2 / Math.tan((p.fov_v_deg * Math.PI) / 360);
  return {
    frame: i, seconds: i / FPS, focalMm, vfovDeg: p.fov_v_deg,
    subjectDist: o.subject ? dist(p.position, o.subject) : null,
    speed: (dist(a.position, b.position) / span) * FPS,
  };
}

export interface Check { id: string; level: "warn" | "info"; text: string }

/** "12-20, 40" from a sorted frame list (runs of consecutive sampled frames collapse). */
export function frameRanges(frames: readonly number[], step = 1): string {
  const out: string[] = [];
  for (let i = 0; i < frames.length; ) {
    let j = i;
    while (j + 1 < frames.length && frames[j + 1]! - frames[j]! <= step) j++;
    out.push(frames[i] === frames[j] ? `${frames[i]}` : `${frames[i]}-${frames[j]}`);
    i = j + 1;
  }
  return out.join(", ");
}

const pathLength = (poses: readonly Pose[]) => poses.slice(1).reduce((s, p, i) => s + dist(p.position, poses[i]!.position), 0);

/** Where the subject sits in the frame: normalised device coordinates, or null when it is behind the camera. */
export function subjectNdc(p: Pose, subject: Vec3, aspect: number): { x: number; y: number } | null {
  const R = quatToMat3(p.quaternion as Quat);
  const v: Vec3 = [subject[0] - p.position[0], subject[1] - p.position[1], subject[2] - p.position[2]];
  const x = R[0]! * v[0] + R[3]! * v[1] + R[6]! * v[2];
  const y = R[1]! * v[0] + R[4]! * v[1] + R[7]! * v[2];
  const z = R[2]! * v[0] + R[5]! * v[1] + R[8]! * v[2];
  if (z >= 0) return null;
  const t = Math.tan((p.fov_v_deg * Math.PI) / 360);
  return { x: x / -z / (t * aspect), y: y / -z / t };
}

export function shotChecks(poses: readonly Pose[], o: {
  subject: Vec3 | null; aspect: number; depth: { frame: number; stats: DepthStats }[]; depthStep?: number;
}): Check[] {
  if (poses.length < 2) return [];
  const out: Check[] = [];
  const first = poses[0]!, last = poses[poses.length - 1]!;
  const ratio = Math.tan((first.fov_v_deg * Math.PI) / 360) / Math.tan((last.fov_v_deg * Math.PI) / 360); // focal ratio last / first
  if (Math.abs(ratio - 1) > 0.1)
    out.push({ id: "focal-change", level: "warn", text: `Focal length changes x${ratio.toFixed(2)} over the shot. The verifier doesn't gate translation or FOV when the focal ratio is more than 10% from 1, and the move label matched on 2 of 5 real dolly-zoom takes.` });

  const len = pathLength(poses);
  const turn = poses.reduce((m, p) => Math.max(m, quatAngleDeg(first.quaternion as Quat, p.quaternion as Quat)), 0);
  if (len < 0.05 && turn < 2) out.push({ id: "no-motion", level: "warn", text: "The camera barely moves, so there is nothing for the verifier to measure." });
  else if (len < 0.05) out.push({ id: "rotation-only", level: "info", text: "Pan or tilt only: takes are scored on rotation alone (no translation check)." });

  if (o.subject) {
    const off = poses.filter((p) => { const n = subjectNdc(p, o.subject!, o.aspect); return !n || Math.abs(n.x) > 1 || Math.abs(n.y) > 1; }).map((p) => p.frame);
    if (off.length) out.push({ id: "subject-out", level: "warn", text: `The subject is out of frame at frames ${frameRanges(off)}.` });
  }

  const step = o.depthStep ?? 8;
  const near = o.depth.filter((d) => d.stats.nearFrac > 0);
  if (near.length) {
    const worst = Math.max(...near.map((d) => d.stats.nearFrac));
    out.push({ id: "near-plane", level: "warn", text: `Geometry is closer than 1 m at frames ${frameRanges(near.map((d) => d.frame), step)} (up to ${(worst * 100).toFixed(0)}% of the frame). The depth guide saturates there, so the model gets no depth cue.` });
  }
  const empty = o.depth.filter((d) => d.stats.emptyFrac >= 0.999);
  if (empty.length) out.push({ id: "empty-frame", level: "warn", text: `Nothing is in range at frames ${frameRanges(empty.map((d) => d.frame), step)}: the depth guide is blank (all sky or beyond 100 m).` });
  return out;
}
