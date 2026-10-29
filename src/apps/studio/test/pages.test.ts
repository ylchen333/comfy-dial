import { describe, expect, it } from "vitest";
import { hashFor, nextPage, pageFromHash, pageFromShortcut, PAGES } from "../src/logic/pages.ts";

describe("pages", () => {
  it("round-trips hashes and falls back to Author", () => {
    for (const p of PAGES) expect(pageFromHash(hashFor(p.id))).toBe(p.id);
    expect(pageFromHash("")).toBe("author");
    expect(pageFromHash("#nope")).toBe("author");
  });
  it("Alt+1/2/3 switch pages by physical key; other modifiers do not", () => {
    const e = (code: string, o = {}) => ({ code, altKey: true, metaKey: false, ctrlKey: false, ...o });
    expect(pageFromShortcut(e("Digit1"))).toBe("author");
    expect(pageFromShortcut(e("Digit3"))).toBe("review");
    expect(pageFromShortcut(e("Digit4"))).toBeNull();
    expect(pageFromShortcut(e("Digit1", { altKey: false }))).toBeNull();
    expect(pageFromShortcut(e("Digit1", { metaKey: true }))).toBeNull();
  });
  it("the flow runs Author, Generate, Review and stops", () => {
    expect(nextPage("author")).toBe("generate");
    expect(nextPage("generate")).toBe("review");
    expect(nextPage("review")).toBeNull();
  });
});

import { isTyping } from "../src/logic/pages.ts";
describe("isTyping", () => {
  const el = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;
  it("is true in inputs, selects, textareas and editable regions, false elsewhere", () => {
    for (const t of ["INPUT", "SELECT", "TEXTAREA"]) expect(isTyping(el(t))).toBe(true);
    expect(isTyping(el("DIV", true))).toBe(true);
    expect(isTyping(el("BUTTON"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
