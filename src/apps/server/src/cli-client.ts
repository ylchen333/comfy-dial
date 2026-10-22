// Live client: drives the `comfy` CLI, the same path the M0 spikes used (verified end to end).
// Cloud vs local is chosen from COMFY_BASE_URL: empty or *.comfy.org = Cloud, anything else = local host:port.
// Server-side idempotency keys are not exposed by the CLI, so duplicate protection is our job store
// (persist intent before submit); lookupByKey is therefore always null and an unconfirmed submit
// surfaces as PendingSubmitError instead of being silently resubmitted.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { ComfyClient, Graph, JobResult } from "./client.ts";

const execp = promisify(execFile);

interface Envelope {
  ok: boolean;
  data: Record<string, unknown> | null;
  error: { code?: string; message?: string } | null;
}

export function resolveTarget(baseUrl: string | undefined): string[] {
  if (!baseUrl || /(^|\/\/|\.)comfy\.org(\/|:|$)/.test(baseUrl)) return ["--where", "cloud"];
  const u = new URL(baseUrl);
  return ["--where", "local", "--host", u.hostname, "--port", u.port || "8188"];
}

export class CliComfyClient implements ComfyClient {
  readonly label: string;
  private readonly target: string[];
  private readonly opts: { baseUrl?: string | undefined; apiKey?: string | undefined; scratchDir: string; timeoutSec?: number };

  constructor(opts: { baseUrl?: string | undefined; apiKey?: string | undefined; scratchDir: string; timeoutSec?: number }) {
    this.opts = opts;
    this.target = resolveTarget(opts.baseUrl);
    this.label = `LIVE (${this.target[1]})`;
    mkdirSync(opts.scratchDir, { recursive: true });
  }

  private async comfy(args: string[]): Promise<Envelope> {
    const env = { ...process.env, ...(this.opts.apiKey ? { COMFY_API_KEY: this.opts.apiKey } : {}) };
    try {
      const { stdout } = await execp("comfy", ["--json", ...args], { env, maxBuffer: 64 * 1024 * 1024 });
      return JSON.parse(stdout) as Envelope;
    } catch (e) {
      const out = (e as { stdout?: string }).stdout;
      if (out) {
        try {
          return JSON.parse(out) as Envelope;
        } catch {
          /* fall through */
        }
      }
      throw new Error(`comfy ${args[0]} failed: ${(e as Error).message.split("\n")[0]}`);
    }
  }

  private must(env: Envelope, what: string): Record<string, unknown> {
    if (!env.ok || !env.data) throw new Error(`${what}: ${env.error?.code ?? "error"} ${env.error?.message ?? ""}`.trim());
    return env.data;
  }

  async uploadFile(localPath: string): Promise<string> {
    const d = this.must(await this.comfy(["upload", ...this.target, localPath]), "upload");
    const up = (d.uploads as { cloud_name?: string }[] | undefined)?.[0];
    return up?.cloud_name ?? basename(localPath);
  }

  async submit(graph: Graph, key: string): Promise<string> {
    const file = join(this.opts.scratchDir, `${key.replace(/[^\w.-]/g, "_")}.api.json`);
    writeFileSync(file, JSON.stringify(graph));
    const d = this.must(await this.comfy(["run", "--workflow", file, ...this.target]), "run");
    const id = (d.prompt_id ?? d.job_id) as string | undefined;
    if (!id) throw new Error(`run returned no prompt_id: ${JSON.stringify(d).slice(0, 200)}`);
    return id;
  }

  async lookupByKey(): Promise<string | null> {
    return null;
  }

  async wait(jobId: string): Promise<JobResult> {
    const env = await this.comfy(["jobs", "wait", jobId, ...this.target, "--timeout", String(this.opts.timeoutSec ?? 1800)]);
    const job = (env.data?.jobs as { status?: string; ok?: boolean }[] | undefined)?.[0];
    if (job?.ok) return { state: "succeeded" };
    // Pull the server's error text (VAELoader / MTPHead shows up here) so transient failures can retry.
    let msg = job?.status ?? env.error?.message ?? "job did not complete";
    try {
      const st = await this.comfy(["jobs", "status", jobId, ...this.target]);
      const extra = [st.data?.error_message, JSON.stringify(st.data?.execution_error ?? "")].filter(Boolean).join(" ");
      if (extra) msg = `${msg}: ${extra}`;
    } catch {
      /* keep msg */
    }
    return { state: "failed", error: msg };
  }

  async download(jobId: string, outDir: string): Promise<string[]> {
    mkdirSync(outDir, { recursive: true });
    const d = this.must(await this.comfy(["download", jobId, ...this.target, "-o", outDir]), "download");
    const files = (d.files as { url?: string; path: string }[]) ?? [];
    // Job outputs also list the INPUT files (type=input); keep only real outputs.
    return files.filter((f) => !f.url || /type=output/.test(f.url)).map((f) => f.path);
  }

  /** Credit balance, for before/after cost reporting. */
  async credits(): Promise<number | null> {
    const d = this.must(await this.comfy(["cloud", "status"]), "cloud status");
    return typeof d.credit_balance_credits === "number" ? d.credit_balance_credits : null;
  }
}
