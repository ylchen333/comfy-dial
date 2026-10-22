import { describe, expect, it } from "vitest";
import { moveCheck } from "../src/rank.ts";

describe("move class (advisory)", () => {
  const shot = { track: [{ t: 0, position: [0, 0, 0], quaternion: [0, 0, 0, 1], fov_v_deg: 24.89 }, { t: 4.8, position: [0, 0, 0], quaternion: [0, 0, 0, 1], fov_v_deg: 40.39 }] } as never;
  const mk = (a: number, b: number) => ({ solve_ok: true, frames: [{ fov_v_deg: a }, { fov_v_deg: b }] });
  it("matches when the recovered focal change has the authored direction", () => {
    expect(moveCheck(shot, mk(30, 40))).toMatchObject({ authored: "out", recovered: "out", match: true });
  });
  it("flags a take that did not change focal length", () => {
    expect(moveCheck(shot, mk(30, 30.2))).toMatchObject({ authored: "out", recovered: "none", match: false });
  });
  it("is undefined without a solve", () => {
    expect(moveCheck(shot, { solve_ok: false, frames: [] })).toBeUndefined();
  });
});
