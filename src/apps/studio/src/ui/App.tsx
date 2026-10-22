import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FPS, sampleShot, type Vec3 } from "@comfy-osh/rig-core";
import { exportShot } from "../logic/compile.ts";
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from "../logic/history.ts";
import { exportShotJson, importShotJson, parsePosesJson, validateDoc } from "../logic/io.ts";
import {
  addKeyAtCurrent, deleteKey, evalChannel, moveKey, newDoc, setEasing, setFrames, setResolution, setSensorHeight, upsertKey,
} from "../logic/keys.ts";
import { ASPECT_PRESETS, SENSOR_PRESETS, aspectIdOf, focalToFov } from "../logic/lens.ts";
import { PRESET_IDS, PRESET_LABELS, applyPreset } from "../logic/presets.ts";
import type { Channel, Easing, Result, StudioDoc } from "../logic/types.ts";
import { Timeline, type SelectedKey } from "./Timeline.tsx";
import { Viewport, type GizmoTarget } from "./Viewport.tsx";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const readFile = (accept: string, cb: (text: string) => void) => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = () => input.files?.[0]?.text().then(cb);
  input.click();
};

export function App() {
  const [hist, setHist] = useState<History>(() => createHistory(newDoc()));
  const doc = hist.present;
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<SelectedKey | null>(null);
  const [gizmo, setGizmo] = useState<GizmoTarget>("position");
  const [showPip, setShowPip] = useState(true);
  const [messages, setMessages] = useState<string[]>([]);
  const [recovered, setRecovered] = useState<Vec3[] | null>(null);

  const poses = useMemo(() => sampleShot(exportShot(doc)), [doc]);
  const validation = useMemo(() => validateDoc(doc), [doc]);
  const pose = poses[Math.min(frame, poses.length - 1)]!;
  const focal = evalChannel(doc, "focal", frame);

  // Apply a pure-logic edit; surface its error instead of changing anything.
  const edit = useCallback((f: (d: StudioDoc) => Result<StudioDoc> | StudioDoc) => {
    setHist((h) => {
      const r = f(h.present);
      if ("ok" in r) {
        if (!r.ok) {
          setMessages([r.error]);
          return h;
        }
        setMessages([]);
        return commit(h, r.value);
      }
      setMessages([]);
      return commit(h, r);
    });
  }, []);

  // Playback: advance on a 25 fps clock; the poses come from the rig-core sampler so the studio matches the verifier.
  const lastFrame = doc.frames - 1;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const start = performance.now();
    const from = frame;
    const tick = (now: number) => {
      const f = (from + Math.floor(((now - start) / 1000) * FPS)) % doc.frames;
      setFrame(f);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, doc.frames]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "SELECT") return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setHist((h) => (e.shiftKey ? redo(h) : undo(h)));
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        setHist(redo);
      } else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        edit((d) => deleteKey(d, selected.ch, selected.frame));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, edit]);

  const scrubTo = (f: number) => {
    setPlaying(false);
    setFrame(Math.max(0, Math.min(lastFrame, f)));
  };

  const keyHere = (ch: Channel) => edit((d) => addKeyAtCurrent(d, ch, frame));

  const doExport = () => {
    const r = exportShotJson(doc);
    if (!r.ok) return setMessages(r.errors);
    setMessages([]);
    download(`${doc.id}.shot.json`, r.value);
  };
  const doImport = () =>
    readFile("application/json,.json", (text) => {
      const r = importShotJson(text, doc);
      if (!r.ok) return setMessages(r.errors);
      setHist((h) => commit(h, r.value));
      setFrame(0);
      setSelected(null);
      setMessages([]);
    });
  const doLoadPoses = () =>
    readFile("application/json,.json", (text) => {
      const r = parsePosesJson(text);
      if (!r.ok) return setMessages(r.errors);
      setRecovered(r.value);
      setMessages([]);
    });

  const aspectId = aspectIdOf(doc.resolution);
  const sensorId = SENSOR_PRESETS.find((s) => s.heightMm === doc.sensorHeightMm)?.id ?? "custom";

  return (
    <div className="app">
      <header>
        <strong>Cinema Studio</strong>
        <button disabled={!canUndo(hist)} onClick={() => setHist(undo)}>Undo</button>
        <button disabled={!canRedo(hist)} onClick={() => setHist(redo)}>Redo</button>
        <button onClick={doImport}>Import Shot</button>
        <button onClick={doExport}>Export Shot</button>
        <button onClick={doLoadPoses}>Load Poses (recovered)</button>
        {recovered && <button onClick={() => setRecovered(null)}>Clear recovered</button>}
        <span className={validation.ok ? "valid" : "invalid"}>{validation.ok ? "Shot valid" : "Shot invalid"}</span>
        <span className="legend"><i style={{ background: "#ffd23f" }} />authored <i style={{ background: "#3fd2ff" }} />recovered</span>
      </header>
      {(messages.length > 0 || !validation.ok) && (
        <ul className="errors">
          {[...messages, ...(validation.ok ? [] : validation.errors)].map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
      <main>
        <div className="viewport">
          <Viewport
            doc={doc}
            frame={frame}
            poses={poses}
            recovered={recovered}
            gizmo={gizmo}
            showPip={showPip}
            onGizmoCommit={(target, value) => edit((d) => upsertKey(d, target, frame, value))}
          />
          <div className="pip-label">Shot camera ({doc.resolution.width}x{doc.resolution.height})</div>
        </div>
        <aside>
          <section>
            <h3>Gizmo</h3>
            <label><input type="radio" checked={gizmo === "position"} onChange={() => setGizmo("position")} /> Position (yellow)</label>
            <label><input type="radio" checked={gizmo === "aim"} onChange={() => setGizmo("aim")} /> Aim (pink)</label>
            <p className="hint">Drag, release to key it at the current frame.</p>
            <label><input type="checkbox" checked={showPip} onChange={(e) => setShowPip(e.target.checked)} /> Camera view</label>
          </section>
          <section>
            <h3>Lens</h3>
            <label>
              Focal length {focal.toFixed(1)} mm = {focalToFov(focal, doc.sensorHeightMm).toFixed(2)} deg vFOV
              <input
                type="range" min={8} max={200} step={0.5} value={focal}
                onChange={(e) => edit((d) => upsertKey(d, "focal", frame, Number(e.target.value)))}
              />
            </label>
            <label>
              Sensor height
              <select value={sensorId} onChange={(e) => {
                const s = SENSOR_PRESETS.find((x) => x.id === e.target.value);
                if (s) edit((d) => setSensorHeight(d, s.heightMm));
              }}>
                {sensorId === "custom" && <option value="custom">{doc.sensorHeightMm} mm</option>}
                {SENSOR_PRESETS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <label>
              Aspect
              <select value={aspectId} onChange={(e) => {
                const a = ASPECT_PRESETS.find((x) => x.id === e.target.value);
                if (a) edit((d) => setResolution(d, a.width, a.height));
              }}>
                {aspectId === "custom" && <option value="custom">{doc.resolution.width}x{doc.resolution.height}</option>}
                {ASPECT_PRESETS.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.width}x{a.height})</option>)}
              </select>
            </label>
            <label>
              Frames (1+8k)
              <input
                type="number" value={doc.frames} step={8} min={9}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  edit((d) => setFrames(d, n));
                  setFrame((f) => Math.min(f, n - 1));
                }}
              />
            </label>
          </section>
          <section>
            <h3>Keys at frame {frame}</h3>
            <div className="row">
              {(["position", "aim", "focal"] as const).map((c) => <button key={c} onClick={() => keyHere(c)}>Key {c}</button>)}
            </div>
            <p className="hint mono">cam {pose.position.map((v) => v.toFixed(2)).join(", ")}</p>
          </section>
          <section>
            <h3>Move presets</h3>
            <div className="row wrap">
              {PRESET_IDS.map((id) => (
                <button key={id} onClick={() => { edit((d) => applyPreset(d, id)); setSelected(null); setFrame(0); }}>{PRESET_LABELS[id]}</button>
              ))}
            </div>
            <p className="hint">Replaces all keys with editable ones, framed on the subject.</p>
          </section>
        </aside>
      </main>
      <Timeline
        doc={doc}
        frame={frame}
        playing={playing}
        selected={selected}
        onFrame={scrubTo}
        onPlayToggle={() => setPlaying((p) => !p)}
        onSelect={setSelected}
        onAddKey={(ch, f) => edit((d) => addKeyAtCurrent(d, ch, f))}
        onMoveKey={(ch, from, to) => {
          edit((d) => moveKey(d, ch, from, to));
          setSelected({ ch, frame: to });
        }}
        onDeleteKey={(ch, f) => { edit((d) => deleteKey(d, ch, f)); setSelected(null); }}
        onEasing={(ch, f, e: Easing) => edit((d) => setEasing(d, ch, f, e))}
      />
    </div>
  );
}
