import type { Shot } from "@comfy-osh/contracts";
import type { Vec3 } from "@comfy-osh/rig-core";

export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut";
export const EASINGS: readonly Easing[] = ["linear", "easeIn", "easeOut", "easeInOut"];

/** Easing on a key shapes the segment that starts at that key. */
export interface Key<T> {
  frame: number;
  value: T;
  easing: Easing;
}

export type Channel = "position" | "aim" | "focal";
export const CHANNELS: readonly Channel[] = ["position", "aim", "focal"];

export interface ChannelValues {
  position: Vec3;
  aim: Vec3;
  focal: number;
}

export interface StudioDoc {
  id: string;
  name?: string;
  frames: number; // 1 + 8k
  resolution: { width: number; height: number };
  sensorHeightMm: number;
  scene: Shot["scene"];
  segments: Shot["segments"];
  position: Key<Vec3>[];
  aim: Key<Vec3>[];
  focal: Key<number>[]; // focal length in mm
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
