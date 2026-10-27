// The loop: guide upload -> N take submits (all persisted before any await) -> per take:
// wait -> download -> decimate -> DA3 job -> Poses JSON -> verifier -> ScoreReport.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Poses, ScoreReport, type ControlPacket, type Shot } from "@comfy-osh/contracts";
import { isTransientError, type ComfyClient, type Graph } from "./client.ts";
import { buildPoseGraph, buildSegmentGraph, buildTakeGraph, SEGMENT_CONTEXT_FRAMES, segmentWindow } from "./graph.ts";
import { moveCheck, rankTakes, verdict, type Ranked, type TableRow } from "./rank.ts";
import { idempotencyKey, submitOnce, type JobStore } from "./store.ts";
import { POSE_STRIDE, type Tools } from "./tools.ts";

export interface LoopOptions {
  shot: Shot;
  shotPath: string;
  packet: ControlPacket;
  guidePath: string;
  prompt: string;
  allowUnguided?: boolean | undefined;
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
  const graphs = seeds.map((seed) => buildTakeGraph({ shot: o.shot, packet: o.packet, guideFile, prompt: o.prompt, seed, allowUnguided: o.allowUnguided }));

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
  name = `s${seed}`,
): Promise<TakeOutcome> {
  const id = `${o.shot.id}-${name}`;
  const dir = join(o.outDir, name);
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
      const decim = join(dir, `take_${name}_dec.mp4`);
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
    const posesDoc = Poses.parse(JSON.parse(readFileSync(posesPath, "utf8"))); // throws if the conversion output drifts from the contract
    const report = await o.tools.score(o.shotPath, posesPath, id);
    o.store.patchTake(id, { poses: posesPath, report });
    return { id, seed, report, verdict: verdict(report, o.shot), takeJobId, daJobId, note: report.solveOk ? undefined : "solve failed", move: moveCheck(o.shot, posesDoc) };
  } catch (e) {
    return fail(`error: ${(e as Error).message}`, takeJobId, daJobId);
  }
}

export interface RepairOptions extends Omit<LoopOptions, "n" | "seedBase" | "allowUnguided"> {
  /** Outcome of the take being repaired (its stored video must exist). */
  take: TakeOutcome;
  /** Segment index to regenerate; defaults to the first drifted segment. */
  segment?: number;
  /** attention_strength for the regeneration (contract max 1.0); at least the take's. At 1.0 the levers are the new seed and the pinned context. */
  strength: number;
  /** Defaults to seed + 1 so the repair is not a replay of the failed sample. */
  seed?: number;
}

export interface RepairResult {
  before: TakeOutcome;
  after: TakeOutcome;
  segment: number;
  /** Frame where the regenerated clip starts (0 = segment 0, whole take redone). */
  fromFrame: number;
  improved: boolean;
}

/**
 * Regenerate one drifted segment of a take, then re-score the WHOLE patched clip (seam check).
 * The new clip continues from 9 original frames just before the segment and runs to the end of
 * the shot (SPEC section 9: seams fallback). Segment 0 has nothing to continue from, so the take is redone.
 */
export async function repairSegment(o: RepairOptions): Promise<RepairResult> {
  const { shot, take } = o;
  const log = o.log ?? (() => {});
  const k = o.segment ?? take.verdict.badSegments[0];
  if (k === undefined) throw new Error(`${take.id} has no drifted segment to repair`);
  if (!take.verdict.badSegments.includes(k)) throw new Error(`segment ${k} of ${take.id} did not drift; refusing to spend a job on it`);
  if (o.strength < o.packet.iclora.strength) throw new Error(`repair strength ${o.strength} must be at least the take's ${o.packet.iclora.strength}`);
  const rec = o.store.take(take.id);
  if (!rec?.takeVideo || !existsSync(rec.takeVideo)) throw new Error(`no stored video for ${take.id}`);

  const seed = o.seed ?? take.seed + 1;
  const win = segmentWindow(shot, k);
  const name = `s${take.seed}-r${k}`;
  const id = `${shot.id}-${name}`;
  const dir = join(o.outDir, name);
  mkdirSync(dir, { recursive: true });
  const packet = { ...o.packet, iclora: { ...o.packet.iclora, strength: o.strength } };
  const pre = `repair seg ${k} of ${take.id}:`;

  let graph: Graph;
  const guideFile = win.hasContext ? await trimUpload(o, o.guidePath, join(dir, "guide_seg.mp4"), win.ctxStart, win.length) : await o.client.uploadFile(o.guidePath);
  if (win.hasContext) {
    const contextFile = await trimUpload(o, rec.takeVideo, join(dir, "context.mp4"), win.ctxStart, SEGMENT_CONTEXT_FRAMES);
    graph = buildSegmentGraph({ shot, packet, guideFile, contextFile, prompt: o.prompt, seed, window: win });
  } else {
    graph = buildTakeGraph({ shot, packet, guideFile, prompt: o.prompt, seed });
  }
  log(`${pre} regenerating frames ${win.ctxStart}-${shot.frames - 1} at strength ${o.strength}, seed ${seed}`);

  const lo: LoopOptions = { ...o, n: 1, seedBase: seed };
  const job = await runJob(lo, "repair", seed, graph, (takeKey) => o.store.patchTake(id, { seed, takeKey }));
  if (job.error) throw new Error(`${pre} job failed: ${job.error}`);
  const files = (await o.client.download(job.jobId, join(dir, "take"))).filter((f) => /\.(mp4|webm|mov)$/i.test(f));
  const fresh = files.find((f) => !/guide|depth|context/i.test(basename(f))) ?? files[0];
  if (!fresh) throw new Error(`${pre} job produced no video`);

  let patched = fresh;
  if (win.hasContext) {
    patched = join(dir, "patched.mp4");
    await o.tools.stitch(rec.takeVideo, win.ctxStart, fresh, patched, shot.fps);
  }
  o.store.patchTake(id, { seed, takeVideo: patched });
  const after = await chain(lo, seed, graph, job.jobId, name);
  // Improved = the repaired segment now passes the frozen gate and no segment that passed before fails now.
  // Not the composite: it carries translation error, which is ungated on focal-changing shots.
  const improved = after.report.solveOk && !after.verdict.badSegments.includes(k) && after.verdict.badSegments.every((b) => take.verdict.badSegments.includes(b));
  return { before: take, after, segment: k, fromFrame: win.ctxStart, improved };
}

async function trimUpload(o: RepairOptions, src: string, dst: string, start: number, count: number): Promise<string> {
  await o.tools.trim(src, dst, start, count, o.shot.fps);
  return o.client.uploadFile(dst);
}

export const listDir = (d: string) => (existsSync(d) ? readdirSync(d) : []);
