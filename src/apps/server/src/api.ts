// Local HTTP API for the studio: POST a Shot, poll the run, fetch recovered poses. Binds to 127.0.0.1 only.
// Dry-run (mock client) is the default; live needs the key, the safety caps, the calibrated resolution and an
// echo of the credit estimate, and only one live run may be in flight.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ControlPacket, Shot } from "@comfy-osh/contracts";
import { CliComfyClient } from "./cli-client.ts";
import type { ComfyClient } from "./client.ts";
import { ensureGuide, type Guide } from "./guide.ts";
import { MockClient } from "./mock-client.ts";
import { runLoop, type TakeOutcome } from "./pipeline.ts";
import type { Ranked } from "./rank.ts";
import { estimateCredits, liveRefusal } from "./safety.ts";
import { JobStore } from "./store.ts";
import { copyDecimate, POSE_STRIDE, realTools, type Tools } from "./tools.ts";

export const CALIBRATED_RESOLUTION = { width: 768, height: 512 } as const;
const IC_LORA = "ltx-2.3-22b-ic-lora-union-control-ref0.5";
const DEFAULT_PROMPT = "A cinematic shot of a single subject in a room, soft natural light, smooth steady camera motion.";

export interface TakeView {
  id: string; seed: number; rank: number; pass: boolean; solveOk: boolean;
  composite: number | null; rotDeg: number | null; transPct: number | null; fovDeg: number | null;
  badSegments: number[]; move: string | null; note: string | null; hasPoses: boolean;
}
export interface RunView {
  id: string; state: "running" | "done" | "error"; live: boolean; n: number; shotId: string;
  estimate: number; log: string[]; error: string | null; takes: TakeView[];
}

export interface ApiOptions {
  runsDir: string;
  env: Record<string, string | undefined>;
  tools?: Tools;
  guide?: (shot: Shot, cacheDir: string) => Promise<Guide>;
  /** Test hook: replaces the Comfy Cloud client for live runs. */
  liveClient?: (shot: Shot, scratchDir: string) => ComfyClient;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function readBody(req: IncomingMessage, limit = 1_000_000): Promise<unknown> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) { fail(new HttpError(413, "body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { ok(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { fail(new HttpError(400, "body is not valid JSON")); }
    });
    req.on("error", fail);
  });
}

const num = (v: unknown, name: string, lo: number, hi: number, dflt: number): number => {
  if (v === undefined) return dflt;
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new HttpError(400, `${name} must be a number in [${lo}, ${hi}]`);
  return v;
};

