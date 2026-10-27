import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApi, type RunView } from "../src/api.ts";
import { MockClient } from "../src/mock-client.ts";
import { SceneKit } from "../../../packages/rig-core/scripts/scene-kit.ts";
import { fakeTools, loadShot, tmp } from "./helpers.ts";

const shot = loadShot();
const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function boot(env: Record<string, string> = {}, live = false) {
  const runsDir = tmp();
  const server = createApi({
    runsDir, env, tools: fakeTools(shot),
    ...(live ? { liveClient: () => new MockClient({ shot, stride: 4 }) } : {}),
    guide: async (_s, dir) => { mkdirSync(dir, { recursive: true }); const p = join(dir, "g.depth.mp4"); writeFileSync(p, "fake"); return { path: p, near: 1, far: 100 }; },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown) => fetch(`${base}/api/runs`, { method: "POST", body: JSON.stringify(body) });
  const poll = async (id: string): Promise<RunView> => {
    for (let i = 0; i < 100; i++) {
      const v = (await (await fetch(`${base}/api/runs/${id}`)).json()) as RunView;
      if (v.state !== "running") return v;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("run did not finish");
  };
  return { base, post, poll };
}

describe("studio API", () => {
  it("dry run: ranked takes, poses served", async () => {
    const { base, post, poll } = await boot();
    const r = await post({ shot, n: 4 });
    expect(r.status).toBe(202);
    const v = await poll(((await r.json()) as RunView).id);
    expect(v.error).toBeNull();
    expect(v.state).toBe("done");
    expect(v.live).toBe(false);
    expect(v.takes).toHaveLength(4);
    expect(v.takes.map((t) => t.rank)).toEqual([1, 2, 3, 4]);
    expect(v.takes.some((t) => t.pass)).toBe(true);
    const withPoses = v.takes.find((t) => t.hasPoses)!;
    const poses = (await (await fetch(`${base}/api/runs/${v.id}/takes/${withPoses.seed}/poses`)).json()) as { schema: string };
    expect(poses.schema).toBe("comfy-osh/poses/1");
  });

  it("repair: regenerates the drifted segment, re-ranks, serves the patched poses, and refuses a second repair", async () => {
    const { base, post, poll } = await boot();
    const v = await poll(((await (await post({ shot, n: 4, strength: 0.8 })).json()) as RunView).id);
    const bad = v.takes.find((t) => t.solveOk && t.badSegments.length > 0)!;
    expect(bad.segments).toHaveLength(shot.segments.length);
    expect(bad.repair).toBeNull();
    const go = () => fetch(`${base}/api/runs/${v.id}/takes/${bad.seed}/repair`, { method: "POST", body: JSON.stringify({ strength: 1 }) });
    const r = await go();
    expect(r.status).toBe(202);
    let after = v;
    for (let i = 0; i < 100 && (i === 0 || after.repairing); i++) {
      await new Promise((x) => setTimeout(x, 50));
      after = (await (await fetch(`${base}/api/runs/${v.id}`)).json()) as RunView;
    }
    expect(after.error).toBeNull();
    const fixed = after.takes.find((t) => t.seed === bad.seed)!;
    expect(fixed.repair?.improved).toBe(true);
    expect(fixed.repair?.before.segments).toHaveLength(shot.segments.length);
    expect(fixed.badSegments).toEqual([]);
    expect(fixed.hasPoses).toBe(true);
    expect((await go()).status).toBe(409);
    expect((await fetch(`${base}/api/runs/${v.id}/takes/${v.takes.find((t) => !t.solveOk)!.seed}/repair`, { method: "POST", body: "{}" })).status).toBe(400);
  });

  it("rejects an invalid shot and a bad n", async () => {
    const { post } = await boot();
    expect((await post({ shot: { nope: 1 } })).status).toBe(400);
    expect((await post({ shot, n: 9 })).status).toBe(400);
    expect((await post({ shot, n: 2.5 })).status).toBe(400);
  });

  it("refuses live without a key, without confirmation, at an uncalibrated resolution", async () => {
    const noKey = await boot();
    expect((await noKey.post({ shot, n: 2, live: true, confirmCredits: 18 })).status).toBe(400);
    const { post } = await boot({ COMFY_API_KEY: "k" });
    const unconfirmed = await post({ shot, n: 2, live: true });
    expect(unconfirmed.status).toBe(400);
    expect(((await unconfirmed.json()) as { error: string }).error).toContain("confirmCredits=18");
    const wide = { ...shot, resolution: { width: 1120, height: 480 } };
    const res = await post({ shot: wide, n: 2, live: true, confirmCredits: 18 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("768x512");
  });

  it("unknown run and unknown route are 404", async () => {
    const { base } = await boot();
    expect((await fetch(`${base}/api/runs/abcd`)).status).toBe(404);
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("lists bundled scenes and serves them; refuses names outside scenes/ and uploads/", async () => {
    const { base } = await boot();
    const list = (await (await fetch(`${base}/api/scenes`)).json()) as { id: string; asset: string }[];
    expect(list.map((s) => s.asset)).toEqual(["scenes/courtyard.glb", "scenes/street.glb"]);
    const glb = await fetch(`${base}/api/assets/scenes/courtyard.glb`);
    expect(glb.status).toBe(200);
    expect(glb.headers.get("content-type")).toBe("model/gltf-binary");
    expect(new DataView(await glb.arrayBuffer()).getUint32(0, true)).toBe(0x46546c67);
    expect((await fetch(`${base}/api/assets/scenes/..%2Fpackage.json`)).status).toBe(404);
    expect((await fetch(`${base}/api/assets/uploads/missing.glb`)).status).toBe(404);
  });

  it("uploads a GLB (content-addressed, with size info) and rejects a non-glTF file", async () => {
    const { base } = await boot();
    const k = new SceneKit();
    k.box([0, 1, 0], [2, 2, 2], [1, 0, 0]);
    const body = Buffer.from(k.toGlb());
    const up = await fetch(`${base}/api/assets`, { method: "POST", body });
    expect(up.status).toBe(200);
    const r = (await up.json()) as { asset: string; triangles: number; min: number[]; max: number[] };
    expect(r.asset).toMatch(/^uploads\/[0-9a-f]{12}\.glb$/);
    expect(r.triangles).toBe(12);
    expect(r.min).toEqual([-1, 0, -1]);
    expect(r.max).toEqual([1, 2, 1]);
    const again = (await (await fetch(`${base}/api/assets`, { method: "POST", body })).json()) as { asset: string };
    expect(again.asset).toBe(r.asset);
    expect((await fetch(`${base}${"/api/assets/" + r.asset}`)).status).toBe(200);
    const bad = await fetch(`${base}/api/assets`, { method: "POST", body: "not a model" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/not a GLB/);
  });

  it("dry-run takes have no video; live takes serve their file with Range support", async () => {
    const dry = await boot();
    const d = await dry.poll(((await (await dry.post({ shot, n: 2 })).json()) as RunView).id);
    expect(d.takes.every((t) => !t.hasVideo)).toBe(true);
    expect((await fetch(`${dry.base}/api/runs/${d.id}/takes/${d.takes[0]!.seed}/video`)).status).toBe(404);

    const live = await boot({ COMFY_API_KEY: "k" }, true);
    const r = await live.post({ shot, n: 2, live: true, confirmCredits: 18 });
    expect(r.status).toBe(202);
    const v = await live.poll(((await r.json()) as RunView).id);
    const t = v.takes.find((x) => x.hasVideo)!;
    expect(t).toBeDefined();
    const full = await fetch(`${live.base}/api/runs/${v.id}/takes/${t.seed}/video`);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    const text = await full.text();
    expect(text).toContain("MOCK take");
    const part = await fetch(`${live.base}/api/runs/${v.id}/takes/${t.seed}/video`, { headers: { range: "bytes=0-3" } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe(text.slice(0, 4));
    expect(part.headers.get("content-range")).toBe(`bytes 0-3/${text.length}`);
  });
});
