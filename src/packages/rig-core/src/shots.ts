// One preset per camera-shot type in SHOT.md (StudioBinder's guide). Size, angle and movement shots
// compile to a contract-valid Shot; framing and focus shots that a camera track cannot express carry a
// prompt hint instead (the depth guide only encodes geometry, and the lens/DoF layer is Parking Lot).
import type { Shot } from "@comfy-dial/contracts";
import { dollyZoomFovDeg } from "./fov.ts";
import { lookAtQuat, quatNormalize, yawQuat, type Quat, type Vec3 } from "./math.ts";
import { DEFAULT_TARGET, duration, FPS, key, makeShot, orbit, type PresetBase } from "./presets.ts";

export type ShotGroup = "size" | "framing" | "focus" | "angle" | "movement" | "equipment";
export type ShotSupport = "camera" | "alias" | "prompt-only";

export interface ShotType {
  id: string;
  name: string;
  group: ShotGroup;
  support: ShotSupport;
  /** alias: the camera preset this shot type uses. */
  aliasOf?: string;
  /** prompt-only: text to add to the LTX prompt. */
  promptHint?: string;
  /** prompt-only: what the scene would need for a camera track to exist. */
  needs?: string;
}

const camera = (id: string, name: string, group: ShotGroup): ShotType => ({ id, name, group, support: "camera" });
const alias = (id: string, name: string, group: ShotGroup, aliasOf: string): ShotType => ({ id, name, group, support: "alias", aliasOf });
const prompt = (id: string, name: string, group: ShotGroup, promptHint: string, needs?: string): ShotType =>
  ({ id, name, group, support: "prompt-only", promptHint, ...(needs ? { needs } : {}) });

export const SHOT_TYPES: readonly ShotType[] = [
  // Shot size
  camera("extreme-wide", "Extreme Wide Shot", "size"),
  camera("wide", "Wide Shot", "size"),
  camera("full", "Full Shot", "size"),
  camera("medium-wide", "Medium Wide Shot", "size"),
  camera("cowboy", "Cowboy Shot", "size"),
  camera("medium", "Medium Shot", "size"),
  camera("medium-close-up", "Medium Close-Up", "size"),
  camera("close-up", "Close-Up", "size"),
  camera("extreme-close-up", "Extreme Close-Up", "size"),
  camera("establishing", "Establishing Shot", "size"),
  // Shot framing
  alias("single", "Single Shot", "framing", "medium"),
  prompt("two-shot", "Two Shot", "framing", "two people framed together in one shot", "a second figure in the scene"),
  prompt("three-shot", "Three Shot", "framing", "three people framed together in one shot", "two more figures in the scene"),
  prompt("over-the-shoulder", "Over-the-Shoulder Shot", "framing", "over-the-shoulder shot, a shoulder blurred in the foreground", "a second figure in the scene"),
  prompt("over-the-hip", "Over-the-Hip Shot", "framing", "over-the-hip shot, a hip in the foreground", "a second figure in the scene"),
  camera("pov", "Point-of-View Shot", "framing"),
  // Shot focus
  prompt("rack-focus", "Rack Focus", "focus", "rack focus, focus shifts from the foreground subject to the background"),
  prompt("shallow-focus", "Shallow Focus", "focus", "shallow depth of field, subject sharp, background and foreground blurred"),
  prompt("deep-focus", "Deep Focus", "focus", "deep focus, everything in frame sharp"),
  prompt("tilt-shift", "Tilt-Shift", "focus", "tilt-shift lens, selective focus band, miniature look"),
  prompt("soft-focus", "Soft Focus", "focus", "soft focus, dreamy glow, nothing fully sharp"),
  prompt("split-diopter", "Split Diopter", "focus", "split diopter, foreground and background both sharp, blurred middle"),
  // Camera angle
  camera("eye-level", "Eye Level", "angle"),
  camera("low-angle", "Low Angle", "angle"),
  camera("high-angle", "High Angle", "angle"),
  camera("hip-level", "Hip Level", "angle"),
  camera("knee-level", "Knee Level", "angle"),
  camera("ground-level", "Ground Level", "angle"),
  camera("shoulder-level", "Shoulder Level", "angle"),
  camera("dutch-angle", "Dutch Angle", "angle"),
  camera("birds-eye", "Bird's Eye View", "angle"),
  camera("aerial", "Aerial Shot", "angle"),
  // Camera movement
  camera("static", "Static Shot", "movement"),
  alias("dolly", "Dolly Shot", "movement", "push-in"),
  camera("push-in", "Push-In", "movement"),
  camera("pull-out", "Pull-Out", "movement"),
  camera("zoom-in", "Zoom In", "movement"),
  camera("zoom-out", "Zoom Out", "movement"),
  camera("dolly-zoom", "Dolly Zoom", "movement"),
  alias("vertigo", "Vertigo Shot", "movement", "dolly-zoom"),
  camera("pan", "Pan", "movement"),
  camera("tilt", "Tilt", "movement"),
  camera("whip-pan", "Whip Pan", "movement"),
  camera("whip-tilt", "Whip Tilt", "movement"),
  camera("tracking", "Tracking Shot", "movement"),
  camera("crab", "Crab Shot", "movement"),
  camera("arc", "Arc Shot", "movement"),
  // Equipment
  alias("sticks", "Sticks / Tripod", "equipment", "static"),
  camera("slider", "Slider Shot", "equipment"),
  camera("handheld", "Handheld", "equipment"),
  alias("steadicam", "Steadicam", "equipment", "tracking"),
  alias("gimbal", "Gimbal", "equipment", "tracking"),
  camera("crane", "Crane Shot", "equipment"),
  camera("jib", "Jib Shot", "equipment"),
  camera("drone", "Drone Shot", "equipment"),
  alias("wire", "Wire Shot", "equipment", "tracking"),
];

