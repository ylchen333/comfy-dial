// Deterministic keyframe sampler: Shot.track -> one pose per frame.
// Frame i is sampled at t = i / fps. Before the first / after the last key the pose is held.
// Position: linear. Orientation: shortest-arc slerp. Zoom: linear in focal length (cot(fov/2)),
// which is what makes a linear dolly + linear focal ramp an exact dolly zoom.
import type { Shot } from "@comfy-osh/contracts";
import { lerp3, quatNormalize, slerp, type Quat, type Vec3 } from "./math.ts";

export interface Pose {
  frame: number;
  t: number;
  position: Vec3;
  quaternion: Quat;
  fov_v_deg: number;
}

type Key = Shot["track"][number];

const cotHalf = (fovDeg: number) => 1 / Math.tan((fovDeg * Math.PI) / 360);
const fovFromCot = (c: number) => (2 * Math.atan(1 / c) * 180) / Math.PI;

export function samplePose(track: readonly Key[], t: number): Omit<Pose, "frame" | "t"> {
  const first = track[0]!;
  const last = track[track.length - 1]!;
  const hold = (k: Key) => ({
    position: [...k.position] as Vec3,
    quaternion: quatNormalize([...k.quaternion] as Quat),
    fov_v_deg: k.fov_v_deg,
  });
  if (t <= first.t) return hold(first);
  if (t >= last.t) return hold(last);
  let i = 0;
  while (track[i + 1]!.t < t) i++;
  const a = track[i]!;
  const b = track[i + 1]!;
  const u = (t - a.t) / (b.t - a.t);
  return {
    position: lerp3(a.position as Vec3, b.position as Vec3, u),
    quaternion: slerp(a.quaternion as Quat, b.quaternion as Quat, u),
    fov_v_deg: fovFromCot(cotHalf(a.fov_v_deg) + (cotHalf(b.fov_v_deg) - cotHalf(a.fov_v_deg)) * u),
  };
}

export function sampleShot(shot: Pick<Shot, "track" | "frames" | "fps">): Pose[] {
  const poses: Pose[] = [];
  for (let frame = 0; frame < shot.frames; frame++) {
    const t = frame / shot.fps;
    poses.push({ frame, t, ...samplePose(shot.track, t) });
  }
  return poses;
}
