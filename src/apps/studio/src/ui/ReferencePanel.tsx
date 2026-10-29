import { useEffect, useMemo, useRef, useState } from "react";
import { applyReference, keysFromReference, type RefKeys } from "../logic/fromReference.ts";
import { getHealth, recoverReference, type Health, type ReferenceSolve } from "../logic/runs.ts";
import type { StudioDoc } from "../logic/types.ts";

interface Props {
  doc: StudioDoc;
  /** Replace the move; the caller commits it so Undo brings the old one back. */
  onApply: (doc: StudioDoc) => void;
}

const MAX_MB = 60;

/** Copy the camera move of a video you have: recover it, state the travel in metres, apply it as editable keys. */
export function ReferencePanel({ doc, onApply }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [solve, setSolve] = useState<ReferenceSolve | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [travel, setTravel] = useState(3);
  const [zoom, setZoom] = useState<"keep" | "ratio">("keep");
  const pick = useRef<HTMLInputElement>(null);
  useEffect(() => { getHealth().then(setHealth).catch(() => setHealth(null)); }, []);

  // Recomputed as the travel or zoom option changes, so the summary is always for what Apply would do.
  const keys = useMemo(() => (solve ? keysFromReference(solve.poses, doc, { travelM: travel, zoom }) : null), [solve, doc, travel, zoom]);
  const cloud = health?.cloud ?? true;

  const run = () => {
    if (!file || busy) return;
    if (cloud && !armed) return setArmed(true);
    setArmed(false);
    setBusy(true);
    setError(null);
    setApplied(false);
    setSolve(null);
    recoverReference(file, cloud ? health?.referenceCredits : undefined)
      .then(setSolve)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  const summary = keys?.ok ? keys.value.summary : null;

  return (
    <section>
      <h3>Match a camera from a video</h3>
      <input
        ref={pick} type="file" accept="video/*" hidden
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setSolve(null); setApplied(false); setArmed(false);
          if (f && f.size > MAX_MB * 1024 * 1024) { setFile(null); setError(`that file is ${(f.size / 1048576).toFixed(0)} MB; the limit is ${MAX_MB} MB`); return; }
          setError(null); setFile(f);
        }}
      />
      <div className="row">
        <button type="button" className="grow" onClick={() => pick.current?.click()}>{file ? "Change video" : "Choose video..."}</button>
      </div>
      {file && <p className="hint mono">{file.name} · {(file.size / 1048576).toFixed(1)} MB</p>}
      <label>
        Camera travel (m)
        <input type="number" min={0} step={0.5} value={travel} onChange={(e) => setTravel(Math.max(0, Number(e.target.value)))} />
      </label>
      <label>
        Zoom
        <select value={zoom} onChange={(e) => setZoom(e.target.value as "keep" | "ratio")}>
          <option value="keep">Keep my focal length</option>
          <option value="ratio">Follow the zoom (change only)</option>
        </select>
      </label>
      <button type="button" disabled={!file || busy || !health} onClick={run} onBlur={() => setArmed(false)}>
        {busy ? "Solving the camera..." : armed ? `Confirm: about ${health?.referenceCredits ?? 9} credits` : cloud ? "Recover camera (uses credits)" : "Recover camera"}
      </button>
      {error && <p className="hint err">{error}</p>}
      {solve && keys && !keys.ok && <p className="hint err">{keys.error}</p>}
      {summary && keys?.ok && (
        <>
          <p className="hint">
            Solved {summary.solvedFrames} frames over {summary.durationSec.toFixed(1)} s, turning up to {summary.maxTurnDeg.toFixed(0)}°. Becomes {summary.keys.position} position, {summary.keys.aim} aim and {summary.keys.focal} focal key{summary.keys.focal === 1 ? "" : "s"}.
          </p>
          <div className="row">
            <button type="button" className="grow" disabled={applied} onClick={() => { onApply(applyReference(doc, keys.value as RefKeys)); setApplied(true); }}>{applied ? "Applied (Undo restores)" : "Apply to shot"}</button>
            <button type="button" onClick={() => { setSolve(null); setApplied(false); }}>Discard</button>
          </div>
        </>
      )}
      <p className="hint">One video can't tell us the scale, so you set the travel. Its zoom is unreliable, so your focal length stays by default. Use footage you made or may use.</p>
    </section>
  );
}
