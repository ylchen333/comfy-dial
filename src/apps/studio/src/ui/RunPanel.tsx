import { useEffect, useState } from "react";
import type { Shot } from "@comfy-dial/contracts";
import { cameraWords, DEFAULT_NEGATIVE, DEMO_PROMPT, DEFAULT_PROMPT, MAX_NEGATIVE, MAX_PROMPT, PROMPT_EXAMPLES, promptProblem } from "../logic/prompts.ts";
import { getHealth, runBlocker, startRun, type Health, type RunView } from "../logic/runs.ts";

/** Text that survives leaving the page and reloading; a per-viewer convenience, so any storage failure is ignored. */
function usePersisted(key: string, initial: string): [string, (v: string) => void] {
  const [v, setV] = useState(() => { try { return window.localStorage.getItem(key) ?? initial; } catch { return initial; } });
  return [v, (next) => { setV(next); try { window.localStorage.setItem(key, next); } catch { /* storage unavailable */ } }];
}

interface Props {
  shot: Shot | null; // null while the doc is invalid
  resolution: { width: number; height: number };
  run: RunView | null; // owned by App, which also polls it, so leaving this page never stalls a running job
  onRun: (run: RunView | null) => void;
  onClearTake: () => void;
}

export function RunPanel({ shot, resolution, run, onRun, onClearTake }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [n, setN] = useState(4);
  const [live, setLive] = useState(false);
  const [strength, setStrength] = useState(1);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = usePersisted("cinema-studio.prompt", DEMO_PROMPT);
  const [negative, setNegative] = usePersisted("cinema-studio.negative", "");

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  const estimate = 5 * n + 8; // mirrors safety.estimateCredits; the server echoes the figure it will hold us to
  const problem = promptProblem(prompt, negative);
  const blocker = problem ?? runBlocker({ valid: shot !== null, live, health, resolution, confirmed });
  const camera = cameraWords(prompt);
  const running = run?.state === "running";

  const start = () => {
    if (!shot || blocker) return;
    setError(null);
    onClearTake();
    startRun({ shot, n, live, strength, ...(prompt.trim() ? { prompt: prompt.trim() } : {}), ...(negative.trim() ? { negative: negative.trim() } : {}), ...(live ? { confirmCredits: estimate } : {}) })
      .then((v) => { onRun(v); setConfirmed(false); })
      .catch((e: Error) => setError(e.message));
  };

  const digits = String(n).padStart(2, "0");
  return (
    <section className="runpanel">
      <div className="run-prompt">
        <h2>Prompt <span className="vt" style={{ order: 2, textTransform: "none", letterSpacing: 0 }}>who · where · what · how it looks</span></h2>
        <p className="hint">Say who the subject is, where they are, and what they do. The depth guide gives the shape (a mannequin by default, set on Author) and the camera move, so leave the camera out.</p>
        <div className="chips" role="group" aria-label="Example prompts">
          {PROMPT_EXAMPLES.map((e) => <button key={e.label} type="button" className="chip" onClick={() => setPrompt(e.text)} title={e.text}>{e.label}</button>)}
        </div>
        <textarea
          aria-label="Prompt" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder={`Default: ${DEFAULT_PROMPT}`}
        />
        <div className="counter"><span className={prompt.trim().length > MAX_PROMPT ? "err" : "muted"}>{prompt.trim().length} / {MAX_PROMPT}</span>{prompt && <button type="button" className="linkish" onClick={() => setPrompt("")}>Clear</button>}</div>
        {camera.length > 0 && <p className="hint warn">"{camera.join('", "')}" describes camera work. The depth guide already sets the move, and the two can disagree.</p>}
        <details>
          <summary>Avoid</summary>
          <textarea aria-label="Avoid" rows={2} value={negative} onChange={(e) => setNegative(e.target.value)} placeholder={`Default: ${DEFAULT_NEGATIVE}`} />
          <div className="counter"><span className={negative.trim().length > MAX_NEGATIVE ? "err" : "muted"}>{negative.trim().length} / {MAX_NEGATIVE}</span></div>
        </details>
      </div>
      <div className="run-takes">
        <h2>Takes</h2>
        <div className="takes-count">
          <span className="digits" role="img" aria-label={`${n} takes`}>{digits.split("").map((d, i) => <span key={i}>{d}</span>)}</span>
          <div className="counter-keys">
            <button type="button" className="key" aria-label="More takes" disabled={n >= 5} onClick={() => setN(Math.min(5, n + 1))}>&#9650;</button>
            <button type="button" className="key" aria-label="Fewer takes" disabled={n <= 1} onClick={() => setN(Math.max(1, n - 1))}>&#9660;</button>
          </div>
          <span className="muted">takes (1 to 5)</span>
        </div>
        <label>
          Guidance strength <span className="value-lg">{strength.toFixed(2)}</span>
          <input type="range" min={0.1} max={1} step={0.05} value={strength} onChange={(e) => setStrength(Number(e.target.value))} aria-label="Guidance strength (attention_strength)" />
        </label>
        <p className="hint">Lower strength gives the prompt more freedom to change how the subject looks, but the camera follows the guide less closely.</p>
        <div className="toggle" role="group" aria-label="Run mode">
          <button type="button" className={!live ? "on" : ""} aria-pressed={!live} onClick={() => { setLive(false); setConfirmed(false); }}>Dry</button>
          <button type="button" className={live ? "on live" : ""} aria-pressed={live} onClick={() => { setLive(true); setConfirmed(false); }}>Live</button>
        </div>
        {live && (
          <label className="warn">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I accept about {estimate} credits (Comfy Cloud)
          </label>
        )}
        {!live && <p className="hint">Dry run: synthetic poses exercise the pipeline for free. They are not a measurement of any video.</p>}
        <div className="run-shoot">
          <button type="button" className={`shoot${live ? " live" : ""}`} disabled={Boolean(blocker) || running} onClick={start}>
            {running ? <span className="vt">RUNNING…</span> : live ? "Shoot live" : "Shoot dry"}
          </button>
          {running && <div className="busy-meter" aria-hidden="true"><i /></div>}
        </div>
        {blocker && <p className="hint">{blocker}</p>}
        {error && <p className="hint err">{error}</p>}
        {run && (
          <>
            <p className="hint mono">{run.live ? "LIVE" : "DRY"} run {run.id}: {run.state}{run.error ? ` (${run.error})` : ""}</p>
            {run.state === "running" && <p className="hint mono">{run.log[run.log.length - 1] ?? ""}</p>}
          </>
        )}
      </div>
    </section>
  );
}
