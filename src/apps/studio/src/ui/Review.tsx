import { useEffect, useMemo, useRef, useState } from "react";
import type { Poses } from "@comfy-osh/contracts";
import { FPS, sampleShot } from "@comfy-osh/rig-core";
import { alignRecovered } from "../logic/align.ts";
import { docFromShot } from "../logic/compile.ts";
import { parsePosesDoc } from "../logic/io.ts";
import { driftFrame, errorSamples, frameAtTime, frameAtX, niceTicks, ROT_GATE_DEG, videoTimeFor } from "../logic/review.ts";
import { getPosesText, posesUrl, videoDownloadUrl, videoUrl, type RunView, type TakeView } from "../logic/runs.ts";
import { repairTarget, verdictOf } from "../logic/sheet.ts";
import { framingOf } from "../logic/viewControls.ts";
import { Viewport } from "./Viewport.tsx";

interface Props {
  run: RunView;
  seed: number;
  onSeed: (seed: number) => void;
  onClose: () => void;
  onRepair: (t: TakeView, segment: number) => void;
  repairCredits: number;
}

const H = 190, L = 44, R = 12, T = 22, B = 26; // chart height and plot margins; the width follows the container
const deg = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "-" : `${v.toFixed(d)}°`);

/** One series: rotation error against the authored camera, per solved frame. Click or drag to scrub. */
function ErrorChart({ samples, frames, frame, onFrame, segments, bad, drift }: {
  samples: { frame: number; deg: number }[]; frames: number; frame: number; onFrame: (f: number) => void;
  segments: { start: number; end: number }[]; bad: boolean[]; drift: number | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(1000);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(320, Math.round(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(320, Math.round(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  const ticks = niceTicks(Math.max(ROT_GATE_DEG * 1.2, ...samples.map((s) => s.deg)));
  const top = ticks[ticks.length - 1]!;
  const x = (f: number) => L + (f / (frames - 1)) * (W - L - R);
  const y = (d: number) => H - B - (d / top) * (H - B - T);
  const xTicks = [0, 1, 2, 3, 4].map((i) => Math.round((i * (frames - 1)) / 4));
  const cur = samples.length ? samples.reduce((a, b) => (Math.abs(b.frame - frame) < Math.abs(a.frame - frame) ? b : a)) : null;
  const dragging = useRef(false);
  const at = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onFrame(frameAtX(((e.clientX - r.left) * W) / r.width, L, W - L - R, frames));
  };
  return (
    <div ref={box} className="errbox">
    <svg
      className="errchart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Rotation error per frame against the gate"
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); at(e); }}
      onPointerMove={(e) => { if (dragging.current) at(e); }}
      onPointerUp={() => { dragging.current = false; }}
    >
      {segments.map((s, i) => (
        <g key={i}>
          {bad[i] && <rect x={x(s.start)} y={T} width={x(Math.min(s.end, frames - 1)) - x(s.start)} height={H - B - T} fill="#e05a5a" opacity={0.1} />}
          {i > 0 && <line x1={x(s.start)} x2={x(s.start)} y1={T} y2={H - B} stroke="#2e2e2e" />}
          <text x={x(s.start) + 6} y={T - 8} className="ct">segment {i + 1}{bad[i] ? " drifted" : ""}</text>
        </g>
      ))}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#4a4a4a" : "#2b2b2b"} />
          <text x={L - 8} y={y(t) + 4} textAnchor="end" className="ct">{t}°</text>
        </g>
      ))}
      {xTicks.map((f) => <text key={f} x={x(f)} y={H - 8} textAnchor={f === 0 ? "start" : f === frames - 1 ? "end" : "middle"} className="ct">{f}</text>)}
      <line x1={L} x2={W - R} y1={y(ROT_GATE_DEG)} y2={y(ROT_GATE_DEG)} stroke="#949494" strokeDasharray="4 4" />
      <text x={L + 6} y={y(ROT_GATE_DEG) - 5} className="ct">gate {ROT_GATE_DEG}°</text>
      {drift !== null && (
        <g>
          <line x1={x(drift)} x2={x(drift)} y1={T} y2={H - B} stroke="#e05a5a" />
          <text x={x(drift) - 6} y={y(top) + 12} textAnchor="end" className="ct warn">over the gate from frame {drift}</text>
        </g>
      )}
      {samples.length > 1 && <polyline points={samples.map((s) => `${x(s.frame)},${y(s.deg)}`).join(" ")} fill="none" stroke="#3fd2ff" strokeWidth={2} />}
      <line x1={x(frame)} x2={x(frame)} y1={T} y2={H - B} stroke="#ffffff" opacity={0.55} />
      {cur && <circle cx={x(cur.frame)} cy={y(cur.deg)} r={4} fill="#3fd2ff" />}
      {samples.length === 0 && <text x={W / 2} y={H / 2} textAnchor="middle" className="ct">no pose solve for this take: nothing to plot</text>}
    </svg>
    </div>
  );
}

