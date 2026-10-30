import { eulerDegFromQuat, nodeLabel, type SceneNode, type TransformPatch } from "../logic/sceneEdit.ts";
import type { Vec3 } from "@comfy-dial/rig-core";
import { Num } from "./ItemPanel.tsx";

export type TransformMode = "translate" | "rotate" | "scale";

interface Props {
  nodes: SceneNode[];
  selectedId: string | null;
  mode: TransformMode;
  canRemove: boolean;
  canDuplicate: boolean;
  onSelect: (id: string | null) => void;
  onMode: (m: TransformMode) => void;
  onChange: (id: string, patch: TransformPatch) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
}

const set = (v: Vec3, i: number, x: number): Vec3 => v.map((c, k) => (k === i ? x : c)) as Vec3;
const AXES = ["X", "Y", "Z"] as const;

/** Pick an object in the scene and type its location, rotation and scale. The same numbers feed the depth guide the model gets. */
export function ObjectPanel({ nodes, selectedId, mode, canRemove, canDuplicate, onSelect, onMode, onChange, onDuplicate, onRemove }: Props) {
  const node = nodes.find((n) => n.id === selectedId) ?? null;
  const t = node?.transform;
  const rot = t ? eulerDegFromQuat(t.quaternion) : null;
  return (
    <div className="objpanel">
      <div className="objlist" role="listbox" aria-label="Scene objects">
        {nodes.map((n) => (
          <button key={n.id} type="button" role="option" aria-selected={n.id === selectedId} className={n.id === selectedId ? "on" : ""} onClick={() => onSelect(n.id === selectedId ? null : n.id)}>
            {nodeLabel(n)}
          </button>
        ))}
      </div>
      {!node && <p className="hint">Click an object here or in the viewport to move it.</p>}
      {node && t && rot && (
        <>
          <div className="seg2" role="group" aria-label="Tool">
            {([["translate", "Move", "W"], ["rotate", "Rotate", "E"], ["scale", "Scale", "R"]] as const).map(([m, label, key]) => (
              <button key={m} type="button" className={mode === m ? "on" : ""} title={`${label} (${key})`} onClick={() => onMode(m)}>{label}</button>
            ))}
          </div>
          <div className="group"><span className="gl">Location (m)</span>
            {AXES.map((a, i) => <Num key={a} label={a} value={t.position[i]!} onCommit={(x) => onChange(node.id, { position: set(t.position, i, x) })} />)}
          </div>
          <div className="group"><span className="gl">Rotation (deg)</span>
            {AXES.map((a, i) => <Num key={a} label={a} value={rot[i]!} step={5} onCommit={(x) => onChange(node.id, { rotationDeg: set(rot, i, x) })} />)}
          </div>
          <div className="group"><span className="gl">Scale</span>
            {AXES.map((a, i) => <Num key={a} label={a} value={t.scale[i]!} onCommit={(x) => onChange(node.id, { scale: set(t.scale, i, x) })} />)}
            <button type="button" onClick={() => { const s = t.scale[0]!; onChange(node.id, { scale: [s, s, s] }); }} title="Make all three axes equal to X">Make uniform</button>
          </div>
          <div className="row">
            <button type="button" onClick={() => onChange(node.id, { rotationDeg: [0, 0, 0] })}>Reset rotation</button>
            {canDuplicate && <button type="button" onClick={() => onDuplicate(node.id)}>Duplicate</button>}
            {canRemove && <button type="button" onClick={() => onRemove(node.id)}>Remove</button>}
          </div>
          {node.id === "subject" && <p className="hint">The subject is where presets aim the camera. Actors stand on the ground at Y 0.9.</p>}
        </>
      )}
    </div>
  );
}