export interface ShotOpts extends PresetBase {
  fovDeg?: number;
}

const DEFAULT_FOV_DEG = 40;
/** Height of the default mannequin; its soles sit 0.9 m below `target`. */
export const SUBJECT_HEIGHT_M = 1.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Quaternion multiply a*b (apply b first). */
function qmul(a: Quat, b: Quat): Quat {
  return quatNormalize([
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]);
}
const rollQuat = (deg: number): Quat => [0, 0, Math.sin(rad(deg) / 2), Math.cos(rad(deg) / 2)];

interface Ctx { o: ShotOpts; c: Vec3; fov: number; D: number }
const ctx = (o: ShotOpts): Ctx => ({ o, c: o.target ?? DEFAULT_TARGET, fov: o.fovDeg ?? DEFAULT_FOV_DEG, D: duration(o) });

/** y of the body point at `f` of the subject's height (0 = soles, 1 = top of head). */
const bodyY = (c: Vec3, f: number) => c[1] - SUBJECT_HEIGHT_M / 2 + f * SUBJECT_HEIGHT_M;

// ---- shot size: aim at a body point, back off until `span` metres of height fill the frame ----
interface SizeSpec { aim: number; span: number; camY?: number }
const SIZES: Record<string, SizeSpec> = {
  "extreme-wide": { aim: 0.5, span: 18, camY: 1.6 },
  wide: { aim: 0.5, span: 3.6, camY: 1.6 },
  full: { aim: 0.5, span: 2.1, camY: 1.6 },
  "medium-wide": { aim: 0.64, span: 1.4 },
  cowboy: { aim: 0.7, span: 1.2 },
  medium: { aim: 0.78, span: 0.9 },
  "medium-close-up": { aim: 0.86, span: 0.58 },
  "close-up": { aim: 0.93, span: 0.32 },
  "extreme-close-up": { aim: 0.92, span: 0.1 },
  establishing: { aim: 0.5, span: 24, camY: 6 },
};

function sized(o: ShotOpts, s: SizeSpec): Shot {
  const { c, fov, D } = ctx(o);
  const aimY = bodyY(c, s.aim);
  const d = s.span / (2 * Math.tan(rad(fov) / 2));
  const eye: Vec3 = [c[0], s.camY ?? aimY, c[2] + d];
  const q = lookAtQuat(eye, [c[0], aimY, c[2]]);
  return makeShot(o, [key(0, eye, q, fov), key(D, eye, q, fov)]);
}

