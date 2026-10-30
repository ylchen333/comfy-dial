// Scene assets a Shot can reference: bundled sets (src/assets/scenes), bundled actors (src/assets/actors) and glTF/GLB files
// uploaded from the studio. A Shot node names them as "scenes/<file>", "actors/<file>" or "uploads/<file>"; nothing else is ever resolved, so no path escapes.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { countTriangles, isPrimitiveAsset, loadGltf, meshBounds, parseGltf, type GltfModel, type Mesh, type MeshResolver, type Vec3 } from "@comfy-dial/rig-core";
import type { Shot } from "@comfy-dial/contracts";
import { SRC_DIR } from "./tools.ts";

export const BUNDLED_SCENES_DIR = resolve(SRC_DIR, "assets/scenes");
export const BUNDLED_ACTORS_DIR = resolve(SRC_DIR, "assets/actors");
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_TRIANGLES = 200_000;

const ASSET_RE = /^(scenes|actors|uploads)\/[A-Za-z0-9_-]+\.(glb|gltf)$/;

export interface SceneListing { id: string; label: string; asset: string }
export interface UploadResult { asset: string; triangles: number; min: Vec3; max: Vec3 }

export class AssetStore {
  private readonly cache = new Map<string, Mesh[]>();
  private readonly uploadsDir: string;
  private readonly scenesDir: string;
  private readonly actorsDir: string;
  constructor(uploadsDir: string, scenesDir = BUNDLED_SCENES_DIR, actorsDir = BUNDLED_ACTORS_DIR) {
    this.uploadsDir = uploadsDir;
    this.scenesDir = scenesDir;
    this.actorsDir = actorsDir;
  }

  /** Absolute file for a Shot asset name, or null if the name is not one we serve or the file is missing. */
  fileFor(asset: string): string | null {
    if (!ASSET_RE.test(asset)) return null;
    const [kind, name] = asset.split("/") as [string, string];
    const file = join(kind === "scenes" ? this.scenesDir : kind === "actors" ? this.actorsDir : this.uploadsDir, name);
    return existsSync(file) ? file : null;
  }

  list(): SceneListing[] {
    if (!existsSync(this.scenesDir)) return [];
    return readdirSync(this.scenesDir)
      .filter((f) => /\.glb$/.test(f))
      .sort()
      .map((f) => ({ id: f.replace(/\.glb$/, ""), label: f.replace(/\.glb$/, "").replace(/^./, (c) => c.toUpperCase()), asset: `scenes/${f}` }));
  }

  /** Bundled actors: static mannequin poses that stand in for the subject in the depth guide. */
  listActors(): SceneListing[] {
    if (!existsSync(this.actorsDir)) return [];
    return readdirSync(this.actorsDir)
      .filter((f) => /^(mannequin_(stand|stride)|dancing_baby)\.glb$/.test(f))
      .sort()
      .map((f) => {
        const id = f.replace(/\.glb$/, "");
        return { id, label: id === "mannequin_stand" ? "Mannequin, standing" : id === "dancing_baby" ? "Dancing baby" : "Mannequin, mid-stride", asset: `actors/${f}` };
      });
  }

  /** Actors generated on this machine (kept beside the uploads, never bundled), newest first. */
  listGenerated(): (SceneListing & { description: string; hasImage: boolean })[] {
    const file = join(this.uploadsDir, "generated-actors.json");
    if (!existsSync(file)) return [];
    try {
      const all = JSON.parse(readFileSync(file, "utf8")) as { asset: string; label: string; description: string }[];
      return all.filter((a) => this.fileFor(a.asset)).reverse().map((a) => ({ id: a.asset.replace(/^uploads\//, "").replace(/\.glb$/, ""), ...a, hasImage: existsSync(join(this.uploadsDir, a.asset.replace(/^uploads\//, "").replace(/\.glb$/, ".png"))) }));
    } catch {
      return [];
    }
  }

  /** Remember a generated actor (and its reference image) so the studio can offer it again. */
  registerGenerated(asset: string, description: string, imagePath?: string): void {
    const file = join(this.uploadsDir, "generated-actors.json");
    let all: { asset: string; label: string; description: string }[] = [];
    try { all = JSON.parse(readFileSync(file, "utf8")) as typeof all; } catch { /* first one */ }
    all = all.filter((a) => a.asset !== asset);
    all.push({ asset, label: description.length > 40 ? `${description.slice(0, 37)}...` : description || "From photo", description });
    mkdirSync(this.uploadsDir, { recursive: true });
    writeFileSync(file, JSON.stringify(all));
    if (imagePath) copyFileSync(imagePath, join(this.uploadsDir, asset.replace(/^uploads\//, "").replace(/\.glb$/, ".png")));
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

  private readonly models = new Map<string, GltfModel>();

  private model(asset: string): GltfModel {
    let m = this.models.get(asset);
    if (!m) {
      const file = this.fileFor(asset);
      if (!file) throw new Error(`scene asset ${asset} not found (expected scenes/<file>.glb or uploads/<file>.glb)`);
      m = loadGltf(new Uint8Array(readFileSync(file)));
      this.models.set(asset, m);
    }
    return m;
  }

  /** The renderer's resolver (parsed models are cached for the life of the store). Assets with a node animation are posed per frame by the renderer. */
  resolver(): MeshResolver {
    const r: MeshResolver = (asset) => {
      const hit = this.cache.get(asset);
      if (hit) return hit;
      const meshes = this.model(asset).meshesAt();
      this.cache.set(asset, meshes);
      return meshes;
    };
    r.animated = (asset) => (isPrimitiveAsset(asset) ? null : this.model(asset));
    return r;
  }

  /** Content hash of every non-primitive asset a Shot uses, so a changed file never reuses a cached guide. */
  contentKey(shot: Pick<Shot, "scene">): string {
    const h = createHash("sha1");
    for (const n of shot.scene.nodes) {
      if (isPrimitiveAsset(n.asset)) continue;
      const file = this.fileFor(n.asset);
      h.update(n.asset);
      if (file) { h.update(readFileSync(file)); if (this.model(n.asset).animation) h.update("animated-v1"); } // rendering changed for animated files: never reuse an older static guide
    }
    return h.digest("hex");
  }
}

export const hasMeshNodes = (shot: Pick<Shot, "scene">) => shot.scene.nodes.some((n) => !isPrimitiveAsset(n.asset));
