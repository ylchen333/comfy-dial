// Review screen logic (no UI): the per-frame error series, chart ticks, and the one event worth annotating.
import type { Aligned } from "./align.ts";

/** Mirrors the frozen rotation gate in apps/server/src/rank.ts (FROZEN_GATES.rotDeg). */
export const ROT_GATE_DEG = 2.75;

export interface Sample { frame: number; deg: number }

/** Rotation error at each solved frame. Only measured samples: DA3 runs on a decimated clip, so nothing is interpolated. */
export const errorSamples = (a: Aligned | null): Sample[] => (a ? a.poses.map((p) => ({ frame: p.frame, deg: p.rotErrDeg })) : []);

/** First sample that is over the gate and stays over it for the rest of the clip is the drift; a one-frame spike is not. */
export function driftFrame(samples: readonly Sample[], gate = ROT_GATE_DEG): number | null {
  for (let i = 0; i < samples.length; i++) if (samples.slice(i).every((s) => s.deg > gate)) return samples[i]!.frame;
  return null;
}

/** Round y ticks from 0 with the top tick above the data and the gate, in steps of 1, 2, 5 x 10^k. */
export function niceTicks(max: number, count = 4): number[] {
  const want = Math.max(max, 0.1) / count;
  const mag = 10 ** Math.floor(Math.log10(want));
  const step = ([1, 2, 5, 10].map((m) => m * mag).find((s) => s >= want) ?? mag * 10);
  const top = Math.ceil((max + 1e-9) / step) * step;
  const n = Math.round(top / step);
  const ticks = Array.from({ length: n + 1 }, (_, i) => +(i * step).toFixed(6));
  return ticks[ticks.length - 1]! > max ? ticks : [...ticks, +(top + step).toFixed(6)];
}

/** Frame for a pointer x inside the plot, clamped to the clip. */
export const frameAtX = (x: number, left: number, width: number, frames: number): number =>
  Math.min(frames - 1, Math.max(0, Math.round(((x - left) / width) * (frames - 1))));

/** Where the video should sit for a frame: the middle of that frame's slot, so seeking never lands on the previous frame. */
export const videoTimeFor = (frame: number, fps: number): number => (frame + 0.5) / fps;
export const frameAtTime = (t: number, fps: number, frames: number): number => Math.min(frames - 1, Math.max(0, Math.floor(t * fps)));
