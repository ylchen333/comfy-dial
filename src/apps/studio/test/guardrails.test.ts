import { describe, expect, it } from "vitest";
import { sampleShot } from "@comfy-osh/rig-core";
import { exportShot } from "../src/logic/compile.ts";
import { newDoc } from "../src/logic/keys.ts";
import { applyPreset } from "../src/logic/presets.ts";
import { frameRanges, frameReadout, shotChecks, subjectNdc } from "../src/logic/guardrails.ts";

const posesFor = (id: Parameters<typeof applyPreset>[1]) => sampleShot(exportShot(applyPreset(newDoc(), id)));
const subject = [0, 0.9, 0] as [number, number, number];
const ids = (id: Parameters<typeof applyPreset>[1], depth = [] as Parameters<typeof shotChecks>[1]["depth"]) =>
  shotChecks(posesFor(id), { subject, aspect: 1.5, depth }).map((c) => c.id);

describe("guardrails", () => {
  it("a clean push-in raises nothing; a dolly zoom is flagged for the focal change the verifier can't gate", () => {
    expect(ids("push-in")).toEqual([]);
    expect(ids("dolly-zoom")).toContain("focal-change");
    expect(ids("zoom-only")).toContain("focal-change");
  });
  it("a pan is rotation-only (info), not 'no motion'", () => {
    const c = shotChecks(posesFor("pan"), { subject, aspect: 1.5, depth: [] });
    expect(c.find((x) => x.id === "rotation-only")?.level).toBe("info");
    expect(c.some((x) => x.id === "no-motion")).toBe(false);
  });
  it("a locked-off camera is flagged as nothing to measure", () => {
    const p = posesFor("push-in").map((x) => ({ ...x, position: posesFor("push-in")[0]!.position, quaternion: posesFor("push-in")[0]!.quaternion }));
    expect(shotChecks(p, { subject, aspect: 1.5, depth: [] }).map((c) => c.id)).toContain("no-motion");
  });
  it("flags the subject leaving the frame, in frame ranges", () => {
    const poses = posesFor("push-in");
    const aimedAway = poses.map((p, i) => (i < 60 ? p : { ...p, quaternion: [0, 1, 0, 0] as typeof p.quaternion })); // turned 180 deg
    const c = shotChecks(aimedAway, { subject, aspect: 1.5, depth: [] }).find((x) => x.id === "subject-out")!;
    expect(c.text).toContain("60-120");
  });
  it("reports near-plane saturation and blank guide frames from the depth samples", () => {
    const depth = [
      { frame: 0, stats: { nearFrac: 0, emptyFrac: 0.4, minZ: 6 } },
      { frame: 96, stats: { nearFrac: 0.25, emptyFrac: 0, minZ: 0.6 } },
      { frame: 104, stats: { nearFrac: 0.4, emptyFrac: 0, minZ: 0.5 } },
      { frame: 112, stats: { nearFrac: 0, emptyFrac: 1, minZ: Infinity } },
    ];
    const c = shotChecks(posesFor("push-in"), { subject, aspect: 1.5, depth });
    expect(c.find((x) => x.id === "near-plane")!.text).toMatch(/96-104.*40%/);
    expect(c.find((x) => x.id === "empty-frame")!.text).toContain("112");
  });
  it("readout gives focal length, subject distance and speed that match the sampled path", () => {
    const poses = posesFor("push-in");
    const r = frameReadout(poses, 60, { subject, sensorHeightMm: 24 });
    expect(r.focalMm).toBeCloseTo(35, 0);
    expect(r.subjectDist!).toBeCloseTo(Math.hypot(...poses[60]!.position.map((v, i) => v - subject[i]!) as [number, number, number]), 6);
    expect(r.speed).toBeGreaterThan(0);
    expect(frameReadout(poses, 0, { subject: null, sensorHeightMm: 24 }).subjectDist).toBeNull();
  });
  it("collapses frame lists into ranges and puts a centred subject at the middle of the frame", () => {
    expect(frameRanges([0, 8, 16, 40, 48, 100], 8)).toBe("0-16, 40-48, 100");
    const n = subjectNdc(posesFor("push-in")[0]!, subject, 1.5)!;
    expect(Math.abs(n.x)).toBeLessThan(0.2);
  });
});
