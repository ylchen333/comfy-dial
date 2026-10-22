// Graph builder: fills the API-format templates in src/workflows from a Shot + ControlPacket.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isLtxFrameCount, type ControlPacket, type Shot } from "@comfy-osh/contracts";
import type { Graph } from "./client.ts";

export const WORKFLOWS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../workflows");

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
  seed: number;
}

export function buildTakeGraph(p: TakeParams): Graph {
  const { shot, packet, seed } = p;
  if (!isLtxFrameCount(shot.frames)) throw new Error(`frames ${shot.frames} is not 1+8k`);
  if (!Number.isInteger(seed) || seed < 0) throw new Error(`seed must be a non-negative integer, got ${seed}`);
  if (packet.shotId !== shot.id) throw new Error(`ControlPacket is for ${packet.shotId}, Shot is ${shot.id}`);
  // LTX ignores the guide only at strength 0.0, so 0 would silently produce an unguided take.
  if (!(packet.iclora.strength > 0)) throw new Error("iclora.strength must be > 0 (LTX ignores the guide at 0.0)");
  const lora = packet.iclora.name.endsWith(".safetensors") ? packet.iclora.name : `${packet.iclora.name}.safetensors`;

  const g = loadTemplate("ltx25_union_depth.api.json");
  patch(g, "2", "LTXICLoRALoaderModelOnly", { lora_name: lora });
  patch(g, "6", "CLIPTextEncode", { text: p.prompt });
  patch(g, "8", "LTXVConditioning", { frame_rate: shot.fps });
  patch(g, "9", "LoadVideo", { file: p.guideFile });
  patch(g, "11", "EmptyLTXVLatentVideo", { width: shot.resolution.width, height: shot.resolution.height, length: shot.frames });
  patch(g, "12", "LTXAddVideoICLoRAGuide", { strength: packet.iclora.strength });
  patch(g, "13", "LTXVEmptyLatentAudio", { frames_number: shot.frames, frame_rate: shot.fps });
  patch(g, "16", "RandomNoise", { noise_seed: seed });
  patch(g, "24", "CreateVideo", { fps: shot.fps });
  patch(g, "25", "SaveVideo", { filename_prefix: `video/loop/${shot.id}_s${seed}` });
  return g;
}

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
