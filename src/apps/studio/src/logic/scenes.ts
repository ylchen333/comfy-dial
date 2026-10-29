// Scene choices: the primitive blocking set, the bundled glTF sets, and glTF/GLB models added by the user.
import type { Shot } from "@comfy-osh/contracts";
import type { Vec3 } from "@comfy-osh/rig-core";
import { DEFAULT_SCENE_NODES } from "./keys.ts";
import type { StudioDoc } from "./types.ts";

export interface SceneListing { id: string; label: string; asset: string }
export interface UploadInfo { asset: string; triangles: number; min: Vec3; max: Vec3 }

export const BLOCKING_SCENE_ID = "blocking";
export const isModelAsset = (asset: string) => !asset.startsWith("primitive:");

type Node = Shot["scene"]["nodes"][number];
const IDENTITY: Node["transform"] = { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] };
const SUBJECT = DEFAULT_SCENE_NODES.nodes.find((n) => n.id === "subject")!;

/** A bundled set: the model plus the subject stand-in (presets frame on the node called "subject"). */
export function bundledScene(asset: string): Shot["scene"] {
  return { nodes: [{ id: "set", asset, transform: IDENTITY }, SUBJECT] };
}

/** Which scene the doc shows: "blocking", a bundled id, or "custom" when models were added or the nodes were changed. The subject node is judged separately (see withSubject). */
export function sceneIdOf(doc: Pick<StudioDoc, "scene">, listings: readonly SceneListing[]): string {
  const nodes = doc.scene.nodes.filter((n) => n.id !== "subject");
  if (nodes.every((n) => !isModelAsset(n.asset))) return BLOCKING_SCENE_ID;
  const set = nodes.find((n) => n.id === "set");
  const hit = listings.find((l) => l.asset === set?.asset);
  return hit && nodes.length === 1 ? hit.id : "custom";
}

/** The standing mannequin: the studio's default subject, so the depth guide shows a person-shaped silhouette. */
export const ACTOR_STAND = "actors/mannequin_stand.glb";
export const SUBJECT_BOX = "primitive:box";

/**
 * Change what the subject looks like to the model. Position stays where it is (presets, framing and checks aim at it);
 * actors are authored with their origin at the body centre, so a subject at y = 0.9 stands on the ground.
 */
export function withSubject(doc: StudioDoc, asset: string): StudioDoc {
  const old = doc.scene.nodes.find((n) => n.id === "subject");
  const base = old?.transform ?? SUBJECT.transform;
  const transform: Node["transform"] = asset === SUBJECT_BOX
    ? { position: base.position, quaternion: IDENTITY.quaternion, scale: SUBJECT.transform.scale }
    : { position: base.position, quaternion: IDENTITY.quaternion, scale: [1, 1, 1] };
  const node: Node = { id: "subject", asset, transform };
  const nodes = old ? doc.scene.nodes.map((n) => (n.id === "subject" ? node : n)) : [...doc.scene.nodes, node];
  return withScene(doc, { nodes });
}

/** The asset the subject currently uses. */
export const subjectAssetOf = (doc: Pick<StudioDoc, "scene">): string => doc.scene.nodes.find((n) => n.id === "subject")?.asset ?? SUBJECT_BOX;

/** Switch to another set while keeping the subject the user chose. */
export function keepSubject(doc: Pick<StudioDoc, "scene">, scene: Shot["scene"]): Shot["scene"] {
  const mine = doc.scene.nodes.find((n) => n.id === "subject");
  return mine ? { nodes: scene.nodes.map((n) => (n.id === "subject" ? mine : n)) } : scene;
}

export function withScene(doc: StudioDoc, scene: Shot["scene"]): StudioDoc {
  return { ...doc, scene };
}

/** Models the user added or the set uses (not the subject: that has its own control). */
export const modelNodes = (doc: Pick<StudioDoc, "scene">): Node[] => doc.scene.nodes.filter((n) => isModelAsset(n.asset) && n.id !== "subject");

/** Add an uploaded model standing on the ground (y = 0), x/z as authored. */
export function addModel(doc: StudioDoc, up: Pick<UploadInfo, "asset" | "min">): StudioDoc {
  const taken = new Set(doc.scene.nodes.map((n) => n.id));
  let k = 1;
  while (taken.has(`model_${k}`)) k++;
  const node: Node = { id: `model_${k}`, asset: up.asset, transform: { ...IDENTITY, position: [0, -up.min[1], 0] } };
  return withScene(doc, { nodes: [...doc.scene.nodes, node] });
}

export function removeNode(doc: StudioDoc, id: string): StudioDoc {
  return withScene(doc, { nodes: doc.scene.nodes.filter((n) => n.id !== id) });
}

/** The ground plane exists in the Shot (and so in the depth guide) only when the scene has a "ground" node. */
export const hasGround = (doc: Pick<StudioDoc, "scene">) => doc.scene.nodes.some((n) => n.id === "ground");

/** URL the viewport loads a model from. */
export const assetUrl = (asset: string) => `/api/assets/${asset}`;

export function blockingScene(): Shot["scene"] {
  return DEFAULT_SCENE_NODES;
}
