import { describe, expect, it } from "vitest";
import { resolveTarget } from "../src/cli-client.ts";
import { authoredFocalRatio, transGated } from "../src/rank.ts";
import { estimateCredits, liveRefusal } from "../src/safety.ts";
import { loadShot } from "./helpers.ts";

describe("live safety", () => {
  it("refuses n > 4, missing key, and n < 1", () => {
    expect(liveRefusal(6, "k")).toMatch(/exceeds the cap of 5/);
    expect(liveRefusal(1, undefined)).toMatch(/COMFY_API_KEY/);
    expect(liveRefusal(0, "k")).toMatch(/positive integer/);
  });
  it("allows n=1..4 and estimates cost", () => {
    expect(liveRefusal(1, "k")).toBeNull();
    expect(liveRefusal(4, "k")).toBeNull();
    expect(estimateCredits(4)).toBe(28);
  });
});

describe("runtime target", () => {
  it("empty or comfy.org means cloud, other URLs mean local host:port", () => {
    expect(resolveTarget(undefined)).toEqual(["--where", "cloud"]);
    expect(resolveTarget("https://cloud.comfy.org")).toEqual(["--where", "cloud"]);
    expect(resolveTarget("http://127.0.0.1:8000")).toEqual(["--where", "local", "--host", "127.0.0.1", "--port", "8000"]);
  });
});

describe("frozen gate scope", () => {
  it("gates translation on push-in, not on dolly zoom", () => {
    expect(transGated(loadShot("push_in"))).toBe(true);
    expect(transGated(loadShot("dolly_zoom"))).toBe(false);
    expect(authoredFocalRatio(loadShot("zoom_only"))).toBeGreaterThan(1.1);
  });
});
