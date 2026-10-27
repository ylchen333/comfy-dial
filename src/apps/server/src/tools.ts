// Local tools the loop shells out to: ffmpeg (decimate take for DA3), python poses conversion, verifier.
import { execFile } from "node:child_process";
import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ScoreReport } from "@comfy-osh/contracts";

const exec = promisify(execFile);

/** src/ (pnpm workspace root, python project root). */
export const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const POSE_STRIDE = 4; // matches the calibration set (31 frames of 121)

export interface Tools {
  /** Keep every `stride`-th frame (DA3 multiview is run on a decimated clip, as in calibration). */
  decimate(src: string, dst: string, stride: number): Promise<void>;
  /** Copy `count` frames starting at frame `start` into a new clip at `fps` (no audio). */
  trim(src: string, dst: string, start: number, count: number, fps: number): Promise<void>;
  /** First `headFrames` frames of `head`, then all of `tail`, re-encoded as one clip. */
  stitch(head: string, headFrames: number, tail: string, dst: string, fps: number): Promise<void>;
  /** DA3 extrinsics/intrinsics text -> comfy-osh/poses/1 JSON (comfy_nodes/poses.py). */
  buildPoses(extrinsics: string, intrinsics: string, out: string, fps: number, stride: number): Promise<void>;
  /** python -m verifier score. */
  score(shotPath: string, posesPath: string, candidateId: string): Promise<ScoreReport>;
}

export const realTools: Tools = {
  async decimate(src, dst, stride) {
    await exec("ffmpeg", [
      "-y", "-loglevel", "error", "-i", src,
      "-vf", `select='not(mod(n\\,${stride}))',setpts=N/(25/${stride})/TB`,
      "-an", "-r", String(25 / stride), "-c:v", "libx264", "-pix_fmt", "yuv420p", dst,
    ]);
  },
  async trim(src, dst, start, count, fps) {
    await exec("ffmpeg", [
      "-y", "-loglevel", "error", "-i", src,
      "-vf", `select='between(n\\,${start}\\,${start + count - 1})',setpts=N/${fps}/TB`,
      "-an", "-r", String(fps), "-frames:v", String(count), "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", dst,
    ]);
  },
  async stitch(head, headFrames, tail, dst, fps) {
    await exec("ffmpeg", [
      "-y", "-loglevel", "error", "-i", head, "-i", tail,
      "-filter_complex",
      `[0:v]select='lt(n\\,${headFrames})',setpts=N/${fps}/TB[a];[1:v]setpts=N/${fps}/TB[b];[a][b]concat=n=2:v=1:a=0[v]`,
      "-map", "[v]", "-r", String(fps), "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", dst,
    ]);
  },
  async buildPoses(extrinsics, intrinsics, out, fps, stride) {
    await exec("uv", ["run", "python", "comfy_nodes/poses.py", extrinsics, intrinsics, out, String(fps), String(stride)], {
      cwd: SRC_DIR,
    });
  },
  async score(shotPath, posesPath, candidateId) {
    // FOV is reported but not gated by default (calibration freeze).
    const { stdout } = await exec(
      "uv",
      ["run", "python", "-m", "verifier", "score", "--shot", shotPath, "--poses", posesPath, "--candidate-id", candidateId],
      { cwd: SRC_DIR, maxBuffer: 16 * 1024 * 1024 },
    );
    return ScoreReport.parse(JSON.parse(stdout));
  },
};

/** Test/dry-run variant that needs no ffmpeg: the mock "video" is a stand-in file. */
export const copyDecimate: Tools["decimate"] = async (src, dst) => {
  copyFileSync(src, dst);
};
export const copyTrim: Tools["trim"] = async (src, dst) => {
  copyFileSync(src, dst);
};
export const copyStitch: Tools["stitch"] = async (_head, _n, tail, dst) => {
  copyFileSync(tail, dst);
};
