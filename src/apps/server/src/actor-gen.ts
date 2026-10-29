// Optional "generate an actor" step: description (or the user's own photo) -> reference image -> Hunyuan3D 2.1 shape -> normalised GLB.
// The result lives in the local uploads folder only; nothing generated is ever written to src/assets (Tencent licence: not bundled).
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeActorGlb, type ActorReport, type NormalizeOptions } from "./actor-normalize.ts";
import type { AssetStore, UploadResult } from "./assets.ts";
import { isTransientError, type ComfyClient, type Graph } from "./client.ts";
import { buildActorImageGraph, buildActorMeshGraph } from "./graph.ts";
import { idempotencyKey, submitOnce, type JobStore } from "./store.ts";

export interface ActorResult extends UploadResult {
  report: ActorReport;
  /** Reference image the shape was made from (absolute path in the run dir). */
  imagePath: string;
}

/** The prompt the image model sees: a plain, full-length, arms-down front view, which is what image-to-3D reconstructs best. */
export const actorImagePrompt = (description: string) =>
  `full body photo of ${description.trim()}, standing straight, arms relaxed at the sides, feet together, facing the camera, head to toe fully in frame, plain white background, soft studio lighting`;

const seedOf = (text: string) => parseInt(createHash("sha1").update(text).digest("hex").slice(0, 7), 16);

async function runJob(o: { client: ComfyClient; store: JobStore; graph: Graph; name: string; tag: string; maxRetries?: number }): Promise<string> {
  const max = o.maxRetries ?? 2;
  for (let attempt = 0; ; attempt++) {
    const id = await submitOnce(o.store, o.client, idempotencyKey(o.tag, o.name, 0, o.graph, attempt), o.name, o.graph);
    const res = await o.client.wait(id);
    if (res.state === "succeeded") return id;
    if (!isTransientError(res.error) || attempt >= max) throw new Error(`${o.name} failed: ${res.error ?? "job failed"}`);
  }
}

export async function generateActor(o: {
  dir: string; client: ComfyClient; store: JobStore; assets: AssetStore;
  /** Either a description (an image is generated) or a photo the user supplied. */
  description?: string; imagePath?: string; seed?: number; normalize?: NormalizeOptions; log?: (m: string) => void;
}): Promise<ActorResult> {
  mkdirSync(o.dir, { recursive: true });
  const tag = `actor/${o.dir.split("/").pop()}`;
  let imagePath = o.imagePath;
  if (!imagePath) {
    if (!o.description?.trim()) throw new Error("give a description or an image");
    const seed = o.seed ?? seedOf(o.description);
    const id = await runJob({ client: o.client, store: o.store, graph: buildActorImageGraph({ prompt: actorImagePrompt(o.description), seed }), name: "actor-image", tag });
    const img = (await o.client.download(id, join(o.dir, "image"))).find((f) => /\.(png|jpe?g|webp)$/i.test(f));
    if (!img) throw new Error("the image job returned no image");
    imagePath = join(o.dir, "reference.png");
    copyFileSync(img, imagePath);
    o.log?.("reference image made");
  }
  const up = await o.client.uploadFile(imagePath);
  const seed = o.seed ?? seedOf(o.description ?? up);
  const id = await runJob({ client: o.client, store: o.store, graph: buildActorMeshGraph({ imageFile: up, seed }), name: "actor-mesh", tag });
  const outDir = join(o.dir, "mesh");
  const glb = (await o.client.download(id, outDir)).find((f) => /\.glb$/i.test(f)) ?? readdirSync(outDir).map((f) => join(outDir, f)).find((f) => /\.glb$/i.test(f));
  if (!glb) throw new Error("the shape job returned no GLB");
  const { glb: bytes, report } = normalizeActorGlb(readFileSync(glb), o.normalize);
  if (!bytes) throw new Error(`the generated shape is not usable: ${report.problems.join("; ")}`);
  return { ...o.assets.save(bytes), report, imagePath };
}
