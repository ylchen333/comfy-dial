// "Through the lens" geometry (no UI): where the shot's frame sits inside the viewport, and the wider camera FOV that keeps
// the frame's content exactly as the shot camera sees it while showing a little overscan around it.

export interface Rect { x: number; y: number; w: number; h: number }

/** Largest frame of the shot's aspect that fits the viewport with padding (pad = fraction of the viewport used). */
export function lensFrame(containerW: number, containerH: number, aspect: number, pad = 0.9): Rect {
  const h = Math.min(containerH * pad, (containerW * pad) / aspect);
  const w = h * aspect;
  return { x: (containerW - w) / 2, y: (containerH - h) / 2, w, h };
}

/** Vertical FOV for a camera that fills a container of height containerH when the shot's frame (shotFovDeg) fills frameH of it. */
export function overscanFov(shotFovDeg: number, containerH: number, frameH: number): number {
  const half = Math.tan((shotFovDeg * Math.PI) / 360);
  return (2 * Math.atan(half * (containerH / frameH)) * 180) / Math.PI;
}

/** Rule-of-thirds, centre and 90% safe-area guides inside a frame, as line segments in container pixels. */
export function guideLines(f: Rect): { x1: number; y1: number; x2: number; y2: number; kind: "thirds" | "centre" | "safe" }[] {
  const L = (x1: number, y1: number, x2: number, y2: number, kind: "thirds" | "centre" | "safe") => ({ x1, y1, x2, y2, kind });
  const sx = f.w * 0.05, sy = f.h * 0.05;
  return [
    L(f.x + f.w / 3, f.y, f.x + f.w / 3, f.y + f.h, "thirds"), L(f.x + (2 * f.w) / 3, f.y, f.x + (2 * f.w) / 3, f.y + f.h, "thirds"),
    L(f.x, f.y + f.h / 3, f.x + f.w, f.y + f.h / 3, "thirds"), L(f.x, f.y + (2 * f.h) / 3, f.x + f.w, f.y + (2 * f.h) / 3, "thirds"),
    L(f.x + f.w / 2 - 8, f.y + f.h / 2, f.x + f.w / 2 + 8, f.y + f.h / 2, "centre"), L(f.x + f.w / 2, f.y + f.h / 2 - 8, f.x + f.w / 2, f.y + f.h / 2 + 8, "centre"),
    L(f.x + sx, f.y + sy, f.x + f.w - sx, f.y + sy, "safe"), L(f.x + f.w - sx, f.y + sy, f.x + f.w - sx, f.y + f.h - sy, "safe"),
    L(f.x + f.w - sx, f.y + f.h - sy, f.x + sx, f.y + f.h - sy, "safe"), L(f.x + sx, f.y + f.h - sy, f.x + sx, f.y + sy, "safe"),
  ];
}
