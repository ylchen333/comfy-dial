// pnpm repair --run <run dir> --shot <shot.json> --take <take id> [--segment k] [--strength 1.0] [--seed n]
// Regenerates one drifted segment of a stored LIVE take and re-scores the whole patched clip. Spends Cloud credits.
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ControlPacket, ScoreReport, Shot } from "@comfy-osh/contracts";
import { CliComfyClient } from "./cli-client.ts";
import { loadEnvFile } from "./env.ts";
import { ensureGuide } from "./guide.ts";
import { repairSegment, type TakeOutcome } from "./pipeline.ts";
import { verdict } from "./rank.ts";
import { REPAIR_CREDITS } from "./safety.ts";
import { JobStore } from "./store.ts";
import { realTools, SRC_DIR } from "./tools.ts";

const CWD = process.env.INIT_CWD ?? process.cwd();
const here = dirname(fileURLToPath(import.meta.url));
const IC_LORA = "ltx-2.3-22b-ic-lora-union-control-ref0.5";
const DEFAULT_PROMPT = "A cinematic shot of a single subject in a room, soft natural light, smooth steady camera motion.";

const die = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};
const abs = (p: string) => (isAbsolute(p) ? p : resolve(CWD, p));

async function main() {
  const { values: a } = parseArgs({
    options: {
      run: { type: "string" }, shot: { type: "string" }, take: { type: "string" }, segment: { type: "string" },
      strength: { type: "string", default: "1.0" }, "orig-strength": { type: "string", default: "1.0" },
      seed: { type: "string" }, prompt: { type: "string", default: DEFAULT_PROMPT }, guide: { type: "string" },
    },
  });
  if (!a.run || !a.shot || !a.take) die("usage: pnpm repair --run <run dir> --shot <shot.json> --take <take id> [--segment k] [--strength 1.0]");
  const runDir = abs(a.run!);
  const shotPath = abs(a.shot!);
  const raw = JSON.parse(readFileSync(shotPath, "utf8")) as { shot?: unknown };
  const shot = Shot.parse(raw.shot ?? raw);
  const env = { ...loadEnvFile(resolve(SRC_DIR, ".env")), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("COMFY_"))) };
  if (!env.COMFY_API_KEY) die("repair is live-only: set COMFY_API_KEY in src/.env");

  const store = new JobStore(join(runDir, "jobs.json"));
  const rec = store.take(a.take!);
  if (!rec?.report) die(`no scored take ${a.take} in ${join(runDir, "jobs.json")}`);
  const report = ScoreReport.parse(rec!.report);
  const take: TakeOutcome = { id: a.take!, seed: rec!.seed, report, verdict: verdict(report, shot), takeJobId: null, daJobId: null };

  const guide = a.guide ? { path: abs(a.guide), near: 1, far: 100 } : await ensureGuide(shot, resolve(here, "..", ".runs", "guides"));
  const packet = ControlPacket.parse({
    shotId: shot.id, depthVideo: guide.path, depthNormalization: { mode: "fixed", near: guide.near, far: guide.far },
    iclora: { name: IC_LORA, strength: Number(a["orig-strength"]) },
  });
  console.log(`repair ${take.id}: bad segments [${take.verdict.badSegments.join(",")}], estimate ${REPAIR_CREDITS} credits`);
  const cloud = new CliComfyClient({ baseUrl: env.COMFY_BASE_URL, apiKey: env.COMFY_API_KEY, scratchDir: join(runDir, "graphs") });
  const before = await cloud.credits();
  if (before !== null) console.log(`credits before: ${before}`);
  const r = await repairSegment({
    shot, shotPath, packet, guidePath: guide.path, prompt: a.prompt!, outDir: runDir, client: cloud, store, tools: realTools,
    take, strength: Number(a.strength), ...(a.segment !== undefined ? { segment: Number(a.segment) } : {}),
    ...(a.seed !== undefined ? { seed: Number(a.seed) } : {}), log: (m) => console.log(m),
  });
  const fmt = (s: { rotErrDeg: number | null; pass: boolean }) => `${s.rotErrDeg === null ? "-" : s.rotErrDeg.toFixed(2)}${s.pass ? "" : "*"}`;
  console.log(`\nsegment ${r.segment} regenerated from frame ${r.fromFrame}; improved: ${r.improved}`);
  console.log(`            whole   per-segment rot err (deg, * = failed gate)`);
  for (const [label, t] of [["before", r.before], ["after", r.after]] as const)
    console.log(`${label.padEnd(8)} ${(t.report.rotErrDeg?.toFixed(2) ?? "-").padStart(8)}   ${t.report.perSegment.map(fmt).join("  ")}   pass=${t.verdict.pass} badSegments=[${t.verdict.badSegments}]`);
  console.log(`patched clip: ${store.take(r.after.id)?.takeVideo}`);
  const after = await cloud.credits();
  if (before !== null && after !== null) console.log(`credits after: ${after} (change so far ${before - after}; billing can lag)`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
