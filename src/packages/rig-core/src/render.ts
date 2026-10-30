// Offscreen renderer (pure TS, no GL): analytic ray-casting of the Shot's primitive scene.
// Produces an RGB frame and a depth frame. Depth is view-space z (distance along the camera
// forward axis), normalized with a FIXED near/far for the whole clip, never per frame:
//   v = clamp(1 - ln(z / near) / ln(far / near), 0, 1)   (near -> 1 white, far/sky -> 0 black)
import type { Shot } from "@comfy-dial/contracts";
import { quatToMat3, type Quat, type Vec3 } from "./math.ts";
import { vFovDegToFocalPx } from "./fov.ts";
import type { Pose } from "./sampler.ts";
import { buildBvh, hitBvh, isPrimitiveAsset, meshHit, type MeshResolver, type WorldBvh } from "./mesh.ts";

export interface DepthNormalization {
  mode: "fixed";
  kind: "log";
  near: number;
  far: number;
}
export const DEFAULT_DEPTH_NORM: DepthNormalization = { mode: "fixed", kind: "log", near: 1, far: 100 };

export function normalizeDepth(z: number, n: DepthNormalization = DEFAULT_DEPTH_NORM): number {
  const c = Math.min(Math.max(z, n.near), n.far);
  return Math.min(1, Math.max(0, 1 - Math.log(c / n.near) / Math.log(n.far / n.near)));
}
/** Inverse of normalizeDepth (v in [0,1] -> metres). */
export function denormalizeDepth(v: number, n: DepthNormalization = DEFAULT_DEPTH_NORM): number {
  return n.near * Math.exp((1 - v) * Math.log(n.far / n.near));
}

type Kind = "plane" | "box" | "cylinder" | "mesh";
interface Prim {
  kind: Kind;
  id: string;
  A: number[]; // world -> local linear part: S^-1 R^T (row-major)
  o: Vec3; // camera origin in local space (filled per frame)
  R: number[]; // local -> world rotation (normal transform: R S^-1)
  invS: Vec3;
  pos: Vec3;
  color: Vec3;
  bvh?: WorldBvh; // kind "mesh": triangles already in world space
}

const COLORS: Record<string, Vec3> = {
  ground: [0.42, 0.55, 0.38],
  subject: [0.9, 0.55, 0.25],
  pillar_l: [0.35, 0.5, 0.85],
  pillar_r: [0.35, 0.5, 0.85],
};

/** Nodes whose asset has a node animation (they are re-posed for every frame). */
export function animatedNodes(scene: Shot["scene"], meshes?: MeshResolver): number[] {
  if (!meshes?.animated) return [];
  return scene.nodes.flatMap((n, i) => (!isPrimitiveAsset(n.asset) && meshes.animated!(n.asset)?.animation ? [i] : []));
}

/** `t` is the shot time in seconds; it poses animated glTF nodes (looped clip), and is ignored for everything else. */
export function buildPrims(scene: Shot["scene"], meshes?: MeshResolver, t?: number): Prim[] {
  return scene.nodes.map((n) => {
    const R = quatToMat3(n.transform.quaternion as Quat);
    const s = n.transform.scale;
    if (!isPrimitiveAsset(n.asset)) {
      if (!meshes) throw new Error(`asset ${n.asset} needs a mesh resolver (glTF/GLB nodes cannot be rendered without one)`);
      const model = t === undefined ? null : meshes.animated?.(n.asset);
      const bvh = buildBvh(model?.animation ? model.meshesAt(t) : meshes(n.asset), n.transform.position as Vec3, R, s as Vec3);
      return { kind: "mesh", id: n.id, A: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0, 0, 0], R, invS: [1, 1, 1], pos: [0, 0, 0], color: [0.7, 0.7, 0.7], bvh };
    }
    const kind = n.asset.replace("primitive:", "") as Kind;
    if (kind !== "plane" && kind !== "box" && kind !== "cylinder") throw new Error(`unsupported asset ${n.asset}`);
    const invS: Vec3 = [1 / s[0], 1 / s[1], 1 / s[2]];
    // A = S^-1 * R^T
    const A = [
      R[0]! * invS[0], R[3]! * invS[0], R[6]! * invS[0],
      R[1]! * invS[1], R[4]! * invS[1], R[7]! * invS[1],
      R[2]! * invS[2], R[5]! * invS[2], R[8]! * invS[2],
    ];
    return { kind, id: n.id, A, o: [0, 0, 0], R, invS, pos: n.transform.position as Vec3, color: COLORS[n.id] ?? [0.7, 0.7, 0.7] };
  });
}

// Scratch for the winning hit.
const hit = { t: Infinity, nx: 0, ny: 0, nz: 0, lx: 0, ly: 0, lz: 0 };

function setHit(t: number, nx: number, ny: number, nz: number, lx: number, ly: number, lz: number) {
  hit.t = t; hit.nx = nx; hit.ny = ny; hit.nz = nz; hit.lx = lx; hit.ly = ly; hit.lz = lz;
}

const EPS = 1e-6;

