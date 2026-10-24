// Depth guide for a Shot: reuse a golden clip that names it, else render one with rig-core (cached by content hash).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Shot } from "@comfy-osh/contracts";
import { DEFAULT_DEPTH_NORM, renderClip, sampleShot } from "@comfy-osh/rig-core";
import { SRC_DIR } from "./tools.ts";

export interface Guide { path: string; near: number; far: number }
interface ClipMeta { shotId: string; files: { depth: string }; depth: { near: number; far: number } }

/** An existing golden depth clip whose meta names this shot id (and only that id; the clip is not re-checked against the path). */
export function findGoldenGuide(shotId: string): Guide | null {
  const dir = resolve(SRC_DIR, "tests/golden/clips");
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".meta.json")).sort()) {
    const m = JSON.parse(readFileSync(join(dir, f), "utf8")) as ClipMeta;
    if (m.shotId === shotId) return { path: join(dir, m.files.depth), near: m.depth.near, far: m.depth.far };
  }
  return null;
}

const shotHash = (shot: Shot) => createHash("sha1").update(JSON.stringify(shot)).digest("hex").slice(0, 16);

/** Render the fixed-normalization depth video for any Shot (needs ffmpeg). Cached under cacheDir by content hash. */
export async function renderGuide(shot: Shot, cacheDir: string): Promise<Guide> {
  mkdirSync(cacheDir, { recursive: true });
  const out = join(cacheDir, `${shotHash(shot)}.depth.mp4`);
  const guide = { path: out, near: DEFAULT_DEPTH_NORM.near, far: DEFAULT_DEPTH_NORM.far };
  if (existsSync(out)) return guide;
  const { width: w, height: h } = shot.resolution;
  const tmp = `${out}.part.mp4`;
  const ff = spawn(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${w}x${h}`, "-r", "25", "-i", "-",
     "-vf", "scale=in_range=pc:out_range=pc,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "14",
     "-pix_fmt", "yuv420p", "-color_range", "pc", "-movflags", "+faststart", tmp],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const closed = new Promise<void>((res, rej) => {
    ff.on("error", (e) => rej(new Error(`ffmpeg not runnable: ${e.message}`)));
    ff.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`))));
  });
  closed.catch(() => {}); // surfaced below; avoids an unhandled rejection if ffmpeg dies mid-write
  ff.stdin.on("error", () => {});
  for (const f of renderClip(shot, sampleShot(shot), DEFAULT_DEPTH_NORM)) {
    if (!ff.stdin.write(f.depth8)) await new Promise<void>((r) => ff.stdin.once("drain", () => r()));
  }
  ff.stdin.end();
  await closed;
  renameSync(tmp, out);
  return guide;
}

/** Golden clip first (CLI behaviour), else render. */
export async function ensureGuide(shot: Shot, cacheDir: string): Promise<Guide> {
  return findGoldenGuide(shot.id) ?? (await renderGuide(shot, cacheDir));
}
