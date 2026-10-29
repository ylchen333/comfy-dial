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
