import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ControlPacket, ScoreReport, Shot } from "@comfy-osh/contracts";
import { copyDecimate, copySample, copyStitch, copyTrim, SRC_DIR, type Tools } from "../src/tools.ts";

export const FIXTURES = resolve(SRC_DIR, "packages/contracts/fixtures");
export const loadShot = (name = "push_in") => Shot.parse(JSON.parse(readFileSync(join(FIXTURES, "shots", `${name}.json`), "utf8")));
export const shotPath = (name = "push_in") => join(FIXTURES, "shots", `${name}.json`);
export const tmp = () => mkdtempSync(join(tmpdir(), "comfy-osh-server-"));

export const packetFor = (shot: Shot, strength = 1) =>
  ControlPacket.parse({
    shotId: shot.id,
    depthVideo: "guide.mp4",
    depthNormalization: { mode: "fixed", near: 1, far: 100 },
    iclora: { name: "ltx-2.3-22b-ic-lora-union-control-ref0.5", strength },
  });

export const guideFile = () => {
  const p = join(tmp(), "guide.depth.mp4");
  writeFileSync(p, "fake guide");
  return p;
};

/** Verifier stand-in: seed 3 mod 4 (no solve) fails, seed%4==2 drifts, others follow. Python is not spawned. */
export const fakeTools = (shot: Shot): Tools => ({
  decimate: copyDecimate,
  trim: copyTrim,
  sample: copySample,
  stitch: copyStitch,
  async buildPoses(ext, _i, out, fps) {
    const empty = readFileSync(ext, "utf8").includes('"extrinsics":[]');
    writeFileSync(out, JSON.stringify({ schema: "comfy-osh/poses/1", fps, image: { width: 768, height: 512 }, solve_ok: !empty, frames: empty ? [] : [{ index: 0, t: 0, position: [0, 0, 0], quaternion: [0, 0, 0, 1], fov_v_deg: 40 }] }));
  },
  async score(_s, posesPath, id) {
    const solveOk = (JSON.parse(readFileSync(posesPath, "utf8")) as { solve_ok: boolean }).solve_ok;
    const seed = Number(/-s(\d+)(?:-r\d+)?$/.exec(id)?.[1]);
    // A repaired take (-rK) is scored as clean: the stand-in verifier only needs "after" to differ from "before".
    if (/-r\d+$/.test(id)) return ScoreReport.parse({ candidateId: id, solveOk, mode: "full", rotErrDeg: 0.6, transErrPct: 3, fovErrDeg: 2, perSegment: shot.segments.map((s) => ({ ...s, rotErrDeg: 0.6, transErrPct: 3, fovErrDeg: 2, pass: solveOk })), composite: 0.2, pass: solveOk });
    const rot = seed % 4 === 2 ? 6 : 0.5 + (seed % 4) * 0.1;
    const seg = shot.segments.map((s, i) => ({ ...s, rotErrDeg: solveOk ? (seed % 4 === 2 && i === 2 ? 9 : rot) : null, transErrPct: solveOk ? 3 : null, fovErrDeg: solveOk ? 2 : null, pass: solveOk }));
    return ScoreReport.parse({
      candidateId: id, solveOk, mode: "full",
      rotErrDeg: solveOk ? rot : null, transErrPct: solveOk ? 3 : null, fovErrDeg: solveOk ? 2 : null,
      perSegment: seg, composite: solveOk ? rot / 3 : null, pass: solveOk && rot < 3,
    });
  },
});
