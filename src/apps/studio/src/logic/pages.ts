// The three workspaces, in the order the work happens (the way a colour or edit suite splits its pages).
export type Page = "author" | "generate" | "review";
export const PAGES: readonly { id: Page; label: string; hint: string }[] = [
  { id: "author", label: "Author", hint: "Draw the camera move" },
  { id: "generate", label: "Generate", hint: "Make takes and spend credits" },
  { id: "review", label: "Review", hint: "Compare each take with the move" },
];

/** `#review` -> "review"; anything else is the first page. */
export const pageFromHash = (hash: string): Page => PAGES.find((p) => `#${p.id}` === hash)?.id ?? "author";
export const hashFor = (page: Page): string => `#${page}`;

/** Alt+1/2/3 (by physical key, since Alt changes the character on macOS). */
export const pageFromShortcut = (e: { code: string; altKey: boolean; metaKey: boolean; ctrlKey: boolean }): Page | null => {
  if (!e.altKey || e.metaKey || e.ctrlKey) return null;
  const i = ["Digit1", "Digit2", "Digit3"].indexOf(e.code);
  return i < 0 ? null : PAGES[i]!.id;
};

/** The page the work moves to next, or null after the last one. */
export const nextPage = (page: Page): Page | null => PAGES[PAGES.findIndex((p) => p.id === page) + 1]?.id ?? null;

/** True while focus is in something you type into, so single-key shortcuts (Space, G, L...) must not fire. */
export const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) || el.isContentEditable === true);
};
