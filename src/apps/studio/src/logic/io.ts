// Shot JSON import/export, validated with the contract's zod schemas. Errors are human-readable lines.
import { Poses, Shot } from "@comfy-osh/contracts";
import type { Vec3 } from "@comfy-osh/rig-core";
import { docFromShot, exportShot } from "./compile.ts";
import type { StudioDoc } from "./types.ts";

interface IssueLike { path: PropertyKey[]; message: string }

export function formatIssues(issues: readonly IssueLike[]): string[] {
  return issues.map((i) => `${i.path.length ? i.path.map(String).join(".") : "(root)"}: ${i.message}`);
}

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Validate a doc by compiling it and running the zod Shot. */
export function validateDoc(doc: StudioDoc): Validated<Shot> {
  const r = Shot.safeParse(exportShot(doc));
  return r.success ? { ok: true, value: r.data } : { ok: false, errors: formatIssues(r.error.issues) };
}

export function exportShotJson(doc: StudioDoc): Validated<string> {
  const v = validateDoc(doc);
  return v.ok ? { ok: true, value: JSON.stringify(v.value, null, 2) } : v;
}

export function importShotJson(text: string, base?: Pick<StudioDoc, "sensorHeightMm">): Validated<StudioDoc> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${(e as Error).message}`] };
  }
  const r = Shot.safeParse(raw);
  if (!r.success) return { ok: false, errors: formatIssues(r.error.issues) };
  return { ok: true, value: docFromShot(r.data, base) };
}

/** Recovered poses (verifier output) as a polyline, for the second path overlay. */
export function parsePosesJson(text: string): Validated<Vec3[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${(e as Error).message}`] };
  }
  const r = Poses.safeParse(raw);
  if (!r.success) return { ok: false, errors: formatIssues(r.error.issues) };
  if (!r.data.solve_ok) return { ok: false, errors: ["solve_ok is false: no recovered path to draw"] };
  return { ok: true, value: r.data.frames.map((f) => [...f.position] as Vec3) };
}



/** Recovered poses as a validated document (the studio aligns them to the authored path before drawing). */
export function parsePosesDoc(text: string): Validated<Poses> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`not valid JSON: ${(e as Error).message}`] };
  }
  const r = Poses.safeParse(raw);
  if (!r.success) return { ok: false, errors: formatIssues(r.error.issues) };
  if (!r.data.solve_ok) return { ok: false, errors: ["solve_ok is false: no recovered path to draw"] };
  return { ok: true, value: r.data };
}
