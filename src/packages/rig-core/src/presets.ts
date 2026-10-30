// The 5 move presets (push-in, pull-out, orbit, pan, dolly zoom) plus plain dolly / zoom helpers.
// Each compiles to a contract-valid Shot whose track the sampler turns into per-frame poses.
import type { Shot } from "@comfy-dial/contracts";
import { dollyZoomFovDeg } from "./fov.ts";
import { lookAtQuat, yawQuat, type Quat, type Vec3 } from "./math.ts";

export const FPS = 25;
export const DEFAULT_FRAMES = 121;
export const DEFAULT_RESOLUTION = { width: 768, height: 512 } as const;
export const DEFAULT_EYE_HEIGHT = 1.6;
export const DEFAULT_TARGET: Vec3 = [0, 1, 0];

/** Same scene as the contract fixtures (ground, subject box, two pillars). */
export const DEFAULT_SCENE: Shot["scene"] = {
  nodes: [
    { id: "ground", asset: "primitive:plane", transform: { position: [0, 0, 0], quaternion: [-0.707106781, 0, 0, 0.707106781], scale: [20, 20, 1] } },
    { id: "subject", asset: "primitive:box", transform: { position: [0, 1, 0], quaternion: [0, 0, 0, 1], scale: [1, 2, 1] } },
    { id: "pillar_l", asset: "primitive:cylinder", transform: { position: [-3, 1.5, -2], quaternion: [0, 0, 0, 1], scale: [0.5, 3, 0.5] } },
    { id: "pillar_r", asset: "primitive:cylinder", transform: { position: [3, 1.5, -2], quaternion: [0, 0, 0, 1], scale: [0.5, 3, 0.5] } },
  ],
};

export interface PresetBase {
  id: string;
  name?: string;
  frames?: number;
  eyeHeight?: number;
  target?: Vec3;
  scene?: Shot["scene"];
}

const r9 = (n: number) => Math.round(n * 1e9) / 1e9;
export const key = (t: number, position: Vec3, quaternion: Quat, fov: number): Shot["track"][number] => ({
  t: r9(t),
  position: position.map(r9) as Vec3,
  quaternion: quaternion.map(r9) as Quat,
  fov_v_deg: r9(fov),
});

export function makeShot(base: PresetBase, track: Shot["track"]): Shot {
  const frames = base.frames ?? DEFAULT_FRAMES;
  const cuts = [0, 1, 2, 3].map((i) => Math.floor((frames * i) / 3));
  return {
    version: 1,
    id: base.id,
    ...(base.name ? { name: base.name } : {}),
    scene: base.scene ?? DEFAULT_SCENE,
    fps: FPS,
    frames,
    resolution: { ...DEFAULT_RESOLUTION },
    track,
    segments: [0, 1, 2].map((i) => ({ start: cuts[i]!, end: cuts[i + 1]! })),
  };
}

export const duration = (base: PresetBase) => ((base.frames ?? DEFAULT_FRAMES) - 1) / FPS;

export interface DollyOpts extends PresetBase { from: number; to: number; fovDeg: number }

/** Move along the Z axis toward/away from the subject, fixed focal length. from > to = push-in. */
export function dolly(o: DollyOpts): Shot {
  const h = o.eyeHeight ?? DEFAULT_EYE_HEIGHT;
  const tgt = o.target ?? DEFAULT_TARGET;
  const a: Vec3 = [0, h, o.from];
  const b: Vec3 = [0, h, o.to];
  return makeShot(o, [key(0, a, lookAtQuat(a, tgt), o.fovDeg), key(duration(o), b, lookAtQuat(b, tgt), o.fovDeg)]);
}
export const pushIn = (o: DollyOpts): Shot => dolly(o);
export const pullOut = (o: DollyOpts): Shot => dolly({ ...o, from: o.to, to: o.from });

export interface OrbitOpts extends PresetBase { radius: number; startDeg: number; endDeg: number; fovDeg: number }
/** Orbit around the target on a circle; positive angle goes from +Z toward +X. Dense keys follow the arc. */
export function orbit(o: OrbitOpts): Shot {
  const h = o.eyeHeight ?? DEFAULT_EYE_HEIGHT;
  const tgt = o.target ?? DEFAULT_TARGET;
  const span = o.endDeg - o.startDeg;
  const n = Math.max(2, Math.ceil(Math.abs(span) / 10));
  const track = Array.from({ length: n + 1 }, (_, i) => {
    const a = ((o.startDeg + (span * i) / n) * Math.PI) / 180;
    const eye: Vec3 = [o.radius * Math.sin(a), h, o.radius * Math.cos(a)];
    return key((duration(o) * i) / n, eye, lookAtQuat(eye, tgt), o.fovDeg);
  });
  return makeShot(o, track);
}

export interface PanOpts extends PresetBase { distance: number; yawDeg: number; fovDeg: number }
/** Rotate about +Y from a fixed position (positive yaw = pan left). Starts looking down -Z. */
export function pan(o: PanOpts): Shot {
  const eye: Vec3 = [0, o.eyeHeight ?? DEFAULT_EYE_HEIGHT, o.distance];
  return makeShot(o, [key(0, eye, yawQuat(0), o.fovDeg), key(duration(o), eye, yawQuat(o.yawDeg), o.fovDeg)]);
}

export interface ZoomOpts extends PresetBase { distance: number; fromFovDeg: number; toFovDeg: number }
/** Camera fixed, focal length ramps (zoom only). */
export function zoom(o: ZoomOpts): Shot {
  const eye: Vec3 = [0, o.eyeHeight ?? DEFAULT_EYE_HEIGHT, o.distance];
  const q = lookAtQuat(eye, o.target ?? DEFAULT_TARGET);
  return makeShot(o, [key(0, eye, q, o.fromFovDeg), key(duration(o), eye, q, o.toFovDeg)]);
}

/**
 * Dolly zoom: dolly from `from` to `to` while the focal length scales with subject distance so the
 * subject's framed size stays constant (d * tan(fov/2) = const). The sampler interpolates focal
 * length linearly, so 2 keys are already exact.
 */
export function dollyZoom(o: DollyOpts): Shot {
  const h = o.eyeHeight ?? DEFAULT_EYE_HEIGHT;
  const tgt = o.target ?? DEFAULT_TARGET;
  const a: Vec3 = [0, h, o.from];
  const b: Vec3 = [0, h, o.to];
  return makeShot(o, [
    key(0, a, lookAtQuat(a, tgt), o.fovDeg),
    key(duration(o), b, lookAtQuat(b, tgt), dollyZoomFovDeg(o.fovDeg, o.from, o.to)),
  ]);
}
