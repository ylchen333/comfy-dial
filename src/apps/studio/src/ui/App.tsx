import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Poses } from "@comfy-osh/contracts";
import { FPS, sampleShot } from "@comfy-osh/rig-core";
import { exportShot } from "../logic/compile.ts";
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from "../logic/history.ts";
import { alignRecovered } from "../logic/align.ts";
import { exportShotJson, importShotJson, parsePosesDoc, validateDoc } from "../logic/io.ts";
import {
  addKeyAtCurrent, deleteKey, evalChannel, moveKey, newDoc, setEasing, setFrames, setResolution, setSensorHeight, upsertKey,
} from "../logic/keys.ts";
import { ASPECT_PRESETS, SENSOR_PRESETS, aspectIdOf, focalToFov } from "../logic/lens.ts";
import { PRESET_IDS, PRESET_LABELS, applyPreset } from "../logic/presets.ts";
import { getActors, getHealth, type GeneratedActor, getRun, getScenes, listRuns, repairTake, uploadModel, type RunListing, type RunView, type TakeView } from "../logic/runs.ts";
import { ACTOR_STAND, BLOCKING_SCENE_ID, SUBJECT_BOX, addModel, blockingScene, bundledScene, keepSubject, modelNodes, removeNode, sceneIdOf, subjectAssetOf, withScene, withSubject, type SceneListing } from "../logic/scenes.ts";
import type { Channel, Easing, Result, StudioDoc } from "../logic/types.ts";
import { ReferencePanel } from "./ReferencePanel.tsx";
import { GeneratePage } from "./GeneratePage.tsx";
import { StatusBar, TopBar } from "./PageBar.tsx";
import { hashFor, isTyping, pageFromHash, pageFromShortcut, type Page } from "../logic/pages.ts";
import { Review } from "./Review.tsx";
import { DepthCanvas, LensOverlay } from "./LensOverlay.tsx";
import { DepthPreview, type DepthImage, type DepthStats } from "../logic/depthPreview.ts";
import { frameReadout, shotChecks } from "../logic/guardrails.ts";
import { framingOf, snapPoint, viewKey, type Framing, type ViewId } from "../logic/viewControls.ts";
import { jumpKey, keyFrames } from "../logic/timeNav.ts";
import { ActorPanel } from "./ActorPanel.tsx";
import { ItemPanel } from "./ItemPanel.tsx";
import { Menu, MenuItem } from "./Menu.tsx";
import { Timeline, type SelectedKey } from "./Timeline.tsx";
import { DEFAULT_OVERLAYS, Viewport, type GizmoTarget, type Overlays } from "./Viewport.tsx";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const readBinary = (accept: string, cb: (bytes: ArrayBuffer, name: string) => void) => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void file.arrayBuffer().then((b) => cb(b, file.name));
  };
  input.click();
};

const readFile = (accept: string, cb: (text: string) => void) => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = () => input.files?.[0]?.text().then(cb);
  input.click();
};