// ---- camera angle: fixed 5 m from the subject at a chosen camera height ----
interface AngleSpec { y: number; aimY: number; roll?: number; dist?: number; fov?: number; zOff?: number }
const ANGLES: Record<string, (c: Vec3) => AngleSpec> = {
  "eye-level": (c) => ({ y: bodyY(c, 0.9), aimY: bodyY(c, 0.9) }),
  "low-angle": (c) => ({ y: bodyY(c, 0.1), aimY: bodyY(c, 0.85) }),
  "high-angle": (c) => ({ y: bodyY(c, 0.5) + 3, aimY: bodyY(c, 0.5) }),
  "hip-level": (c) => ({ y: bodyY(c, 0.5), aimY: bodyY(c, 0.5) }),
  "knee-level": (c) => ({ y: bodyY(c, 0.28), aimY: bodyY(c, 0.28) }),
  "ground-level": (c) => ({ y: bodyY(c, 0.05), aimY: bodyY(c, 0.2) }),
  "shoulder-level": (c) => ({ y: bodyY(c, 0.8), aimY: bodyY(c, 0.8) }),
  "dutch-angle": (c) => ({ y: bodyY(c, 0.9), aimY: bodyY(c, 0.9), roll: 20 }),
  // Straight down is degenerate for an up=+Y lookAt, so sit 0.5 m off the vertical.
  "birds-eye": (c) => ({ y: c[1] + 12, aimY: c[1], dist: 0.5 }),
  aerial: (c) => ({ y: c[1] + 22, aimY: c[1] - 1, dist: 22, fov: 55 }),
};

function angled(o: ShotOpts, id: string): Shot {
  const { c, fov, D } = ctx(o);
  const a = ANGLES[id]!(c);
  const eye: Vec3 = [c[0], a.y, c[2] + (a.dist ?? 5)];
  let q = lookAtQuat(eye, [c[0], a.aimY, c[2]]);
  if (a.roll) q = qmul(q, rollQuat(a.roll));
  const f = a.fov ?? fov;
  return makeShot(o, [key(0, eye, q, f), key(D, eye, q, f)]);
}

// ---- helpers for movement builders ----
const EYE_Y = 1.6;
const look = (eye: Vec3, c: Vec3) => lookAtQuat(eye, c);
const track = (x: Ctx, pts: Array<{ u: number; eye: Vec3; q?: Quat; fov?: number }>) =>
  makeShot(x.o, pts.map((p) => key(p.u * x.D, p.eye, p.q ?? look(p.eye, x.c), p.fov ?? x.fov)));
/** Pitch about the camera's own X axis: look at a point `dist` ahead, raised by `pitchDeg`. */
const pitchedLook = (eye: Vec3, dist: number, pitchDeg: number): Quat =>
  lookAtQuat(eye, [eye[0], eye[1] + dist * Math.tan(rad(pitchDeg)), eye[2] - dist]);

const WHIP_FRAMES = 8;

