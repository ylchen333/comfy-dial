import { describe, expect, it } from "vitest";
import { buildPoseGraph, buildTakeGraph } from "../src/graph.ts";
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