export function App() {
  const [hist, setHist] = useState<History>(() => createHistory(withSubject(newDoc(), ACTOR_STAND)));
  const doc = hist.present;
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<SelectedKey | null>(null);
  const [gizmo, setGizmo] = useState<GizmoTarget>("position");
  const [showPip, setShowPip] = useState(true);
  const [messages, setMessages] = useState<string[]>([]);
  const [recoveredDoc, setRecoveredDoc] = useState<Poses | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [scenes, setScenes] = useState<SceneListing[]>([]);
  const [actors, setActors] = useState<SceneListing[]>([]);
  const [made, setMade] = useState<GeneratedActor[]>([]);
  const [repairCredits, setRepairCredits] = useState(13);
  const [reviewSeed, setReviewSeed] = useState<number | null>(null);
  const [page, setPageState] = useState<Page>(() => pageFromHash(window.location.hash));
  const goPage = useCallback((p: Page) => {
    setPlaying(false);
    setPageState(p);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hashFor(p)}`);
  }, []);
  const [lens, setLens] = useState(false);
  const [depth, setDepth] = useState(false);
  const [guides, setGuides] = useState(true);
  const [snap, setSnap] = useState(false);
  const [overlays, setOverlays] = useState<Overlays>(DEFAULT_OVERLAYS);
  const [ortho, setOrtho] = useState(false);
  const [orthoAuto, setOrthoAuto] = useState(false); // set by a numbered view; orbiting returns to perspective, as in Blender
  const [viewLabel, setViewLabel] = useState("User Perspective");
  const [npanel, setNpanel] = useState(false);
  const [grab, setGrab] = useState<{ frame: number; start: [number, number, number] } | null>(null);
  const [grabInfo, setGrabInfo] = useState<{ axis: "x" | "y" | "z" | null } | null>(null);
  const [viewCmd, setViewCmd] = useState<{ n: number; view: ViewId; framing?: Framing } | undefined>(undefined);
  const sendView = (view: ViewId, framing?: Framing) => setViewCmd((c) => ({ n: (c?.n ?? 0) + 1, view, ...(framing ? { framing } : {}) }));
  /** Front/Right/Top...: leave the camera view, and go orthographic like Blender's "Auto Perspective". */
  const viewTo = (view: ViewId) => { setLens(false); setOrtho(true); setOrthoAuto(true); sendView(view); };
  const preview = useMemo(() => new DepthPreview(), []);
  const [depthImg, setDepthImg] = useState<DepthImage | null>(null);
  const [depthSamples, setDepthSamples] = useState<{ frame: number; stats: DepthStats }[]>([]);
  const [runList, setRunList] = useState<RunListing[]>([]);
  useEffect(() => { listRuns().then(setRunList).catch(() => setRunList([])); }, [run?.id, run?.state]);
  const openRun = (id: string) => getRun(id).then((v) => { setRun(v); if (v.takes.length) setReviewSeed(v.takes[0]!.seed); goPage("review"); }).catch((e: Error) => setMessages([e.message]));
  const openReview = (seed: number) => { setReviewSeed(seed); goPage("review"); };
  // Back/forward and a hand-edited URL change the hash without a reload.
  useEffect(() => {
    const onHash = () => { setPlaying(false); setPageState(pageFromHash(window.location.hash)); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // /?run=<id> reopens a run the server still holds, straight into Review (a reload otherwise loses the run).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("run");
    if (!id) return;
    getRun(id).then((v) => { setRun(v); if (v.takes.length) setReviewSeed(v.takes[0]!.seed); goPage("review"); }).catch((e: Error) => setMessages([`could not load run ${id}: ${e.message}`]));
  }, [goPage]);
  useEffect(() => { getHealth().then((h) => setRepairCredits(h.repairCredits)).catch(() => {}); }, []);
  // Poll a running run here (not in RunPanel, which unmounts when you leave the Generate page).
  const runningId = run?.state === "running" ? run.id : null;
  useEffect(() => {
    if (!runningId) return;
    const t = window.setInterval(() => { getRun(runningId).then(setRun).catch(() => {}); }, 1500);
    return () => window.clearInterval(t);
  }, [runningId]);
  // A repair runs after the run finished, so RunPanel's poller has stopped: poll here while one is in flight.
  const repairingId = run?.repairing ? run.id : null;
  useEffect(() => {
    if (!repairingId) return;
    const t = window.setInterval(() => { getRun(repairingId).then((v) => { setRun(v); if (!v.repairing && v.takes.length) { setRecoveredDoc(null); } }).catch(() => {}); }, 1500);
    return () => window.clearInterval(t);
  }, [repairingId]);
  useEffect(() => { getScenes().then(setScenes).catch(() => setScenes([])); getActors().then((l) => { setActors(l.bundled); setMade(l.generated); }).catch(() => { setActors([]); setMade([]); }); }, []);

  const poses = useMemo(() => sampleShot(exportShot(doc)), [doc]);
  const validation = useMemo(() => validateDoc(doc), [doc]);
  const recovered = useMemo(() => (recoveredDoc ? alignRecovered(recoveredDoc, poses) : null), [recoveredDoc, poses]);
  const rotHere = recovered?.poses.reduce((a, b) => (Math.abs(b.frame - frame) < Math.abs(a.frame - frame) ? b : a)) ?? null;
  const pose = poses[Math.min(frame, poses.length - 1)]!;
  const focal = evalChannel(doc, "focal", frame);
  // Checks need the depth guide's near/far behaviour along the whole path: sample every 8th frame at 64 px, debounced.
  const subjectPos = useMemo(() => (doc.scene.nodes.find((n) => n.id === "subject")?.transform.position as [number, number, number] | undefined) ?? null, [doc.scene]);
  useEffect(() => {
    let dead = false;
    const t = window.setTimeout(() => {
      preview.ready(doc.scene).then(() => {
        if (dead) return;
        const shot = { scene: doc.scene, resolution: doc.resolution };
        const frames = poses.map((p) => p.frame).filter((f) => f % 8 === 0 || f === poses.length - 1);
        setDepthSamples(frames.map((f) => ({ frame: f, stats: preview.render(shot, poses[f]!, 64).stats })));
      }).catch(() => { if (!dead) setDepthSamples([]); });
    }, 300);
    return () => { dead = true; window.clearTimeout(t); };
  }, [doc.scene, doc.resolution, poses, preview]);
  const framing = useMemo(() => framingOf(poses, subjectPos), [poses, subjectPos]);
  const readout = useMemo(() => frameReadout(poses, frame, { subject: subjectPos, sensorHeightMm: doc.sensorHeightMm }), [poses, frame, subjectPos, doc.sensorHeightMm]);
  const checks = useMemo(() => shotChecks(poses, { subject: subjectPos, aspect: doc.resolution.width / doc.resolution.height, depth: depthSamples }), [poses, subjectPos, doc.resolution, depthSamples]);

  // Depth guide preview: the same renderer as the server's guide at reduced size; re-rendered when the frame, camera or scene changes.
  useEffect(() => {
    if (!depth || !lens) { setDepthImg(null); return; }
    let dead = false;
    const t = window.setTimeout(() => {
      preview.ready(doc.scene)
        .then(() => { if (!dead) setDepthImg(preview.render({ scene: doc.scene, resolution: doc.resolution }, pose, lens ? 320 : 224)); })
        .catch((e: Error) => { if (!dead) setMessages([e.message]); });
    }, playing ? 0 : 30);
    return () => { dead = true; window.clearTimeout(t); };
  }, [depth, lens, pose, doc.scene, doc.resolution, playing, preview]);

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
      const goto = pageFromShortcut(e);
      if (goto) { e.preventDefault(); goPage(goto); return; }
      if (page !== "author") return; // Review owns its own keys; Generate has none
      if (isTyping(e.target)) return;
      if (grab) return; // the grab controller owns the keyboard until it ends
      const mod = e.metaKey || e.ctrlKey;
      const vk = viewKey(e);
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setHist((h) => (e.shiftKey ? redo(h) : undo(h)));
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        setHist(redo);
      } else if (e.key === " ") {
        e.preventDefault();
        if (!e.repeat) setPlaying((p) => !p);
      } else if (vk) {
        e.preventDefault();
        if ("view" in vk) viewTo(vk.view);
        else if ("ortho" in vk) { if (!lens) { setOrtho((o) => !o); setOrthoAuto(false); } }
        else if ("camera" in vk) setLens((v) => !v);
        else if ("all" in vk) { setLens(false); sendView("frame"); }
        else frameSelected();
      } else if (!mod && !e.altKey && e.key.toLowerCase() === "l") {
        setLens((v) => !v);
      } else if (!mod && !e.altKey && (e.key.toLowerCase() === "d" || e.key.toLowerCase() === "z")) {
        setDepth((v) => !v);
      } else if (!mod && !e.altKey && e.key.toLowerCase() === "n") {
        setNpanel((v) => !v);
      } else if (!mod && !e.altKey && e.key.toLowerCase() === "g") {
        startGrab();
      } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !mod) {
        e.preventDefault();
        setPlaying(false);
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        setFrame((f) => (e.shiftKey ? (dir < 0 ? 0 : lastFrame) : Math.min(lastFrame, Math.max(0, f + dir))));
      } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !mod) {
        e.preventDefault();
        setPlaying(false);
        setFrame((f) => jumpKey(keyFrames(doc), f, e.key === "ArrowUp" ? 1 : -1));
      } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        edit((d) => deleteKey(d, selected.ch, selected.frame));
        setSelected(null);
      }
    };
    // A focused button also clicks on space KEY-UP; cancel that, or one press toggles twice and does nothing.
    const onUp = (e: KeyboardEvent) => { if (e.key === " " && page === "author" && !isTyping(e.target)) e.preventDefault(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onUp); };
  }, [selected, edit, page, lastFrame, goPage, doc, lens, grab, frame, orthoAuto]);

  /** G: grab the selected position key (or the key at this frame) and move it with the mouse. */
  const startGrab = () => {
    const f = selected?.ch === "position" ? selected.frame : frame;
    const key = doc.position.find((k) => k.frame === f);
    if (!key) { setMessages(["Select a position key (click a sphere on the path) or go to a key frame, then press G."]); return; }
    setMessages([]);
    setLens(false);
    setPlaying(false);
    setSelected({ ch: "position", frame: f });
    setGrab({ frame: f, start: key.value });
  };
  const frameSelected = () => {
    setLens(false);
    const k = selected?.ch === "position" ? doc.position.find((x) => x.frame === selected.frame) : undefined;
    sendView("frame", k ? { center: k.value, radius: 2 } : undefined);
  };

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
      const r = parsePosesDoc(text);
      if (!r.ok) return setMessages(r.errors);
      setRecoveredDoc(r.value);
      setMessages([]);
    });
  const repair = (t: TakeView, segment: number) => {
    if (!run) return;
    repairTake(run.id, t.seed, { segment, strength: 1, ...(run.live ? { confirmCredits: repairCredits } : {}) })
      .then(setRun)
      .catch((e: Error) => setMessages([e.message]));
  };
  const sceneId = sceneIdOf(doc, scenes);
  const chooseScene = (id: string) => {
    const listing = scenes.find((l) => l.id === id);
    if (id === BLOCKING_SCENE_ID) edit((d) => withScene(d, keepSubject(d, blockingScene())));
    else if (listing) edit((d) => withScene(d, keepSubject(d, bundledScene(listing.asset))));
  };
  const doAddModel = () =>
    readBinary(".glb,.gltf,model/gltf-binary,model/gltf+json", (bytes, name) => {
      uploadModel(bytes)
        .then((info) => {
          edit((d) => addModel(d, info));
          setMessages([`${name}: ${info.triangles} triangles added on the ground. Colours are flat in the depth guide; only geometry matters there.`]);
        })
        .catch((e: Error) => setMessages([`${name}: ${e.message}`]));
    });
  const aspectId = aspectIdOf(doc.resolution);
  const sensorId = SENSOR_PRESETS.find((s) => s.heightMm === doc.sensorHeightMm)?.id ?? "custom";

  const goReview = run && run.takes.length > 0;
  const facts = { id: doc.id, frames: doc.frames, seconds: (doc.frames - 1) / FPS, resolution: doc.resolution, focalFrom: evalChannel(doc, "focal", 0), focalTo: evalChannel(doc, "focal", lastFrame) };

  return (
    <div className="app">
      <TopBar page={page} onPage={goPage} canReview={Boolean(goReview)} />
      {page === "author" && (
        <div className="page author">
          <header className="pagehead">
            <span className="blurb">Draw the camera move</span>
            <button disabled={!canUndo(hist)} onClick={() => setHist(undo)}>Undo</button>
            <button disabled={!canRedo(hist)} onClick={() => setHist(redo)}>Redo</button>
            <button onClick={doImport}>Import Shot</button>
            <button onClick={doExport}>Export Shot</button>
            <button onClick={doLoadPoses}>Load poses (recovered)</button>
            {recoveredDoc && <button onClick={() => setRecoveredDoc(null)}>Clear recovered</button>}
            <span className="spacer" />
            <span className="legend"><i className="dot a" />authored <i className="dot r" />recovered</span>
          </header>
          {(messages.length > 0 || !validation.ok) && (
            <ul className="errors">
              {[...messages, ...(validation.ok ? [] : validation.errors)].map((m, i) => <li key={i}>{m}</li>)}
            </ul>
          )}
          <main>
            <aside className="panel">
          <section>
            <h3>Move presets</h3>
            <div className="row wrap">
              {PRESET_IDS.map((id) => (
                <button key={id} onClick={() => { edit((d) => applyPreset(d, id)); setSelected(null); setFrame(0); }}>{PRESET_LABELS[id]}</button>
              ))}
            </div>
            <p className="hint">Replaces all keys with editable ones, framed on the subject.</p>
          </section>
          <ReferencePanel doc={doc} onApply={(d) => { setHist((h) => commit(h, d)); setSelected(null); setFrame(0); setMessages([]); }} />
          <section>
            <h3>Add a key at frame {frame}</h3>
            <div className="row">
              {(["position", "aim", "focal"] as const).map((c) => <button key={c} className="grow" onClick={() => keyHere(c)} title={`Key ${c} at the current frame`}>{c === "position" ? "Position" : c === "aim" ? "Aim" : "Focal"}</button>)}
            </div>
            <p className="hint mono">cam {pose.position.map((v) => v.toFixed(2)).join(", ")}</p>
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
            <h3>Scene</h3>
            <label>
              Subject (what the model sees)
              <select value={subjectAssetOf(doc)} onChange={(e) => edit((d) => withSubject(d, e.target.value))}>
                {actors.map((a) => <option key={a.asset} value={a.asset}>{a.label}</option>)}
                {made.length > 0 && <optgroup label="Generated (this machine only)">{made.map((a) => <option key={a.asset} value={a.asset}>{a.label}</option>)}</optgroup>}
                {!actors.some((a) => a.asset === subjectAssetOf(doc)) && !made.some((a) => a.asset === subjectAssetOf(doc)) && subjectAssetOf(doc) !== SUBJECT_BOX && <option value={subjectAssetOf(doc)}>{subjectAssetOf(doc)}</option>}
                <option value={SUBJECT_BOX}>Box stand-in</option>
              </select>
            </label>
            <p className="hint">The depth guide shows this shape and nothing else of the person. Your prompt says who they are.</p>
            <ActorPanel onMade={(asset) => { getActors().then((l) => { setActors(l.bundled); setMade(l.generated); }).catch(() => undefined); edit((d) => withSubject(d, asset)); }} />
            <label>
              Set
              <select value={sceneId} onChange={(e) => chooseScene(e.target.value)}>
                <option value={BLOCKING_SCENE_ID}>Blocking set (primitives)</option>
                {scenes.map((l) => <option key={l.id} value={l.id}>{l.label} (glTF)</option>)}
                {sceneId === "custom" && <option value="custom">Custom</option>}
              </select>
            </label>
            <button onClick={doAddModel}>Add glTF / GLB...</button>
            {modelNodes(doc).filter((n) => n.id !== "set").map((n) => (
              <div key={n.id} className="row modelrow">
                <span className="mono">{n.id}</span>
                <button onClick={() => edit((d) => removeNode(d, n.id))}>Remove</button>
              </div>
            ))}
            <p className="hint">Models stay in the depth guide the server renders for the takes, so keep them under 200k triangles.</p>
          </section>
          <section>
            <h3>Gizmo</h3>
            <label><input type="radio" checked={gizmo === "position"} onChange={() => setGizmo("position")} /> Position (yellow)</label>
            <label><input type="radio" checked={gizmo === "aim"} onChange={() => setGizmo("aim")} /> Aim (pink)</label>
            <p className="hint">Drag, release to key it at the current frame.</p>
            <label><input type="checkbox" checked={showPip} onChange={(e) => setShowPip(e.target.checked)} /> Camera view</label>
          </section>
            </aside>
        <div className="vp-col">
          <div className="vp-header" role="toolbar" aria-label="Viewport">
            <div className="seg2" title="Editor view, or look through the shot camera (0)">
              <button type="button" className={!lens ? "on" : ""} onClick={() => setLens(false)}>Editor</button>
              <button type="button" className={lens ? "on" : ""} onClick={() => setLens(true)}>Camera</button>
            </div>
            <Menu label="View" title="Standard views (1 front, 3 right, 7 top; Shift for the opposite side)">
              <MenuItem label="Front" keys="1" onClick={() => viewTo("front")} />
              <MenuItem label="Back" keys="Shift 1" onClick={() => viewTo("back")} />
              <MenuItem label="Right" keys="3" onClick={() => viewTo("side")} />
              <MenuItem label="Left" keys="Shift 3" onClick={() => viewTo("left")} />
              <MenuItem label="Top" keys="7" onClick={() => viewTo("top")} />
              <MenuItem label="Bottom" keys="Shift 7" onClick={() => viewTo("bottom")} />
              <hr />
              <MenuItem label={ortho ? "Switch to perspective" : "Switch to orthographic"} keys="5" onClick={() => { if (!lens) { setOrtho((o) => !o); setOrthoAuto(false); } }} />
              <MenuItem label="Camera view" keys="0" onClick={() => setLens((v) => !v)} />
              <hr />
              <MenuItem label="Frame all" keys="Home" onClick={() => { setLens(false); sendView("frame"); }} />
              <MenuItem label="Frame selected key" keys="." onClick={frameSelected} />
            </Menu>
            <div className="seg2" title="Viewport shading (D or Z). Depth shows what the model's depth guide contains.">
              <button type="button" className={!depth ? "on" : ""} onClick={() => setDepth(false)}>Solid</button>
              <button type="button" className={depth ? "on" : ""} onClick={() => setDepth(true)}>Depth</button>
            </div>
            <Menu label="Overlays">
              {([["grid", "Grid"], ["frustum", "Camera frustum"], ["path", "Camera path and keys"], ["ghosts", "Ghost cameras (every 20 frames)"]] as const).map(([k, label]) => (
                <label key={k} className="mi chk"><input type="checkbox" checked={overlays[k]} onChange={(e) => setOverlays({ ...overlays, [k]: e.target.checked })} /> {label}</label>
              ))}
              <label className="mi chk"><input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} /> Composition guides (camera view)</label>
              <label className="mi chk"><input type="checkbox" checked={showPip} onChange={(e) => setShowPip(e.target.checked)} /> Shot camera inset</label>
            </Menu>
            <label title="Snap dragged points to 0.25 m and keep them above the ground"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap</label>
            <span className="spacer" />
            <button type="button" className={npanel ? "on" : ""} onClick={() => setNpanel((v) => !v)} title="Numbers for the shot camera at this frame (N)">Item</button>
          </div>
          <div className="viewport">
            <Viewport
              doc={doc}
              frame={frame}
              poses={poses}
              recovered={recovered}
              gizmo={gizmo}
              showPip={showPip}
              lens={lens}
              ortho={ortho}
              shading={depth ? "depth" : "solid"}
              overlays={overlays}
              viewCmd={viewCmd}
              framing={framing}
              snap={snap}
              grab={grab}
              onGrabPreview={(i) => setGrabInfo(i ? { axis: i.axis } : null)}
              onGrabEnd={(f, pos) => { setGrab(null); setGrabInfo(null); if (pos) edit((d) => upsertKey(d, "position", f, pos)); }}
              onUserOrbit={() => { if (orthoAuto) { setOrtho(false); setOrthoAuto(false); } }}
              onViewLabel={setViewLabel}
              selectedKeyFrame={selected?.ch === "position" ? selected.frame : null}
              onSelectKey={(f) => setSelected({ ch: "position", frame: f })}
              onKeyMove={(f, v) => edit((d) => upsertKey(d, "position", f, snapPoint(v, { on: snap })))}
              onGizmoCommit={(target, value) => edit((d) => upsertKey(d, target, frame, snapPoint(value, { on: snap })))}
              onAssetError={(m) => setMessages([m])}
            />
            {lens
              ? <LensOverlay aspect={doc.resolution.width / doc.resolution.height} resolution={doc.resolution} frame={frame} focalMm={focal} guides={guides} depth={depth} image={depthImg} />
              : <div className="pip-label">Shot camera ({doc.resolution.width}x{doc.resolution.height})</div>}
            <div className="vp-info" aria-live="polite">
              <div className="vp-title">{viewLabel}</div>
              <div className="vp-sub">({frame}) Shot camera{selected?.ch === "position" ? ` | position key ${selected.frame}` : ""}</div>
              {grabInfo && <div className="vp-sub grab">Grab{grabInfo.axis ? ` along ${grabInfo.axis.toUpperCase()}` : ""}: move the mouse. X Y Z constrain, click or Enter confirms, Esc cancels.</div>}
              {checks.length > 0 && <ul className="checks">{checks.map((c) => <li key={c.id} className={c.level}>{c.text}</li>)}</ul>}
            </div>
            {npanel && (
              <ItemPanel
                frame={frame}
                position={evalChannel(doc, "position", frame)}
                aim={evalChannel(doc, "aim", frame)}
                focalMm={focal}
                readout={readout}
                onPosition={(v) => edit((d) => upsertKey(d, "position", frame, snapPoint(v, { on: snap })))}
                onAim={(v) => edit((d) => upsertKey(d, "aim", frame, v))}
                onFocal={(mm) => edit((d) => upsertKey(d, "focal", frame, mm))}
              />
            )}
            <div className="vp-hint">Middle mouse orbits · Shift+middle pans · scroll zooms · Alt+drag orbits without a middle button · G grabs a key · N opens Item</div>
            {rotHere && <div className="rot-readout">recovered camera: {rotHere.rotErrDeg.toFixed(1)}° off the authored aim at frame {rotHere.frame}</div>}
          </div>
        </div>
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
      )}
      {page === "generate" && (
        <GeneratePage
          shot={validation.ok ? validation.value : null}
          facts={facts}
          checks={checks}
          run={run}
          runList={runList}
          onRun={setRun}
          onOpenRun={(id) => void openRun(id)}
          onReview={openReview}
          onRepair={repair}
          repairCredits={repairCredits}
          segments={doc.segments.length}
        />
      )}
      {page === "review" && (goReview ? (
        <Review run={run} seed={reviewSeed ?? run.takes[0]!.seed} onSeed={setReviewSeed} onClose={() => goPage("generate")} onRepair={repair} repairCredits={repairCredits} />
      ) : (
        <div className="page">
          <header className="pagehead"><span className="blurb">Compare each take with the move</span></header>
          <div className="empty big">
            <h2>Nothing to review yet</h2>
            <p>Review compares each generated take with the camera move you drew. Make takes on the Generate page, or open an earlier run there.</p>
            <button type="button" onClick={() => goPage("generate")}>Go to Generate</button>
          </div>
        </div>
      ))}
      <StatusBar shotId={doc.id} valid={validation.ok} run={run} />
    </div>
  );
}
