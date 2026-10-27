import { describe, expect, it } from "vitest";
import { newDoc } from "../src/logic/keys.ts";
import { applyPreset } from "../src/logic/presets.ts";
import { validateDoc } from "../src/logic/io.ts";
import { addModel, blockingScene, bundledScene, hasGround, modelNodes, removeNode, sceneIdOf, withScene, type SceneListing } from "../src/logic/scenes.ts";
import type { TakeView } from "../src/logic/runs.ts";
import { metricsLine, repairLine, repairTarget, segmentStates, sheetSummary, verdictOf } from "../src/logic/sheet.ts";

const LISTINGS: SceneListing[] = [
  { id: "courtyard", label: "Courtyard", asset: "scenes/courtyard.glb" },
  { id: "street", label: "Street", asset: "scenes/street.glb" },
];

const take = (o: Partial<TakeView>): TakeView => ({
  id: "t", seed: 1, rank: 1, pass: true, solveOk: true, composite: 0.3, rotDeg: 0.9, transPct: 2.1, fovDeg: 3,
  badSegments: [], move: null, note: null, hasPoses: true, hasVideo: false, segments: [], repair: null, ...o,
});

describe("scene choices", () => {
  it("a bundled scene is a valid Shot with a subject, no ground node, and presets still frame on the subject", () => {
    let d = withScene(newDoc(), bundledScene("scenes/courtyard.glb"));
    expect(validateDoc(d).ok).toBe(true);
    expect(hasGround(d)).toBe(false);
    expect(hasGround(newDoc())).toBe(true);
    d = applyPreset(d, "orbit");
    expect(validateDoc(d).ok).toBe(true);
    expect(sceneIdOf(d, LISTINGS)).toBe("courtyard");
  });

  it("names the scene: blocking, bundled, or custom once a model is added", () => {
    const d = newDoc();
    expect(sceneIdOf(d, LISTINGS)).toBe("blocking");
    expect(sceneIdOf(withScene(d, bundledScene("scenes/street.glb")), LISTINGS)).toBe("street");
    const custom = addModel(withScene(d, bundledScene("scenes/street.glb")), { asset: "uploads/abc123abc123.glb", min: [-1, 0.5, -1] });
    expect(sceneIdOf(custom, LISTINGS)).toBe("custom");
  });

  it("adds an imported model on the ground with a fresh id, and removes it again", () => {
    let d = addModel(newDoc(), { asset: "uploads/aaaaaaaaaaaa.glb", min: [-1, 0.5, -1] });
    d = addModel(d, { asset: "uploads/bbbbbbbbbbbb.glb", min: [0, -2, 0] });
    const ms = modelNodes(d);
    expect(ms.map((n) => n.id)).toEqual(["model_1", "model_2"]);
    expect(ms[0]!.transform.position).toEqual([0, -0.5, 0]);
    expect(ms[1]!.transform.position).toEqual([0, 2, 0]);
    expect(validateDoc(d).ok).toBe(true);
    d = removeNode(d, "model_1");
    expect(modelNodes(d).map((n) => n.id)).toEqual(["model_2"]);
    expect(addModel(d, { asset: "uploads/cccccccccccc.glb", min: [0, 0, 0] }).scene.nodes.at(-1)!.id).toBe("model_1");
    expect(removeNode(withScene(d, blockingScene()), "nope").scene.nodes).toHaveLength(blockingScene().nodes.length);
  });
});

describe("contact sheet", () => {
  it("shows drifted segments, and never shows an unsolved take as held", () => {
    expect(segmentStates(take({}), 3)).toEqual(["ok", "ok", "ok"]);
    expect(segmentStates(take({ pass: false, badSegments: [2] }), 3)).toEqual(["ok", "ok", "drift"]);
    expect(segmentStates(take({ solveOk: false, pass: false }), 3)).toEqual(["unsolved", "unsolved", "unsolved"]);
  });

  it("verdicts and metric lines", () => {
    expect(verdictOf(take({}))).toBe("PASS");
    expect(verdictOf(take({ pass: false }))).toBe("FAIL");
    expect(verdictOf(take({ solveOk: false, pass: false }))).toBe("NO SOLVE");
    expect(metricsLine(take({}))).toBe("rot 0.9° · trans 2.1%");
    expect(metricsLine(take({ solveOk: false, rotDeg: null, transPct: null, note: "DA3 failed: x" }))).toBe("DA3 failed: x");
    expect(metricsLine(take({ transPct: null }))).toBe("rot 0.9° · trans -");
  });

  it("summarises the run in the product's own terms", () => {
    expect(sheetSummary([])).toBe("");
    expect(sheetSummary([take({}), take({})])).toBe("2 of 2 takes held the move");
    expect(
      sheetSummary([take({}), take({ pass: false, badSegments: [2] }), take({ pass: false, badSegments: [1, 2] }), take({ solveOk: false, pass: false })]),
    ).toBe("1 of 4 takes held the move; 2 drifted (segment 2, 3); 1 could not be measured");
  });
});

describe("repair", () => {
  const drifted = take({ badSegments: [2], hasVideo: true, segments: [{ rotDeg: 0.6, pass: true }, { rotDeg: 1.6, pass: true }, { rotDeg: 3.1, pass: false }] });
  it("offers a repair for the first drifted segment of a solved take, never for unsolved, clean, or already repaired takes", () => {
    expect(repairTarget(drifted, true)).toBe(2);
    expect(repairTarget({ ...drifted, solveOk: false }, true)).toBeNull();
    expect(repairTarget({ ...drifted, badSegments: [] }, true)).toBeNull();
    expect(repairTarget({ ...drifted, repair: { segment: 2, fromFrame: 72, improved: true, before: { rotDeg: 1.8, segments: [] } } }, true)).toBeNull();
  });
  it("a live take with no video file cannot be repaired; a dry take can (mock tools)", () => {
    expect(repairTarget({ ...drifted, hasVideo: false }, true)).toBeNull();
    expect(repairTarget({ ...drifted, hasVideo: false }, false)).toBe(2);
  });
  it("reports before and after for the repaired segment", () => {
    const fixed = take({ segments: [{ rotDeg: 0.7, pass: true }, { rotDeg: 1.5, pass: true }, { rotDeg: 2.5, pass: true }], repair: { segment: 2, fromFrame: 72, improved: true, before: { rotDeg: 1.8, segments: drifted.segments } } });
    expect(repairLine(fixed)).toBe("segment 3 regenerated: 3.1° → 2.5°, now holds");
    expect(repairLine(take({}))).toBeNull();
  });
});
