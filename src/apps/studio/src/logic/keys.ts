// Pure keyframe store logic. Every function returns a new StudioDoc (or an error); nothing mutates.
import { DEFAULT_FRAMES, DEFAULT_TARGET, type Vec3 } from "@comfy-osh/rig-core";
import { isLtxFrameCount } from "@comfy-osh/contracts";
import { CHANNELS, type Channel, type ChannelValues, type Easing, type Key, type Result, type StudioDoc } from "./types.ts";

export function applyEasing(e: Easing, u: number): number {
  switch (e) {
    case "linear": return u;
    case "easeIn": return u * u;
    case "easeOut": return u * (2 - u);
    case "easeInOut": return u < 0.5 ? 2 * u * u : -1 + (4 - 2 * u) * u;
  }
}

export function thirds(frames: number): StudioDoc["segments"] {
  const cuts = [0, 1, 2, 3].map((i) => Math.floor((frames * i) / 3));
  return [0, 1, 2].map((i) => ({ start: cuts[i]!, end: cuts[i + 1]! }));
}

export const DEFAULT_SCENE_NODES: StudioDoc["scene"] = {
  nodes: [
    { id: "ground", asset: "primitive:plane", transform: { position: [0, 0, 0], quaternion: [-0.707106781, 0, 0, 0.707106781], scale: [20, 20, 1] } },
    // Placeholder person: exported as a box proxy (rig-core's renderer has no capsule); drawn as a capsule in the studio.
    { id: "subject", asset: "primitive:box", transform: { position: [0, 0.9, 0], quaternion: [0, 0, 0, 1], scale: [0.6, 1.8, 0.6] } },
    { id: "prop_crate", asset: "primitive:box", transform: { position: [-2, 0.4, -1.5], quaternion: [0, 0, 0, 1], scale: [0.8, 0.8, 0.8] } },
    { id: "prop_pillar", asset: "primitive:cylinder", transform: { position: [2.5, 1.2, -2], quaternion: [0, 0, 0, 1], scale: [0.5, 2.4, 0.5] } },
  ],
};

export function newDoc(id = "shot_studio"): StudioDoc {
  const frames = DEFAULT_FRAMES;
  return {
    id,
    frames,
    resolution: { width: 768, height: 512 },
    sensorHeightMm: 24,
    scene: DEFAULT_SCENE_NODES,
    segments: thirds(frames),
    position: [{ frame: 0, value: [0, 1.6, 6], easing: "linear" }],
    aim: [{ frame: 0, value: [...DEFAULT_TARGET] as Vec3, easing: "linear" }],
    focal: [{ frame: 0, value: 35, easing: "linear" }],
  };
}

export const lastFrame = (doc: Pick<StudioDoc, "frames">) => doc.frames - 1;

const sortKeys = <T extends { frame: number }>(keys: T[]): T[] => [...keys].sort((a, b) => a.frame - b.frame);

type AnyKey = Key<Vec3> | Key<number>;
const lerpVal = (a: Vec3 | number, b: Vec3 | number, u: number): Vec3 | number =>
  typeof a === "number" ? a + ((b as number) - a) * u : [a[0] + ((b as Vec3)[0] - a[0]) * u, a[1] + ((b as Vec3)[1] - a[1]) * u, a[2] + ((b as Vec3)[2] - a[2]) * u];

/** Evaluate a channel at a (possibly fractional) frame. Held before the first / after the last key. */
export function evalChannel<C extends Channel>(doc: StudioDoc, ch: C, frame: number): ChannelValues[C] {
  const keys = doc[ch] as AnyKey[];
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  if (frame <= first.frame) return first.value as ChannelValues[C];
  if (frame >= last.frame) return last.value as ChannelValues[C];
  let i = 0;
  while (keys[i + 1]!.frame < frame) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  const u = applyEasing(a.easing, (frame - a.frame) / (b.frame - a.frame));
  return lerpVal(a.value, b.value, u) as ChannelValues[C];
}

export function evalAll(doc: StudioDoc, frame: number): ChannelValues {
  return { position: evalChannel(doc, "position", frame), aim: evalChannel(doc, "aim", frame), focal: evalChannel(doc, "focal", frame) };
}

const err = (error: string): Result<never> => ({ ok: false, error });
const inRange = (doc: StudioDoc, frame: number) => Number.isInteger(frame) && frame >= 0 && frame <= lastFrame(doc);

