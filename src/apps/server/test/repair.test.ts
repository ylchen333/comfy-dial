import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSegmentGraph, segmentWindow } from "../src/graph.ts";
import { MockClient } from "../src/mock-client.ts";
import { repairSegment, runLoop, type LoopOptions } from "../src/pipeline.ts";
import { JobStore } from "../src/store.ts";
import { fakeTools, guideFile, loadShot, packetFor, shotPath, tmp } from "./helpers.ts";

const shot = loadShot();

describe("segmentWindow", () => {
  it("starts the clip 8 frames before the segment's latent anchor and runs to the end, always 1+8k", () => {
    for (let k = 1; k < shot.segments.length; k++) {
      const w = segmentWindow(shot, k);
      expect(w.hasContext).toBe(true);
      expect(w.ctxStart % 8).toBe(0);
      expect(w.ctxStart).toBeLessThanOrEqual(shot.segments[k]!.start);
      expect((w.length - 1) % 8).toBe(0);
      expect(w.ctxStart + w.length).toBe(shot.frames);
    }
  });
  it("segment 0 has no context and redoes the whole take", () => {
    expect(segmentWindow(shot, 0)).toEqual({ ctxStart: 0, length: shot.frames, hasContext: false });
  });
});

describe("buildSegmentGraph", () => {
  const w = segmentWindow(shot, 2);
  const g = buildSegmentGraph({ shot, packet: packetFor(shot, 1), guideFile: "g.mp4", contextFile: "c.mp4", prompt: "p", seed: 7, window: w });
  it("pins the context frames and routes the new conditioning to the guider, the audio concat and the guide crop", () => {
    expect(g["30"]!.inputs.file).toBe("c.mp4");
    expect(g["32"]!.class_type).toBe("LTXVAddGuide");
    expect(g["14"]!.inputs.video_latent).toEqual(["32", 2]);
    expect(g["15"]!.inputs.positive).toEqual(["32", 0]);
    expect(g["21"]!.inputs.negative).toEqual(["32", 1]);
    expect(g["11"]!.inputs.length).toBe(w.length);
    expect(g["13"]!.inputs.frames_number).toBe(w.length);
    expect(g["12"]!.inputs.strength).toBe(1);
  });
  it("refuses segment 0", () => {
    expect(() => buildSegmentGraph({ shot, packet: packetFor(shot), guideFile: "g", contextFile: "c", prompt: "p", seed: 1, window: segmentWindow(shot, 0) })).toThrow(/segment 0/);
  });
});

describe("repairSegment", () => {
  async function drifted() {
    const dir = tmp();
    const client = new MockClient({ shot, stride: 4 });
    const o: LoopOptions = { shot, shotPath: shotPath(), packet: packetFor(shot, 0.8), guidePath: guideFile(), prompt: "p", n: 4, seedBase: 1000, outDir: dir, store: new JobStore(join(dir, "jobs.json")), tools: fakeTools(shot), client };
    const ranked = await runLoop(o);
    const bad = ranked.map((r) => r.item).find((t) => t.verdict.badSegments.length > 0 && t.report.solveOk)!;
    return { o, client, bad };
  }

  it("regenerates only the drifted segment at the requested strength, then re-scores the whole patched clip", async () => {
    const { o, client, bad } = await drifted();
    const before = client.jobs.length;
    const r = await repairSegment({ ...o, take: bad, strength: 1 });
    expect(r.segment).toBe(bad.verdict.badSegments[0]);
    expect(r.improved).toBe(true);
    expect(r.after.report.pass).toBe(true);
    const repair = client.jobs.slice(before).filter((j) => j.kind === "take");
    expect(repair).toHaveLength(1);
    expect(repair[0]!.seed).toBe(bad.seed + 1);
    expect(repair[0]!.graph["12"]!.inputs.strength).toBe(1);
    expect(client.jobs.slice(before).filter((j) => j.kind === "da3")).toHaveLength(1); // the patched clip is re-solved
  });

  it("refuses a segment that did not drift, and a strength below the take's", async () => {
    const { o, bad } = await drifted();
    const onlyLast = { ...bad, verdict: { pass: false, badSegments: [2] } };
    await expect(repairSegment({ ...o, take: onlyLast, segment: 1, strength: 1 })).rejects.toThrow(/did not drift|no drifted/);
    await expect(repairSegment({ ...o, take: bad, strength: 0.7 })).rejects.toThrow(/at least/);
  });

  it("refuses a segment that follows an earlier drifted segment", async () => {
    const { o, bad } = await drifted();
    const early = { ...bad, verdict: { pass: false, badSegments: [0, 2] } };
    await expect(repairSegment({ ...o, take: early, segment: 2, strength: 1 })).rejects.toThrow(/repair segment 1 first/);
  });

  it("rerun with the same inputs submits nothing new", async () => {
    const { o, client, bad } = await drifted();
    await repairSegment({ ...o, take: bad, strength: 1 });
    const n = client.submitAttempts.length;
    await repairSegment({ ...o, take: bad, strength: 1, store: new JobStore(o.store.path) });
    expect(client.submitAttempts.length).toBe(n);
  });
});

describe("improved", () => {
  it("is judged on the repaired segment passing the gate, not on the composite", async () => {
    const dir = tmp();
    const client = new MockClient({ shot, stride: 4 });
    const o: LoopOptions = { shot, shotPath: shotPath(), packet: packetFor(shot, 0.8), guidePath: guideFile(), prompt: "p", n: 4, seedBase: 1000, outDir: dir, store: new JobStore(join(dir, "jobs.json")), tools: fakeTools(shot), client };
    const bad = (await runLoop(o)).map((r) => r.item).find((t) => t.report.solveOk && t.verdict.badSegments.length > 0)!;
    // fake verifier's repaired score has a HIGHER composite than a worse-but-passing original would; segment gate still decides
    const r = await repairSegment({ ...o, take: { ...bad, report: { ...bad.report, composite: 0.01 } }, strength: 1 });
    expect(r.after.report.composite).toBeGreaterThan(0.01);
    expect(r.improved).toBe(true);
  });
});
