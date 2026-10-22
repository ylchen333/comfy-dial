// Mock Comfy client for --dry-run and tests. Costs nothing. Its "DA3 output" is SYNTHETIC: it is
// derived from the authored Shot (with a per-seed scenario), so dry-run tables exercise the
// plumbing and the verifier but are NOT measurements of any video.
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Shot } from "@comfy-osh/contracts";
import { sampleShot } from "@comfy-osh/rig-core";
import { DuplicateKeyError, type ComfyClient, type Graph, type JobResult } from "./client.ts";

type M3 = number[][];
const mul = (a: M3, b: M3): M3 => a.map((r) => [0, 1, 2].map((j) => r[0]! * b[0]![j]! + r[1]! * b[1]![j]! + r[2]! * b[2]![j]!));
const tr = (a: M3): M3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[j]![i]!));
const mv = (a: M3, v: number[]) => a.map((r) => r[0]! * v[0]! + r[1]! * v[1]! + r[2]! * v[2]!);
const S: M3 = [[1, 0, 0], [0, -1, 0], [0, 0, -1]];

function quatToMat(q: number[]): M3 {
  const [x, y, z, w] = [q[0]!, q[1]!, q[2]!, q[3]!];
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}
const rotY = (a: number): M3 => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];

/** Scenario by seed % 4: 0,1 follow the move; 2 drifts in yaw (30 deg) over the last third; 3 is an unsolved clip. */
export const mockScenario = (seed: number) => (["follows", "follows_jitter", "drifts", "no_solve"] as const)[seed % 4]!;

export function syntheticDa3(shot: Shot, seed: number, stride: number): { extrinsics: string; intrinsics: string } {
  const scenario = mockScenario(seed);
  if (scenario === "no_solve") return { extrinsics: JSON.stringify({ extrinsics: [] }), intrinsics: JSON.stringify({ intrinsics: [] }) };
  const poses = sampleShot(shot).filter((p) => p.frame % stride === 0);
  const { width, height } = shot.resolution;
  const r0 = quatToMat(poses[0]!.quaternion);
  const p0 = poses[0]!.position as number[];
  const ext: Record<string, number[][]>[] = [];
  const intr: Record<string, number[][]>[] = [];
  poses.forEach((p, i) => {
    let r = quatToMat(p.quaternion);
    const u = Math.max(0, (p.frame / (shot.frames - 1) - 2 / 3) * 3);
    if (scenario === "drifts") r = mul(r, rotY((30 * Math.PI / 180) * u));
    const jit = scenario === "follows_jitter" ? 1 + 0.01 * Math.sin(i * 1.7) : 1;
    const rel = mul(tr(r0), r);
    const prel = mv(tr(r0), (p.position as number[]).map((v, k) => v - p0[k]!)).map((v) => v * 0.37 * jit);
    const rcv = mul(S, mul(rel, S));
    const pcv = mv(S, prel);
    const rw = tr(rcv);
    const t = mv(rw, pcv).map((v) => -v);
    ext.push({ [`image_${i}`]: [[rw[0]![0]!, rw[0]![1]!, rw[0]![2]!, t[0]!], [rw[1]![0]!, rw[1]![1]!, rw[1]![2]!, t[1]!], [rw[2]![0]!, rw[2]![1]!, rw[2]![2]!, t[2]!]] });
    const fy = height / 2 / Math.tan((p.fov_v_deg * Math.PI) / 360);
    intr.push({ [`image_${i}`]: [[fy, 0, width / 2], [0, fy, height / 2], [0, 0, 1]] });
  });
  return { extrinsics: JSON.stringify({ extrinsics: ext }), intrinsics: JSON.stringify({ intrinsics: intr }) };
}

export interface MockOptions {
  shot: Shot;
  stride: number;
  /** First N take jobs fail once with a transient "MTPHead" VAELoader error. */
  transientTakeFailures?: number;
  /** Every wait() of a take whose seed is in this set fails permanently. */
  failSeeds?: Set<number>;
}

interface MockJob {
  id: string;
  key: string;
  kind: "take" | "da3";
  seed: number;
  graph: Graph;
}

export class MockClient implements ComfyClient {
  readonly label = "MOCK (dry-run, synthetic poses)";
  readonly jobs: MockJob[] = [];
  readonly submitAttempts: string[] = [];
  readonly uploads: string[] = [];
  private byKey = new Map<string, MockJob>();
  private byId = new Map<string, MockJob>();
  private transientLeft: number;
  /** When set, submit() records the job server-side then throws (simulates a crash after submit). */
  crashAfterSubmit = false;

  private readonly opts: MockOptions;
  constructor(opts: MockOptions) {
    this.opts = opts;
    this.transientLeft = opts.transientTakeFailures ?? 0;
  }

  async uploadFile(localPath: string): Promise<string> {
    this.uploads.push(localPath);
    return `mock_${basename(localPath)}`;
  }

  async submit(graph: Graph, key: string): Promise<string> {
    this.submitAttempts.push(key);
    if (this.byKey.has(key)) throw new DuplicateKeyError(key);
    const kind = Object.values(graph).some((n) => n.class_type === "DepthAnythingV3_MultiView") ? "da3" : "take";
    const file = String((graph[kind === "da3" ? "1" : "9"]?.inputs as { file?: string }).file);
    const seedGraph = graph["16"]?.inputs as { noise_seed?: number } | undefined;
    const seed = kind === "take" ? Number(seedGraph?.noise_seed) : Number(/_s(\d+)/.exec(file)?.[1] ?? 0);
    const job: MockJob = { id: `mock-job-${String(this.jobs.length + 1).padStart(4, "0")}`, key, kind, seed, graph };
    this.jobs.push(job);
    this.byKey.set(key, job);
    this.byId.set(job.id, job);
    if (this.crashAfterSubmit) throw new Error("simulated crash after server accepted the job");
    return job.id;
  }

  async lookupByKey(key: string): Promise<string | null> {
    return this.byKey.get(key)?.id ?? null;
  }

  async wait(jobId: string): Promise<JobResult> {
    const job = this.byId.get(jobId);
    if (!job) return { state: "failed", error: "unknown job" };
    if (job.kind === "take" && this.opts.failSeeds?.has(job.seed)) return { state: "failed", error: "mock permanent failure" };
    if (job.kind === "take" && this.transientLeft > 0) {
      this.transientLeft--;
      return { state: "failed", error: "VAELoader: MTPHead not found (mock transient)" };
    }
    return { state: "succeeded" };
  }

  async download(jobId: string, outDir: string): Promise<string[]> {
    const job = this.byId.get(jobId);
    if (!job) throw new Error(`unknown job ${jobId}`);
    mkdirSync(outDir, { recursive: true });
    if (job.kind === "take") {
      const p = join(outDir, `${jobId}_take.mp4`);
      writeFileSync(p, `MOCK take seed=${job.seed}\n`);
      return [p];
    }
    const { extrinsics, intrinsics } = syntheticDa3(this.opts.shot, job.seed, this.opts.stride);
    const a = join(outDir, `${jobId}_001.txt`);
    const b = join(outDir, `${jobId}_002.txt`);
    writeFileSync(a, extrinsics);
    writeFileSync(b, intrinsics);
    return [a, b];
  }
}
