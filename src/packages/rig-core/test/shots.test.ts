import { describe, expect, it } from "vitest";
import { Shot } from "@comfy-dial/contracts";
import { SHOT_TYPES, len, quatAngleDeg, resolveShotType, rotate, sampleShot, shotPreset, sub, type Vec3 } from "../src/index.ts";

const base = { id: "t", target: [0, 1, 0] as Vec3, fovDeg: 40 };
const first = (id: string) => Shot.parse(shotPreset(id, base)).track[0]!;

describe("shot type presets", () => {
  it("every id is unique and every alias resolves to a camera preset", () => {
    expect(new Set(SHOT_TYPES.map((s) => s.id)).size).toBe(SHOT_TYPES.length);
    for (const s of SHOT_TYPES.filter((t) => t.support === "alias")) expect(resolveShotType(s.id)?.support).toBe("camera");
  });
  it("camera and alias types give a contract-valid Shot; prompt-only types give null with a hint", () => {
    for (const s of SHOT_TYPES) {
      if (s.support === "prompt-only") {
        expect(shotPreset(s.id, base)).toBeNull();
        expect(s.promptHint).toBeTruthy();
      } else {
        const shot = Shot.parse(shotPreset(s.id, base));
        expect(sampleShot(shot)).toHaveLength(shot.frames);
      }
    }
  });
  it("shot sizes get closer in the order of the guide", () => {
    const order = ["extreme-wide", "wide", "full", "medium-wide", "cowboy", "medium", "medium-close-up", "close-up", "extreme-close-up"];
    const dist = order.map((id) => len(sub(first(id).position as Vec3, [0, 1, 0])));
    for (let i = 1; i < dist.length; i++) expect(dist[i]).toBeLessThan(dist[i - 1]!);
  });
  it("a close-up frames about 0.32 m of height", () => {
    const t = first("close-up");
    const span = 2 * Math.abs(t.position[2]) * Math.tan((t.fov_v_deg * Math.PI) / 360);
    expect(span).toBeCloseTo(0.32, 2);
  });
  it("low angle looks up, high angle looks down, eye level is level", () => {
    const pitch = (id: string) => rotate(first(id).quaternion as [number, number, number, number], [0, 0, -1])[1];
    expect(pitch("low-angle")).toBeGreaterThan(0.1);
    expect(pitch("high-angle")).toBeLessThan(-0.1);
    expect(Math.abs(pitch("eye-level"))).toBeLessThan(1e-6);
  });
  it("dutch angle rolls the camera about 20 degrees off eye level", () => {
    const q = (id: string) => first(id).quaternion as [number, number, number, number];
    expect(quatAngleDeg(q("dutch-angle"), q("eye-level"))).toBeCloseTo(20, 4);
  });
  it("whip pan turns 90 degrees within a few frames", () => {
    const p = sampleShot(Shot.parse(shotPreset("whip-pan", base)));
    const step = p.slice(1).map((f, i) => quatAngleDeg(f.quaternion as never, p[i]!.quaternion as never));
    expect(Math.max(...step)).toBeGreaterThan(8);
    expect(quatAngleDeg(p[0]!.quaternion as never, p.at(-1)!.quaternion as never)).toBeCloseTo(90, 4);
  });
  it("dolly zoom pushes in and widens the lens to hold the subject size, and vertigo is the same shot", () => {
    const s = Shot.parse(shotPreset("dolly-zoom", base));
    expect(s.track[1]!.fov_v_deg).toBeGreaterThan(s.track[0]!.fov_v_deg);
    expect(shotPreset("vertigo", base)).toEqual(shotPreset("dolly-zoom", base));
  });
  it("rejects an unknown id", () => {
    expect(() => shotPreset("nope", base)).toThrow(/unknown shot type/);
  });
});
