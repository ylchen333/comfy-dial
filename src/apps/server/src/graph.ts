// Graph builder: fills the API-format templates in src/workflows from a Shot + ControlPacket.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isLtxFrameCount, type ControlPacket, type Shot } from "@comfy-osh/contracts";
import type { Graph } from "./client.ts";

export const WORKFLOWS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../workflows");

export interface DecodeTiling { tile_size: number; overlap: number; temporal_size: number; temporal_overlap: number }

/** Largest clip decoded in a single tile (pixels x frames); above it we tile, with a wide temporal overlap. About 768x512x180. */
export const SINGLE_TILE_BUDGET = 70_000_000;

/**
 * VAEDecodeTiled settings for a clip. The shipped template used 64-frame temporal tiles with an 8-frame overlap, which left
 * visible brightness seams at frames 56 and 112 of every 121-frame take (measured on 14 live takes: the worst jump was at a seam
 * in 12 of them, median 2.1x the rest of the clip). One tile that covers the whole clip has no seams. Both sizes are multiples
 * of the node's steps (32 px, 4 frames).
 */
export function decodeTiling(res: { width: number; height: number }, frames: number): DecodeTiling {
  const up = (v: number, m: number) => Math.ceil(v / m) * m;
  if (res.width * res.height * frames <= SINGLE_TILE_BUDGET) {
    return { tile_size: Math.min(4096, up(Math.max(res.width, res.height) + 32, 32)), overlap: 64, temporal_size: Math.min(4096, up(frames, 4) + 4), temporal_overlap: 8 };
  }
  // Too big for one tile: overlap by half a tile so the blend between tiles is long and gentle instead of an 8-frame seam.
  return { tile_size: 640, overlap: 128, temporal_size: 96, temporal_overlap: 48 };
}

/** SKILLS.md section 4: only Small/Base. Never Large/Giant/Metric. */
export const DA3_ALLOWED_MODELS = ["da3_small.safetensors", "da3_base.safetensors"] as const;
export const DA3_MODEL = "da3_base.safetensors";

const loadTemplate = (name: string): Graph => JSON.parse(readFileSync(resolve(WORKFLOWS_DIR, name), "utf8")) as Graph;

/** Set inputs on a node, refusing to run if the template drifted (wrong class or missing input). */
function patch(g: Graph, id: string, cls: string, values: Record<string, unknown>) {
  const node = g[id];
  if (!node || node.class_type !== cls) {
    throw new Error(`template drift: node ${id} should be ${cls}, found ${node?.class_type ?? "nothing"}`);
  }
  for (const [k, v] of Object.entries(values)) {
    if (!(k in node.inputs)) throw new Error(`template drift: node ${id} (${cls}) has no input "${k}"`);
    node.inputs[k] = v;
  }
}

export interface TakeParams {
  shot: Shot;
  packet: ControlPacket;
  /** Name LoadVideo must use: the cloud_name returned by upload of the depth guide. */
  guideFile: string;
  prompt: string;
  /** Text for what to avoid; the template's own negative stays when omitted. */
  negative?: string | undefined;
  seed: number;
  /** Negative-control only: allow strength 0 (LTX then ignores the guide and the take is unguided). */
  allowUnguided?: boolean | undefined;
}

export function buildTakeGraph(p: TakeParams): Graph {
  const { shot, packet, seed } = p;
  if (!isLtxFrameCount(shot.frames)) throw new Error(`frames ${shot.frames} is not 1+8k`);
  if (!Number.isInteger(seed) || seed < 0) throw new Error(`seed must be a non-negative integer, got ${seed}`);
  if (packet.shotId !== shot.id) throw new Error(`ControlPacket is for ${packet.shotId}, Shot is ${shot.id}`);
  // LTX ignores the guide only at strength 0.0, so 0 would silently produce an unguided take.
  if (!(packet.iclora.strength > 0) && !p.allowUnguided) throw new Error("iclora.strength must be > 0 (LTX ignores the guide at 0.0); pass allowUnguided for a negative control");
  const lora = packet.iclora.name.endsWith(".safetensors") ? packet.iclora.name : `${packet.iclora.name}.safetensors`;

  const g = loadTemplate("ltx25_union_depth.api.json");
  patch(g, "2", "LTXICLoRALoaderModelOnly", { lora_name: lora });
  patch(g, "6", "CLIPTextEncode", { text: p.prompt });
  if (p.negative) patch(g, "7", "CLIPTextEncode", { text: p.negative });
  patch(g, "8", "LTXVConditioning", { frame_rate: shot.fps });
  patch(g, "9", "LoadVideo", { file: p.guideFile });
  patch(g, "11", "EmptyLTXVLatentVideo", { width: shot.resolution.width, height: shot.resolution.height, length: shot.frames });
  patch(g, "12", "LTXAddVideoICLoRAGuide", { strength: packet.iclora.strength });
  patch(g, "13", "LTXVEmptyLatentAudio", { frames_number: shot.frames, frame_rate: shot.fps });
  patch(g, "22", "VAEDecodeTiled", { ...decodeTiling(shot.resolution, shot.frames) });
  patch(g, "16", "RandomNoise", { noise_seed: seed });
  patch(g, "24", "CreateVideo", { fps: shot.fps });
  patch(g, "25", "SaveVideo", { filename_prefix: `video/loop/${shot.id}_s${seed}` });
  return g;
}

/** Latent frames are 8 pixel frames wide, so the regenerated window must start on a multiple of 8. */
const CONTEXT_FRAMES = 9; // 1 + 8: one latent step of already-good footage the new frames continue from

