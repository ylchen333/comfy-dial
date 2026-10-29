import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApi, type RunView } from "../src/api.ts";
import { buildSegmentGraph, buildTakeGraph, segmentWindow } from "../src/graph.ts";
import { MockClient } from "../src/mock-client.ts";
import { cleanPrompt, DEFAULT_NEGATIVE, DEFAULT_PROMPT, MAX_PROMPT } from "../src/prompt.ts";
import { fakeTools, loadShot, packetFor, tmp } from "./helpers.ts";

const shot = loadShot();
const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function boot() {
  const mock = new MockClient({ shot, stride: 4 });
  const server = createApi({
    runsDir: tmp(), env: { COMFY_API_KEY: "k" }, tools: fakeTools(shot), liveClient: () => mock,
    guide: async (_s, dir) => { mkdirSync(dir, { recursive: true }); const p = join(dir, "g.depth.mp4"); writeFileSync(p, "fake"); return { path: p, near: 1, far: 100 }; },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown) => fetch(`${base}/api/runs`, { method: "POST", body: JSON.stringify(body) });
  const poll = async (id: string, until: (v: RunView) => boolean = (v) => v.state !== "running"): Promise<RunView> => {
    for (let i = 0; i < 100; i++) {
      const v = (await (await fetch(`${base}/api/runs/${id}`)).json()) as RunView;
      if (until(v)) return v;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("timed out");
  };
  return { base, post, poll, mock };
}

describe("prompt text", () => {
  it("cleans whitespace and control characters, falls back when empty, and refuses over-long text instead of cutting it", () => {
    expect(cleanPrompt("  A  woman\n\tin a red coat \u0007 ", MAX_PROMPT, "d", "prompt")).toBe("A woman in a red coat");
    expect(cleanPrompt("   ", MAX_PROMPT, "d", "prompt")).toBe("d");
    expect(cleanPrompt(undefined, MAX_PROMPT, "d", "prompt")).toBe("d");
    expect(() => cleanPrompt("x".repeat(MAX_PROMPT + 1), MAX_PROMPT, "d", "prompt")).toThrow(/limit is 600/);
    expect(() => cleanPrompt(42, MAX_PROMPT, "d", "prompt")).toThrow(/must be text/);
  });

  it("both graphs take the user's prompt and avoid text, and keep the validated negative when none is given", () => {
    const p = { shot, packet: packetFor(shot), guideFile: "g.mp4", prompt: "A dancer in blue", seed: 1 };
    const t = buildTakeGraph({ ...p, negative: "blurry, extra limbs" });
    expect(t["6"]!.inputs.text).toBe("A dancer in blue");
    expect(t["7"]!.inputs.text).toBe("blurry, extra limbs");
    expect(buildTakeGraph(p)["7"]!.inputs.text).toBe(DEFAULT_NEGATIVE);
    const s = buildSegmentGraph({ ...p, contextFile: "c.mp4", window: segmentWindow(shot, 2), negative: "blurry" });
    expect(s["6"]!.inputs.text).toBe("A dancer in blue");
    expect(s["7"]!.inputs.text).toBe("blurry");
  });
});

describe("prompt through the API", () => {
  it("sends the user's prompt to every take, echoes it in the run, and repair uses the same text", async () => {
    const { post, poll, mock, base } = await boot();
    const prompt = "A woman in a red wool coat walks through a rain-soaked neon street at night";
    const negative = "blurry, extra fingers";
    const r = await post({ shot, n: 2, seedBase: 1002, live: true, confirmCredits: 18, prompt, negative });
    expect(r.status).toBe(202);
    const v = await poll(((await r.json()) as RunView).id);
    expect(v.error).toBeNull();
    expect(v).toMatchObject({ prompt, negative });
    const takes = mock.jobs.filter((j) => j.kind === "take");
    expect(takes).toHaveLength(2);
    for (const j of takes) expect(j.graph["6"]!.inputs).toMatchObject({ text: prompt });
    for (const j of takes) expect(j.graph["7"]!.inputs).toMatchObject({ text: negative });

    const bad = v.takes.find((t) => t.solveOk && t.badSegments.length > 0)!;
    expect((await fetch(`${base}/api/runs/${v.id}/takes/${bad.seed}/repair`, { method: "POST", body: JSON.stringify({ strength: 1, confirmCredits: 13 }) })).status).toBe(202);
    await poll(v.id, (x) => !x.repairing && x.takes.some((t) => t.seed === bad.seed && t.repair !== null));
    const repair = mock.jobs.filter((j) => j.kind === "take").at(-1)!;
    expect(repair.graph["6"]!.inputs).toMatchObject({ text: prompt });
    expect(repair.graph["7"]!.inputs).toMatchObject({ text: negative });
  });

  it("an empty prompt uses the default; a too-long or non-text prompt is a 400", async () => {
    const { post, poll, mock } = await boot();
    const v = await poll(((await (await post({ shot, n: 1, live: true, confirmCredits: 13, prompt: "   " })).json()) as RunView).id);
    expect(v.prompt).toBe(DEFAULT_PROMPT);
    expect(mock.jobs.find((j) => j.kind === "take")!.graph["6"]!.inputs).toMatchObject({ text: DEFAULT_PROMPT });
    expect((await post({ shot, n: 1, prompt: "x".repeat(601) })).status).toBe(400);
    expect((await post({ shot, n: 1, prompt: 5 })).status).toBe(400);
    expect((await post({ shot, n: 1, negative: "y".repeat(301) })).status).toBe(400);
  });
});
