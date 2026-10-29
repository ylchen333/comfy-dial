import { PAGES, nextPage, type Page } from "../logic/pages.ts";
import type { RunView } from "../logic/runs.ts";

interface TabsProps {
  page: Page;
  onPage: (p: Page) => void;
  /** Review needs takes: the Next button on Generate waits for them. */
  canReview: boolean;
}

/** Top bar: the three workspaces in the order the work happens, and one button for the next step. */
export function TopBar({ page, onPage, canReview }: TabsProps) {
  const next = nextPage(page);
  const nextDef = PAGES.find((p) => p.id === next);
  const blocked = next === "review" && !canReview;
  return (
    <nav className="topbar" aria-label="Workspace">
      <span className="brand">Cinema Studio</span>
      <div className="tabs" role="tablist">
        {PAGES.map((p, i) => (
          <button key={p.id} role="tab" aria-selected={page === p.id} className={page === p.id ? "on" : ""} title={`${p.hint} (Alt+${i + 1})`} onClick={() => onPage(p.id)}>
            <span className="step">{i + 1}</span>{p.label}
          </button>
        ))}
      </div>
      <div className="next">
        {next && nextDef && (
          <button type="button" className="primary" disabled={blocked} title={blocked ? "Make takes first" : `${nextDef.hint} (Alt+${PAGES.indexOf(nextDef) + 1})`} onClick={() => onPage(next)}>
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
