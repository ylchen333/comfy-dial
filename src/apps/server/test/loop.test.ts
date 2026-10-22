import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MockClient } from "../src/mock-client.ts";
import { runLoop, type LoopOptions } from "../src/pipeline.ts";
import { formatTable } from "../src/rank.ts";
import { JobStore } from "../src/store.ts";
import { realTools } from "../src/tools.ts";
import { fakeTools, guideFile, loadShot, packetFor, shotPath, tmp } from "./helpers.ts";

const shot = loadShot();

function opts(over: Partial<LoopOptions> & { client: MockClient }, dir = tmp()): LoopOptions {
  return {
    shot, shotPath: shotPath(), packet: packetFor(shot), guidePath: guideFile(), prompt: "p", n: 4, seedBase: 1000,
    outDir: dir, store: new JobStore(join(dir, "jobs.json")), tools: fakeTools(shot), ...over,
  };
}

describe("fan-out", () => {
  it("submits N takes with distinct seeds, all before any DA3 job", async () => {
    const client = new MockClient({ shot, stride: 4 });
    const o = opts({ client });
    await runLoop(o);
    const takes = client.jobs.filter((j) => j.kind === "take");
    expect(takes).toHaveLength(4);
    expect(new Set(takes.map((j) => j.seed)).size).toBe(4);
    expect(new Set(takes.map((j) => j.key)).size).toBe(4);
    expect(client.jobs.slice(0, 4).every((j) => j.kind === "take")).toBe(true);
    expect(client.jobs.filter((j) => j.kind === "da3")).toHaveLength(4);
    expect(client.uploads.filter((u) => u.endsWith("guide.depth.mp4"))).toHaveLength(1);
  });

  it("every key is in the job store with its jobId", async () => {
    const client = new MockClient({ shot, stride: 4 });
    const o = opts({ client });
    await runLoop(o);
    for (const j of client.jobs) expect(o.store.job(j.key)?.jobId).toBe(j.id);
  });

  it("rerun on the same store resumes: zero new submits", async () => {
    const client = new MockClient({ shot, stride: 4 });
    const o = opts({ client });
    await runLoop(o);
    const submits = client.submitAttempts.length;
    const again = await runLoop({ ...o, store: new JobStore(o.store.path) });
    expect(client.submitAttempts.length).toBe(submits);
    expect(again).toHaveLength(4);
  });

  it("retries a transient VAELoader/MTPHead failure under a new key, once", async () => {
    const client = new MockClient({ shot, stride: 4, transientTakeFailures: 1 });
    const o = opts({ client, n: 2 });
    const r = await runLoop(o);
    expect(r.every((x) => !x.item.note?.includes("failed"))).toBe(true);
    expect(client.jobs.filter((j) => j.kind === "take")).toHaveLength(3);
    expect(client.jobs.some((j) => j.key.endsWith(":r1"))).toBe(true);
  });

  it("a permanently failed take is reported as a failed solve, ranked last, never dropped", async () => {
    const client = new MockClient({ shot, stride: 4, failSeeds: new Set([1001]) });
    const r = await runLoop(opts({ client }));
    expect(r).toHaveLength(4);
    const failed = r.find((x) => x.item.seed === 1001)!;
    expect(failed.rank).toBeGreaterThanOrEqual(3); // behind both takes that solved
    expect(failed.item.report.solveOk).toBe(false);
    expect(failed.item.verdict.pass).toBe(false);
    expect(failed.item.note).toMatch(/take failed/);
    expect(r.slice(2).every((x) => !x.item.report.solveOk)).toBe(true);
  });
});

describe("ranking", () => {
  it("passing first by composite, drifted next, failed solve last", async () => {
    const client = new MockClient({ shot, stride: 4 });
    const r = await runLoop(opts({ client }));
    const order = r.map((x) => `${x.item.seed % 4}:${x.item.verdict.pass ? "P" : "F"}`);
    expect(order).toEqual(["0:P", "1:P", "2:F", "3:F"]);
    expect(r[3]!.item.report.solveOk).toBe(false);
    expect(r[2]!.item.verdict.badSegments).toEqual([0, 1, 2]);
    const table = formatTable(r.map((x) => ({ rank: x.rank, item: x.item })));
    expect(table).toMatch(/FAIL \(no solve\)/);
    expect(table.split("\n")[0]).toMatch(/rank\s+take\s+seed\s+pass\s+composite\s+rot deg\s+trans %/);
  });
});

describe("end to end with the real poses converter and verifier (mock DA3)", () => {
  it("follows-the-move takes pass, the drifting take fails, the unsolved take ranks last", async () => {
    const client = new MockClient({ shot, stride: 4 });
    const r = await runLoop(opts({ client, tools: { ...realTools, decimate: fakeTools(shot).decimate } }));
    const bySeed = Object.fromEntries(r.map((x) => [x.item.seed % 4, x]));
    expect(bySeed[0]!.item.verdict.pass).toBe(true);
    expect(bySeed[1]!.item.verdict.pass).toBe(true);
    expect(bySeed[2]!.item.verdict.pass).toBe(false);
    expect(bySeed[3]!.item.report.solveOk).toBe(false);
    expect(r[3]!.item.seed % 4).toBe(3);
  }, 120_000);
});
