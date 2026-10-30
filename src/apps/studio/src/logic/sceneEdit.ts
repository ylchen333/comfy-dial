// Editing the objects in the scene: location, rotation (degrees, XYZ order like Blender), scale, duplicate.
// The Shot stores a quaternion, so rotation is converted at the edges; everything else is the same transform the depth guide renders.
import type { Shot } from "@comfy-dial/contracts";
import type { Quat, Vec3 } from "@comfy-dial/rig-core";
import { withScene } from "./scenes.ts";
import type { StudioDoc } from "./types.ts";

export type SceneNode = Shot["scene"]["nodes"][number];
export type Transform = SceneNode["transform"];

const D2R = Math.PI / 180;

/** Euler XYZ (intrinsic, degrees) to quaternion [x, y, z, w], three.js's "XYZ" order. */
export function quatFromEulerDeg([ex, ey, ez]: Vec3): Quat {
  const [c1, c2, c3] = [Math.cos((ex * D2R) / 2), Math.cos((ey * D2R) / 2), Math.cos((ez * D2R) / 2)];
  const [s1, s2, s3] = [Math.sin((ex * D2R) / 2), Math.sin((ey * D2R) / 2), Math.sin((ez * D2R) / 2)];
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}

/** Quaternion to Euler XYZ degrees (the inverse of quatFromEulerDeg, within gimbal limits). */
export function eulerDegFromQuat([x, y, z, w]: Quat): Vec3 {
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - z * w), m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - x * w), m33 = 1 - 2 * (x * x + y * y);
  const m32 = 2 * (y * z + x * w);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  const [ex, ez] = Math.abs(m13) < 0.9999999 ? [Math.atan2(-m23, m33), Math.atan2(-m12, m11)] : [Math.atan2(m32, m22), 0];
  const clean = (r: number) => { const d = r / D2R; return Math.abs(d) < 1e-9 ? 0 : d; };
  return [clean(ex), clean(ey), clean(ez)];
}

const MIN_SCALE = 0.01;

export interface TransformPatch { position?: Vec3; rotationDeg?: Vec3; scale?: Vec3; quaternion?: Quat }

/** Change one node's transform. Scale is kept positive; an unknown id leaves the doc as it was. */
export function updateNode(doc: StudioDoc, id: string, patch: TransformPatch): StudioDoc {
  if (!doc.scene.nodes.some((n) => n.id === id)) return doc;
  const nodes = doc.scene.nodes.map((n) => {
    if (n.id !== id) return n;
    const t = n.transform;
    const quaternion = patch.rotationDeg ? quatFromEulerDeg(patch.rotationDeg) : patch.quaternion ?? t.quaternion;
    const scale = (patch.scale ?? t.scale).map((s) => Math.max(MIN_SCALE, s)) as Vec3;
    return { ...n, transform: { position: patch.position ?? t.position, quaternion, scale } };
  });
  return withScene(doc, { nodes });
}

/** The nodes the user can pick and move: everything except the ground plane (which has its own switch). */
export const editableNodes = (doc: Pick<StudioDoc, "scene">): SceneNode[] => doc.scene.nodes.filter((n) => n.id !== "ground");

/** Short name for a node in lists: the id, plus what it is. */
export function nodeLabel(n: SceneNode): string {
  if (n.id === "subject") return "Subject";
  const what = n.asset.startsWith("primitive:") ? n.asset.replace("primitive:", "") : n.asset.split("/").pop()!.replace(/\.(glb|gltf)$/, "");
  return n.id === what ? n.id : `${n.id} (${what})`;
}

/** Duplicate a node beside the original (0.5 m along x). The subject is a single role, so it can't be copied. */
export function duplicateNode(doc: StudioDoc, id: string): { doc: StudioDoc; id: string } | null {
  const src = doc.scene.nodes.find((n) => n.id === id);
  if (!src || id === "subject" || id === "ground") return null;
  const base = id.replace(/_\d+$/, "");
  const taken = new Set(doc.scene.nodes.map((n) => n.id));
  let k = 1;
  while (taken.has(`${base}_${k}`)) k++;
  const copy: SceneNode = { ...src, id: `${base}_${k}`, transform: { ...src.transform, position: [src.transform.position[0] + 0.5, src.transform.position[1], src.transform.position[2]] } };
  return { doc: withScene(doc, { nodes: [...doc.scene.nodes, copy] }), id: copy.id };
}

/** Subject and ground are structural: presets aim at the subject and the ground has a switch, so neither can be removed here. */
export const canRemoveNode = (id: string) => id !== "subject" && id !== "ground";
