import { describe, expect, it } from "vitest";
import { driftFrame, frameAtTime, frameAtX, niceTicks, videoTimeFor, ROT_GATE_DEG } from "../src/logic/review.ts";

const s = (...deg: number[]) => deg.map((d, i) => ({ frame: i * 4, deg: d }));

describe("review logic", () => {
  it("drift is where the error goes over the gate and stays there, not a single spike", () => {
    expect(driftFrame(s(0.2, 0.5, 4, 0.8, 1, 3, 4, 5))).toBe(20);
    expect(driftFrame(s(0.2, 0.5, 4, 0.8))).toBeNull();
    expect(driftFrame([])).toBeNull();
    expect(ROT_GATE_DEG).toBe(2.75);
  });
  it("ticks start at 0, step evenly in 1/2/5, and top out above the data", () => {
    expect(niceTicks(3.2)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(11.84)).toEqual([0, 5, 10, 15]);
    expect(niceTicks(0.8)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    for (const m of [0.4, 2.75, 5.9, 12.1]) expect(niceTicks(m).at(-1)!).toBeGreaterThan(m);
  });
  it("maps pointer x to a clamped frame and frames to mid-slot video times", () => {
    expect(frameAtX(0, 0, 100, 121)).toBe(0);
    expect(frameAtX(50, 0, 100, 121)).toBe(60);
    expect(frameAtX(500, 0, 100, 121)).toBe(120);
    expect(frameAtX(-5, 0, 100, 121)).toBe(0);
    expect(frameAtTime(videoTimeFor(37, 25), 25, 121)).toBe(37);
    expect(frameAtTime(99, 25, 121)).toBe(120);
  });
});

import { upscaledSize } from "../src/logic/runs.ts";
describe("upscaledSize", () => {
  it("scales the shot's size to the target height, keeping the aspect ratio", () => {
    expect(upscaledSize({ width: 768, height: 512 }, 1024)).toBe("1536x1024");
    expect(upscaledSize({ width: 1120, height: 480 }, 960)).toBe("2240x960");
  });
});
