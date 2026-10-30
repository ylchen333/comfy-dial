import { useState } from "react";
import { PAGES, nextPage, type Page } from "../logic/pages.ts";
import type { RunView } from "../logic/runs.ts";

interface TabsProps {
  page: Page;
  shotId?: string;
  run?: RunView | null;
  onPage: (p: Page) => void;
  /** Review needs takes: the Next button on Generate waits for them. */
  canReview: boolean;
}

/** Top bar: the three workspaces in the order the work happens, and one button for the next step. */
export function TopBar({ page, onPage, canReview, shotId, run }: TabsProps) {
  const [info, setInfo] = useState(false);
  const next = nextPage(page);
  const nextDef = PAGES.find((p) => p.id === next);
  const blocked = next === "review" && !canReview;
  return (
    <nav className="topbar" aria-label="Workspace">
      <span className="chk" aria-hidden="true" />
      <span className="brand">ComfyDial</span>
      <div className="tabs" role="tablist">
        {PAGES.map((p, i) => (
          <button key={p.id} type="button" role="tab" aria-selected={page === p.id} className={page === p.id ? "on" : ""} title={`${p.hint} (Alt+${i + 1})`} onClick={() => onPage(p.id)}>
            <span className="step">{i + 1}</span>{p.label}
          </button>
        ))}
      </div>
      <span className="spacer" />
      <button type="button" className="key info-key" aria-label="Show status" aria-expanded={info} onClick={() => setInfo((v) => !v)}>i</button>
      <div className={`status-boxes${info ? " open" : ""}`}>
        {shotId && <span className="sbox">[ {shotId} ]</span>}
        {run ? <span className={`sbox${run.live ? " live" : ""}`}>[ {run.live ? "LIVE" : "DRY"} · run {run.id} ]</span> : <span className="sbox">[ no run yet ]</span>}
      </div>
      <div className="next">
        {next && nextDef && (
          <button type="button" className="btn on" disabled={blocked} title={blocked ? "Make takes first" : `${nextDef.hint} (Alt+${PAGES.indexOf(nextDef) + 1})`} onClick={() => onPage(next)}>
            {nextDef.label} <span aria-hidden>&rarr;</span>
          </button>
        )}
      </div>
    </nav>
  );
}

interface StatusProps { shotId: string; valid: boolean; run: RunView | null }

/** Bottom strip: what is loaded, not navigation. */
export function StatusBar({ shotId, valid, run }: StatusProps) {
  return (
    <footer className="statusbar">
      <span className="mono">{shotId}</span>
      <span className={valid ? "good" : "bad"}>{valid ? "Shot valid" : "Shot invalid"}</span>
      <span className="spacer" />
      <span className="muted">Alt+1 Author · Alt+2 Generate · Alt+3 Review</span>
      <span className="mono muted">
        {run ? `${run.live ? "LIVE" : "DRY"} run ${run.id} · ${run.takes.length} take${run.takes.length === 1 ? "" : "s"}${run.state === "running" ? " · running" : ""}` : "no run yet"}
      </span>
    </footer>
  );
}
