// Local HTTP API for the studio: POST a Shot, poll the run, fetch recovered poses. Binds to 127.0.0.1 only.
// Dry-run (mock client) is the default; live needs the key, the safety caps, the calibrated resolution and an
// echo of the credit estimate, and only one live run may be in flight.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ControlPacket, Shot } from "@comfy-osh/contracts";
import { AssetStore, MAX_UPLOAD_BYTES } from "./assets.ts";
import { CliComfyClient } from "./cli-client.ts";
import type { ComfyClient } from "./client.ts";
import { ensureGuide, type Guide } from "./guide.ts";
import { MockClient } from "./mock-client.ts";
import { repairSegment, runLoop, type TakeOutcome } from "./pipeline.ts";
import { rankTakes, type Ranked } from "./rank.ts";
import { estimateCredits, liveRefusal, REPAIR_CREDITS } from "./safety.ts";
import { JobStore } from "./store.ts";
import { copyDecimate, copyStitch, copyTrim, POSE_STRIDE, realTools, type Tools } from "./tools.ts";

export const CALIBRATED_RESOLUTION = { width: 768, height: 512 } as const;
const IC_LORA = "ltx-2.3-22b-ic-lora-union-control-ref0.5";
const DEFAULT_PROMPT = "A cinematic shot of a single subject in a room, soft natural light, smooth steady camera motion.";

export interface TakeView {
  id: string; seed: number; rank: number; pass: boolean; solveOk: boolean;
  composite: number | null; rotDeg: number | null; transPct: number | null; fovDeg: number | null;
  badSegments: number[]; move: string | null; note: string | null; hasPoses: boolean; hasVideo: boolean;
  /** Per-segment rotation error and gate result, in Shot order. */
  segments: { rotDeg: number | null; pass: boolean }[];
  /** Set once a drifted segment of this take was regenerated; the numbers above are then the patched clip's. */
  repair: RepairView | null;
}
export interface RepairView {
  segment: number; fromFrame: number; improved: boolean;
  before: { rotDeg: number | null; segments: { rotDeg: number | null; pass: boolean }[] };
}
export interface RunView {
  id: string; state: "running" | "done" | "error"; live: boolean; n: number; shotId: string;
  estimate: number; log: string[]; error: string | null; takes: TakeView[];
  /** A repair job is in flight for this take seed. */
  repairing: { seed: number; segment: number } | null;
}

