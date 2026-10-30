import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Shot } from "@comfy-dial/contracts";
import {
  DEFAULT_DEPTH_NORM, FIXTURE_CLIPS, denormalizeDepth, dolly, dollyZoom, focalMmToVFovDeg, focalPxToVFovDeg,
  len, lookAtQuat, ltxClips, normalizeDepth, orbit, pan, pullOut, pushIn, quatAngleDeg, renderFrame,
  rotate, sampleShot, slerp, sub, vFovDegToFocalMm, vFovDegToFocalPx, vFovToHFovDeg, yawQuat, zoom,
  type Vec3,
} from "../src/index.ts";

const fixture = (n: string) =>
  Shot.parse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../contracts/fixtures/shots/${n}.json`, import.meta.url)), "utf8")));

describe("focal length <-> vertical FOV", () => {
  it("round-trips mm and px", () => {
    for (const mm of [14, 24, 35, 50, 85, 200]) expect(vFovDegToFocalMm(focalMmToVFovDeg(mm))).toBeCloseTo(mm, 9);
    for (const px of [400, 1160, 3000]) expect(vFovDegToFocalPx(focalPxToVFovDeg(px, 512), 512)).toBeCloseTo(px, 9);
  });
  it("matches known values (24 mm sensor height)", () => {
    expect(focalMmToVFovDeg(24)).toBeCloseTo(53.130102, 5); // 2*atan(0.5)
    expect(focalMmToVFovDeg(12)).toBeCloseTo(90, 9);
    expect(vFovDegToFocalMm(60, 24)).toBeCloseTo(20.7846, 4);
    expect(vFovToHFovDeg(40, 768, 512)).toBeCloseTo(2 * Math.atan(Math.tan((40 * Math.PI) / 360) * 1.5) * (180 / Math.PI), 9);
  });
  it("LTX guide: f=1160 px at 512 px high is ~24.9 deg", () => {
    expect(focalPxToVFovDeg(1160, 512)).toBeCloseTo(24.9, 1);
  });
});

describe("camera math", () => {
  it("lookAt: camera looks down -Z toward the target", () => {
    const eye: Vec3 = [3, 2, 5];
    const target: Vec3 = [0, 1, 0];
    const fwd = rotate(lookAtQuat(eye, target), [0, 0, -1]);
    const want = sub(target, eye);
    const n = len(want);
    fwd.forEach((c, i) => expect(c).toBeCloseTo(want[i]! / n, 9));
  });
  it("positive yaw pans left (-Z -> -X)", () => {
    const f = rotate(yawQuat(30), [0, 0, -1]);
    expect(f[0]).toBeCloseTo(-0.5, 9);
    expect(f[2]).toBeCloseTo(-Math.cos(Math.PI / 6), 9);
  });
  it("slerp midpoint is half the angle", () => {
    const m = slerp(yawQuat(0), yawQuat(60), 0.5);
    expect(quatAngleDeg(m, yawQuat(30))).toBeLessThan(1e-6);
  });
});

describe("presets compile to contract-valid Shots", () => {
  const o = { frames: 121 };
  const shots = {
    pushIn: pushIn({ id: "a", from: 6, to: 3, fovDeg: 40, ...o }),
    pullOut: pullOut({ id: "b", from: 6, to: 3, fovDeg: 40, ...o }),
    orbit: orbit({ id: "c", radius: 5, startDeg: 0, endDeg: 90, fovDeg: 40, ...o }),
    pan: pan({ id: "d", distance: 5, yawDeg: 30, fovDeg: 40, ...o }),
    dollyZoom: dollyZoom({ id: "e", from: 8, to: 4, fovDeg: 25, ...o }),
    zoom: zoom({ id: "f", distance: 5, fromFovDeg: 50, toFovDeg: 25, ...o }),
  };
  for (const [name, s] of Object.entries(shots)) {
    it(`${name} parses (frames = 1+8k, unit quats, contiguous segments)`, () => {
      expect(() => Shot.parse(s)).not.toThrow();
      expect((s.frames - 1) % 8).toBe(0);
    });
  }
  it("pull-out is push-in reversed", () => {
    const a = sampleShot(shots.pushIn), b = sampleShot(shots.pullOut);
    expect(b[0]!.position[2]).toBeCloseTo(a[120]!.position[2], 9);
    expect(b[120]!.position[2]).toBeCloseTo(a[0]!.position[2], 9);
  });
  it("orbit stays on the circle (dense keys)", () => {
    for (const p of sampleShot(shots.orbit)) expect(Math.hypot(p.position[0], p.position[2])).toBeGreaterThan(4.95);
  });
});

describe("sampler", () => {
  const fx = fixture("dolly_zoom");
  it("frames 0..N-1 at 25 fps, held outside range, endpoints exact", () => {
    const p = sampleShot(fx);
    expect(p).toHaveLength(121);
    expect(p[1]!.t).toBeCloseTo(0.04, 12);
    expect(p[0]!.position).toEqual(fx.track[0]!.position);
    expect(p[120]!.fov_v_deg).toBeCloseTo(fx.track[fx.track.length - 1]!.fov_v_deg, 6);
  });
  it("is deterministic (bitwise identical across runs and independent of input copy)", () => {
    const a = JSON.stringify(sampleShot(fx));
    const b = JSON.stringify(sampleShot(structuredClone(fx)));
    expect(a).toBe(b);
    for (const n of FIXTURE_CLIPS) expect(JSON.stringify(sampleShot(fixture(n)))).toBe(JSON.stringify(sampleShot(fixture(n))));
  });
  it("dolly zoom keeps d * tan(fov/2) constant on every frame", () => {
    for (const p of sampleShot(fx)) {
      const d = p.position[2]; // subject at z=0, camera on the Z axis
      expect(d * Math.tan((p.fov_v_deg * Math.PI) / 360)).toBeCloseTo(8 * Math.tan((25 * Math.PI) / 360), 5);
    }
  });
  it("preset dolly zoom reproduces the fixture", () => {
    const s = dollyZoom({ id: "x", from: 8, to: 4, fovDeg: 25 });
    sampleShot(s).forEach((p, i) => {
      const q = sampleShot(fx)[i]!;
      expect(p.position[2]).toBeCloseTo(q.position[2], 6);
      expect(p.fov_v_deg).toBeCloseTo(q.fov_v_deg, 4);
    });
  });
  it("LTX-matched clips: same path, only focal differs; person height constant vs ~1.67x", () => {
    const { dolly_zoom_5to3: dz, dolly_5to3: dl } = ltxClips();
    const a = sampleShot(dz), b = sampleShot(dl);
    a.forEach((p, i) => expect(p.position).toEqual(b[i]!.position));
    const size = (p: { position: Vec3; fov_v_deg: number }) => 1 / (p.position[2] * Math.tan((p.fov_v_deg * Math.PI) / 360));
    expect(size(a[120]!) / size(a[0]!)).toBeCloseTo(1, 6);
    expect(size(b[120]!) / size(b[0]!)).toBeCloseTo(5 / 3, 6);
    expect(a[0]!.fov_v_deg).toBeCloseTo(24.9, 1);
    expect(dolly({ id: "y", from: 5, to: 3, fovDeg: 24.9 }).track).toHaveLength(2);
  });
});

describe("depth normalization is fixed, not per-frame", () => {
  it("round-trips and is monotonic", () => {
    for (const z of [1, 2, 5, 33, 100]) expect(denormalizeDepth(normalizeDepth(z))).toBeCloseTo(z, 9);
    expect(normalizeDepth(1)).toBe(1);
    expect(normalizeDepth(100)).toBe(0);
    expect(normalizeDepth(3)).toBeGreaterThan(normalizeDepth(5));
  });
  const small = { width: 96, height: 64 };
  const scene = fixture("push_in").scene;
  const frameAt = (z: number) =>
    renderFrame({ scene, resolution: small }, { position: [0, 1.6, z], quaternion: lookAtQuat([0, 1.6, z], [0, 1, 0]), fov_v_deg: 40 });
  it("same surface gets a different value when the camera moves", () => {
    const centre = (f: ReturnType<typeof frameAt>) => f.depth8[32 * 96 + 48]!;
    const far = centre(frameAt(6)), near = centre(frameAt(3));
    expect(near).toBeGreaterThan(far);
    expect(Math.abs(denormalizeDepth(far / 255) - 5.0)).toBeLessThan(1.0); // subject front face ~ 5.5 m
  });
  it("sky is exactly far (0) and the image has both sky and geometry", () => {
    const f = frameAt(6);
    expect(Math.min(...f.depth8)).toBe(0);
    expect(Math.max(...f.depth8)).toBeGreaterThan(0);
  });
  it("dolly vs dolly zoom differ in depth (fixed norm preserves the cue)", () => {
    const { dolly_zoom_5to3: dz, dolly_5to3: dl } = ltxClips();
    const last = (s: Shot) => renderFrame({ scene: s.scene, resolution: small }, sampleShot(s)[120]!);
    const a = last(dz), b = last(dl);
    let diff = 0;
    for (let i = 0; i < a.depth8.length; i++) diff += Math.abs(a.depth8[i]! - b.depth8[i]!);
    expect(diff / a.depth8.length).toBeGreaterThan(1);
  });
  it("default norm is near 1 / far 100", () => {
    expect(DEFAULT_DEPTH_NORM).toMatchObject({ mode: "fixed", near: 1, far: 100 });
  });
});
