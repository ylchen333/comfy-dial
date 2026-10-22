import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DuplicateKeyError, type ComfyClient } from "../src/client.ts";
import { buildTakeGraph } from "../src/graph.ts";
import { MockClient } from "../src/mock-client.ts";
import { idempotencyKey, JobStore, PendingSubmitError, submitOnce } from "../src/store.ts";
import { loadShot, packetFor, tmp } from "./helpers.ts";

const shot = loadShot();
const graph = (seed: number, prompt = "p") => buildTakeGraph({ shot, packet: packetFor(shot), guideFile: "g.mp4", prompt, seed });

describe("idempotency", () => {
  it("persists intent to disk BEFORE the submit call", async () => {
    const path = join(tmp(), "jobs.json");
    const store = new JobStore(path);
    let seenAtSubmit: unknown;
    const spy = Object.assign(new MockClient({ shot, stride: 4 }), {
      async submit() {
        seenAtSubmit = new JobStore(path).job(key); // a fresh reader sees what a crash would leave behind
        throw new Error("boom");
      },
    }) as ComfyClient;
    const g = graph(1);
    const key = idempotencyKey(shot.id, "take", 1, g);
    await expect(submitOnce(store, spy, key, "take", g)).rejects.toThrow("boom");
    expect(seenAtSubmit).toMatchObject({ jobId: null });
  });

  it("same key submitted twice hits the server once", async () => {
    const c = new MockClient({ shot, stride: 4 });
    const store = new JobStore(join(tmp(), "jobs.json"));
    const g = graph(5);
    const key = idempotencyKey(shot.id, "take", 5, g);
    const a = await submitOnce(store, c, key, "take", g);
    const b = await submitOnce(store, c, key, "take", g);
    expect(a).toBe(b);
    expect(c.submitAttempts).toEqual([key]);
  });

  it("survives a process restart: a new store + client does not resubmit a persisted key", async () => {
    const path = join(tmp(), "jobs.json");
    const c = new MockClient({ shot, stride: 4 });
    const g = graph(9);
    const key = idempotencyKey(shot.id, "take", 9, g);
    const a = await submitOnce(new JobStore(path), c, key, "take", g);
    const b = await submitOnce(new JobStore(path), c, key, "take", g);
    expect(b).toBe(a);
    expect(c.submitAttempts).toHaveLength(1);
  });

  it("crash after the server accepted but before we stored the jobId: retry looks the job up, no double submit", async () => {
    const path = join(tmp(), "jobs.json");
    const c = new MockClient({ shot, stride: 4 });
    const g = graph(3);
    const key = idempotencyKey(shot.id, "take", 3, g);
    c.crashAfterSubmit = true;
    await expect(submitOnce(new JobStore(path), c, key, "take", g)).rejects.toThrow(/crash/);
    c.crashAfterSubmit = false;
    const id = await submitOnce(new JobStore(path), c, key, "take", g); // new process
    expect(id).toBe(c.jobs[0]!.id);
    expect(c.jobs).toHaveLength(1);
    expect(c.submitAttempts).toEqual([key]); // lookup resolved it, submit was not called again
  });

  it("a 422 duplicate resolves by lookup, not resubmit", async () => {
    const c = new MockClient({ shot, stride: 4 });
    const g = graph(4);
    const key = idempotencyKey(shot.id, "take", 4, g);
    const first = await c.submit(g, key); // someone else (earlier run) already holds the key
    await expect(c.submit(g, key)).rejects.toBeInstanceOf(DuplicateKeyError);
    const store = new JobStore(join(tmp(), "jobs.json")); // our store lost it
    expect(await submitOnce(store, c, key, "take", g)).toBe(first);
    expect(c.jobs).toHaveLength(1);
  });

  it("an unconfirmed key the server cannot resolve refuses to resubmit unless told to", async () => {
    const path = join(tmp(), "jobs.json");
    const g = graph(2);
    const key = idempotencyKey(shot.id, "take", 2, g);
    const store = new JobStore(path);
    store.putJob(key, { jobId: null, kind: "take", createdAt: "t" });
    const c = new MockClient({ shot, stride: 4 });
    await expect(submitOnce(store, c, key, "take", g)).rejects.toBeInstanceOf(PendingSubmitError);
    expect(c.submitAttempts).toHaveLength(0);
    await submitOnce(store, c, key, "take", g, { resubmitPending: true });
    expect(c.submitAttempts).toHaveLength(1);
  });

  it("keys change with the inputs but not across reruns", () => {
    expect(idempotencyKey("s", "take", 1, graph(1))).toBe(idempotencyKey("s", "take", 1, graph(1)));
    expect(idempotencyKey("s", "take", 1, graph(1))).not.toBe(idempotencyKey("s", "take", 1, graph(1, "other prompt")));
    expect(idempotencyKey("s", "take", 1, graph(1))).not.toBe(idempotencyKey("s", "take", 2, graph(2)));
  });
});
