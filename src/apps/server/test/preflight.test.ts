import { describe, expect, it } from "vitest";
import { checkAll, checkGraph, formatFindings, loadLoopGraphs } from "../src/preflight.ts";

const combo = (...v: string[]): string[][] => [v];
/** An /object_info that has every node the loop uses, with exactly the model files its graphs name. */
function fullInfo() {
  const info: Record<string, { input: { required: Record<string, string[][]> } }> = {};
  for (const g of Object.values(loadLoopGraphs()))
    for (const n of Object.values(g)) {
      const req = (info[n.class_type] ??= { input: { required: {} } }).input.required;
      for (const [k, v] of Object.entries(n.inputs)) if (typeof v === "string" && k !== "file") (req[k] ??= combo())[0]!.push(v);
    }
  return info;
}

describe("preflight", () => {
  it("passes when every node and model is present", () => {
    expect(checkAll(fullInfo())).toEqual([]);
    expect(formatFindings([])).toMatch(/preflight ok/);
  });
  it("lists a missing model file and a missing node pack", () => {
    const info = fullInfo();
    info.UNETLoader!.input.required.unet_name = combo("something-else.safetensors");
    delete (info as Record<string, unknown>).LTXAddVideoICLoRAGuide;
    const f = checkAll(info);
    expect(f.some((x) => x.kind === "missing-model" && x.detail === "ltx-2.5-22b-distilled-transformer-bf16.safetensors")).toBe(true);
    expect(f.some((x) => x.kind === "missing-node" && x.detail.includes("LTXAddVideoICLoRAGuide"))).toBe(true);
    expect(formatFindings(f)).toMatch(/MISSING NODES[\s\S]*MISSING MODEL FILES/);
  });
  it("checks the DA3 model the server will request (da3_base), not the template's da3_small", () => {
    const info = fullInfo();
    info.DownloadAndLoadDepthAnythingV3Model!.input.required.model = combo("da3_small.safetensors");
    expect(checkAll(info).some((x) => x.kind === "missing-model" && x.detail === "da3_base.safetensors")).toBe(true);
  });
  it("flags a partner node", () => {
    const g = { "1": { class_type: "LtxApi25", inputs: {} } };
    expect(checkGraph("w", g, { LtxApi25: { api_node: true } }).map((x) => x.kind)).toEqual(["partner-node"]);
  });
});
