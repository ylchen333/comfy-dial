// Prompt text for the LTX graphs: defaults, and the one place user text is cleaned and bounded.
export const DEFAULT_PROMPT = "A cinematic shot of a single subject in a room, soft natural light, smooth steady camera motion.";
/** The negative text the validated graph shipped with. */
export const DEFAULT_NEGATIVE = "pc game, console game, video game, cartoon, childish, ugly";
export const MAX_PROMPT = 600;
export const MAX_NEGATIVE = 300;

/**
 * Trim, drop control characters and collapse runs of whitespace. Empty falls back to `fallback`; too long is an error
 * (never a silent cut, so what the user sees is what is sent).
 */
export function cleanPrompt(v: unknown, max: number, fallback: string, what: string): string {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "string") throw new Error(`${what} must be text`);
  // eslint-disable-next-line no-control-regex
  const t = v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return fallback;
  if (t.length > max) throw new Error(`${what} is ${t.length} characters; the limit is ${max}`);
  return t;
}
