// Editor-view helpers (no UI): where to put the orbit camera for a named view, and snapping for dragged points.
import type { Pose, Vec3 } from "@comfy-osh/rig-core";

export type ViewId = "persp" | "top" | "bottom" | "front" | "back" | "side" | "left" | "frame";
export const VIEW_LABELS: Record<Exclude<ViewId, "frame">, string> = { persp: "Persp", top: "Top", bottom: "Bottom", front: "Front", back: "Back", side: "Right", left: "Left" };
export interface Framing { center: Vec3; radius: number }

/** A sphere around the whole camera path and the subject, so every view shows the entire move. */
export function framingOf(poses: readonly Pose[], subject: Vec3 | null): Framing {
  const pts: Vec3[] = [...poses.map((p) => p.position), ...(subject ? [subject] : [])];
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i]!, p[i]!); hi[i] = Math.max(hi[i]!, p[i]!); }
  if (!pts.length) return { center: [0, 1, 0], radius: 5 };
  const center: Vec3 = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
  return { center, radius: Math.max(1.5, Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) / 2) };
}

const norm = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** Orbit camera position and target for a view. "frame" keeps the current viewing direction and refits the distance. */
export function viewPose(view: ViewId, f: Framing, currentDir?: Vec3): { position: Vec3; target: Vec3 } {
  const d = f.radius * 2.6;
  const dir: Vec3 =
    view === "top" ? [0, 1, 0.001] : view === "bottom" ? [0, -1, 0.001] : view === "front" ? [0, 0, 1] : view === "back" ? [0, 0, -1]
    : view === "side" ? [1, 0, 0] : view === "left" ? [-1, 0, 0]
    : view === "frame" && currentDir ? norm(currentDir) : norm([0.55, 0.4, 0.73]);
  const u = norm(dir);
  return { position: [f.center[0] + u[0] * d, f.center[1] + u[1] * d, f.center[2] + u[2] * d], target: f.center };
}

/** Snap a dragged point to a grid and keep it on or above the ground. A no-op when snapping is off. */
export function snapPoint(v: Vec3, o: { on: boolean; step?: number }): Vec3 {
  if (!o.on) return v;
  const s = o.step ?? 0.25;
  const r = (x: number) => Math.round(x / s) * s;
  return [r(v[0]), Math.max(0, r(v[1])), r(v[2])];
}

/** Orthographic zoom (pixels per metre) that fits a sphere of `radius` in a viewport `heightPx` tall. */
export const orthoZoomFor = (radius: number, heightPx: number): number => heightPx / (2 * radius * 1.15);

/** Pixels per metre an orthographic camera needs to match a perspective view of `fovDeg` at `distance`. */
export const orthoZoomMatching = (fovDeg: number, distance: number, heightPx: number): number => heightPx / (2 * distance * Math.tan((fovDeg * Math.PI) / 360));

/** Name the view like Blender's viewport text: "Front", "Top" ... when looking straight down an axis, else "User". */
export function viewName(dir: Vec3, tolDeg = 0.7): "Front" | "Back" | "Right" | "Left" | "Top" | "Bottom" | "User" {
  const d = norm(dir);
  const cos = Math.cos((tolDeg * Math.PI) / 180);
  // dir is where the camera LOOKS. Looking down -Z is the front view (the camera sits at +Z).
  const axes: [Vec3, "Front" | "Back" | "Right" | "Left" | "Top" | "Bottom"][] = [
    [[0, 0, -1], "Front"], [[0, 0, 1], "Back"], [[-1, 0, 0], "Right"], [[1, 0, 0], "Left"], [[0, -1, 0], "Top"], [[0, 1, 0], "Bottom"],
  ];
  for (const [a, name] of axes) if (d[0] * a[0] + d[1] * a[1] + d[2] * a[2] >= cos) return name;
  return "User";
}

/** What a keyboard event asks of the viewport, using Blender's numpad layout (top-row digits stand in for it). */
export type ViewKey = { view: ViewId } | { ortho: true } | { camera: true } | { all: true } | { selected: true } | null;
export function viewKey(e: { code: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): ViewKey {
  if (e.ctrlKey || e.altKey || e.metaKey) return null; // Alt+digit changes page; Ctrl/Cmd+digit belongs to the browser
  const n = /^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1];
  const flip = e.shiftKey;
  if (n === "1") return { view: flip ? "back" : "front" };
  if (n === "3") return { view: flip ? "left" : "side" };
  if (n === "7") return { view: flip ? "bottom" : "top" };
  if (n === "5") return { ortho: true };
  if (n === "0") return { camera: true };
  if (e.code === "Home") return { all: true };
  if (e.code === "NumpadDecimal" || e.code === "Period") return { selected: true };
  return null;
}

/** Closest point to a mouse ray on an axis line through `origin` (the Blender "G, X" constraint). */
export function closestOnAxis(rayO: Vec3, rayD: Vec3, origin: Vec3, axis: Vec3): Vec3 {
  const d = norm(rayD), a = norm(axis);
  const w: Vec3 = [rayO[0] - origin[0], rayO[1] - origin[1], rayO[2] - origin[2]];
  const b = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
  const dw = d[0] * w[0] + d[1] * w[1] + d[2] * w[2];
  const aw = a[0] * w[0] + a[1] * w[1] + a[2] * w[2];
  const den = 1 - b * b;
  const t = den < 1e-9 ? 0 : (aw - b * dw) / den; // parameter along the axis
  return [origin[0] + a[0] * t, origin[1] + a[1] * t, origin[2] + a[2] * t];
}

/** Where a mouse ray meets the plane through `point` facing `normal` (the free "G" move), or null when parallel. */
export function rayPlane(rayO: Vec3, rayD: Vec3, point: Vec3, normal: Vec3): Vec3 | null {
  const n = norm(normal);
  const den = rayD[0] * n[0] + rayD[1] * n[1] + rayD[2] * n[2];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((point[0] - rayO[0]) * n[0] + (point[1] - rayO[1]) * n[1] + (point[2] - rayO[2]) * n[2]) / den;
  return [rayO[0] + rayD[0] * t, rayO[1] + rayD[1] * t, rayO[2] + rayD[2] * t];
}
