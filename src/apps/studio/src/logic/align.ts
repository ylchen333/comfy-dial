// Draw a recovered path in the authored world. DA3 poses live in their own frame with arbitrary scale, so (like the
// verifier) express both paths in the frame-0 camera's axes, fit a single scale s >= 0, then map back through the
// authored frame-0 camera. Rotation is never fitted, so a reversed or sideways move still looks reversed or sideways.
import type { Poses } from "@comfy-osh/contracts";
import { FPS, quatToMat3, type Pose, type Quat, type Vec3 } from "@comfy-osh/rig-core";

// R is row-major camera-to-world. toCam = R^T v, toWorld = R v.
const toCam = (R: number[], v: Vec3): Vec3 => [
  R[0]! * v[0] + R[3]! * v[1] + R[6]! * v[2],
  R[1]! * v[0] + R[4]! * v[1] + R[7]! * v[2],
  R[2]! * v[0] + R[5]! * v[1] + R[8]! * v[2],
];
const toWorld = (R: number[], v: Vec3): Vec3 => [
  R[0]! * v[0] + R[1]! * v[1] + R[2]! * v[2],
  R[3]! * v[0] + R[4]! * v[1] + R[5]! * v[2],
  R[6]! * v[0] + R[7]! * v[1] + R[8]! * v[2],
];

export interface Aligned { path: Vec3[]; scale: number }

/** Null when the solve failed or there is nothing to align. */
export function alignRecovered(poses: Pick<Poses, "solve_ok" | "frames">, authored: readonly Pose[]): Aligned | null {
  if (!poses.solve_ok || poses.frames.length < 2 || authored.length < 2) return null;
  const a0 = authored[0]!;
  const Ra = quatToMat3(a0.quaternion as Quat);
  const f0 = poses.frames[0]!;
  const Rr = quatToMat3(f0.quaternion as Quat);
  let num = 0;
  let den = 0;
  const rels = poses.frames.map((f) => {
    const rel = toCam(Rr, [f.position[0] - f0.position[0], f.position[1] - f0.position[1], f.position[2] - f0.position[2]]);
    const a = authored[Math.min(authored.length - 1, Math.max(0, Math.round(f.t * FPS)))]!;
    const ref = toCam(Ra, [a.position[0] - a0.position[0], a.position[1] - a0.position[1], a.position[2] - a0.position[2]]);
    num += rel[0] * ref[0] + rel[1] * ref[1] + rel[2] * ref[2];
    den += rel[0] * rel[0] + rel[1] * rel[1] + rel[2] * rel[2];
    return rel;
  });
  const scale = den > 1e-18 ? Math.max(num / den, 0) : 0;
  const path = rels.map((r) => {
    const w = toWorld(Ra, [r[0] * scale, r[1] * scale, r[2] * scale]);
    return [a0.position[0] + w[0], a0.position[1] + w[1], a0.position[2] + w[2]] as Vec3;
  });
  return { path, scale };
}