export interface ApiOptions {
  runsDir: string;
  env: Record<string, string | undefined>;
  tools?: Tools;
  guide?: (shot: Shot, cacheDir: string, assets: AssetStore) => Promise<Guide>;
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

function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) { fail(new HttpError(413, `upload is larger than ${limit / 1024 / 1024} MB`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", fail);
  });
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
  const assets = new AssetStore(join(o.runsDir, "uploads"));
  interface RunCtx {
    view: RunView; dir: string; videos: Map<number, string>; poses: Map<number, string>; outcomes: Map<number, TakeOutcome>;
    repairs: Map<number, RepairView>;
    loop: { shot: Shot; shotPath: string; packet: ControlPacket; guidePath: string; prompt: string; store: JobStore; client: ComfyClient; tools: Tools } | null;
  }
  const runs = new Map<string, RunCtx>();
  const busyLive = () => [...runs.values()].some((r) => r.view.live && (r.view.state === "running" || r.view.repairing));

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
      if (busyLive()) throw new HttpError(409, "a live run is already in progress");
    }

    const id = randomBytes(4).toString("hex");
    const dir = join(o.runsDir, live ? "live" : "dry", `studio-${id}`);
    mkdirSync(dir, { recursive: true });
    const shotPath = join(dir, "shot.json");
    writeFileSync(shotPath, JSON.stringify(shot, null, 2));
    const view: RunView = { id, state: "running", live, n, shotId: shot.id, estimate: live ? estimate : 0, log: [], error: null, takes: [], repairing: null };
    const videos = new Map<number, string>();
    const ctx: RunCtx = { view, dir, videos, poses: new Map(), outcomes: new Map(), repairs: new Map(), loop: null };
    runs.set(id, ctx);
    const log = (m: string) => { view.log.push(m); if (view.log.length > 200) view.log.shift(); };

    void (async () => {
      try {
        log("rendering depth guide");
        const guide = await guideFor(shot, join(o.runsDir, "guides"), assets);
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
        const store = new JobStore(join(dir, "jobs.json"));
        const ranked = await runLoop({
          shot, shotPath, packet, guidePath: guide.path, prompt, n, seedBase, outDir: dir, client,
          store, tools: useTools, log,
        });
        for (const r of ranked) {
          const v = store.take(r.item.id)?.takeVideo;
          if (live && v && existsSync(v)) videos.set(r.item.seed, v); // the dry-run mock writes a placeholder file, not a video
        }
        ctx.loop = { shot, shotPath, packet, guidePath: guide.path, prompt, store, client, tools: useTools };
        for (const r of ranked) ctx.outcomes.set(r.item.seed, r.item);
        view.takes = ranked.map((r) => takeView(r, ctx));
        view.state = "done";
      } catch (e) {
        view.error = (e as Error).message;
        view.state = "error";
      }
    })();
    return view;
  }

  /** Regenerate one drifted segment of a finished take, re-score the patched clip, re-rank the sheet. */
  async function startRepair(run: RunCtx, seed: number, body: Record<string, unknown>): Promise<RunView> {
    const { view } = run;
    const loop = run.loop;
    const take = run.outcomes.get(seed);
    if (view.state !== "done" || !loop || !take) throw new HttpError(409, "the run must be finished and the take must exist");
    if (view.repairing) throw new HttpError(409, "a repair is already in progress");
    if (run.repairs.has(seed)) throw new HttpError(409, "this take was already repaired");
    if (!take.report.solveOk || take.verdict.badSegments.length === 0) throw new HttpError(400, "this take has no measured drifted segment to repair");
    const segment = body.segment === undefined ? take.verdict.badSegments[0]! : num(body.segment, "segment", 0, loop.shot.segments.length - 1, 0);
    if (!take.verdict.badSegments.includes(segment)) throw new HttpError(400, `segment ${segment + 1} did not drift`);
    const strength = num(body.strength, "strength", loop.packet.iclora.strength, 1, 1);
    if (view.live) {
      if (!o.env.COMFY_API_KEY) throw new HttpError(400, "live repair needs COMFY_API_KEY in src/.env");
      if (body.confirmCredits !== REPAIR_CREDITS) throw new HttpError(400, `live repair not confirmed: send confirmCredits=${REPAIR_CREDITS}`);
      if (busyLive()) throw new HttpError(409, "a live job is already in progress");
    }
    view.repairing = { seed, segment };
    const log = (m: string) => { view.log.push(m); if (view.log.length > 200) view.log.shift(); };
    void (async () => {
      try {
        // Dry repair: a fresh mock client (the run's job ids are gone), copy-based video tools, same real poses+verifier path.
        const client = view.live ? loop.client : new MockClient({ shot: loop.shot, stride: POSE_STRIDE });
        const useTools = view.live ? loop.tools : { ...loop.tools, trim: copyTrim, stitch: copyStitch };
        const r = await repairSegment({
          shot: loop.shot, shotPath: loop.shotPath, packet: loop.packet, guidePath: loop.guidePath, prompt: loop.prompt,
          outDir: run.dir, client, store: loop.store, tools: useTools, take, segment, strength, log,
        });
        const name = `s${take.seed}-r${segment}`;
        const patched = loop.store.take(r.after.id)?.takeVideo;
        if (view.live && patched && existsSync(patched)) run.videos.set(seed, patched);
        run.poses.set(seed, join(run.dir, name, "poses.json"));
        run.outcomes.set(seed, { ...r.after, seed });
        run.repairs.set(seed, {
          segment, fromFrame: r.fromFrame, improved: r.improved,
          before: { rotDeg: take.report.rotErrDeg, segments: take.report.perSegment.map((s) => ({ rotDeg: s.rotErrDeg, pass: s.pass })) },
        });
        view.takes = rankTakes([...run.outcomes.values()]).map((x) => takeView(x, run));
      } catch (e) {
        view.error = (e as Error).message;
      } finally {
        view.repairing = null;
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
      return send(200, { ok: true, liveAvailable: Boolean(o.env.COMFY_API_KEY), calibratedResolution: CALIBRATED_RESOLUTION, maxLiveTakes: 5, repairCredits: REPAIR_CREDITS });
    if (req.method === "GET" && p === "/api/estimate") {
      const n = Number(url.searchParams.get("n") ?? 4);
      return send(200, { n, credits: Number.isInteger(n) && n > 0 ? estimateCredits(n) : null });
    }
    if (req.method === "POST" && p === "/api/runs") {
      const body = await readBody(req);
      if (typeof body !== "object" || body === null) throw new HttpError(400, "body must be an object");
      return send(202, await startRun(body as Record<string, unknown>));
    }
    if (req.method === "GET" && p === "/api/scenes") return send(200, assets.list());
    if (req.method === "POST" && p === "/api/assets") {
      const bytes = await readRaw(req, MAX_UPLOAD_BYTES);
      try {
        return send(200, assets.save(new Uint8Array(bytes)));
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }
    const am = /^\/api\/assets\/((?:scenes|uploads)\/[^/]+)$/.exec(p);
    if (req.method === "GET" && am) {
      const file = assets.fileFor(decodeURIComponent(am[1]!));
      if (!file) throw new HttpError(404, "no such asset");
      res.writeHead(200, { "content-type": file.endsWith(".glb") ? "model/gltf-binary" : "model/gltf+json", "cache-control": "no-cache" });
      return void res.end(readFileSync(file));
    }
    const rm = /^\/api\/runs\/([0-9a-f]+)\/takes\/(\d+)\/repair$/.exec(p);
    if (req.method === "POST" && rm) {
      const run = runs.get(rm[1]!);
      if (!run) throw new HttpError(404, "no such run");
      const body = await readBody(req);
      if (typeof body !== "object" || body === null) throw new HttpError(400, "body must be an object");
      return send(202, await startRepair(run, Number(rm[2]), body as Record<string, unknown>));
    }
    const m = /^\/api\/runs\/([0-9a-f]+)(?:\/takes\/(\d+)\/(poses|video))?$/.exec(p);
    if (req.method === "GET" && m) {
      const run = runs.get(m[1]!);
      if (!run) throw new HttpError(404, "no such run");
      if (m[2] === undefined) return send(200, run.view);
      if (m[3] === "video") {
        const file = run.videos.get(Number(m[2]));
        if (!file) throw new HttpError(404, "no video for that take");
        return serveVideo(req, res, file);
      }
      const file = run.poses.get(Number(m[2])) ?? join(run.dir, `s${Number(m[2])}`, "poses.json");
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

/** mp4 with Range support so <video> can seek and loop. */
function serveVideo(req: IncomingMessage, res: ServerResponse, file: string): void {
  const size = statSync(file).size;
  const type = /\.webm$/i.test(file) ? "video/webm" : "video/mp4";
  const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (!r || (r[1] === "" && r[2] === "")) {
    res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
    return void createReadStream(file).pipe(res);
  }
  const start = r[1] === "" ? Math.max(0, size - Number(r[2])) : Number(r[1]);
  const end = r[1] === "" || r[2] === "" ? size - 1 : Math.min(Number(r[2]), size - 1);
  if (start > end || start >= size) {
    res.writeHead(416, { "content-range": `bytes */${size}` });
    return void res.end();
  }
  res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes" });
  createReadStream(file, { start, end }).pipe(res);
}

function takeView(r: Ranked<TakeOutcome>, run: { dir: string; videos: Map<number, string>; poses: Map<number, string>; repairs: Map<number, RepairView> }): TakeView {
  const { dir, videos } = run;
  const t = r.item;
  const mv = t.move;
  return {
    id: t.id, seed: t.seed, rank: r.rank, pass: t.report.solveOk && t.verdict.pass, solveOk: t.report.solveOk,
    composite: t.report.composite, rotDeg: t.report.rotErrDeg, transPct: t.report.transErrPct, fovDeg: t.report.fovErrDeg,
    badSegments: t.verdict.badSegments,
    move: mv ? (mv.match ? `${mv.recovered} ok` : `${mv.authored}->${mv.recovered} MISMATCH`) : null,
    note: t.note ?? null,
    hasPoses: existsSync(run.poses.get(t.seed) ?? join(dir, `s${t.seed}`, "poses.json")),
    hasVideo: videos.has(t.seed),
    segments: t.report.perSegment.map((s) => ({ rotDeg: s.rotErrDeg, pass: s.pass })),
    repair: run.repairs.get(t.seed) ?? null,
  };
}

export const defaultRunsDir = (here: string) => resolve(here, "..", ".runs", "studio");
