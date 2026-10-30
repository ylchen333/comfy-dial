import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../src/api.ts";
import { MockClient } from "../src/mock-client.ts";
import { REFERENCE_CREDITS } from "../src/safety.ts";
import { copySample, realTools } from "../src/tools.ts";
import { loadShot, tmp } from "./helpers.ts";

const shot = loadShot();
const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

/** Real python poses converter and verifier path; only ffmpeg sampling and the Comfy job are mocked. */
async function boot(env: Record<string, string>, seedName = "mock_ref.mp4") {
  const mock = new MockClient({ shot, stride: 1 });
  mock.uploadFile = async () => seedName; // the mock reads a "_s<seed>" in the name to pick its scenario (seed 3 = unsolved)
  const server = createApi({ runsDir: tmp(), env, tools: { ...realTools, sample: copySample }, referenceClient: () => mock });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (qs = "", bytes = new Uint8Array(4096)) => fetch(`${base}/api/reference${qs}`, { method: "POST", body: bytes });
  return { base, post, mock };
}

describe("reference video camera", () => {
  it("local server: recovers a Poses document for free, with the clip's duration", async () => {
    const { post } = await boot({ COMFY_BASE_URL: "http://127.0.0.1:8000" });
    const r = await post();
    expect(r.status).toBe(200);
    const v = (await r.json()) as { poses: { schema: string; solve_ok: boolean; frames: { t: number }[] }; durationSec: number };
    expect(v.poses.schema).toBe("comfy-dial/poses/1");
    expect(v.poses.solve_ok).toBe(true);
    expect(v.poses.frames.length).toBeGreaterThan(10);
    expect(v.durationSec).toBeCloseTo(4.8, 6);
    expect(v.poses.frames.at(-1)!.t).toBeGreaterThan(4); // poses' time runs across the whole clip
  });

  it("Cloud: refuses without the key or the credit confirmation, accepts with both", async () => {
    const noKeyEnv = await boot({}); // referenceClient hook present, so only the confirmation gates it
    expect((await noKeyEnv.post()).status).toBe(400);
    const { post, base } = await boot({ COMFY_API_KEY: "test-key" });
    expect((await post()).status).toBe(400);
    expect((await post("?confirmCredits=1")).status).toBe(400);
    expect((await post(`?confirmCredits=${REFERENCE_CREDITS}`)).status).toBe(200);
    const health = (await (await fetch(`${base}/api/health`)).json()) as { referenceCredits: number; cloud: boolean };
    expect(health).toMatchObject({ referenceCredits: REFERENCE_CREDITS, cloud: true });
  });

  it("reports an unsolved clip honestly (422) instead of returning an empty move", async () => {
    const { post } = await boot({ COMFY_BASE_URL: "http://127.0.0.1:8000" }, "mock_ref_s3.mp4");
    const r = await post();
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toMatch(/could not be recovered/);
  });

  it("rejects an upload too small to be a video", async () => {
    const { post } = await boot({ COMFY_BASE_URL: "http://127.0.0.1:8000" });
    expect((await post("", new Uint8Array(10))).status).toBe(400);
  });
});