/** Add a key, or replace the value (keeping its easing unless given) of an existing key at that frame. */
export function upsertKey<C extends Channel>(doc: StudioDoc, ch: C, frame: number, value: ChannelValues[C], easing?: Easing): Result<StudioDoc> {
  if (!inRange(doc, frame)) return err(`frame ${frame} is outside 0..${lastFrame(doc)}`);
  const keys = (doc[ch] as AnyKey[]).slice();
  const i = keys.findIndex((k) => k.frame === frame);
  const nk = { frame, value, easing: easing ?? (i >= 0 ? keys[i]!.easing : "linear") } as AnyKey;
  if (i >= 0) keys[i] = nk;
  else keys.push(nk);
  return { ok: true, value: { ...doc, [ch]: sortKeys(keys) } };
}

/** Add a key at `frame` holding whatever the channel currently evaluates to there. */
export function addKeyAtCurrent(doc: StudioDoc, ch: Channel, frame: number): Result<StudioDoc> {
  if ((doc[ch] as AnyKey[]).some((k) => k.frame === frame)) return err(`${ch} already has a key at frame ${frame}`);
  return upsertKey(doc, ch, frame, evalChannel(doc, ch, frame) as never);
}

export function moveKey(doc: StudioDoc, ch: Channel, from: number, to: number): Result<StudioDoc> {
  if (!inRange(doc, to)) return err(`frame ${to} is outside 0..${lastFrame(doc)}`);
  if (from === to) return { ok: true, value: doc };
  const keys = (doc[ch] as AnyKey[]).slice();
  const i = keys.findIndex((k) => k.frame === from);
  if (i < 0) return err(`no ${ch} key at frame ${from}`);
  if (keys.some((k) => k.frame === to)) return err(`${ch} already has a key at frame ${to}`);
  keys[i] = { ...keys[i]!, frame: to } as AnyKey;
  return { ok: true, value: { ...doc, [ch]: sortKeys(keys) } };
}

/** A channel must always keep at least one key, otherwise it has no value to hold. */
export function deleteKey(doc: StudioDoc, ch: Channel, frame: number): Result<StudioDoc> {
  const keys = doc[ch] as AnyKey[];
  if (!keys.some((k) => k.frame === frame)) return err(`no ${ch} key at frame ${frame}`);
  if (keys.length === 1) return err(`${ch} needs at least one key`);
  return { ok: true, value: { ...doc, [ch]: keys.filter((k) => k.frame !== frame) } };
}

export function setEasing(doc: StudioDoc, ch: Channel, frame: number, easing: Easing): Result<StudioDoc> {
  const keys = doc[ch] as AnyKey[];
  if (!keys.some((k) => k.frame === frame)) return err(`no ${ch} key at frame ${frame}`);
  return { ok: true, value: { ...doc, [ch]: keys.map((k) => (k.frame === frame ? { ...k, easing } : k)) } };
}

/** Change clip length; must be 1+8k (>= 9). Keys past the new end are dropped (a channel keeps its last surviving key, moved to the end if none survive). */
export function setFrames(doc: StudioDoc, frames: number): Result<StudioDoc> {
  if (!isLtxFrameCount(frames)) return err(`frames must be 1 + 8k (>= 9); got ${frames}`);
  const end = frames - 1;
  const next: StudioDoc = { ...doc, frames, segments: thirds(frames) };
  for (const ch of CHANNELS) {
    const keys = doc[ch] as AnyKey[];
    const kept = keys.filter((k) => k.frame <= end);
    (next as unknown as Record<string, AnyKey[]>)[ch] = kept.length > 0 ? kept : [{ ...keys[0]!, frame: end }];
  }
  return { ok: true, value: next };
}

export function setResolution(doc: StudioDoc, width: number, height: number): Result<StudioDoc> {
  if (![width, height].every((n) => Number.isInteger(n) && n >= 64 && n % 32 === 0)) return err("resolution must be integers, multiples of 32, >= 64");
  return { ok: true, value: { ...doc, resolution: { width, height } } };
}

/** Changing sensor height keeps the framing (vertical FOV), so focal keys are rescaled. */
export function setSensorHeight(doc: StudioDoc, heightMm: number): Result<StudioDoc> {
  if (!(heightMm > 0)) return err("sensor height must be positive");
  const k = heightMm / doc.sensorHeightMm;
  return { ok: true, value: { ...doc, sensorHeightMm: heightMm, focal: doc.focal.map((f) => ({ ...f, value: f.value * k })) } };
}

/** Replace all three channels from preset keys (frame-aligned) while keeping scene, lens and resolution. */
export function replaceKeys(doc: StudioDoc, keys: Pick<StudioDoc, "position" | "aim" | "focal">): StudioDoc {
  return { ...doc, position: keys.position, aim: keys.aim, focal: keys.focal };
}
