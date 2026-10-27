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

/** Which scene the doc shows: "blocking", a bundled id, or "custom" when models were added or the nodes were changed. */
export function sceneIdOf(doc: Pick<StudioDoc, "scene">, listings: readonly SceneListing[]): string {
  const nodes = doc.scene.nodes;
  if (nodes.every((n) => !isModelAsset(n.asset))) return BLOCKING_SCENE_ID;
  const set = nodes.find((n) => n.id === "set");
  const hit = listings.find((l) => l.asset === set?.asset);
  return hit && nodes.length === 2 ? hit.id : "custom";
}

export function withScene(doc: StudioDoc, scene: Shot["scene"]): StudioDoc {
  return { ...doc, scene };
}

export const modelNodes = (doc: Pick<StudioDoc, "scene">): Node[] => doc.scene.nodes.filter((n) => isModelAsset(n.asset));

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
