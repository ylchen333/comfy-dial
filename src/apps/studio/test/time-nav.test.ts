import { describe, expect, it } from "vitest";
import { jumpKey, keyFrames } from "../src/logic/timeNav.ts";

const k = (frame: number) => ({ frame, value: 0, easing: "linear" as const });

describe("timeline navigation", () => {
  const doc = { position: [k(0), k(40)], aim: [k(0), k(40), k(80)], focal: [k(120)] } as unknown as Parameters<typeof keyFrames>[0];
  it("collects the key frames of every channel, sorted and unique", () => {
    expect(keyFrames(doc)).toEqual([0, 40, 80, 120]);
  });
  it("jumps to the next and previous key, and stays put at the ends", () => {
    const f = keyFrames(doc);
    expect(jumpKey(f, 0, 1)).toBe(40);
    expect(jumpKey(f, 41, 1)).toBe(80);
    expect(jumpKey(f, 80, -1)).toBe(40);
    expect(jumpKey(f, 120, 1)).toBe(120);
    expect(jumpKey(f, 0, -1)).toBe(0);
  });
});
