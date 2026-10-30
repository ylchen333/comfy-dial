import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApi } from "../src/api.ts";
import { BUNDLED_ACTORS_DIR } from "../src/assets.ts";
import type { ComfyClient, Graph } from "../src/client.ts";
import { ACTOR_CREDITS } from "../src/safety.ts";
import { tmp } from "./helpers.ts";

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

/** Stands in for Comfy: the image job returns a PNG, the shape job returns a GLB (the bundled mannequin, 37x too big and Z-up like a raw mesh). */
class ActorStub implements ComfyClient {
  readonly label = "stub";
  graphs: Graph[] = [];
  jobs = new Map<string, "image" | "mesh">();
  fail = false;
  async uploadFile(p: string) { return p.split("/").pop()!; }
  async submit(g: Graph) { this.graphs.push(g); const id = `j${this.graphs.length}`; this.jobs.set(id, "SaveImage" in Object.fromEntries(Object.values(g).map((n) => [n.class_type, 1])) ? "image" : "mesh"); return id; }
  async lookupByKey() { return null; }
  async wait(id: string) { return this.fail && this.jobs.get(id) === "mesh" ? { state: "failed" as const, error: "boom" } : { state: "succeeded" as const }; }
  async download(id: string, dir: string) {
    mkdirSync(dir, { recursive: true });
    if (this.jobs.get(id) === "image") { const f = join(dir, "reference_00001_.png"); writeFileSync(f, new Uint8Array(512).fill(7)); return [f]; }
    const f = join(dir, "comfy_dial_actor_00001_.glb");
    copyFileSync(join(BUNDLED_ACTORS_DIR, "mannequin_stand.glb"), f);
    return [f];
  }
}

async function boot(env: Record<string, string>) {
  const stub = new ActorStub();
  const runsDir = tmp();
  const server = createApi({ runsDir, env, actorClient: () => stub });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const gen = (qs: string, body: unknown, type = "application/json") => fetch(`${base}/api/actors/generate${qs}`, { method: "POST", headers: { "content-type": type }, body: type === "application/json" ? JSON.stringify(body) : (body as Uint8Array) as unknown as BodyInit });
  return { base, stub, gen };
}

describe("generate actor", () => {
  it("local server: description -> image job -> shape job -> a normalised actor in uploads, listed as generated", async () => {
    const { base, stub, gen } = await boot({ COMFY_BASE_URL: "http://127.0.0.1:8000" });
    const r = await gen("", { description: "a woman in a red coat" });
    expect(r.status).toBe(200);
    const v = (await r.json()) as { asset: string; triangles: number; report: { ok: boolean; heightM: number } };
    expect(v.asset).toMatch(/^uploads\/[0-9a-f]{12}\.glb$/);
    expect(v.report.ok).toBe(true);
    expect(stub.graphs.length).toBe(2);
    const text = Object.values(stub.graphs[0]!).find((n) => n.class_type === "CLIPTextEncode" && (n.inputs.text as string).length > 0)!.inputs.text as string;
    expect(text).toContain("a woman in a red coat");
    expect(text).toContain("plain white background");
    expect(Object.values(stub.graphs[1]!).some((n) => n.class_type === "SaveGLB")).toBe(true);
    const list = (await (await fetch(`${base}/api/actors`)).json()) as { bundled: { asset: string }[]; generated: { asset: string; description: string; hasImage: boolean }[] };
    expect(list.bundled.length).toBeGreaterThan(0);
    expect(list.generated[0]).toMatchObject({ asset: v.asset, description: "a woman in a red coat", hasImage: true });
    expect((await fetch(`${base}/api/assets/${v.asset}`)).status).toBe(200);
    expect((await fetch(`${base}/api/actors/image/${v.asset.slice(8, 20)}`)).headers.get("content-type")).toBe("image/png");
  });

  it("a supplied photo skips the image job", async () => {
    const { stub, gen } = await boot({ COMFY_BASE_URL: "http://127.0.0.1:8000" });
    const r = await gen("?turnDeg=180", new Uint8Array(1024).fill(9), "image/png");
    expect(r.status).toBe(200);
    expect(stub.graphs.length).toBe(1);
  });

  it("Cloud: needs the credit confirmation; the generated files never land in the bundled actors folder", async () => {
    const { gen } = await boot({ COMFY_API_KEY: "k" });
    const refused = await gen("", { description: "a man" });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain(`confirmCredits=${ACTOR_CREDITS}`);
    const ok = await gen(`?confirmCredits=${ACTOR_CREDITS}`, { description: "a man" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { asset: string }).asset.startsWith("uploads/")).toBe(true);
  });

  it("rejects an empty or over-long description and reports a failed job", async () => {
    const { stub, gen } = await boot({ COMFY_BASE_URL: "http://127.0.0.1:8000" });
    expect((await gen("", { description: "  " })).status).toBe(400);
    expect((await gen("", { description: "x".repeat(201) })).status).toBe(400);
    stub.fail = true;
    const r = await gen("", { description: "a child" });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toContain("boom");
  });
});
