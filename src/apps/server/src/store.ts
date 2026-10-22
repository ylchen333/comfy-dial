// Job store: {idempotencyKey -> jobId} persisted to JSON BEFORE awaiting any job, so a crash or
// retry never double-submits. Plus per-take stage results so a rerun resumes instead of redoing.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DuplicateKeyError, type ComfyClient, type Graph } from "./client.ts";

export interface JobRecord {
  /** null = intent persisted, submit not confirmed (crash window). */
  jobId: string | null;
  kind: string;
  createdAt: string;
}

export interface TakeRecord {
  seed: number;
  takeKey?: string;
  takeVideo?: string;
  daKey?: string;
  extrinsics?: string;
  intrinsics?: string;
  poses?: string;
  report?: unknown;
}

interface StoreFile {
  version: 1;
  jobs: Record<string, JobRecord>;
  takes: Record<string, TakeRecord>;
}

export class PendingSubmitError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(
      `key ${key} was recorded but its submit was never confirmed and the server cannot tell us the job. ` +
        `Refusing to resubmit (could double-spend). Check the server queue, then set the jobId in the job store ` +
        `or rerun with --resubmit-pending.`,
    );
    this.name = "PendingSubmitError";
    this.key = key;
  }
}

export class JobStore {
  private data: StoreFile = { version: 1, jobs: {}, takes: {} };

  readonly path: string;
  constructor(path: string) {
    this.path = path;
    if (existsSync(path)) this.data = JSON.parse(readFileSync(path, "utf8")) as StoreFile;
  }

  private flush() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.path); // atomic: a crash leaves the old or the new file, never half of one
  }

  job(key: string): JobRecord | undefined {
    return this.data.jobs[key];
  }
  putJob(key: string, rec: JobRecord) {
    this.data.jobs[key] = rec;
    this.flush();
  }
  take(id: string): TakeRecord | undefined {
    return this.data.takes[id];
  }
  patchTake(id: string, patch: Partial<TakeRecord> & { seed?: number }) {
    const cur = this.data.takes[id] ?? { seed: patch.seed ?? 0 };
    this.data.takes[id] = { ...cur, ...patch } as TakeRecord;
    this.flush();
  }
  allJobs(): Readonly<Record<string, JobRecord>> {
    return this.data.jobs;
  }
}

export const shortHash = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 8);

/** Same inputs give the same key (so reruns dedupe); changed prompt/guide/etc. give a new key. */
export const idempotencyKey = (shotId: string, kind: string, seed: number, graph: Graph, attempt = 0) =>
  `${shotId}:${kind}:${seed}:${shortHash(graph)}${attempt ? `:r${attempt}` : ""}`;

/**
 * Submit at most once per key. Order matters: (1) persist intent, (2) submit, (3) persist jobId.
 * A 422 duplicate, or a recorded-but-unconfirmed key, resolves by looking the job up, never by resubmitting.
 */
export async function submitOnce(
  store: JobStore,
  client: ComfyClient,
  key: string,
  kind: string,
  graph: Graph,
  opts: { resubmitPending?: boolean } = {},
): Promise<string> {
  const rec = store.job(key);
  if (rec?.jobId) return rec.jobId;
  if (rec) {
    const found = await client.lookupByKey(key);
    if (found) {
      store.putJob(key, { ...rec, jobId: found });
      return found;
    }
    if (!opts.resubmitPending) throw new PendingSubmitError(key);
  } else {
    store.putJob(key, { jobId: null, kind, createdAt: new Date().toISOString() });
  }
  let jobId: string;
  try {
    jobId = await client.submit(graph, key);
  } catch (e) {
    if (!(e instanceof DuplicateKeyError)) throw e;
    const found = await client.lookupByKey(key);
    if (!found) throw new Error(`server says ${key} is a duplicate but cannot find its job`);
    jobId = found;
  }
  store.putJob(key, { jobId, kind, createdAt: store.job(key)!.createdAt });
  return jobId;
}