function hitPlane(o: Vec3, dx: number, dy: number, dz: number, best: number): boolean {
  if (Math.abs(dz) < 1e-12) return false;
  const t = -o[2] / dz;
  if (t <= EPS || t >= best) return false;
  const x = o[0] + t * dx, y = o[1] + t * dy;
  if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) return false;
  setHit(t, 0, 0, dz > 0 ? -1 : 1, x, y, 0);
  return true;
}

function hitBox(o: Vec3, dx: number, dy: number, dz: number, best: number): boolean {
  let tmin = -Infinity, tmax = Infinity, axis = 0, sgn = 1;
  const oo = [o[0], o[1], o[2]], dd = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    const d = dd[a]!, p = oo[a]!;
    if (Math.abs(d) < 1e-12) {
      if (Math.abs(p) > 0.5) return false;
      continue;
    }
    let t0 = (-0.5 - p) / d, t1 = (0.5 - p) / d, s = -1;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; s = 1; }
    if (t0 > tmin) { tmin = t0; axis = a; sgn = s; }
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return false;
  }
  if (tmin <= EPS || tmin >= best) return false;
  setHit(tmin, axis === 0 ? sgn : 0, axis === 1 ? sgn : 0, axis === 2 ? sgn : 0, oo[0]! + tmin * dx, oo[1]! + tmin * dy, oo[2]! + tmin * dz);
  return true;
}

function hitCylinder(o: Vec3, dx: number, dy: number, dz: number, best: number): boolean {
  const R2 = 0.25;
  let found = false;
  const a = dx * dx + dz * dz;
  if (a > 1e-12) {
    const b = o[0] * dx + o[2] * dz;
    const c = o[0] * o[0] + o[2] * o[2] - R2;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / a, (-b + sq) / a]) {
        if (t > EPS && t < best) {
          const y = o[1] + t * dy;
          if (Math.abs(y) <= 0.5) {
            const x = o[0] + t * dx, z = o[2] + t * dz;
            setHit(t, x / 0.5, 0, z / 0.5, x, y, z);
            best = t; found = true;
            break;
          }
        }
      }
    }
  }
  if (Math.abs(dy) > 1e-12) {
    for (const sy of [-0.5, 0.5]) {
      const t = (sy - o[1]) / dy;
      if (t > EPS && t < best) {
        const x = o[0] + t * dx, z = o[2] + t * dz;
        if (x * x + z * z <= R2) {
          setHit(t, 0, sy > 0 ? 1 : -1, 0, x, sy, z);
          best = t; found = true;
        }
      }
    }
  }
  return found;
}

const SUN = (() => {
  const v = [0.4, 0.8, 0.5];
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / n, v[1]! / n, v[2]! / n];
})();

function checker(prim: Prim, lx: number, ly: number, lz: number): number {
  let k: number;
  if (prim.kind === "plane") k = Math.floor(lx * 20) + Math.floor(ly * 20); // 1 m cells on the 20 m ground
  else if (prim.kind === "box") k = Math.floor(lx * 4) + Math.floor(ly * 8) + Math.floor(lz * 4);
  else k = Math.floor((Math.atan2(lz, lx) / Math.PI) * 6) + Math.floor(ly * 6);
  return (k & 1) === 0 ? 1 : 0.72;
}

export interface Frame {
  width: number;
  height: number;
  rgb: Uint8Array; // W*H*3
  depthZ: Float32Array; // metres, view-space z; far for sky
  depth8: Uint8Array; // fixed-normalized, 8 bit
}

