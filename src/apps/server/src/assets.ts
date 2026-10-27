// Scene assets a Shot can reference: bundled sets (src/assets/scenes) and glTF/GLB files uploaded from the studio.
// A Shot node names them as "scenes/<file>" or "uploads/<file>"; nothing else is ever resolved, so no path escapes.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { countTriangles, isPrimitiveAsset, meshBounds, parseGltf, type Mesh, type MeshResolver, type Vec3 } from "@comfy-osh/rig-core";
import type { Shot } from "@comfy-osh/contracts";
import { SRC_DIR } from "./tools.ts";

export const BUNDLED_SCENES_DIR = resolve(SRC_DIR, "assets/scenes");
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_TRIANGLES = 200_000;

const ASSET_RE = /^(scenes|uploads)\/[A-Za-z0-9_-]+\.(glb|gltf)$/;

export interface SceneListing { id: string; label: string; asset: string }
export interface UploadResult { asset: string; triangles: number; min: Vec3; max: Vec3 }

export class AssetStore {
  private readonly cache = new Map<string, Mesh[]>();
  private readonly uploadsDir: string;
  private readonly scenesDir: string;
  constructor(uploadsDir: string, scenesDir = BUNDLED_SCENES_DIR) {
    this.uploadsDir = uploadsDir;
    this.scenesDir = scenesDir;
  }

  /** Absolute file for a Shot asset name, or null if the name is not one we serve or the file is missing. */
  fileFor(asset: string): string | null {
    if (!ASSET_RE.test(asset)) return null;
    const [kind, name] = asset.split("/") as [string, string];
    const file = join(kind === "scenes" ? this.scenesDir : this.uploadsDir, name);
    return existsSync(file) ? file : null;
  }

  list(): SceneListing[] {
    if (!existsSync(this.scenesDir)) return [];
    return readdirSync(this.scenesDir)
      .filter((f) => /\.glb$/.test(f))
      .sort()
      .map((f) => ({ id: f.replace(/\.glb$/, ""), label: f.replace(/\.glb$/, "").replace(/^./, (c) => c.toUpperCase()), asset: `scenes/${f}` }));
  }

  /** Validate bytes as glTF, store them under a content hash, and say how big the model is. */
  save(bytes: Uint8Array): UploadResult {
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error(`file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
    const meshes = parseGltf(bytes); // throws a readable error for anything unsupported
    const triangles = countTriangles(meshes);
    if (triangles > MAX_TRIANGLES) throw new Error(`${triangles} triangles is too many for the depth renderer (limit ${MAX_TRIANGLES}); decimate the model first`);
    const isGlb = bytes.byteLength >= 4 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === 0x46546c67;
    const name = `${createHash("sha1").update(bytes).digest("hex").slice(0, 12)}.${isGlb ? "glb" : "gltf"}`;
    mkdirSync(this.uploadsDir, { recursive: true });
    const file = join(this.uploadsDir, name);
    if (!existsSync(file)) writeFileSync(file, bytes);
    const { min, max } = meshBounds(meshes);
    return { asset: `uploads/${name}`, triangles, min, max };
  }

  /** The renderer's resolver (parsed meshes are cached for the life of the store). */
  resolver(): MeshResolver {
    return (asset) => {
      const hit = this.cache.get(asset);
      if (hit) return hit;
      const file = this.fileFor(asset);
      if (!file) throw new Error(`scene asset ${asset} not found (expected scenes/<file>.glb or uploads/<file>.glb)`);
      const meshes = parseGltf(new Uint8Array(readFileSync(file)));
      this.cache.set(asset, meshes);
      return meshes;
    };
  }

  /** Content hash of every non-primitive asset a Shot uses, so a changed file never reuses a cached guide. */
  contentKey(shot: Pick<Shot, "scene">): string {
    const h = createHash("sha1");
    for (const n of shot.scene.nodes) {
      if (isPrimitiveAsset(n.asset)) continue;
      const file = this.fileFor(n.asset);
      h.update(n.asset);
      if (file) h.update(readFileSync(file));
    }
    return h.digest("hex");
  }
}

export const hasMeshNodes = (shot: Pick<Shot, "scene">) => shot.scene.nodes.some((n) => !isPrimitiveAsset(n.asset));
