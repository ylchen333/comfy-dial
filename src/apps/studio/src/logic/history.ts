// Undo / redo over immutable StudioDoc snapshots.
import type { StudioDoc } from "./types.ts";

export interface History {
  past: StudioDoc[];
  present: StudioDoc;
  future: StudioDoc[];
}

const LIMIT = 200;

export const createHistory = (doc: StudioDoc): History => ({ past: [], present: doc, future: [] });

export function commit(h: History, doc: StudioDoc): History {
  if (doc === h.present) return h;
  return { past: [...h.past, h.present].slice(-LIMIT), present: doc, future: [] };
}

export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  const next = h.future[0];
  if (!next) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}
