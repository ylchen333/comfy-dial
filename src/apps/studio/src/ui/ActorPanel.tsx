import { useEffect, useRef, useState } from "react";
import { generateActor, getHealth, type Health } from "../logic/runs.ts";

interface Props {
  /** Called with the new asset name so the caller can make it the subject and refresh its list. */
  onMade: (asset: string) => void;
}

const MAX_MB = 12;

/** Optional: make the subject from a description or a photo (image, then Hunyuan3D shape). Local only, never saved into the repo. */
export function ActorPanel({ onMade }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [turn, setTurn] = useState("0"); // text, so it can be emptied and "-" can be typed on the way to -90
  const turnDeg = turn.trim() === "" || turn.trim() === "-" ? 0 : Number(turn);
  const turnBad = !Number.isFinite(turnDeg) || Math.abs(turnDeg) > 360;
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  useEffect(() => { getHealth().then(setHealth).catch(() => setHealth(null)); }, []);
  const cloud = health?.cloud ?? true;
  const ready = (Boolean(photo) || text.trim().length > 0) && !turnBad;

  const run = () => {
    if (!ready || busy || !health) return;
    if (cloud && !armed) return setArmed(true);
    setArmed(false); setBusy(true); setError(null); setNote(null);
    generateActor({ ...(photo ? { photo } : { description: text.trim() }), turnDeg, ...(cloud ? { confirmCredits: health.actorCredits } : {}) })
      .then((r) => { setNote(`${r.triangles.toLocaleString()} triangles${r.report.notes.length ? `; ${r.report.notes.join("; ")}` : ""}. Set as the subject.`); onMade(r.asset); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <details className="actor-gen">
      <summary>Generate an actor (optional)</summary>
      <label>
        Describe the person
        <textarea rows={2} maxLength={200} value={text} disabled={Boolean(photo)} placeholder="a woman in a long red coat" onChange={(e) => { setText(e.target.value); setArmed(false); }} />
      </label>
      <input ref={pick} type="file" accept="image/png,image/jpeg" hidden onChange={(e) => {
        const f = e.target.files?.[0] ?? null;
        setArmed(false);
        if (f && f.size > MAX_MB * 1024 * 1024) { setPhoto(null); setError(`that image is ${(f.size / 1048576).toFixed(0)} MB; the limit is ${MAX_MB} MB`); return; }
        setError(null); setPhoto(f);
      }} />
      <div className="row">
        <button type="button" className="grow" onClick={() => pick.current?.click()}>{photo ? `Photo: ${photo.name}` : "Or use a photo..."}</button>
        {photo && <button type="button" onClick={() => setPhoto(null)}>Clear</button>}
      </div>
      <label>
        Turn (degrees, if the figure faces the wrong way)
        <input type="text" inputMode="numeric" value={turn} onChange={(e) => { setTurn(e.target.value); setArmed(false); }} onFocus={(e) => e.target.select()} />
        {turnBad && <span className="hint err">Enter a number from -360 to 360.</span>}
      </label>
      <button type="button" disabled={!ready || busy || !health} onClick={run} onBlur={() => setArmed(false)}>
        {busy ? "Generating (1 to 3 minutes)..." : armed ? `Confirm: about ${health?.actorCredits ?? 24} credits` : cloud ? "Generate actor (uses credits)" : "Generate actor"}
      </button>
      {error && <p className="hint err">{error}</p>}
      {note && <p className="hint">{note}</p>}
      <p className="hint">A plain, full-length, arms-down front view works best. Generated actors stay on this machine and are not part of the repo (Hunyuan3D has its own licence: it excludes the EU, UK and South Korea). Use a photo you may use.</p>
    </details>
  );
}
