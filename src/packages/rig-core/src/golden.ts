// Golden clip definitions + per-clip metadata (the true camera path the verifier compares against).
import type { Shot } from "@comfy-osh/contracts";
import { DEFAULT_SENSOR_HEIGHT_MM, vFovDegToFocalMm, vFovDegToFocalPx } from "./fov.ts";
import { dolly, dollyZoom } from "./presets.ts";
import { DEFAULT_DEPTH_NORM, type DepthNormalization } from "./render.ts";
import { sampleShot, type Pose } from "./sampler.ts";
import { len, sub, type Vec3 } from "./math.ts";

/** The 5 SPEC golden clips come from contract fixtures (names = fixtures/shots/<name>.json). */
export const FIXTURE_CLIPS = ["push_in", "orbit", "pan", "zoom_only", "dolly_zoom"] as const;

/**
 * Two extra clips that match the real LTX takes (dollyzoom_* / dolly_control_*): subject distance 5 -> 3,
 * f0 = 1160 px at 512 px height (vFOV 24.9 deg). Same camera path; only the focal length differs.
 */
export const LTX_F0_PX = 1160;
export const LTX_FOV0_DEG = (2 * Math.atan(256 / LTX_F0_PX) * 180) / Math.PI;
export function ltxClips(): { dolly_zoom_5to3: Shot; dolly_5to3: Shot } {
  const common = { from: 5, to: 3, fovDeg: LTX_FOV0_DEG };
  return {
    dolly_zoom_5to3: dollyZoom({ ...common, id: "fx_dolly_zoom_5to3", name: "LTX-matched dolly zoom: subject distance 5 -> 3 m, focal scaled with distance (subject size constant)" }),
    dolly_5to3: dolly({ ...common, id: "fx_dolly_5to3", name: "LTX-matched dolly control: same path 5 -> 3 m, fixed focal (subject grows ~1.67x)" }),
  };
}

export interface FrameMeta {
  frame: number;
  t: number;
  position: Vec3;
  quaternion: [number, number, number, number];
  fov_v_deg: number;
  focal_px: number;
  focal_mm: number;
  subject_distance: number; // camera -> scene node "subject" centre (m)
}

export interface ClipMeta {
  format: "comfy-osh.golden-clip/1";
  name: string;
  files: { rgb: string; depth: string };
  shotId: string;
  fps: number;
  frames: number;
  resolution: { width: number; height: number };
  convention: string;
  intrinsics: { model: "pinhole-square-pixels"; principal_point: "image-centre"; sensor_height_mm: number };
  depth: DepthNormalization & { semantics: string; encoding: string; sky: string };
  interpolation: string;
  segments: Shot["segments"];
  /** Sampled truth: one entry per frame. The verifier should compare against this, not against the sparse track. */
  poses: FrameMeta[];
  /** Authored keyframes + scene (contract Shot). */
  shot: Shot;
}

export function buildMeta(name: string, shot: Shot, norm: DepthNormalization = DEFAULT_DEPTH_NORM): ClipMeta {
  const subject = shot.scene.nodes.find((n) => n.id === "subject")?.transform.position as Vec3 | undefined;
  const poses = sampleShot(shot).map((p: Pose): FrameMeta => ({
    frame: p.frame,
    t: p.t,
    position: p.position,
    quaternion: p.quaternion,
    fov_v_deg: p.fov_v_deg,
    focal_px: vFovDegToFocalPx(p.fov_v_deg, shot.resolution.height),
    focal_mm: vFovDegToFocalMm(p.fov_v_deg),
    subject_distance: subject ? len(sub(p.position, subject)) : NaN,
  }));
  return {
    format: "comfy-osh.golden-clip/1",
    name,
    files: { rgb: `${name}.rgb.mp4`, depth: `${name}.depth.mp4` },
    shotId: shot.id,
    fps: shot.fps,
    frames: shot.frames,
    resolution: shot.resolution,
    convention: "right-handed, Y-up, three.js; camera looks down local -Z; quaternions [x,y,z,w] camera->world",
    intrinsics: { model: "pinhole-square-pixels", principal_point: "image-centre", sensor_height_mm: DEFAULT_SENSOR_HEIGHT_MM },
    depth: {
      ...norm,
      semantics: "view-space z (distance along camera forward axis), metres",
      encoding: "8-bit gray, full range: v = clamp(1 - ln(z/near)/ln(far/near), 0, 1); z = near * exp((1-v) * ln(far/near)); fixed for the whole clip",
      sky: "z = far (v = 0)",
    },
    interpolation: "position linear; orientation shortest-arc slerp; focal length (cot(fov/2)) linear; frame i sampled at t = i/fps; held outside the key range",
    segments: shot.segments,
    poses,
    shot,
  };
}