function RepairButton({ t, run, repairCredits, onRepair }: { t: TakeView; run: RunView; repairCredits: number; onRepair: Props["onRepair"] }) {
  const [armed, setArmed] = useState(false); // live repair spends credits: first click arms, second sends
  const target = repairTarget(t, run.live);
  const mine = run.repairing?.seed === t.seed;
  if (target === null && !mine) return null;
  const go = () => {
    if (target === null || run.repairing) return;
    if (run.live && !armed) return setArmed(true);
    setArmed(false);
    onRepair(t, target);
  };
  return (
    <button type="button" disabled={Boolean(run.repairing)} onClick={go} onBlur={() => setArmed(false)}>
      {mine ? "Regenerating..." : armed ? `Confirm: about ${repairCredits} credits` : `Repair segment ${(target ?? 0) + 1}${run.live ? ` (~${repairCredits} credits)` : " (dry)"}`}
    </button>
  );
}

/** Full-window review of one take: the video and the two camera paths on one clock, with the error curve under both. */
export function Review({ run, seed, onSeed, onClose, onRepair, repairCredits }: Props) {
  const take = run.takes.find((t) => t.seed === seed) ?? run.takes[0]!;
  const frames = run.shot.frames;
  const doc = useMemo(() => docFromShot(run.shot), [run.shot]);
  const authored = useMemo(() => sampleShot(run.shot), [run.shot]);
  const framing = useMemo(() => framingOf(authored, null), [authored]);
  const [posesDoc, setPosesDoc] = useState<Poses | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const version = `${take.repair?.segment ?? "-"}:${run.repairing ? 1 : 0}`; // poses change when a repair lands

  useEffect(() => {
    let dead = false;
    setPosesDoc(null);
    setProblem(null);
    if (!take.hasPoses) return;
    getPosesText(run.id, take.seed)
      .then((text) => {
        const r = parsePosesDoc(text);
        if (dead) return;
        if (r.ok) setPosesDoc(r.value);
        else setProblem(r.errors[0] ?? "poses file is invalid");
      })
      .catch((e: Error) => { if (!dead) setProblem(e.message); });
    return () => { dead = true; };
  }, [run.id, take.seed, take.hasPoses, version]);

  const recovered = useMemo(() => (posesDoc ? alignRecovered(posesDoc, authored) : null), [posesDoc, authored]);
  const samples = useMemo(() => errorSamples(recovered), [recovered]);
  const drift = useMemo(() => driftFrame(samples), [samples]);
  const here = samples.length ? samples.reduce((a, b) => (Math.abs(b.frame - frame) < Math.abs(a.frame - frame) ? b : a)) : null;

  // One clock. While paused the frame leads and the video seeks to it; while playing the video leads.
  useEffect(() => {
    if (!playing && video.current) video.current.currentTime = videoTimeFor(frame, FPS);
  }, [playing, frame, take.seed]);
  useEffect(() => {
    if (!playing) { video.current?.pause(); return; }
    const v = video.current;
    if (v && take.hasVideo) {
      void v.play().catch(() => setPlaying(false));
      let raf = 0;
      const tick = () => { setFrame(frameAtTime(v.currentTime, FPS, frames)); raf = requestAnimationFrame(tick); };
      raf = requestAnimationFrame(tick);
      return () => { cancelAnimationFrame(raf); v.pause(); };
    }
    const id = window.setInterval(() => setFrame((f) => (f + 1) % frames), 1000 / FPS);
    return () => window.clearInterval(id);
  }, [playing, take.hasVideo, take.seed, frames]);

  const step = (d: number) => { setPlaying(false); setFrame((f) => Math.min(frames - 1, Math.max(0, f + d))); };
  const pick = (d: number) => { const i = run.takes.findIndex((t) => t.seed === take.seed); const n = run.takes[(i + d + run.takes.length) % run.takes.length]; if (n) { setPlaying(false); onSeed(n.seed); } };
  useEffect(() => {
    const typing = (e: KeyboardEvent) => Boolean((e.target as HTMLElement).closest("input, select, textarea"));
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") { e.preventDefault(); step(e.shiftKey ? -10 : -1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(e.shiftKey ? 10 : 1); }
      else if (e.key === "Home") { e.preventDefault(); step(-frames); }
      else if (e.key === "End") { e.preventDefault(); step(frames); }
      else if (e.key === " ") { e.preventDefault(); if (!e.repeat) setPlaying((p) => !p); }
      else if (e.key === "[") pick(-1);
      else if (e.key === "]") pick(1);
    };
    // A focused button also clicks on space KEY-UP; cancel that, or one press toggles twice and does nothing.
    const onUp = (e: KeyboardEvent) => { if (e.key === " " && !typing(e)) e.preventDefault(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onUp); };
  });

  const verdict = verdictOf(take);
  const held = take.segments.filter((s) => s.pass).length;
  const bad = run.shot.segments.map((_, i) => take.badSegments.includes(i) || !take.solveOk);
  const base = `${run.shot.id}-s${take.seed}${take.repair ? "-repaired" : ""}`;

  return (
    <div className="page review" aria-label="Review take">
      <header className="pagehead">
        <nav className="takepick" aria-label="Takes">
          {run.takes.map((t) => (
            <button key={t.seed} type="button" className={t.seed === take.seed ? "on" : ""} onClick={() => { setPlaying(false); onSeed(t.seed); }}>
              #{t.rank} seed {t.seed} <span className={`pill ${verdictOf(t) === "PASS" ? "ok" : "bad"}`}>{verdictOf(t)}</span>
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <RepairButton t={take} run={run} repairCredits={repairCredits} onRepair={onRepair} />
        {take.hasVideo ? <a className="btn" href={videoDownloadUrl(run.id, take.seed)} download={`${base}.mp4`}>Download video</a> : <span className="muted">{run.live ? "no video file for this take" : "dry run: no video to export"}</span>}
        {take.hasPoses && <a className="btn" href={posesUrl(run.id, take.seed)} download={`${base}.poses.json`}>Download poses</a>}
        <button type="button" onClick={onClose}>Back to Generate (Esc)</button>
      </header>

      <section className="figures">
        <span><b>{deg(take.rotDeg)}</b> rotation error</span>
        <span><b>{take.transPct === null ? "-" : `${take.transPct.toFixed(1)}%`}</b> translation</span>
        <span><b>{held} of {take.segments.length || run.shot.segments.length}</b> segments held</span>
        <span><b>{here ? deg(here.deg) : "-"}</b> at frame {frame}</span>
        {take.move && <span><b>{take.move}</b> move (advisory)</span>}
        <span className={verdict === "PASS" ? "good" : "warn"}>{verdict}</span>
        {take.repair && <span className="muted">segment {take.repair.segment + 1} regenerated from frame {take.repair.fromFrame}: {deg(take.repair.before.segments[take.repair.segment]?.rotDeg)} to {deg(take.segments[take.repair.segment]?.rotDeg)}</span>}
      </section>

      {run.prompt && <p className="promptline" title={`${run.prompt}${run.negative ? `\n\nAvoid: ${run.negative}` : ""}`}><span className="muted">Prompt</span> {run.prompt}</p>}

      <div className="panes">
        <figure>
          <figcaption>Generated take</figcaption>
          <div className="stage">
            {take.hasVideo
              ? <video ref={video} key={`${take.seed}:${version}`} src={videoUrl(run.id, take.seed)} muted loop playsInline preload="auto" />
              : <span className="muted">{run.live ? "no video file for this take" : "dry run: there is no video, only the synthetic camera path"}</span>}
          </div>
        </figure>
        <figure>
          <figcaption>Camera paths <i className="dot a" /> authored <i className="dot r" /> recovered from the take</figcaption>
          <div className="stage">
            <span className="pip-label">Shot camera (authored), frame {frame}</span>
            <Viewport doc={doc} frame={frame} poses={authored} recovered={recovered} gizmo="position" showPip readOnly framing={framing} onGizmoCommit={() => {}} onAssetError={() => {}} />
          </div>
        </figure>
      </div>

      <section className="scrub">
        <div className="transport">
          <button type="button" onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
          <span className="mono">frame {frame} / {frames - 1} · {(frame / FPS).toFixed(2)}s</span>
          <span className="hint">space play/pause · ← → step (shift: 10) · Home End · [ ] switch take · click the chart to scrub</span>
        </div>
        <ErrorChart samples={samples} frames={frames} frame={frame} onFrame={(f) => { setPlaying(false); setFrame(f); }} segments={run.shot.segments} bad={bad} drift={drift} />
        {problem && <p className="warn">{problem}</p>}
        {!problem && take.hasPoses === false && <p className="muted">{take.solveOk ? "poses were not saved for this take" : "the pose solve failed for this take, so there is no recovered path"}</p>}
      </section>
    </div>
  );
}
