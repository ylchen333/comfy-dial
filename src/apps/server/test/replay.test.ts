import { describe, expect, it } from "vitest";
import type { Graph } from "../src/client.ts";
import { applySets } from "../src/replay-cli.ts";

const g = (): Graph => ({ "22": { class_type: "VAEDecodeTiled", inputs: { samples: ["21", 2], tile_size: 512, temporal_size: 64 } }, "16": { class_type: "RandomNoise", inputs: { noise_seed: 1000 } } });

describe("replay edits", () => {
  it("sets numbers and strings on existing inputs and says what changed", () => {
    const x = g();
    const out = applySets(x, ["22.temporal_size=128", "22.tile_size=800"]);
    expect(x["22"]!.inputs).toMatchObject({ temporal_size: 128, tile_size: 800 });
    expect(out[0]).toBe("VAEDecodeTiled 22.temporal_size = 128");
  });
  it("refuses a typo, a missing node, a link, and a malformed edit instead of silently changing nothing", () => {
    expect(() => applySets(g(), ["22.temporal_sizes=128"])).toThrow(/no input/);
    expect(() => applySets(g(), ["99.x=1"])).toThrow(/no node 99/);
    expect(() => applySets(g(), ["22.samples=1"])).toThrow(/link/);
    expect(() => applySets(g(), ["nonsense"])).toThrow(/must look like/);
  });
});
