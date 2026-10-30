// Live preview of the depth guide the model will receive: the SAME rig-core renderer and fixed normalization as the server's
// guide, run at reduced resolution (vertical FOV is unchanged, so the framing is identical).
import type { Shot } from "@comfy-dial/contracts";
import { animatedNodes, buildPrims, DEFAULT_DEPTH_NORM, isPrimitiveAsset, loadGltf, renderFrame, type GltfModel, type MeshResolver, type Pose } from "@comfy-dial/rig-core";
import { assetUrl } from "./scenes.ts";

export interface DepthStats {
  /** Fraction of the frame with geometry closer than the near plane (depth saturates to white there). */
  nearFrac: number;
  /** Fraction of the frame that is sky or beyond the far plane (black in the guide). */
  emptyFrac: number;
  /** Nearest visible surface, metres (Infinity when the frame is empty). */
  minZ: number;
}
export interface DepthImage { width: number; height: number; rgba: Uint8ClampedArray; stats: DepthStats }

type Prims = ReturnType<typeof buildPrims>;

export class DepthPreview {
  private meshes = new Map<string, GltfModel>();
  private resolver: MeshResolver = Object.assign((asset: string) => {
    const m = this.meshes.get(asset);
    if (!m) throw new Error(`scene asset ${asset} is not loaded yet`);
    return m.meshesAt();
  }, { animated: (asset: string) => this.meshes.get(asset) ?? null });
  private moving: number[] = [];
  private prims: Prims | null = null;
  private key = "";

  /** Fetch and parse any glTF the scene uses (cached). Rejects with a readable message if a file cannot be loaded. */
  async ready(scene: Shot["scene"]): Promise<void> {
    for (const n of scene.nodes) {
      if (isPrimitiveAsset(n.asset) || this.meshes.has(n.asset)) continue;
      const res = await fetch(assetUrl(n.asset));
      if (!res.ok) throw new Error(`could not load ${n.asset} for the depth preview (HTTP ${res.status})`);
      this.meshes.set(n.asset, loadGltf(new Uint8Array(await res.arrayBuffer())));
    }
  }

  /** Render one frame at `width` pixels wide (height follows the shot's aspect). Call ready(scene) first for glTF scenes. */
  render(shot: Pick<Shot, "scene" | "resolution">, pose: Pick<Pose, "position" | "quaternion" | "fov_v_deg"> & { t?: number }, width = 192): DepthImage {
    const key = JSON.stringify(shot.scene);
    if (!this.prims || key !== this.key) {
      this.prims = buildPrims(shot.scene, this.resolver);
      this.moving = animatedNodes(shot.scene, this.resolver);
      this.key = key;
    }
    let prims = this.prims;
    if (this.moving.length && pose.t !== undefined) {
      // animated actors (the dancing baby) are posed for this frame's time, exactly as the server renders the guide
      const fresh = buildPrims({ nodes: this.moving.map((i) => shot.scene.nodes[i]!) }, this.resolver, pose.t);
      prims = prims.map((p, i) => (this.moving.includes(i) ? fresh[this.moving.indexOf(i)]! : p));
    }
    const w = Math.max(16, Math.round(width));
    const h = Math.max(16, Math.round((w * shot.resolution.height) / shot.resolution.width));
    const f = renderFrame({ scene: shot.scene, resolution: { width: w, height: h } }, pose, DEFAULT_DEPTH_NORM, prims);
    const rgba = new Uint8ClampedArray(w * h * 4);
    let near = 0, empty = 0, minZ = Infinity;
    for (let i = 0; i < w * h; i++) {
      const v = f.depth8[i]!;
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
      rgba[i * 4 + 3] = 255;
      const z = f.depthZ[i]!;
      if (z >= DEFAULT_DEPTH_NORM.far) empty++;
      else { if (z < DEFAULT_DEPTH_NORM.near) near++; if (z < minZ) minZ = z; }
    }
    return { width: w, height: h, rgba, stats: { nearFrac: near / (w * h), emptyFrac: empty / (w * h), minZ } };
  }
}
