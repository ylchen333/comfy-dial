// pnpm loop --shot <shot.json> --n <k> [--live] [--prompt ...] [--guide depth.mp4]
// Default is a dry run against the mock client (free, synthetic poses). --live spends real Cloud credits.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ControlPacket, Shot } from "@comfy-dial/contracts";
import { CliComfyClient } from "./cli-client.ts";
import type { ComfyClient } from "./client.ts";
import { loadEnvFile } from "./env.ts";
import { cleanPrompt, DEFAULT_NEGATIVE, DEFAULT_PROMPT, MAX_NEGATIVE, MAX_PROMPT } from "./prompt.ts";
import { ensureGuide } from "./guide.ts";
import { MockClient } from "./mock-client.ts";
import { runLoop } from "./pipeline.ts";
import { formatTable } from "./rank.ts";
import { COLD_START_CREDITS, CREDITS_PER_DA3, CREDITS_PER_TAKE, MAX_LIVE_CREDITS, MAX_LIVE_TAKES, estimateCredits, liveRefusal } from "./safety.ts";
import { JobStore } from "./store.ts";
import { copyDecimate, POSE_STRIDE, realTools, SRC_DIR, type Tools } from "./tools.ts";

const CWD = process.env.INIT_CWD ?? process.cwd(); // pnpm --filter runs scripts inside the package dir
const here = dirname(fileURLToPath(import.meta.url));
const IC_LORA = "ltx-2.3-22b-ic-lora-union-control-ref0.5";

const die = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};

async function main() {
  const { values: a } = parseArgs({
    options: {
      shot: { type: "string" },
      n: { type: "string", default: "4" },
      live: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      prompt: { type: "string", default: DEFAULT_PROMPT },
      negative: { type: "string", default: DEFAULT_NEGATIVE },
      guide: { type: "string" },
      strength: { type: "string", default: "1.0" },
      "seed-base": { type: "string", default: "1000" },
      out: { type: "string" },
      "resubmit-pending": { type: "boolean", default: false },
      "allow-unguided": { type: "boolean", default: false },
    },
  });
  if (!a.shot) die("usage: pnpm loop --shot <shot.json> --n <k> [--live]");
  if (a.live && a["dry-run"]) die("pick one of --live and --dry-run");
  const n = Number(a.n);
  if (!Number.isInteger(n) || n < 1) die(`--n must be a positive integer, got ${a.n}`);

  const shotPath = isAbsolute(a.shot!) ? a.shot! : resolve(CWD, a.shot!);
  const raw = JSON.parse(readFileSync(shotPath, "utf8")) as { shot?: unknown };
  const shot = Shot.parse(raw.shot ?? raw); // also accepts a golden clip meta (it embeds the Shot)

  const guide = a.guide
    ? { path: resolve(CWD, a.guide), near: 1, far: 100 }
    : await ensureGuide(shot, resolve(here, "..", ".runs", "guides")).catch((e) => die(`no depth guide for ${shot.id} and rendering one failed: ${(e as Error).message}`));
  if (!existsSync(guide!.path)) die(`guide missing: ${guide!.path}\nrun: pnpm --filter @comfy-dial/rig-core render:golden (needs ffmpeg)`);
  if (Number(a.strength) === 0 && !a["allow-unguided"]) die("--strength 0 gives an unguided take (negative control); add --allow-unguided to confirm");
  const packet = ControlPacket.parse({
    shotId: shot.id,
    depthVideo: guide!.path,
    depthNormalization: { mode: "fixed", near: guide!.near, far: guide!.far },
    iclora: { name: IC_LORA, strength: Number(a.strength) },
  });

  const env = { ...loadEnvFile(resolve(SRC_DIR, ".env")), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("COMFY_"))) };
  const live = a.live!;
  const mode = live ? "live" : "dry";
  const est = estimateCredits(n);
  console.log(`mode: ${live ? "LIVE (Comfy Cloud)" : "DRY-RUN (mock client, synthetic poses, no credits)"}`);
  console.log(`shot: ${shot.id}  frames: ${shot.frames}  n: ${n}  guide: ${guide!.path}`);
  console.log(`estimated cost: ${est} credits (${n} x (${CREDITS_PER_TAKE} take + ${CREDITS_PER_DA3} DA3) + ${COLD_START_CREDITS} cold start)${live ? "" : " if run live; this run spends 0"}`);

  const outDir = a.out ? resolve(CWD, a.out) : resolve(here, "..", ".runs", mode, a["allow-unguided"] ? `${shot.id}-unguided` : shot.id);
  let client: ComfyClient;
  let tools: Tools = realTools;
  let cloud: CliComfyClient | null = null;
  if (live) {
    const refusal = liveRefusal(n, env.COMFY_API_KEY);
    if (refusal) die(refusal);
    cloud = new CliComfyClient({ baseUrl: env.COMFY_BASE_URL, apiKey: env.COMFY_API_KEY, scratchDir: join(outDir, "graphs") });
    client = cloud;
  } else {
    rmSync(outDir, { recursive: true, force: true }); // mock job ids die with the process; never resume them
    client = new MockClient({ shot, stride: POSE_STRIDE });
    tools = { ...realTools, decimate: copyDecimate }; // mock "videos" are text stand-ins; poses/verifier stay real
  }
  console.log(`limits for --live: n <= ${MAX_LIVE_TAKES}, estimate <= ${MAX_LIVE_CREDITS} credits`);

  const before = cloud ? await cloud.credits() : null;
  if (before !== null) console.log(`credits before: ${before}`);
  const store = new JobStore(join(outDir, "jobs.json"));
  const ranked = await runLoop({
    shot, shotPath, packet, guidePath: guide!.path, prompt: cleanPrompt(a.prompt, MAX_PROMPT, DEFAULT_PROMPT, "--prompt"), negative: cleanPrompt(a.negative, MAX_NEGATIVE, DEFAULT_NEGATIVE, "--negative"), allowUnguided: a["allow-unguided"]!, n,
    seedBase: Number(a["seed-base"]), outDir, client, store, tools,
    resubmitPending: a["resubmit-pending"]!,
    log: (m) => console.log(m),
  });
  if (cloud) {
    const after = await cloud.credits();
    if (before !== null && after !== null) console.log(`credits after: ${after}  change so far: ${before - after} (Cloud billing can lag several minutes; re-check the balance later)`);
  }

  console.log(`\nranked takes (${client.label})`);
  console.log(formatTable(ranked.map((r) => ({ rank: r.rank, item: r.item }))));
  console.log("\n* FOV is reported, not gated. Gates: rot < 2.75 deg; trans < 12% only when the authored focal ratio is within 10% of 1.\n* move = advisory focal-change class (none/in/out) vs authored; MISMATCH does not change pass/fail.");
  const disagree = ranked.filter((r) => r.item.report.solveOk && r.item.report.pass !== r.item.verdict.pass);
  if (disagree.length) console.log(`note: verifier pass differs from the frozen gate for ${disagree.map((r) => r.item.id).join(", ")} (verifier build may still carry provisional gates).`);
  if (!live) console.log("DRY-RUN: poses are synthetic (seed % 4: follows, follows+jitter, yaw drift, no solve). Not a measurement.");
  console.log(`job store: ${store.path}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
