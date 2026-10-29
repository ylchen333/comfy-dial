import { useEffect, useState } from "react";
import type { Vec3 } from "@comfy-osh/rig-core";
import type { Readout } from "../logic/guardrails.ts";

/** One number, committed on Enter or blur (not on every keystroke, so a typed value is one undo step). */
function Num({ label, value, step = 0.05, onCommit }: { label: string; value: number; step?: number; onCommit: (v: number) => void }) {
  const shown = String(+value.toFixed(3));
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const v = Number(text);
    if (!text.trim() || !Number.isFinite(v)) return setText(shown);
    if (+v.toFixed(3) !== +value.toFixed(3)) onCommit(v);
  };
  return (
    <label className="num">
      <span>{label}</span>
      <input
        type="number" step={step} value={text} aria-label={label}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setText(shown); (e.target as HTMLInputElement).blur(); } e.stopPropagation(); }}
      />
    </label>
  );
}

interface Props {
  frame: number;
  position: Vec3;
  aim: Vec3;
  focalMm: number;
  readout: Readout;
  onPosition: (v: Vec3) => void;
  onAim: (v: Vec3) => void;
  onFocal: (mm: number) => void;
}

/** The viewport's N panel: the shot camera's numbers at this frame. Editing one keys it at this frame. */
export function ItemPanel({ frame, position, aim, focalMm, readout, onPosition, onAim, onFocal }: Props) {
  const set = (v: Vec3, i: number, x: number): Vec3 => v.map((c, k) => (k === i ? x : c)) as Vec3;
  return (
    <div className="npanel" role="complementary" aria-label="Item">
      <h3>Shot camera</h3>
      <div className="group"><span className="gl">Location</span>
        {(["X", "Y", "Z"] as const).map((a, i) => <Num key={a} label={a} value={position[i]!} onCommit={(x) => onPosition(set(position, i, x))} />)}
      </div>
      <div className="group"><span className="gl">Aim point</span>
        {(["X", "Y", "Z"] as const).map((a, i) => <Num key={a} label={a} value={aim[i]!} onCommit={(x) => onAim(set(aim, i, x))} />)}
      </div>
      <div className="group"><span className="gl">Lens</span>
        <Num label="Focal (mm)" value={focalMm} step={1} onCommit={(x) => onFocal(Math.min(200, Math.max(8, x)))} />
        <p className="ro mono">{readout.vfovDeg.toFixed(1)}° vertical FOV</p>
      </div>
      <p className="ro mono">frame {frame} · {readout.seconds.toFixed(2)} s · {readout.speed.toFixed(1)} m/s{readout.subjectDist !== null ? ` · subject ${readout.subjectDist.toFixed(1)} m` : ""}</p>
      <p className="hint">Typing a value keys it at frame {frame}.</p>
    </div>
  );
}
