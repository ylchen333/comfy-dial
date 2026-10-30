import { describe, expect, it } from "vitest";
import { sampleShot } from "@comfy-dial/rig-core";
import { exportShot } from "../src/logic/compile.ts";
import { newDoc } from "../src/logic/keys.ts";
import { applyPreset } from "../src/logic/presets.ts";
import { closestOnAxis, framingOf, orthoZoomFor, orthoZoomMatching, rayPlane, snapPoint, viewKey, viewName, viewPose } from "../src/logic/viewControls.ts";

describe("view controls", () => {
  const poses = sampleShot(exportShot(applyPreset(newDoc(), "orbit")));
  const f = framingOf(poses, [0, 0.9, 0]);
  it("frames the whole path and the subject", () => {
    for (const p of poses) expect(Math.hypot(...p.position.map((v, i) => v - f.center[i]!) as [number, number, number])).toBeLessThanOrEqual(f.radius + 1e-9);
    expect(Math.hypot(0 - f.center[0], 0.9 - f.center[1], 0 - f.center[2])).toBeLessThanOrEqual(f.radius + 1e-9);
    expect(framingOf([], null).radius).toBe(5);
  });
  it("top looks down at the centre, front and side look horizontally along an axis, all at the same distance", () => {
    const top = viewPose("top", f), front = viewPose("front", f), side = viewPose("side", f);
    expect(top.position[1]).toBeGreaterThan(f.center[1] + f.radius);
    expect(Math.abs(top.position[0] - f.center[0])).toBeLessThan(0.1);
    expect(front.position[2]).toBeGreaterThan(f.center[2] + f.radius);
    expect(side.position[0]).toBeGreaterThan(f.center[0] + f.radius);
    expect(top.target).toEqual(f.center);
    const dist = (v: { position: [number, number, number] }) => Math.hypot(...v.position.map((x, i) => x - f.center[i]!) as [number, number, number]);
    expect(dist(top)).toBeCloseTo(dist(front), 6);
  });
  it("frame keeps the current viewing direction", () => {
    const v = viewPose("frame", f, [0, 0, 2]);
    expect(v.position[0]).toBeCloseTo(f.center[0], 6);
    expect(v.position[2]).toBeGreaterThan(f.center[2]);
  });
  it("snaps to a 0.25 m grid and never below the ground, only when on", () => {
    expect(snapPoint([0.13, -0.4, 1.87], { on: true })).toEqual([0.25, 0, 1.75]);
    expect(snapPoint([0.13, -0.4, 1.87], { on: false })).toEqual([0.13, -0.4, 1.87]);
    expect(snapPoint([0.6, 1.1, 0.1], { on: true, step: 0.5 })).toEqual([0.5, 1, 0]);
  });

  it("back, left and bottom mirror front, right and top", () => {
    const f2 = framingOf(poses, [0, 0.9, 0]);
    expect(viewPose("back", f2).position[2]).toBeLessThan(f2.center[2] - f2.radius);
    expect(viewPose("left", f2).position[0]).toBeLessThan(f2.center[0] - f2.radius);
    expect(viewPose("bottom", f2).position[1]).toBeLessThan(f2.center[1] - f2.radius);
  });
  it("the standard views look exactly down their axis, so the viewport can name them Front, Top ...", () => {
    const f3 = framingOf(poses, [0, 0.9, 0]);
    for (const [view, want] of [["front", "Front"], ["back", "Back"], ["side", "Right"], ["left", "Left"], ["top", "Top"], ["bottom", "Bottom"]] as const) {
      const v = viewPose(view, f3);
      const dir = v.target.map((t, i) => t - v.position[i]!) as [number, number, number];
      expect(viewName(dir), view).toBe(want);
    }
  });
  it("names a view by the axis it looks down, like Blender's viewport text, and 'User' otherwise", () => {
    expect(viewName([0, 0, -1])).toBe("Front");
    expect(viewName([0, -1, 0.001])).toBe("Top");
    expect(viewName([-1, 0, 0])).toBe("Right");
    expect(viewName([0, 0, 1])).toBe("Back");
    expect(viewName([0.4, -0.3, -0.8])).toBe("User");
    expect(viewName([0.05, 0, -1])).toBe("User"); // 2.9 degrees off
  });
  it("maps keys the Blender way: 1/3/7 views, Shift for the far side, 5 ortho, 0 camera, Home view all; never with Alt/Ctrl/Cmd", () => {
    const e = (code: string, o = {}) => viewKey({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...o });
    expect(e("Digit1")).toEqual({ view: "front" });
    expect(e("Numpad1", { shiftKey: true })).toEqual({ view: "back" });
    expect(e("Digit3")).toEqual({ view: "side" });
    expect(e("Digit7", { shiftKey: true })).toEqual({ view: "bottom" });
    expect(e("Digit5")).toEqual({ ortho: true });
    expect(e("Digit0")).toEqual({ camera: true });
    expect(e("Home")).toEqual({ all: true });
    expect(e("NumpadDecimal")).toEqual({ selected: true });
    expect(e("Digit1", { altKey: true })).toBeNull();
    expect(e("Digit1", { ctrlKey: true })).toBeNull();
    expect(e("KeyA")).toBeNull();
  });
  it("orthographic zoom: a fit for the framing sphere, and a match for a perspective view at a distance", () => {
    expect(orthoZoomFor(5, 500)).toBeCloseTo(500 / (2 * 5 * 1.15), 9);
    // a 40 degree view at 10 m spans 2*10*tan(20deg) metres; the ortho camera must show the same span
    const z = orthoZoomMatching(40, 10, 600);
    expect(600 / z).toBeCloseTo(2 * 10 * Math.tan((20 * Math.PI) / 180), 9);
  });
  it("G constraints: the axis point is the closest point on the axis to the mouse ray; the free move stays on a plane", () => {
    // ray from (0,0,10) straight down -Z; X axis through the origin: closest point is (0,0,0)
    expect(closestOnAxis([0, 0, 10], [0, 0, -1], [0, 0, 0], [1, 0, 0])).toEqual([0, 0, 0]);
    // ray from (3,5,10) looking at (3,5,0): the closest point on the X axis is x = 3
    const p = closestOnAxis([3, 5, 10], [0, 0, -1], [0, 0, 0], [1, 0, 0]);
    expect(p[0]).toBeCloseTo(3, 9); expect(p[1]).toBeCloseTo(0, 9); expect(p[2]).toBeCloseTo(0, 9);
    const hit = rayPlane([3, 5, 10], [0, 0, -1], [0, 0, 2], [0, 0, 1])!;
    expect(hit).toEqual([3, 5, 2]);
    expect(rayPlane([0, 0, 10], [1, 0, 0], [0, 0, 0], [0, 0, 1])).toBeNull();
  });
});