export function renderFrame(
  shot: Pick<Shot, "scene" | "resolution">,
  pose: Pick<Pose, "position" | "quaternion" | "fov_v_deg">,
  norm: DepthNormalization = DEFAULT_DEPTH_NORM,
  prims: Prim[] = buildPrims(shot.scene),
): Frame {
  const { width: W, height: H } = shot.resolution;
  const f = vFovDegToFocalPx(pose.fov_v_deg, H);
  const Rc = quatToMat3(pose.quaternion);
  const cam = pose.position;
  // camera axes in world space (columns of Rc)
  const rx = [Rc[0]!, Rc[3]!, Rc[6]!], ry = [Rc[1]!, Rc[4]!, Rc[7]!], rz = [Rc[2]!, Rc[5]!, Rc[8]!];
  for (const p of prims) {
    if (p.bvh) continue;
    const dx = cam[0] - p.pos[0], dy = cam[1] - p.pos[1], dz = cam[2] - p.pos[2];
    const A = p.A;
    p.o = [A[0]! * dx + A[1]! * dy + A[2]! * dz, A[3]! * dx + A[4]! * dy + A[5]! * dz, A[6]! * dx + A[7]! * dy + A[8]! * dz];
  }
  const rgb = new Uint8Array(W * H * 3);
  const depthZ = new Float32Array(W * H);
  const depth8 = new Uint8Array(W * H);
  for (let py = 0; py < H; py++) {
    const yn = -(py + 0.5 - H / 2) / f;
    for (let px = 0; px < W; px++) {
      const xn = (px + 0.5 - W / 2) / f;
      // world direction of (xn, yn, -1); z-depth == ray parameter t
      const wx = xn * rx[0]! + yn * ry[0]! - rz[0]!;
      const wy = xn * rx[1]! + yn * ry[1]! - rz[1]!;
      const wz = xn * rx[2]! + yn * ry[2]! - rz[2]!;
      let best = Infinity, bi = -1;
      let bnx = 0, bny = 0, bnz = 0, blx = 0, bly = 0, blz = 0, btri = -1;
      for (let i = 0; i < prims.length; i++) {
        const p = prims[i]!, A = p.A;
        if (p.bvh) {
          if (hitBvh(p.bvh, cam[0], cam[1], cam[2], wx, wy, wz, best)) {
            best = meshHit.t; bi = i; btri = meshHit.tri;
            bnx = meshHit.nx; bny = meshHit.ny; bnz = meshHit.nz;
          }
          continue;
        }
        const dx = A[0]! * wx + A[1]! * wy + A[2]! * wz;
        const dy = A[3]! * wx + A[4]! * wy + A[5]! * wz;
        const dz = A[6]! * wx + A[7]! * wy + A[8]! * wz;
        const ok = p.kind === "plane" ? hitPlane(p.o, dx, dy, dz, best) : p.kind === "box" ? hitBox(p.o, dx, dy, dz, best) : hitCylinder(p.o, dx, dy, dz, best);
        if (ok) {
          best = hit.t; bi = i;
          bnx = hit.nx; bny = hit.ny; bnz = hit.nz; blx = hit.lx; bly = hit.ly; blz = hit.lz; btri = -1;
        }
      }
      const idx = py * W + px;
      let r: number, g: number, b: number;
      if (bi < 0 || best >= norm.far) {
        // sky gradient by world ray elevation
        const e = wy / Math.hypot(wx, wy, wz);
        const u = Math.min(1, Math.max(0, 0.5 + e * 1.2));
        r = 0.62 + (0.25 - 0.62) * u; g = 0.78 + (0.45 - 0.78) * u; b = 0.92 + (0.8 - 0.92) * u;
        depthZ[idx] = norm.far;
        depth8[idx] = 0;
      } else {
        const p = prims[bi]!;
        if (p.bvh) {
          // mesh hit: the normal is already in world space; flat triangle colour, no checker
          const lam = Math.max(0, bnx * SUN[0]! + bny * SUN[1]! + bnz * SUN[2]!);
          const shade = 0.35 + 0.65 * lam, c = p.bvh.colors;
          r = c[btri * 3]! * shade; g = c[btri * 3 + 1]! * shade; b = c[btri * 3 + 2]! * shade;
          depthZ[idx] = best;
          depth8[idx] = Math.round(normalizeDepth(best, norm) * 255);
          const o = idx * 3;
          rgb[o] = Math.round(Math.min(1, r) * 255);
          rgb[o + 1] = Math.round(Math.min(1, g) * 255);
          rgb[o + 2] = Math.round(Math.min(1, b) * 255);
          continue;
        }
        // world normal = normalize(R * (S^-1 * n_local))
        const sx = bnx * p.invS[0], sy = bny * p.invS[1], sz = bnz * p.invS[2];
        const R = p.R;
        let nx = R[0]! * sx + R[1]! * sy + R[2]! * sz;
        let ny = R[3]! * sx + R[4]! * sy + R[5]! * sz;
        let nz = R[6]! * sx + R[7]! * sy + R[8]! * sz;
        const nl = Math.hypot(nx, ny, nz);
        nx /= nl; ny /= nl; nz /= nl;
        const lam = Math.max(0, nx * SUN[0]! + ny * SUN[1]! + nz * SUN[2]!);
        const shade = (0.35 + 0.65 * lam) * checker(p, blx, bly, blz);
        r = p.color[0] * shade; g = p.color[1] * shade; b = p.color[2] * shade;
        depthZ[idx] = best;
        depth8[idx] = Math.round(normalizeDepth(best, norm) * 255);
      }
      const o = idx * 3;
      rgb[o] = Math.round(Math.min(1, r) * 255);
      rgb[o + 1] = Math.round(Math.min(1, g) * 255);
      rgb[o + 2] = Math.round(Math.min(1, b) * 255);
    }
  }
  return { width: W, height: H, rgb, depthZ, depth8 };
}

/** Render every pose of a clip with ONE fixed depth normalization. */
export function* renderClip(
  shot: Pick<Shot, "scene" | "resolution">,
  poses: readonly Pose[],
  norm: DepthNormalization = DEFAULT_DEPTH_NORM,
  meshes?: MeshResolver,
): Generator<Frame> {
  const moving = animatedNodes(shot.scene, meshes);
  let prims = buildPrims(shot.scene, meshes, poses[0]?.t);
  for (const pose of poses) {
    // A static scene is built once; animated actors are re-posed (and their triangles re-sorted into a BVH) for each frame.
    if (moving.length) {
      const fresh = buildPrims({ nodes: moving.map((i) => shot.scene.nodes[i]!) }, meshes, pose.t);
      prims = prims.map((p, i) => (moving.includes(i) ? fresh[moving.indexOf(i)]! : p));
    }
    yield renderFrame(shot, pose, norm, prims);
  }
}
