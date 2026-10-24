import { mkdirSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApi, type RunView } from "../src/api.ts";
import { fakeTools, loadShot, tmp } from "./helpers.ts";

const shot = loadShot();
const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function boot(env: Record<string, string> = {}) {
  const runsDir = tmp();
  const server = createApi({
    runsDir, env, tools: fakeTools(shot),
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
});
