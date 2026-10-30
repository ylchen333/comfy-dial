import { describe, expect, it } from "vitest";
import { newDoc } from "../src/logic/keys.ts";
import { canRemoveNode, duplicateNode, editableNodes, eulerDegFromQuat, nodeLabel, quatFromEulerDeg, updateNode } from "../src/logic/sceneEdit.ts";
import { exportShot } from "../src/logic/compile.ts";

describe("rotation conversion", () => {
  it.each([[0, 0, 0], [30, 0, 0], [0, 90, 0], [0, 0, -45], [20, 40, 60], [-170, 25, 130]] as const)("round trips %s,%s,%s degrees", (x, y, z) => {
    const q = quatFromEulerDeg([x, y, z]);
    expect(Math.hypot(...q)).toBeCloseTo(1, 9);
    const back = quatFromEulerDeg(eulerDegFromQuat(q));
    q.forEach((c, i) => expect(Math.abs(c) - Math.abs(back[i]!)).toBeCloseTo(0, 9)); // same rotation (q and -q are one rotation)
  });
  it("yaw of 90 degrees turns +X to -Z (right-handed, Y up)", () => {
    const [x, y, z, w] = quatFromEulerDeg([0, 90, 0]);
    // rotate (1,0,0): v' = v + 2w(q x v) + 2 q x (q x v)
    const v = [1, 0, 0], qv = [x, y, z];
    const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
    const t = cross(qv, v).map((c) => 2 * c);
    const r = v.map((c, i) => c + w * t[i]! + cross(qv, t)[i]!);
    expect(r[0]).toBeCloseTo(0, 9);
    expect(r[2]).toBeCloseTo(-1, 9);
  });
});

describe("updateNode", () => {
  const doc = newDoc();
  it("moves, rotates and scales one node and leaves the others alone", () => {
    const next = updateNode(doc, "subject", { position: [1, 0.9, -2], rotationDeg: [0, 90, 0], scale: [1, 1, 1] });
    const n = next.scene.nodes.find((x) => x.id === "subject")!;
    expect(n.transform.position).toEqual([1, 0.9, -2]);
    expect(eulerDegFromQuat(n.transform.quaternion)[1]).toBeCloseTo(90, 6);
    expect(next.scene.nodes.filter((x) => x.id !== "subject")).toEqual(doc.scene.nodes.filter((x) => x.id !== "subject"));
  });
  it("keeps scale positive and ignores an unknown id", () => {
    const n = updateNode(doc, "subject", { scale: [-1, 0, 2] }).scene.nodes.find((x) => x.id === "subject")!;
    expect(n.transform.scale.every((s) => s > 0)).toBe(true);
    expect(updateNode(doc, "nope", { position: [9, 9, 9] })).toBe(doc);
  });
  it("produces a valid Shot", () => {
    expect(() => exportShot(updateNode(doc, "subject", { rotationDeg: [10, 20, 30], position: [0.5, 0.9, 0.5] }))).not.toThrow();
  });
});

describe("node helpers", () => {
  const doc = newDoc();
  it("lists everything but the ground, and labels nodes", () => {
    expect(editableNodes(doc).some((n) => n.id === "ground")).toBe(false);
    expect(editableNodes(doc).some((n) => n.id === "subject")).toBe(true);
    expect(nodeLabel({ id: "subject", asset: "actors/mannequin_stand.glb", transform: doc.scene.nodes[0]!.transform })).toBe("Subject");
    expect(nodeLabel({ id: "model_1", asset: "uploads/abc.glb", transform: doc.scene.nodes[0]!.transform })).toBe("model_1 (abc)");
  });
  it("duplicates a prop beside the original with a fresh id, but not the subject or ground", () => {
    const prop = doc.scene.nodes.find((n) => n.id !== "subject" && n.id !== "ground")!;
    const r = duplicateNode(doc, prop.id)!;
    expect(r.id).not.toBe(prop.id);
    expect(new Set(r.doc.scene.nodes.map((n) => n.id)).size).toBe(r.doc.scene.nodes.length);
    expect(r.doc.scene.nodes.find((n) => n.id === r.id)!.transform.position[0]).toBeCloseTo(prop.transform.position[0] + 0.5, 9);
    expect(duplicateNode(doc, "subject")).toBeNull();
    expect(duplicateNode(doc, "ground")).toBeNull();
    expect(canRemoveNode("subject")).toBe(false);
    expect(canRemoveNode(prop.id)).toBe(true);
  });
});
