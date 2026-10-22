// The loop: guide upload -> N take submits (all persisted before any await) -> per take:
// wait -> download -> decimate -> DA3 job -> Poses JSON -> verifier -> ScoreReport.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Poses, ScoreReport, type ControlPacket, type Shot } from "@comfy-osh/contracts";
import { isTransientError, type ComfyClient, type Graph } from "./client.ts";
import { buildPoseGraph, buildTakeGraph } from "./graph.ts";
import { rankTakes, verdict, type Ranked, type TableRow } from "./rank.ts";
import { idempotencyKey, submitOnce, type JobStore } from "./store.ts";
import { POSE_STRIDE, type Tools } from "./tools.ts";

export interface LoopOptions {
  shot: Shot;
  shotPath: string;
  packet: ControlPacket;
  guidePath: string;
  prompt: string;
  n: number;
  seedBase: number;
  outDir: string;
  client: ComfyClient;
  store: JobStore;
  tools: Tools;
  maxRetries?: number;
  resubmitPending?: boolean;
  log?: (msg: string) => void;
}

export interface TakeOutcome extends TableRow {
  takeJobId: string | null;
  daJobId: string | null;
}

const failedReport = (shot: Shot, id: string): ScoreReport =>
  ScoreReport.parse({
    candidateId: id,
    solveOk: false,
    mode: "full",
    rotErrDeg: null,
    transErrPct: null,
    fovErrDeg: null,
    perSegment: shot.segments.map((s) => ({ ...s, rotErrDeg: null, transErrPct: null, fovErrDeg: null, pass: false })),
    composite: null,
    pass: false,
  });

/** Wait for a job; a transient Cloud failure resubmits under a new key (r1, r2) instead of reusing a dead one. */
async function runJob(
  o: LoopOptions,
  kind: string,
  seed: number,
  graph: Graph,
  onKey: (key: string) => void,
  firstJobId?: string,
): Promise<{ jobId: string; error?: string }> {
  const max = o.maxRetries ?? 2;
  let lastErr: string | undefined;
  for (let attempt = 0; attempt <= max; attempt++) {
    const key = idempotencyKey(o.shot.id, kind, seed, graph, attempt);
    onKey(key);
    const jobId = attempt === 0 && firstJobId ? firstJobId : await submitOnce(o.store, o.client, key, kind, graph, { resubmitPending: o.resubmitPending ?? false });
    const res = await o.client.wait(jobId);
    if (res.state === "succeeded") return { jobId };
    lastErr = res.error;
    o.log?.(`  ${kind} seed ${seed} job ${jobId} failed: ${res.error ?? "unknown"}${isTransientError(res.error) && attempt < max ? " (transient, retrying)" : ""}`);
    if (!isTransientError(res.error)) return { jobId, error: res.error ?? "job failed" };
  }
  return { jobId: "", error: lastErr ?? "retries exhausted" };
}

export async function runLoop(o: LoopOptions): Promise<Ranked<TakeOutcome>[]> {
  const log = o.log ?? (() => {});
  mkdirSync(o.outDir, { recursive: true });
  const guideFile = await o.client.uploadFile(o.guidePath);
  log(`guide uploaded as ${guideFile}`);

  const seeds = Array.from({ length: o.n }, (_, i) => o.seedBase + i);
  const graphs = seeds.map((seed) => buildTakeGraph({ shot: o.shot, packet: o.packet, guideFile, prompt: o.prompt, seed }));

  // Fan-out: N submit() calls. Every key hits the store before any job is awaited.
  const firstIds = await Promise.all(
    seeds.map(async (seed, i) => {
      const key = idempotencyKey(o.shot.id, "take", seed, graphs[i]!);
      const id = await submitOnce(o.store, o.client, key, "take", graphs[i]!, { resubmitPending: o.resubmitPending ?? false });
      log(`submitted take seed ${seed} -> ${id}`);
      return id;
    }),
  );

  const outcomes = await Promise.all(seeds.map((seed, i) => chain(o, seed, graphs[i]!, firstIds[i]!)));
  return rankTakes(outcomes);
}