export interface SegmentWindow {
  /** Frame where the new clip starts (a multiple of 8). The first CONTEXT_FRAMES are the original take. */
  ctxStart: number;
  /** Frames in the regenerated clip: runs from ctxStart to the end of the shot, always 1+8k. */
  length: number;
  /** False for segment 0 (nothing earlier to continue from): the whole take is redone with a new seed. */
  hasContext: boolean;
}

export function segmentWindow(shot: Shot, k: number): SegmentWindow {
  const seg = shot.segments[k];
  if (!seg) throw new Error(`shot ${shot.id} has no segment ${k}`);
  const anchor = Math.floor(seg.start / 8) * 8;
  if (anchor < 8) return { ctxStart: 0, length: shot.frames, hasContext: false };
  const ctxStart = anchor - 8;
  return { ctxStart, length: shot.frames - ctxStart, hasContext: true };
}

export interface SegmentParams extends Omit<TakeParams, "guideFile"> {
  window: SegmentWindow;
  /** Uploaded depth guide already trimmed to the window. */
  guideFile: string;
  /** Uploaded CONTEXT_FRAMES-frame clip of the original take at the window start. */
  contextFile: string;
}

/** Extend-from-context graph: same as the take graph plus the original frames pinned at frame 0 of the new clip. */
export function buildSegmentGraph(p: SegmentParams): Graph {
  const { shot, packet, seed, window } = p;
  if (!window.hasContext) throw new Error("segment 0 has no context; use buildTakeGraph with a new seed");
  if (!isLtxFrameCount(window.length)) throw new Error(`segment window ${window.length} is not 1+8k`);
  if (!Number.isInteger(seed) || seed < 0) throw new Error(`seed must be a non-negative integer, got ${seed}`);
  if (packet.shotId !== shot.id) throw new Error(`ControlPacket is for ${packet.shotId}, Shot is ${shot.id}`);
  if (!(packet.iclora.strength > 0)) throw new Error("iclora.strength must be > 0 (LTX ignores the guide at 0.0)");
  const lora = packet.iclora.name.endsWith(".safetensors") ? packet.iclora.name : `${packet.iclora.name}.safetensors`;

  const g = loadTemplate("ltx25_extend_segment.api.json");
  patch(g, "2", "LTXICLoRALoaderModelOnly", { lora_name: lora });
  patch(g, "6", "CLIPTextEncode", { text: p.prompt });
  if (p.negative) patch(g, "7", "CLIPTextEncode", { text: p.negative });
  patch(g, "8", "LTXVConditioning", { frame_rate: shot.fps });
  patch(g, "9", "LoadVideo", { file: p.guideFile });
  patch(g, "11", "EmptyLTXVLatentVideo", { width: shot.resolution.width, height: shot.resolution.height, length: window.length });
  patch(g, "12", "LTXAddVideoICLoRAGuide", { strength: packet.iclora.strength });
  patch(g, "13", "LTXVEmptyLatentAudio", { frames_number: window.length, frame_rate: shot.fps });
  patch(g, "22", "VAEDecodeTiled", { ...decodeTiling(shot.resolution, window.length) });
  patch(g, "16", "RandomNoise", { noise_seed: seed });
  patch(g, "24", "CreateVideo", { fps: shot.fps });
  patch(g, "25", "SaveVideo", { filename_prefix: `video/loop/${shot.id}_s${seed}_seg` });
  patch(g, "30", "LoadVideo", { file: p.contextFile });
  return g;
}

export const SEGMENT_CONTEXT_FRAMES = CONTEXT_FRAMES;

export interface PoseParams {
  /** Uploaded (decimated) take video name. */
  videoFile: string;
  model?: string;
  tag: string;
}

export function buildPoseGraph(p: PoseParams): Graph {
  const model = p.model ?? DA3_MODEL;
  if (!(DA3_ALLOWED_MODELS as readonly string[]).includes(model)) {
    throw new Error(`DA3 model ${model} not allowed (licence): use da3_small or da3_base`);
  }
  const g = loadTemplate("da3_poses.api.json");
  patch(g, "1", "LoadVideo", { file: p.videoFile });
  patch(g, "3", "DownloadAndLoadDepthAnythingV3Model", { model });
  patch(g, "5", "SaveText", { filename_prefix: `da3/${p.tag}/extrinsics` });
  patch(g, "6", "SaveText", { filename_prefix: `da3/${p.tag}/intrinsics` });
  return g;
}

/** Optional actor generation (image, then shape). Both graphs are open-weights only: FLUX.1 schnell (Apache-2.0) and Hunyuan3D 2.1 (Tencent licence, dev use). */
export const ACTOR_IMAGE_SIZE = { width: 768, height: 1024 };

export function buildActorImageGraph(p: { prompt: string; seed: number }): Graph {
  const g = loadTemplate("actor_image_schnell.api.json");
  patch(g, "2", "CLIPTextEncode", { text: p.prompt });
  patch(g, "5", "KSampler", { seed: p.seed });
  patch(g, "4", "EmptyLatentImage", ACTOR_IMAGE_SIZE);
  return g;
}

export function buildActorMeshGraph(p: { imageFile: string; seed: number }): Graph {
  const g = loadTemplate("actor_mesh_hunyuan21.api.json");
  patch(g, "1", "LoadImage", { image: p.imageFile });
  patch(g, "7", "KSampler", { seed: p.seed });
  return g;
}
