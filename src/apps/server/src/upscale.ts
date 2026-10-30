// Optional: upscale a finished take with SeedVR2 for a high-resolution copy. Scoring never uses it (the verifier measures the original take).
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { runJob } from "./actor-gen.ts";
import type { ComfyClient } from "./client.ts";
import { buildUpscaleGraph } from "./graph.ts";
import { UPSCALE_HEIGHT } from "./safety.ts";
import type { JobStore } from "./store.ts";

export const upscaledFile = (takeDir: string, height = UPSCALE_HEIGHT) => join(takeDir, `upscaled_${height}.mp4`);

export async function upscaleTake(o: { videoPath: string; outPath: string; client: ComfyClient; store: JobStore; seed: number; fps?: number; height?: number }): Promise<string> {
  mkdirSync(dirname(o.outPath), { recursive: true });
  const up = await o.client.uploadFile(o.videoPath);
  const graph = buildUpscaleGraph({ videoFile: up, seed: o.seed, height: o.height ?? UPSCALE_HEIGHT, fps: o.fps ?? 25 });
  const id = await runJob({ client: o.client, store: o.store, graph, name: "upscale", tag: `upscale/${o.seed}`, maxRetries: 1 });
  const dir = join(dirname(o.outPath), "upscale_dl");
  const files = await o.client.download(id, dir);
  const mp4 = files.find((f) => /\.mp4$/i.test(f)) ?? readdirSync(dir).map((f) => join(dir, f)).find((f) => /\.mp4$/i.test(f));
  if (!mp4 || statSync(mp4).size < 1024) throw new Error("the upscale job returned no video");
  copyFileSync(mp4, o.outPath);
  return o.outPath;
}
