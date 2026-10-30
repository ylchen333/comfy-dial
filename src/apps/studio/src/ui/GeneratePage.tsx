import type { Shot } from "@comfy-dial/contracts";
import type { Check } from "../logic/guardrails.ts";
import type { RunListing, RunView, TakeView } from "../logic/runs.ts";
import { ContactSheet } from "./ContactSheet.tsx";
import { RunPanel } from "./RunPanel.tsx";

interface Props {
  shot: Shot | null; // null while the doc is invalid
  facts: { id: string; frames: number; seconds: number; resolution: { width: number; height: number }; focalFrom: number; focalTo: number };
  checks: Check[];
  run: RunView | null;
  runList: RunListing[];
  onRun: (r: RunView | null) => void;
  onOpenRun: (id: string) => void;
  onReview: (seed: number) => void;
  onRepair: (t: TakeView, segment: number) => void;
  repairCredits: number;
  segments: number;
}

const when = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Make takes (the only page that spends credits) and see what came back. */
export function GeneratePage({ shot, facts, checks, run, runList, onRun, onOpenRun, onReview, onRepair, repairCredits, segments }: Props) {
  return (
    <div className="page generate">
      <header className="pagehead">
        <span className="blurb">Make takes. This is the only page that spends credits.</span>
      </header>
      <div className="gen-body">
        <section className="gen-shot" aria-label="Shot">
          <h2>The shot</h2>
          <dl className="facts">
            <dt>Name</dt><dd className="mono">{facts.id}</dd>
            <dt>Length</dt><dd>{facts.frames} frames · {facts.seconds.toFixed(2)} s</dd>
            <dt>Frame</dt><dd>{facts.resolution.width}x{facts.resolution.height}</dd>
            <dt>Lens</dt><dd>{facts.focalFrom.toFixed(0)} mm{Math.abs(facts.focalFrom - facts.focalTo) > 0.5 ? ` to ${facts.focalTo.toFixed(0)} mm` : ""}</dd>
          </dl>
          <ul className="checks">
            {checks.length === 0 && <li className="none">No checks raised.</li>}
            {checks.map((c) => <li key={c.id} className={c.level}>{c.text}</li>)}
          </ul>
        </section>
        <RunPanel shot={shot} resolution={facts.resolution} run={run} onRun={onRun} onClearTake={() => {}} />
        <section className="gen-main" aria-label="Results">
          {run && run.takes.length > 0 ? (
            <ContactSheet run={run} segments={segments} onRepair={onRepair} onReview={onReview} repairCredits={repairCredits} />
          ) : (
            <div className="empty">
              <h2>No takes yet</h2>
              <p>{run?.state === "running" ? "Takes are generating. They appear here as they are scored." : "Run a dry run to exercise the pipeline for free, or a live run for real footage. You can also open an earlier run below."}</p>
            </div>
          )}
          <div className="history">
            <h2>Earlier runs</h2>
            {runList.length === 0 ? <p className="muted">No saved runs yet.</p> : (
              <table>
                <thead><tr><th>Run</th><th>Mode</th><th>Shot</th><th className="num">Takes</th><th>When</th><th /></tr></thead>
                <tbody>
                  {runList.map((r) => (
                    <tr key={r.id} className={run?.id === r.id ? "cur" : ""}>
                      <td className="mono">{r.id}</td>
                      <td>{r.live ? <span className="tag-live">LIVE</span> : "Dry"}</td>
                      <td className="mono">{r.shotId}</td>
                      <td className="num">{r.takes}</td>
                      <td>{when(r.modified)}</td>
                      <td className="act"><button type="button" className="btn" onClick={() => onOpenRun(r.id)}>Open in Review</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
