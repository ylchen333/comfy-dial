import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApi, type RunView } from "../src/api.ts";
import type { ComfyClient, Graph } from "../src/client.ts";
import { MockClient } from "../src/mock-client.ts";
import { UPSCALE_CREDITS, UPSCALE_HEIGHT } from "../src/safety.ts";
import { fakeTools, loadShot, tmp } from "./helpers.ts";

const shot = loadShot();
const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

class UpscaleStub implements ComfyClient {
  readonly label = "stub";
  graphs: Graph[] = [];
  fail = false;
  async uploadFile(p: string) { return p.split("/").pop()!; }
  async submit(g: Graph) { this.graphs.push(g); return `u${this.graphs.length}`; }
  async lookupByKey() { return null; }
  async wait() { return this.fail ? { state: "failed" as const, error: "out of memory" } : { state: "succeeded" as const }; }
  async download(_id: string, dir: string) { mkdirSync(dir, { recursive: true }); const f = join(dir, "comfy_dial_00001_.mp4"); writeFileSync(f, new Uint8Array(4096).fill(3)); return [f]; }
}

async function boot(env: Record<string, string>, stub: UpscaleStub) {
  const server = createApi({
    runsDir: tmp(), env, tools: fakeTools(shot),
    liveClient: () => new MockClient({ shot, stride: 4 }), upscaleClient: () => stub,
    guide: async (_s, dir) => { mkdirSync(dir, { recursive: true }); const p = join(dir, "g.depth.mp4"); writeFileSync(p, "fake"); return { path: p, near: 1, far: 100 }; },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const poll = async (id: string): Promise<RunView> => {
    for (let i = 0; i < 200; i++) {
      const v = (await (await fetch(`${base}/api/runs/${id}`)).json()) as RunView;
      if (v.state !== "running" && v.takes.every((t) => t.upscale?.state !== "running")) return v;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("did not settle");
  };
  const live = async () => {
    const r = await fetch(`${base}/api/runs`, { method: "POST", body: JSON.stringify({ shot, n: 2, live: true, confirmCredits: 18 }) });
    const first = (await r.json()) as RunView & { error?: string };
    return poll(first.id);
  };
  return { base, poll, live };
}

describe("upscale a take", () => {
  it("Cloud: needs the credit confirmation, then makes a downloadable high-res copy and marks the take", async () => {
    const stub = new UpscaleStub();
    const { base, poll, live } = await boot({ COMFY_API_KEY: "k" }, stub);
    const v = await live();
    expect(v.error).toBeNull();
    const t = v.takes.find((x) => x.hasVideo)!;
    expect(t.upscale).toBeNull();
    const url = `${base}/api/runs/${v.id}/takes/${t.seed}/upscale`;
    expect((await fetch(url, { method: "POST" })).status).toBe(400);
    expect((await fetch(`${url}?confirmCredits=${UPSCALE_CREDITS}`, { method: "POST" })).status).toBe(202);
    expect((await fetch(`${url}?confirmCredits=${UPSCALE_CREDITS}`, { method: "POST" })).status).toBe(409); // already running
    const done = await poll(v.id);
    expect(done.takes.find((x) => x.seed === t.seed)!.upscale).toEqual({ state: "done", height: UPSCALE_HEIGHT });
    expect(stub.graphs).toHaveLength(1);
    const g = Object.values(stub.graphs[0]!);
    expect(g.find((n) => n.class_type === "SeedVR2VideoUpscaler")!.inputs.resolution).toBe(UPSCALE_HEIGHT);
    expect(g.some((n) => n.class_type.startsWith("Tencent") || /partner/i.test(n.class_type))).toBe(false);
    const file = await fetch(`${base}/api/runs/${v.id}/takes/${t.seed}/upscaled?download=1`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toContain(`-${UPSCALE_HEIGHT}p.mp4`);
    expect((await fetch(url + `?confirmCredits=${UPSCALE_CREDITS}`, { method: "POST" })).status).toBe(409); // already done
  });

  it("reports a failed job on the take and has no file to serve", async () => {
    const stub = new UpscaleStub();
    stub.fail = true;
    const { base, poll, live } = await boot({ COMFY_API_KEY: "k" }, stub);
    const v = await live();
    const t = v.takes.find((x) => x.hasVideo)!;
    await fetch(`${base}/api/runs/${v.id}/takes/${t.seed}/upscale?confirmCredits=${UPSCALE_CREDITS}`, { method: "POST" });
    const after = await poll(v.id);
    expect(after.takes.find((x) => x.seed === t.seed)!.upscale).toMatchObject({ state: "error", error: expect.stringContaining("out of memory") });
    expect((await fetch(`${base}/api/runs/${v.id}/takes/${t.seed}/upscaled`)).status).toBe(404);
  });
});
