// Client for the local server API (apps/server/src/api.ts). Types mirror RunView/TakeView there; keep them in step.
import type { Shot } from "@comfy-osh/contracts";
import type { SceneListing, UploadInfo } from "./scenes.ts";

export interface TakeView {
  id: string; seed: number; rank: number; pass: boolean; solveOk: boolean;
  composite: number | null; rotDeg: number | null; transPct: number | null; fovDeg: number | null;
  badSegments: number[]; move: string | null; note: string | null; hasPoses: boolean; hasVideo: boolean;
  segments: { rotDeg: number | null; pass: boolean }[];
  repair: RepairView | null;
}
export interface RepairView {
  segment: number; fromFrame: number; improved: boolean;
  before: { rotDeg: number | null; segments: { rotDeg: number | null; pass: boolean }[] };
}
export interface RunView {
  id: string; state: "running" | "done" | "error"; live: boolean; n: number; shotId: string;
  estimate: number; log: string[]; error: string | null; takes: TakeView[];
  repairing: { seed: number; segment: number } | null;
}
export interface Health { ok: boolean; liveAvailable: boolean; calibratedResolution: { width: number; height: number }; maxLiveTakes: number; repairCredits: number }
export interface RunRequest { shot: Shot; n: number; live: boolean; strength: number; confirmCredits?: number }

type Fetch = typeof fetch;

async function json<T>(r: Response): Promise<T> {
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(body.error ?? `server returned ${r.status}`);
  return body as T;
}

export const getHealth = (f: Fetch = fetch) => f("/api/health").then((r) => json<Health>(r));

export const startRun = (req: RunRequest, f: Fetch = fetch) =>
  f("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }).then((r) => json<RunView>(r));

export const repairTake = (runId: string, seed: number, req: { segment?: number; strength?: number; confirmCredits?: number }, f: Fetch = fetch) =>
  f(`/api/runs/${runId}/takes/${seed}/repair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) }).then((r) => json<RunView>(r));

export const getRun = (id: string, f: Fetch = fetch) => f(`/api/runs/${id}`).then((r) => json<RunView>(r));

export const videoUrl = (runId: string, seed: number) => `/api/runs/${runId}/takes/${seed}/video`;

export const getScenes = (f: Fetch = fetch) => f("/api/scenes").then((r) => json<SceneListing[]>(r));

/** Upload a glTF/GLB; the server validates it and answers with the asset name and its bounds. */
export const uploadModel = (bytes: ArrayBuffer, f: Fetch = fetch) =>
  f("/api/assets", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes }).then((r) => json<UploadInfo>(r));

export const getPosesText = async (id: string, seed: number, f: Fetch = fetch) => {
  const r = await f(`/api/runs/${id}/takes/${seed}/poses`);
  if (!r.ok) throw new Error(`no poses for seed ${seed}`);
  return r.text();
};

/** Why a run cannot start from here, or null. Mirrors the server's checks so the button can explain itself. */
export function runBlocker(o: { valid: boolean; live: boolean; health: Health | null; resolution: { width: number; height: number }; confirmed: boolean }): string | null {
  if (!o.health) return "server not reachable: run `pnpm serve` in src/";
  if (!o.valid) return "fix the Shot errors first";
  if (!o.live) return null;
  if (!o.health.liveAvailable) return "live needs COMFY_API_KEY in src/.env";
  const c = o.health.calibratedResolution;
  if (o.resolution.width !== c.width || o.resolution.height !== c.height) return `live runs are only validated at ${c.width}x${c.height} (use the 3:2 aspect)`;
  if (!o.confirmed) return "tick the credit confirmation";
  return null;
}
