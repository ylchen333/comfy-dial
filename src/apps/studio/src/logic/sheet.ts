// Contact-sheet logic: what each take tile shows, derived from the server's TakeView (no UI here).
import type { TakeView } from "./runs.ts";

export type SegState = "ok" | "drift" | "unsolved";

/** One cell per Shot segment: drifted, held, or "unsolved" when the pose solve failed (never shown as held). */
export function segmentStates(t: Pick<TakeView, "solveOk" | "badSegments">, count: number): SegState[] {
  return Array.from({ length: count }, (_, i) => (!t.solveOk ? "unsolved" : t.badSegments.includes(i) ? "drift" : "ok"));
}

export type Verdict = "PASS" | "FAIL" | "NO SOLVE";
export const verdictOf = (t: Pick<TakeView, "solveOk" | "pass">): Verdict => (!t.solveOk ? "NO SOLVE" : t.pass ? "PASS" : "FAIL");

const deg = (v: number | null) => (v === null ? "-" : `${v.toFixed(1)}°`);
const pct = (v: number | null) => (v === null ? "-" : `${v.toFixed(1)}%`);

/** "rot 0.9° · trans 2.1%" (or the failure note when there are no numbers). */
export function metricsLine(t: Pick<TakeView, "solveOk" | "rotDeg" | "transPct" | "note">): string {
  if (!t.solveOk) return t.note ?? "no pose solve";
  return `rot ${deg(t.rotDeg)} · trans ${pct(t.transPct)}`;
}

/** The claim the product makes, in one line: "3 of 4 takes held the move; 1 drifted in segment 3". */
export function sheetSummary(takes: readonly TakeView[]): string {
  if (takes.length === 0) return "";
  const held = takes.filter((t) => t.solveOk && t.pass).length;
  const unsolved = takes.filter((t) => !t.solveOk).length;
  const drifted = takes.filter((t) => t.solveOk && !t.pass);
  const parts = [`${held} of ${takes.length} takes held the move`];
  if (drifted.length) {
    const segs = [...new Set(drifted.flatMap((t) => t.badSegments))].sort((a, b) => a - b).map((s) => s + 1);
    parts.push(`${drifted.length} drifted${segs.length ? ` (segment ${segs.join(", ")})` : ""}`);
  }
  if (unsolved) parts.push(`${unsolved} could not be measured`);
  return parts.join("; ");
}

/** The segment a repair button would regenerate, or null when the take cannot be repaired (unsolved, clean, or already repaired). */
export const repairTarget = (t: Pick<TakeView, "solveOk" | "badSegments" | "repair" | "hasVideo">, live: boolean): number | null =>
  t.solveOk && !t.repair && t.badSegments.length > 0 && (t.hasVideo || !live) ? t.badSegments[0]! : null;

/** "segment 3 regenerated: 3.1° → 2.5°, now holds" (or "still drifts"). */
export function repairLine(t: Pick<TakeView, "repair" | "segments">): string | null {
  const r = t.repair;
  if (!r) return null;
  const was = r.before.segments[r.segment]?.rotDeg ?? null;
  const now = t.segments[r.segment]?.rotDeg ?? null;
  return `segment ${r.segment + 1} regenerated: ${deg(was)} → ${deg(now)}, ${r.improved ? "now holds" : "still drifts"}`;
}