export function createApi(o: ApiOptions): Server {
  const tools = o.tools ?? realTools;
  const guideFor = o.guide ?? ensureGuide;
  const runs = new Map<string, { view: RunView; dir: string }>();

  async function startRun(body: Record<string, unknown>): Promise<RunView> {
    const parsed = Shot.safeParse(body.shot);
    if (!parsed.success) throw new HttpError(400, `invalid shot: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
    const shot = parsed.data;
    const n = num(body.n, "n", 1, 5, 4);
    if (!Number.isInteger(n)) throw new HttpError(400, "n must be an integer");
    const live = body.live === true;
    const strength = num(body.strength, "strength", 0.1, 1, 1);
    const seedBase = num(body.seedBase, "seedBase", 0, 1_000_000, 1000);
    const prompt = typeof body.prompt === "string" && body.prompt.trim() ? body.prompt.slice(0, 500) : DEFAULT_PROMPT;
    const estimate = estimateCredits(n);

    if (live) {
      const refusal = liveRefusal(n, o.env.COMFY_API_KEY);
      if (refusal) throw new HttpError(400, refusal);
      if (shot.resolution.width !== CALIBRATED_RESOLUTION.width || shot.resolution.height !== CALIBRATED_RESOLUTION.height)
        throw new HttpError(400, `live runs are only validated at ${CALIBRATED_RESOLUTION.width}x${CALIBRATED_RESOLUTION.height}; this shot is ${shot.resolution.width}x${shot.resolution.height}. Use the 3:2 preset or run a dry run.`);
      if (body.confirmCredits !== estimate) throw new HttpError(400, `live run not confirmed: send confirmCredits=${estimate}`);
      if ([...runs.values()].some((r) => r.view.live && r.view.state === "running")) throw new HttpError(409, "a live run is already in progress");
    }

    const id = randomBytes(4).toString("hex");
    const dir = join(o.runsDir, live ? "live" : "dry", `studio-${id}`);
    mkdirSync(dir, { recursive: true });
    const shotPath = join(dir, "shot.json");
    writeFileSync(shotPath, JSON.stringify(shot, null, 2));
    const view: RunView = { id, state: "running", live, n, shotId: shot.id, estimate: live ? estimate : 0, log: [], error: null, takes: [] };
    runs.set(id, { view, dir });
    const log = (m: string) => { view.log.push(m); if (view.log.length > 200) view.log.shift(); };

    void (async () => {
      try {
        log("rendering depth guide");
        const guide = await guideFor(shot, join(o.runsDir, "guides"));
        const packet = ControlPacket.parse({
          shotId: shot.id, depthVideo: guide.path,
          depthNormalization: { mode: "fixed", near: guide.near, far: guide.far },
          iclora: { name: IC_LORA, strength },
        });
        let client: ComfyClient;
        let useTools = tools;
        if (live) {
          client = o.liveClient?.(shot, join(dir, "graphs")) ?? new CliComfyClient({ baseUrl: o.env.COMFY_BASE_URL, apiKey: o.env.COMFY_API_KEY, scratchDir: join(dir, "graphs") });
        } else {
          client = new MockClient({ shot, stride: POSE_STRIDE });
          useTools = { ...tools, decimate: copyDecimate };
          log("dry run: synthetic poses, not a measurement");
        }
        const ranked = await runLoop({
          shot, shotPath, packet, guidePath: guide.path, prompt, n, seedBase, outDir: dir, client,
          store: new JobStore(join(dir, "jobs.json")), tools: useTools, log,
        });
        view.takes = ranked.map((r) => takeView(r, dir));
        view.state = "done";
      } catch (e) {
        view.error = (e as Error).message;
        view.state = "error";
      }
    })();
    return view;
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(data));
    };
    const p = url.pathname;
    if (req.method === "GET" && p === "/api/health")
      return send(200, { ok: true, liveAvailable: Boolean(o.env.COMFY_API_KEY), calibratedResolution: CALIBRATED_RESOLUTION, maxLiveTakes: 5 });
    if (req.method === "GET" && p === "/api/estimate") {
      const n = Number(url.searchParams.get("n") ?? 4);
      return send(200, { n, credits: Number.isInteger(n) && n > 0 ? estimateCredits(n) : null });
    }
    if (req.method === "POST" && p === "/api/runs") {
      const body = await readBody(req);
      if (typeof body !== "object" || body === null) throw new HttpError(400, "body must be an object");
      return send(202, await startRun(body as Record<string, unknown>));
    }
    const m = /^\/api\/runs\/([0-9a-f]+)(?:\/takes\/(\d+)\/poses)?$/.exec(p);
    if (req.method === "GET" && m) {
      const run = runs.get(m[1]!);
      if (!run) throw new HttpError(404, "no such run");
      if (m[2] === undefined) return send(200, run.view);
      const file = join(run.dir, `s${Number(m[2])}`, "poses.json");
      if (!existsSync(file)) throw new HttpError(404, "no poses for that take");
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return void res.end(readFileSync(file));
    }
    throw new HttpError(404, "not found");
  }

  return createServer((req, res) => {
    route(req, res).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (!(e instanceof HttpError)) console.error(e);
      if (!res.headersSent) res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e instanceof HttpError ? e.message : "internal error" }));
    });
  });
}

function takeView(r: Ranked<TakeOutcome>, dir: string): TakeView {
  const t = r.item;
  const mv = t.move;
  return {
    id: t.id, seed: t.seed, rank: r.rank, pass: t.report.solveOk && t.verdict.pass, solveOk: t.report.solveOk,
    composite: t.report.composite, rotDeg: t.report.rotErrDeg, transPct: t.report.transErrPct, fovDeg: t.report.fovErrDeg,
    badSegments: t.verdict.badSegments,
    move: mv ? (mv.match ? `${mv.recovered} ok` : `${mv.authored}->${mv.recovered} MISMATCH`) : null,
    note: t.note ?? null,
    hasPoses: existsSync(join(dir, `s${t.seed}`, "poses.json")),
  };
}

export const defaultRunsDir = (here: string) => resolve(here, "..", ".runs", "studio");
