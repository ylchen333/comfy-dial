// Frozen pass gate (SPEC section 6, docs/calibration.md, frozen Oct 22) and ranking.
// Re-applied here from the raw errors in ScoreReport so ranking never depends on whichever
// provisional constants the verifier build happens to carry. FOV is reported, never gated.
import type { ScoreReport, Shot } from "@comfy-osh/contracts";

export const FROZEN_GATES = { rotDeg: 2.75, transPct: 12, zoomRatioBand: 0.1 } as const;

const cotHalf = (fovDeg: number) => 1 / Math.tan((fovDeg * Math.PI) / 360);

/** Authored focal ratio last/first. Translation is only gated when this is within 10% of 1. */
export function authoredFocalRatio(shot: Pick<Shot, "track">): number {
  const first = shot.track[0]!;
  const last = shot.track[shot.track.length - 1]!;
  return cotHalf(last.fov_v_deg) / cotHalf(first.fov_v_deg);
}

export const transGated = (shot: Pick<Shot, "track">) =>
  Math.abs(authoredFocalRatio(shot) - 1) <= FROZEN_GATES.zoomRatioBand;

type Errs = { rotErrDeg: number | null; transErrPct: number | null };
const errsPass = (e: Errs, gateTrans: boolean) =>
  e.rotErrDeg !== null &&
  e.rotErrDeg < FROZEN_GATES.rotDeg &&
  (!gateTrans || e.transErrPct === null || e.transErrPct < FROZEN_GATES.transPct);

export interface Verdict {
  pass: boolean;
  /** Indices of segments that drifted under the frozen gate (the repair targets). */
  badSegments: number[];
}

export function verdict(report: ScoreReport, shot: Pick<Shot, "track">): Verdict {
  const gt = transGated(shot);
  if (!report.solveOk) return { pass: false, badSegments: report.perSegment.map((_, i) => i) };
  return {
    pass: errsPass(report, gt),
    badSegments: report.perSegment.flatMap((s, i) => (errsPass(s, gt) ? [] : [i])),
  };
}

export interface Ranked<T> {
  rank: number;
  item: T;
}

interface Rankable {
  report: ScoreReport;
  verdict: Verdict;
}

/** Passing first, then lower composite; a failed solve is always last. Stable on ties. */
export function rankTakes<T extends Rankable>(items: T[]): Ranked<T>[] {
  const key = (t: Rankable) => [
    t.report.solveOk ? 0 : 1,
    t.verdict.pass ? 0 : 1,
    t.report.composite ?? Number.POSITIVE_INFINITY,
  ];
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const ka = key(a.item);
      const kb = key(b.item);
      for (let j = 0; j < ka.length; j++) if (ka[j]! !== kb[j]!) return ka[j]! < kb[j]! ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ item }, idx) => ({ rank: idx + 1, item }));
}

const f = (v: number | null, d = 2) => (v === null ? "-" : v.toFixed(d));

export interface TableRow extends Rankable {
  id: string;
  seed: number;
  note?: string | undefined;
}

export function formatTable(rows: Ranked<TableRow>[]): string {
  const head = ["rank", "take", "seed", "pass", "composite", "rot deg", "trans %", "fov deg*", "drift segs", "note"];
  const body = rows.map(({ rank, item: r }) => [
    String(rank),
    r.id,
    String(r.seed),
    r.report.solveOk ? (r.verdict.pass ? "PASS" : "FAIL") : "FAIL (no solve)",
    f(r.report.composite, 3),
    f(r.report.rotErrDeg),
    f(r.report.transErrPct),
    f(r.report.fovErrDeg),
    r.report.solveOk ? (r.verdict.badSegments.length ? r.verdict.badSegments.join(",") : "-") : "all",
    r.note ?? "",
  ]);
  const all = [head, ...body];
  const w = head.map((_, c) => Math.max(...all.map((row) => row[c]!.length)));
  const line = (row: string[]) => row.map((cell, c) => cell.padEnd(w[c]!)).join("  ").trimEnd();
  return [line(head), w.map((x) => "-".repeat(x)).join("  "), ...body.map(line)].join("\n");
}
