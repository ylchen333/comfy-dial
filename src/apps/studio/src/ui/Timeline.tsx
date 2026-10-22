import { useRef, useState } from "react";
import { FPS } from "@comfy-osh/rig-core";
import { CHANNELS, EASINGS, type Channel, type Easing, type StudioDoc } from "../logic/types.ts";

export interface SelectedKey { ch: Channel; frame: number }

interface Props {
  doc: StudioDoc;
  frame: number;
  playing: boolean;
  selected: SelectedKey | null;
  onFrame: (f: number) => void;
  onPlayToggle: () => void;
  onSelect: (k: SelectedKey | null) => void;
  onAddKey: (ch: Channel, frame: number) => void;
  onMoveKey: (ch: Channel, from: number, to: number) => void;
  onDeleteKey: (ch: Channel, frame: number) => void;
  onEasing: (ch: Channel, frame: number, e: Easing) => void;
}

const LABELS: Record<Channel, string> = { position: "Position", aim: "Aim", focal: "Focal length" };

export function Timeline(p: Props) {
  const { doc } = p;
  const last = doc.frames - 1;
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ ch: Channel; from: number; to: number } | null>(null);

  const frameAt = (clientX: number) => {
    const r = laneRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(last, Math.round(((clientX - r.left) / r.width) * last)));
  };
  const pct = (f: number) => `${(f / last) * 100}%`;
  const selKey = p.selected ? doc[p.selected.ch].find((k) => k.frame === p.selected!.frame) : undefined;
  const ticks: number[] = [];
  for (let f = 0; f <= last; f += 25) ticks.push(f);

  const scrub = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    p.onFrame(frameAt(e.clientX));
  };

  return (
    <div className="timeline">
      <div className="transport">
        <button onClick={p.onPlayToggle}>{p.playing ? "Pause" : "Play"}</button>
        <span className="mono">frame {p.frame}/{last} | {(p.frame / FPS).toFixed(2)}s / {(last / FPS).toFixed(2)}s @ {FPS} fps</span>
        {p.selected && selKey && (
          <span className="keyedit">
            {LABELS[p.selected.ch]} key @ {p.selected.frame}
            <select value={selKey.easing} onChange={(e) => p.onEasing(p.selected!.ch, p.selected!.frame, e.target.value as Easing)}>
              {EASINGS.map((e) => <option key={e}>{e}</option>)}
            </select>
            <button onClick={() => p.onDeleteKey(p.selected!.ch, p.selected!.frame)}>Delete key</button>
          </span>
        )}
      </div>
      <div className="grid">
        <div className="labels">
          <div className="label ruler-label" />
          {CHANNELS.map((c) => <div key={c} className="label">{LABELS[c]}</div>)}
        </div>
        <div className="lanes" ref={laneRef}>
          <div
            className="ruler"
            onPointerDown={scrub}
            onPointerMove={(e) => e.buttons === 1 && p.onFrame(frameAt(e.clientX))}
          >
            {ticks.map((f) => <span key={f} className="tick" style={{ left: pct(f) }}>{f}</span>)}
          </div>
          {CHANNELS.map((ch) => (
            <div key={ch} className="lane" onDoubleClick={(e) => p.onAddKey(ch, frameAt(e.clientX))} title="Double-click to add a key">
              {doc[ch].map((k) => {
                const f = drag && drag.ch === ch && drag.from === k.frame ? drag.to : k.frame;
                const sel = p.selected?.ch === ch && p.selected.frame === k.frame;
                return (
                  <div
                    key={k.frame}
                    className={`key${sel ? " sel" : ""}`}
                    style={{ left: pct(f) }}
                    title={`${ch} @ ${k.frame} (${k.easing})`}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                      p.onSelect({ ch, frame: k.frame });
                      setDrag({ ch, from: k.frame, to: k.frame });
                    }}
                    onPointerMove={(e) => drag && drag.from === k.frame && drag.ch === ch && setDrag({ ...drag, to: frameAt(e.clientX) })}
                    onPointerUp={() => {
                      if (drag && drag.to !== drag.from) p.onMoveKey(ch, drag.from, drag.to);
                      setDrag(null);
                    }}
                  />
                );
              })}
            </div>
          ))}
          <div className="playhead" style={{ left: pct(p.frame) }} />
        </div>
      </div>
    </div>
  );
}
