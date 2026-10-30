import { describe, expect, it } from "vitest";
import { cameraWords, MAX_NEGATIVE, MAX_PROMPT, PROMPT_EXAMPLES, promptProblem } from "../src/logic/prompts.ts";

describe("prompt helpers", () => {
  it("flags camera-move words once each, and only whole words", () => {
    expect(cameraWords("A slow dolly-in, then a Pan and another pan, handheld")).toEqual(["dolly", "pan", "handheld"]);
    expect(cameraWords("A woman in a red coat walks past a panel and a canvas")).toEqual([]);
    expect(cameraWords("")).toEqual([]);
  });
  it("none of the bundled examples tells the camera what to do, and all fit the limit", () => {
    for (const e of PROMPT_EXAMPLES) {
      expect(cameraWords(e.text), e.label).toEqual([]);
      expect(e.text.length, e.label).toBeLessThanOrEqual(MAX_PROMPT);
    }
    expect(PROMPT_EXAMPLES.length).toBeGreaterThanOrEqual(4);
  });
  it("reports over-long text, and accepts empty (the server then uses its default)", () => {
    expect(promptProblem("", "")).toBeNull();
    expect(promptProblem("x".repeat(MAX_PROMPT + 1), "")).toMatch(/limit is 600/);
    expect(promptProblem("ok", "y".repeat(MAX_NEGATIVE + 1))).toMatch(/limit is 300/);
    expect(promptProblem(" ".repeat(900), "")).toBeNull();
  });
});

import { DEFAULT_PROMPT, DEMO_PROMPT, MAX_PROMPT as MAXP, PROMPT_EXAMPLES as EX, cameraWords as cw } from "../src/logic/prompts.ts";
describe("demo prompt", () => {
  it("fits the limit, has no camera words, is the default and the first example", () => {
    expect(DEMO_PROMPT.length).toBeLessThanOrEqual(MAXP);
    expect(cw(DEMO_PROMPT)).toEqual([]);
    expect(DEFAULT_PROMPT).toBe(DEMO_PROMPT);
    expect(EX[0]!.text).toBe(DEMO_PROMPT);
  });
});

import { HERO_PROMPT } from "../src/logic/prompts.ts";
describe("demo prompts", () => {
  it("both Huangshan prompts fit, avoid camera words, and the baby prompt is the default", () => {
    for (const t of [DEMO_PROMPT, HERO_PROMPT]) { expect(t.length).toBeLessThanOrEqual(MAXP); expect(cw(t)).toEqual([]); }
    expect(DEMO_PROMPT).toMatch(/baby/i);
    expect(EX[1]!.text).toBe(HERO_PROMPT);
  });
});
