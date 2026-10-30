import { describe, expect, it } from "vitest";
import { sampleShot } from "@comfy-dial/rig-core";
import { newDoc } from "../src/logic/keys.ts";
import { exportShot } from "../src/logic/compile.ts";
import { DepthPreview } from "../src/logic/depthPreview.ts";
import { guideLines, lensFrame, overscanFov } from "../src/logic/frameGuides.ts";

describe("lens geometry", () => {
  it("fits the shot's aspect inside the viewport, centred, with padding", () => {
    const f = lensFrame(1000, 500, 1.5);
    expect(f.w / f.h).toBeCloseTo(1.5, 6);
    expect(f.h).toBeCloseTo(450, 6); // height-limited: 500 * 0.9
    expect(f.x + f.w / 2).toBeCloseTo(500, 6);
    const tall = lensFrame(300, 800, 1.5); // width-limited
    expect(tall.w).toBeCloseTo(270, 6);
  });
  it("overscan FOV equals the shot FOV when the frame fills the viewport and widens as the frame shrinks, keeping the frame's content", () => {
    expect(overscanFov(40, 500, 500)).toBeCloseTo(40, 6);
    const wide = overscanFov(40, 500, 450);
    expect(wide).toBeGreaterThan(40);
    expect(Math.tan((wide * Math.PI) / 360) * (450 / 500)).toBeCloseTo(Math.tan((40 * Math.PI) / 360), 9);
  });
  it("draws four thirds lines, a centre cross and a closed safe box", () => {
    const kinds = guideLines({ x: 0, y: 0, w: 300, h: 200 }).map((l) => l.kind);
    expect(kinds.filter((k) => k === "thirds")).toHaveLength(4);
    expect(kinds.filter((k) => k === "centre")).toHaveLength(2);
    expect(kinds.filter((k) => k === "safe")).toHaveLength(4);
  });
});

describe("depth preview", () => {
  const shot = exportShot(newDoc());
  const pose = sampleShot(shot)[0]!;
  it("renders at the requested width with the shot's aspect, grey, opaque, and sees the subject and the sky", () => {
    const img = new DepthPreview().render(shot, pose, 96);
    expect(img.width).toBe(96);
    expect(img.height).toBe(Math.round((96 * shot.resolution.height) / shot.resolution.width));
    expect(img.rgba).toHaveLength(img.width * img.height * 4);
    expect(img.rgba[3]).toBe(255);
    expect(img.rgba[0]).toBe(img.rgba[1]);
    expect(img.stats.emptyFrac).toBeGreaterThan(0);
    expect(img.stats.emptyFrac).toBeLessThan(1);
    expect(img.stats.minZ).toBeGreaterThan(1);
  });
  it("reports geometry inside the near plane", () => {
    const close = { ...pose, position: [0, 0.9, 0.55] as typeof pose.position };
    const img = new DepthPreview().render(shot, close, 48);
    expect(img.stats.minZ).toBeLessThan(1);
  });
});
