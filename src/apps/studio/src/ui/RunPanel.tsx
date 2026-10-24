import { useEffect, useRef, useState } from "react";
import type { Shot } from "@comfy-osh/contracts";
import { getHealth, getPosesText, getRun, runBlocker, startRun, type Health, type RunView, type TakeView } from "../logic/runs.ts";

interface Props {
  shot: Shot | null; // null while the doc is invalid
  resolution: { width: number; height: number };
  selectedSeed: number | null;
  onShowTake: (posesText: string, seed: number) => void;
  onClearTake: () => void;
}

const f = (v: number | null, d = 2) => (v === null ? "-" : v.toFixed(d));

export function RunPanel({ shot, resolution, selectedSeed, onShowTake, onClearTake }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [n, setN] = useState(4);
  const [live, setLive] = useState(false);
  const [strength, setStrength] = useState(1);
  const [confirmed, setConfirmed] = useState(false);
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
    return () => { if (timer.current !== null) window.clearTimeout(timer.current); };
  }, []);

  const estimate = 5 * n + 8; // mirrors safety.estimateCredits; the server echoes the figure it will hold us to
  const blocker = runBlocker({ valid: shot !== null, live, health, resolution, confirmed });
  const running = run?.state === "running";

  const poll = (id: string) => {
    getRun(id).then((v) => {
      setRun(v);
      if (v.state === "running") timer.current = window.setTimeout(() => poll(id), 1500);
    }).catch((e: Error) => setError(e.message));
  };

  const start = () => {
    if (!shot || blocker) return;
    setError(null);
    onClearTake();
    startRun({ shot, n, live, strength, ...(live ? { confirmCredits: estimate } : {}) })
      .then((v) => { setRun(v); setConfirmed(false); poll(v.id); })
      .catch((e: Error) => setError(e.message));
  };

  const show = (t: TakeView) => {
    if (!run || !t.hasPoses) return;
    getPosesText(run.id, t.seed).then((text) => onShowTake(text, t.seed)).catch((e: Error) => setError(e.message));
  };

  return (
    <section className="runpanel">
      <h3>Generate takes</h3>
      <label>
        Takes ({n})
        <input type="range" min={1} max={5} value={n} onChange={(e) => setN(Number(e.target.value))} />
      </label>
      <label>
        Depth-guide strength {strength.toFixed(2)}
        <input type="range" min={0.1} max={1} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} />
      </label>
      <label><input type="checkbox" checked={live} onChange={(e) => { setLive(e.target.checked); setConfirmed(false); }} /> Live (Comfy Cloud, spends credits)</label>
      {live && (
        <label className="warn">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I accept about {estimate} credits
        </label>
      )}
      {!live && <p className="hint">Dry run: synthetic poses exercise the pipeline. They are not a measurement of any video.</p>}
      <button disabled={Boolean(blocker) || running} onClick={start}>{running ? "Running..." : live ? "Run live" : "Run dry"}</button>
      {blocker && <p className="hint">{blocker}</p>}
      {error && <p className="hint err">{error}</p>}
      {run && (
        <>
          <p className="hint mono">{run.live ? "LIVE" : "DRY"} run {run.id}: {run.state}{run.error ? ` (${run.error})` : ""}</p>
          {run.state === "running" && <p className="hint mono">{run.log[run.log.length - 1] ?? ""}</p>}
          {run.takes.length > 0 && (
            <table className="takes">
              <thead><tr><th>#</th><th>seed</th><th></th><th>rot°</th><th>trans%</th><th>drift</th><th>move*</th></tr></thead>
              <tbody>
                {run.takes.map((t) => (
                  <tr key={t.seed} className={t.seed === selectedSeed ? "sel" : ""} onClick={() => show(t)}>
                    <td>{t.rank}</td><td>{t.seed}</td>
                    <td><span className={t.pass ? "badge ok" : "badge bad"}>{t.solveOk ? (t.pass ? "PASS" : "FAIL") : "NO SOLVE"}</span></td>
                    <td>{f(t.rotDeg)}</td><td>{f(t.transPct, 1)}</td>
                    <td>{t.solveOk ? (t.badSegments.length ? t.badSegments.join(",") : "-") : "all"}</td>
                    <td>{t.move ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {run.takes.length > 0 && <p className="hint">Click a row to draw its recovered path (cyan, scaled to the authored path). *move is advisory and does not change PASS.</p>}
        </>
      )}
    </section>
  );
}