const MOVES: Record<string, (x: Ctx) => Shot> = {
  static: (x) => track(x, [{ u: 0, eye: [0, EYE_Y, 6] }, { u: 1, eye: [0, EYE_Y, 6] }]),
  "push-in": (x) => track(x, [{ u: 0, eye: [0, EYE_Y, 7] }, { u: 1, eye: [0, EYE_Y, 3] }]),
  "pull-out": (x) => track(x, [{ u: 0, eye: [0, EYE_Y, 3] }, { u: 1, eye: [0, EYE_Y, 7] }]),
  "zoom-in": (x) => track(x, [{ u: 0, eye: [0, EYE_Y, 6] }, { u: 1, eye: [0, EYE_Y, 6], fov: x.fov * 0.5 }]),
  "zoom-out": (x) => track(x, [{ u: 0, eye: [0, EYE_Y, 6], fov: x.fov * 0.5 }, { u: 1, eye: [0, EYE_Y, 6] }]),
  "dolly-zoom": (x) =>
    track(x, [{ u: 0, eye: [0, EYE_Y, 8] }, { u: 1, eye: [0, EYE_Y, 3], fov: dollyZoomFovDeg(x.fov, 8, 3) }]),
  pan: (x) => {
    const eye: Vec3 = [0, EYE_Y, 6];
    return track(x, [{ u: 0, eye, q: yawQuat(0) }, { u: 1, eye, q: yawQuat(30) }]);
  },
  tilt: (x) => {
    const eye: Vec3 = [0, EYE_Y, 6];
    return track(x, [{ u: 0, eye, q: pitchedLook(eye, 6, -20) }, { u: 1, eye, q: pitchedLook(eye, 6, 20) }]);
  },
  "whip-pan": (x) => whip(x, (a) => yawQuat(a)),
  "whip-tilt": (x) => whip(x, (a) => pitchedLook([0, EYE_Y, 6], 6, a * (60 / 90))),
  // Tracking keeps the subject framed while the camera travels sideways; crab keeps the heading fixed.
  tracking: (x) => track(x, [{ u: 0, eye: [-4, EYE_Y, 5] }, { u: 1, eye: [4, EYE_Y, 5] }]),
  crab: (x) => {
    const q = yawQuat(0);
    return track(x, [{ u: 0, eye: [-3, EYE_Y, 6], q }, { u: 1, eye: [3, EYE_Y, 6], q }]);
  },
  arc: (x) => orbit({ ...x.o, radius: 5, startDeg: -60, endDeg: 60, fovDeg: x.fov }),
  slider: (x) => {
    const q = yawQuat(0);
    return track(x, [{ u: 0, eye: [-0.6, EYE_Y, 4], q }, { u: 1, eye: [0.6, EYE_Y, 4], q }]);
  },
  crane: (x) => track(x, [{ u: 0, eye: [0, 1, 7] }, { u: 1, eye: [0, 6, 5] }]),
  jib: (x) => track(x, [{ u: 0, eye: [0, 1.4, 6] }, { u: 1, eye: [0, 2.6, 5.2] }]),
  drone: (x) => track(x, [{ u: 0, eye: [0, 15, 25] }, { u: 1, eye: [0, 3, 8] }]),
  handheld: (x) => {
    // Deterministic sway: two incommensurate sines, about 0.4 deg and 1 cm.
    const n = Math.max(2, Math.ceil(x.D * FPS / 3));
    const pts = Array.from({ length: n + 1 }, (_, i) => {
      const u = i / n;
      const t = u * x.D;
      const eye: Vec3 = [0.01 * Math.sin(2.3 * t), EYE_Y + 0.01 * Math.sin(3.1 * t + 1), 4];
      const aim: Vec3 = [x.c[0] + 0.03 * Math.sin(1.7 * t + 2), x.c[1] + 0.03 * Math.sin(2.9 * t), x.c[2]];
      return { u, eye, q: lookAtQuat(eye, aim) };
    });
    return track(x, pts);
  },
};

/** Hold, snap 90 deg in WHIP_FRAMES frames at the mid-point, hold. `rot` maps degrees to the camera rotation. */
function whip(x: Ctx, rot: (deg: number) => Quat): Shot {
  const eye: Vec3 = [0, EYE_Y, 6];
  const u0 = 0.45;
  const u1 = u0 + WHIP_FRAMES / FPS / x.D;
  return track(x, [
    { u: 0, eye, q: rot(0) }, { u: u0, eye, q: rot(0) }, { u: u1, eye, q: rot(90) }, { u: 1, eye, q: rot(90) },
  ]);
}

// ---- point of view: the subject's own eyes, looking where the figure faces (+Z) ----
function pov(o: ShotOpts): Shot {
  const { c, fov, D } = ctx(o);
  const eye: Vec3 = [c[0], bodyY(c, 0.93), c[2] + 0.15];
  const q = lookAtQuat(eye, [eye[0], eye[1], eye[2] + 8]);
  return makeShot(o, [key(0, eye, q, fov), key(D, eye, q, fov)]);
}

/** Follow `aliasOf` to the camera preset a shot type compiles to; undefined for prompt-only types. */
export function resolveShotType(id: string): ShotType | undefined {
  let t = SHOT_TYPES.find((s) => s.id === id);
  if (t?.support === "alias") t = SHOT_TYPES.find((s) => s.id === t!.aliasOf);
  return t;
}

/** Build the Shot for a shot type, or null when it is prompt-only. Throws on an unknown id. */
export function shotPreset(id: string, o: ShotOpts): Shot | null {
  const t = resolveShotType(id);
  if (!t) throw new Error(`unknown shot type: ${id}`);
  if (t.support === "prompt-only") return null;
  const x = ctx(o);
  if (t.id in SIZES) return sized(o, SIZES[t.id]!);
  if (t.id in ANGLES) return angled(o, t.id);
  if (t.id === "pov") return pov(o);
  return MOVES[t.id]!(x);
}
