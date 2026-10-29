import { describe, expect, it } from "vitest";
import { buildPoseGraph, buildSegmentGraph, buildTakeGraph, decodeTiling, segmentWindow, SINGLE_TILE_BUDGET } from "../src/graph.ts";
import { loadShot, packetFor } from "./helpers.ts";

const shot = loadShot();

describe("buildTakeGraph", () => {
  const g = buildTakeGraph({ shot, packet: packetFor(shot, 0.8), guideFile: "abc.mp4", prompt: "a hallway", seed: 77 });
  it("fills prompt, seed, frames, strength, guide and size", () => {
    expect(g["6"]!.inputs.text).toBe("a hallway");
    expect(g["16"]!.inputs.noise_seed).toBe(77);
    expect(g["9"]!.inputs.file).toBe("abc.mp4");
    expect(g["11"]!.inputs).toMatchObject({ width: 768, height: 512, length: 121 });
    expect(g["13"]!.inputs.frames_number).toBe(121);
    expect(g["12"]!.inputs.strength).toBe(0.8);
    expect(g["2"]!.inputs.lora_name).toBe("ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors");
  });
  it("does not mutate the template between builds", () => {
    const g2 = buildTakeGraph({ shot, packet: packetFor(shot), guideFile: "x.mp4", prompt: "p", seed: 1 });
    expect(g2["16"]!.inputs.noise_seed).toBe(1);
    expect(g["16"]!.inputs.noise_seed).toBe(77);
  });
  it("uses only pack/core nodes, no custom ComfyOSH node and no partner nodes", () => {
    for (const n of Object.values(g)) expect(n.class_type).not.toMatch(/ComfyOSH|LtxApi/);
  });
  it("allows strength 0 only with allowUnguided (negative control)", () => {
    const g0 = buildTakeGraph({ shot, packet: packetFor(shot, 0), guideFile: "a", prompt: "p", seed: 1, allowUnguided: true });
    expect(g0["12"]!.inputs.strength).toBe(0);
  });
  it("refuses strength 0 (LTX would ignore the guide) and bad seeds", () => {
    expect(() => buildTakeGraph({ shot, packet: packetFor(shot, 0), guideFile: "a", prompt: "p", seed: 1 })).toThrow(/strength/);
    expect(() => buildTakeGraph({ shot, packet: packetFor(shot), guideFile: "a", prompt: "p", seed: -1 })).toThrow(/seed/);
  });
});

describe("buildPoseGraph", () => {
  it("defaults to da3_base and sets the video", () => {
    const g = buildPoseGraph({ videoFile: "v.mp4", tag: "t" });
    expect(g["3"]!.inputs.model).toBe("da3_base.safetensors");
    expect(g["1"]!.inputs.file).toBe("v.mp4");
  });
  it("rejects large/giant/metric models", () => {
    for (const m of ["da3_large.safetensors", "da3_giant.safetensors", "da3metric_large.safetensors"]) {
      expect(() => buildPoseGraph({ videoFile: "v.mp4", tag: "t", model: m })).toThrow(/not allowed/);
    }
  });
});


describe("VAE decode tiling", () => {
  it("covers a standard 768x512x121 take in ONE spatial and ONE temporal tile (no seam frames)", () => {
    const t = decodeTiling({ width: 768, height: 512 }, 121);
    expect(t.tile_size).toBeGreaterThanOrEqual(768);
    expect(t.temporal_size).toBeGreaterThanOrEqual(121);
    expect(t.tile_size % 32).toBe(0);
    expect(t.temporal_size % 4).toBe(0);
  });
  it("sizes a repair window from its own length, and both graphs carry it", () => {
    const w = segmentWindow(shot, 2);
    expect(decodeTiling(shot.resolution, w.length).temporal_size).toBeGreaterThanOrEqual(w.length);
    const take = buildTakeGraph({ shot, packet: packetFor(shot), guideFile: "g", prompt: "p", seed: 1 });
    const seg = buildSegmentGraph({ shot, packet: packetFor(shot), guideFile: "g", contextFile: "c", prompt: "p", seed: 1, window: w });
    expect(take["22"]!.inputs.temporal_size).toBeGreaterThanOrEqual(shot.frames);
    expect(seg["22"]!.inputs.temporal_size).toBeGreaterThanOrEqual(w.length);
  });
  it("a clip too big for one tile is tiled with a long overlap, not the old 8-frame seam", () => {
    expect(768 * 512 * 121).toBeLessThan(SINGLE_TILE_BUDGET);
    const big = decodeTiling({ width: 1536, height: 1024 }, 241);
    expect(big.temporal_overlap).toBeGreaterThanOrEqual(32);
    expect(big.temporal_size - big.temporal_overlap).toBeLessThan(big.temporal_size);
  });
});
