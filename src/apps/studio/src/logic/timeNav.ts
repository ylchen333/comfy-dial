// Timeline navigation the Blender way: Up/Down jump between keyframes, Shift+Left/Right jump to the ends (no UI).
import type { StudioDoc } from "./types.ts";

/** Every frame that has a key on any channel, ascending and unique. */
export const keyFrames = (doc: Pick<StudioDoc, "position" | "aim" | "focal">): number[] =>
  [...new Set([...doc.position, ...doc.aim, ...doc.focal].map((k) => k.frame))].sort((a, b) => a - b);

/** The next (dir = 1) or previous (dir = -1) key frame strictly after/before `frame`, or `frame` itself when there is none. */
export function jumpKey(frames: readonly number[], frame: number, dir: 1 | -1): number {
  const hit = dir === 1 ? frames.find((f) => f > frame) : [...frames].reverse().find((f) => f < frame);
  return hit ?? frame;
}
