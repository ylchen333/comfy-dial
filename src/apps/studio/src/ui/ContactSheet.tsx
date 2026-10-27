import { useRef, useState } from "react";
import { videoUrl, type RunView, type TakeView } from "../logic/runs.ts";
import { metricsLine, repairLine, repairTarget, segmentStates, sheetSummary, verdictOf } from "../logic/sheet.ts";

interface Props {
  run: RunView;
  segments: number;
  selectedSeed: number | null;
  onSelect: (t: TakeView) => void;
  onRepair: (t: TakeView, segment: number) => void;
  repairCredits: number;
}

interface TileProps { run: RunView; t: TakeView; segments: number; selected: boolean; onSelect: (t: TakeView) => void; onRepair: Props["onRepair"]; repairCredits: number }

function Tile({ run, t, segments, selected, onSelect, onRepair, repairCredits }: TileProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [armed, setArmed] = useState(false); // live repair spends credits: first click arms, second sends
  const verdict = verdictOf(t);
  const target = repairTarget(t, run.live);
  const busy = run.repairing !== null;
  const mine = run.repairing?.seed === t.seed;
  const fix = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    if (target === null || busy) return;
    if (run.live && !armed) return setArmed(true);
    setArmed(false);
    onRepair(t, target);
  };
  return (
    <div className="tilewrap">
    <button
      type="button"
      className={`tile ${selected ? "sel" : ""} ${verdict === "PASS" ? "pass" : "fail"}`}
      onClick={() => onSelect(t)}
      onMouseEnter={() => void video.current?.play().catch(() => {})}
      onMouseLeave={() => { video.current?.pause(); }}
      title={t.hasPoses ? "Click to draw this take's recovered path" : "No recovered path for this take"}
    >
      <div className="thumb">
        {t.hasVideo ? (
          <video ref={video} src={videoUrl(run.id, t.seed)} muted loop playsInline preload="metadata" />
        ) : (
          <span className="novideo">{run.live ? "no video" : "dry run: no video"}</span>
        )}
        <span className="rank">#{t.rank}</span>
        <span className={`badge ${verdict === "PASS" ? "ok" : "bad"}`}>{verdict}</span>
      </div>
      <div className="segs" aria-label="per-segment result">
        {segmentStates(t, segments).map((s, i) => (
          <span key={i} className={`seg ${s}`} title={`segment ${i + 1}: ${s === "drift" ? "drifted" : s === "ok" ? "held" : "not measured"}`}>{i + 1}</span>
        ))}
      </div>
      <div className="meta mono">seed {t.seed} · {metricsLine(t)}</div>
      {t.move && <div className="meta mono">move* {t.move}</div>}
      {repairLine(t) && <div className={`meta mono ${t.repair?.improved ? "fixed" : "unfixed"}`}>{repairLine(t)}</div>}
    </button>
    {(target !== null || mine) && (
      <button type="button" className="repair" disabled={busy} onClick={fix} onBlur={() => setArmed(false)}>
        {mine ? "Regenerating..." : armed ? `Confirm: about ${repairCredits} credits` : `Repair segment ${(target ?? 0) + 1}${run.live ? ` (~${repairCredits} credits)` : " (dry)"}`}
      </button>
    )}
    </div>
  );
}

/** Ranked takes as tiles: video, verdict, per-segment strip, errors. Click a tile to overlay its recovered camera path. */
export function ContactSheet({ run, segments, selectedSeed, onSelect, onRepair, repairCredits }: Props) {
  if (run.takes.length === 0) return null;
  return (
    <section className="sheet">
      <div className="sheet-head">
        <strong>Contact sheet</strong>
        <span className="mono">{run.live ? "LIVE" : "DRY"} run {run.id}</span>
        <span className="summary">{sheetSummary(run.takes)}</span>
        <span className="hint">*move label is advisory and does not change PASS</span>
      </div>
      <div className="tiles">
        {run.takes.map((t) => <Tile key={t.seed} run={run} t={t} segments={segments} selected={t.seed === selectedSeed} onSelect={onSelect} onRepair={onRepair} repairCredits={repairCredits} />)}
      </div>
    </section>
  );
}