async function chain(
  o: LoopOptions,
  seed: number,
  graph: Graph,
  firstJobId: string,
): Promise<TakeOutcome> {
  const id = `${o.shot.id}-s${seed}`;
  const dir = join(o.outDir, `s${seed}`);
  mkdirSync(dir, { recursive: true });
  const log = o.log ?? (() => {});
  const fail = (note: string, takeJobId: string | null, daJobId: string | null): TakeOutcome => {
    const report = failedReport(o.shot, id);
    return { id, seed, report, verdict: verdict(report, o.shot), note, takeJobId, daJobId };
  };
  let takeJobId: string | null = null;
  let daJobId: string | null = null;
  try {
    // 1. take
    const rec = o.store.take(id);
    let takeVideo = rec?.takeVideo && existsSync(rec.takeVideo) ? rec.takeVideo : undefined;
    if (!takeVideo) {
      const take = await runJob(o, "take", seed, graph, (takeKey) => o.store.patchTake(id, { seed, takeKey }), firstJobId);
      takeJobId = take.jobId || null;
      if (take.error) return fail(`take failed: ${take.error}`, takeJobId, null);
      const files = await o.client.download(take.jobId, join(dir, "take"));
      const vids = files.filter((f) => /\.(mp4|webm|mov)$/i.test(f));
      // The input guide can ride along in the job outputs; the take is the file that is not the guide.
      takeVideo = vids.find((f) => !/guide|depth/i.test(basename(f))) ?? vids[0];
      if (!takeVideo) return fail("take job produced no video", takeJobId, null);
      o.store.patchTake(id, { takeVideo });
    } else {
      takeJobId = o.store.job(o.store.take(id)!.takeKey ?? "")?.jobId ?? null;
    }

    // 2. DA3 poses job on the decimated take
    let rec2 = o.store.take(id)!;
    if (!rec2.extrinsics || !existsSync(rec2.extrinsics)) {
      const decim = join(dir, `take_s${seed}_dec.mp4`);
      await o.tools.decimate(takeVideo, decim, POSE_STRIDE);
      const upName = await o.client.uploadFile(decim);
      const pg = buildPoseGraph({ videoFile: upName, tag: id });
      const da = await runJob(o, "da3", seed, pg, (daKey) => o.store.patchTake(id, { daKey }));
      daJobId = da.jobId || null;
      if (da.error) return fail(`DA3 failed: ${da.error}`, takeJobId, daJobId);
      const files = (await o.client.download(da.jobId, join(dir, "da3"))).filter((f) => f.endsWith(".txt")).sort();
      const read = (f: string) => JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
      const ext = files.find((f) => "extrinsics" in read(f));
      const intr = files.find((f) => "intrinsics" in read(f));
      if (!ext || !intr) return fail("DA3 job missing extrinsics/intrinsics text", takeJobId, daJobId);
      o.store.patchTake(id, { extrinsics: ext, intrinsics: intr });
      rec2 = o.store.take(id)!;
    } else {
      daJobId = o.store.job(rec2.daKey ?? "")?.jobId ?? null;
    }

    // 3. poses JSON (validated with the contract), 4. verifier
    const posesPath = join(dir, "poses.json");
    try {
      await o.tools.buildPoses(rec2.extrinsics!, rec2.intrinsics!, posesPath, o.shot.fps, POSE_STRIDE);
    } catch (e) {
      // An unusable solve (e.g. zero frames) is a failed solve scored by the verifier, never a dropped take.
      void e;
      log(`  ${id}: pose conversion produced no usable solve; recording solve_ok=false`);
      writeFileSync(posesPath, JSON.stringify({ schema: "comfy-osh/poses/1", fps: o.shot.fps, image: o.shot.resolution, solve_ok: false, frames: [] }));
    }
    Poses.parse(JSON.parse(readFileSync(posesPath, "utf8"))); // throws if the conversion output drifts from the contract
    const report = await o.tools.score(o.shotPath, posesPath, id);
    o.store.patchTake(id, { poses: posesPath, report });
    return { id, seed, report, verdict: verdict(report, o.shot), takeJobId, daJobId, note: report.solveOk ? undefined : "solve failed" };
  } catch (e) {
    return fail(`error: ${(e as Error).message}`, takeJobId, daJobId);
  }
}

export const listDir = (d: string) => (existsSync(d) ? readdirSync(d) : []);
