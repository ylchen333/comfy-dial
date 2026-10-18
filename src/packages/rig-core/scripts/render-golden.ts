// Render the golden clips: node --experimental-strip-types scripts/render-golden.ts [outDir]
// Needs ffmpeg on PATH. Output per clip: <name>.rgb.mp4, <name>.depth.mp4, <name>.meta.json
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Shot } from "@comfy-osh/contracts";
import { FIXTURE_CLIPS, buildMeta, ltxClips, renderClip, sampleShot, DEFAULT_DEPTH_NORM } from "../src/index.ts";

// ffmpeg from PATH only.
const FFMPEG = "ffmpeg";
const probe = spawnSync(FFMPEG, ["-version"], { encoding: "utf8" });
if (probe.error || probe.status !== 0) {
  console.error("ffmpeg not found on PATH. Install it (macOS: brew install ffmpeg; Debian/Ubuntu: sudo apt install ffmpeg) and re-run.");
  process.exit(1);
}
console.log(`ffmpeg: ${probe.stdout.split("\n")[0]}`);

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? resolve(here, "../../../tests/golden/clips"));
mkdirSync(outDir, { recursive: true });

const clips: Record<string, Shot> = {};
for (const name of FIXTURE_CLIPS) {
  const p = fileURLToPath(import.meta.resolve(`@comfy-osh/contracts/fixtures/shots/${name}.json`));
  clips[name] = Shot.parse(JSON.parse(readFileSync(p, "utf8")));
}
Object.assign(clips, ltxClips());

function encoder(out: string, w: number, h: number, pix: "rgb24" | "gray", filter: string) {
  const p = spawn(
    FFMPEG,
    ["-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", pix, "-s", `${w}x${h}`, "-r", "25", "-i", "-",
     "-vf", filter, "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-color_range", "pc", "-movflags", "+faststart", out],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  const done = new Promise<void>((res, rej) => p.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
  return { stdin: p.stdin, done };
}
const write = (s: NodeJS.WritableStream, b: Uint8Array) =>
  new Promise<void>((res) => (s.write(b) ? res() : s.once("drain", () => res())));

for (const [name, shot] of Object.entries(clips)) {
  const t0 = Date.now();
  const { width: w, height: h } = shot.resolution;
  const rgb = encoder(resolve(outDir, `${name}.rgb.mp4`), w, h, "rgb24", "scale=in_range=pc:out_range=pc:flags=accurate_rnd,format=yuv420p");
  const dep = encoder(resolve(outDir, `${name}.depth.mp4`), w, h, "gray", "scale=in_range=pc:out_range=pc,format=yuv420p");
  for (const f of renderClip(shot, sampleShot(shot), DEFAULT_DEPTH_NORM)) {
    await write(rgb.stdin, f.rgb);
    await write(dep.stdin, f.depth8);
  }
  rgb.stdin.end(); dep.stdin.end();
  await Promise.all([rgb.done, dep.done]);
  writeFileSync(resolve(outDir, `${name}.meta.json`), JSON.stringify(buildMeta(name, shot)) + "\n");
  console.log(`${name}: ${shot.frames} frames, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
