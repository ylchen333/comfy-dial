// pnpm replay --graph <saved .api.json> --set 22.temporal_size=128 [--set ...] --out <dir> --yes
// Re-run one saved take graph with some inputs changed, so a setting can be compared on the SAME seed, prompt and guide.
// Spends one take's credits on Cloud (about 5 warm, up to 13 cold), so it does nothing without --yes.
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CliComfyClient } from "./cli-client.ts";
import type { Graph } from "./client.ts";
import { loadEnvFile } from "./env.ts";
import { idempotencyKey, JobStore, submitOnce } from "./store.ts";
import { REPAIR_CREDITS, CREDITS_PER_TAKE, COLD_START_CREDITS } from "./safety.ts";
import { SRC_DIR } from "./tools.ts";

const CWD = process.env.INIT_CWD ?? process.cwd();
const abs = (p: string) => (isAbsolute(p) ? p : resolve(CWD, p));
const die = (m: string): never => { console.error(m); process.exit(1); };

/** Apply "node.input=value" edits; the node and input must already exist (a typo must not silently add one). */
export function applySets(g: Graph, sets: readonly string[]): string[] {
  return sets.map((s) => {
    const m = /^(\d+)\.([A-Za-z_][\w.]*)=(.+)$/.exec(s);
    if (!m) throw new Error(`--set must look like 22.temporal_size=128, got "${s}"`);
    const [, id, input, raw] = m as unknown as [string, string, string, string];
    const node = g[id];
    if (!node) throw new Error(`graph has no node ${id}`);
    if (!(input in node.inputs)) throw new Error(`node ${id} (${node.class_type}) has no input "${input}"`);
    let value: unknown = raw;
    try { value = JSON.parse(raw); } catch { /* plain string */ }
    if (Array.isArray(node.inputs[input])) throw new Error(`node ${id}.${input} is a link, not a value`);
    node.inputs[input] = value;
    return `${node.class_type} ${id}.${input} = ${JSON.stringify(value)}`;
  });
}

async function main() {
  const { values: a } = parseArgs({ options: { graph: { type: "string" }, set: { type: "string", multiple: true, default: [] }, out: { type: "string" }, yes: { type: "boolean", default: false } } });
  if (!a.graph || !a.out) die("usage: pnpm replay --graph <file.api.json> --set 22.temporal_size=128 --out <dir> --yes");
  const g = JSON.parse(readFileSync(abs(a.graph!), "utf8")) as Graph;
  const changes = applySets(g, a.set ?? []);
  console.log(changes.length ? `changes:\n  ${changes.join("\n  ")}` : "no changes: this repeats the graph as saved");
  console.log(`cost: about ${CREDITS_PER_TAKE} credits on a warm worker, up to ${CREDITS_PER_TAKE + COLD_START_CREDITS} cold (one take, no pose job; REPAIR is ${REPAIR_CREDITS})`);
  if (!a.yes) die("not running: add --yes to spend the credits");
  const env = { ...loadEnvFile(resolve(SRC_DIR, ".env")), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("COMFY_"))) };
  if (!env.COMFY_API_KEY) die("replay is live-only: set COMFY_API_KEY in src/.env");
  const out = abs(a.out!);
  const client = new CliComfyClient({ baseUrl: env.COMFY_BASE_URL, apiKey: env.COMFY_API_KEY, scratchDir: join(out, "graphs") });
  const before = await client.credits();
  const store = new JobStore(join(out, "jobs.json"));
  const seed = Number((g["16"]?.inputs as { noise_seed?: number } | undefined)?.noise_seed ?? 0);
  const jobId = await submitOnce(store, client, idempotencyKey("replay", "take", seed, g), "take", g);
  console.log(`submitted ${jobId}; waiting`);
  const res = await client.wait(jobId);
  if (res.state !== "succeeded") die(`job failed: ${res.error ?? "unknown"}`);
  const files = (await client.download(jobId, join(out, "take"))).filter((f) => /\.(mp4|webm|mov)$/i.test(f));
  console.log(files.join("\n"));
  const after = await client.credits();
  if (before !== null && after !== null) console.log(`credits: ${before} -> ${after} (change so far ${before - after}; billing can lag)`);
}

if (process.argv[1] && /replay-cli\.ts$/.test(process.argv[1])) main().catch((e) => { console.error((e as Error).message); process.exit(1); });
