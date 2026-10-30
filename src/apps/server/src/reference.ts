// Recover the camera of an arbitrary reference video: sample frames, one DA3 pose job, convert to a Poses document.
// Reuses the loop's pieces (same graph, key store, poses converter), so it measures the same way the verifier does.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Poses } from "@comfy-dial/contracts";
import { isTransientError, type ComfyClient } from "./client.ts";
import { buildPoseGraph } from "./graph.ts";
import { REFERENCE_SAMPLES } from "./safety.ts";
import { idempotencyKey, submitOnce, type JobStore } from "./store.ts";
import type { Tools } from "./tools.ts";

export interface ReferenceResult {
  poses: Poses;
  /** Source clip length in seconds (the poses' `t` runs across it). */
  durationSec: number;
  sampled: number;
}

export async function recoverCamera(o: {
  videoPath: string; dir: string; client: ComfyClient; store: JobStore; tools: Tools; maxRetries?: number; log?: (m: string) => void;
}): Promise<ReferenceResult> {
  mkdirSync(o.dir, { recursive: true });
  const sampled = join(o.dir, "ref_sampled.mp4");
  const { durationSec, frames } = await o.tools.sample(o.videoPath, sampled, REFERENCE_SAMPLES);
  o.log?.(`sampled ${frames} frames of a ${durationSec.toFixed(1)} s clip`);
  const up = await o.client.uploadFile(sampled);
  const graph = buildPoseGraph({ videoFile: up, tag: `reference/${o.dir.split("/").pop()}` });

  let jobId = "";
  let lastErr = "";
  const max = o.maxRetries ?? 2;
  for (let attempt = 0; attempt <= max; attempt++) {
    jobId = await submitOnce(o.store, o.client, idempotencyKey("reference", "da3", 0, graph, attempt), "da3", graph);
    const res = await o.client.wait(jobId);
    if (res.state === "succeeded") { lastErr = ""; break; }
    lastErr = res.error ?? "job failed";
    if (!isTransientError(lastErr) || attempt === max) throw new Error(`DA3 failed: ${lastErr}`);
  }
  const txt = (await o.client.download(jobId, join(o.dir, "da3"))).filter((f) => f.endsWith(".txt")).sort();
  const read = (f: string) => JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
  const ext = txt.find((f) => "extrinsics" in read(f));
  const intr = txt.find((f) => "intrinsics" in read(f));
  if (!ext || !intr) throw new Error("DA3 job missing extrinsics/intrinsics text");

  const out = join(o.dir, "poses.json");
  try {
    // The sampled frames are evenly spaced, so index i sits at i * duration / (frames - 1): fps = (frames - 1) / duration.
    await o.tools.buildPoses(ext, intr, out, (frames - 1) / durationSec, 1);
  } catch {
    writeFileSync(out, JSON.stringify({ schema: "comfy-dial/poses/1", fps: 25, image: { width: 768, height: 512 }, solve_ok: false, frames: [] }));
  }
  return { poses: Poses.parse(JSON.parse(readFileSync(out, "utf8"))), durationSec, sampled: frames };
}
