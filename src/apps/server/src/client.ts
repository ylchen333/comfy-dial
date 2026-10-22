// Comfy client seam. Mock, `comfy` CLI (Cloud or local) and any future HTTP/SDK client implement it.
export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export interface JobResult {
  state: "succeeded" | "failed";
  error?: string;
}

/** Thrown by submit() when the server already holds a job for this idempotency key (HTTP 422). */
export class DuplicateKeyError extends Error {
  readonly key: string;
  constructor(key: string) {
    super(`duplicate idempotency key: ${key}`);
    this.key = key;
    this.name = "DuplicateKeyError";
  }
}

export interface ComfyClient {
  readonly label: string;
  /** Upload a local file to the server input dir; returns the name LoadVideo must use. */
  uploadFile(localPath: string): Promise<string>;
  /** Submit one graph. Throws DuplicateKeyError when the key was already used. */
  submit(graph: Graph, idempotencyKey: string): Promise<string>;
  /** Find the job a key maps to on the server, or null when unknown. */
  lookupByKey(idempotencyKey: string): Promise<string | null>;
  wait(jobId: string): Promise<JobResult>;
  /** Download every output of a finished job into outDir; returns absolute paths. */
  download(jobId: string, outDir: string): Promise<string[]>;
}

/** Cloud's occasional VAELoader / "MTPHead" failure is transient; everything else is not. */
export const isTransientError = (msg: string | undefined) => !!msg && /MTPHead|VAELoader/i.test(msg);
