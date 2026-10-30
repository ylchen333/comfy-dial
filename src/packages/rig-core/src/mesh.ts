// glTF/GLB triangles for the depth renderer: a small parser (positions, indices, base colour, node transforms) and a BVH.
// Not a general glTF loader: triangle lists only, no Draco/meshopt/sparse accessors, no textures (flat base colour).
import type { Vec3 } from "./math.ts";

/** One triangle soup in model space with one flat colour per triangle. */
export interface Mesh {
  positions: Float32Array; // 3 floats per vertex
  indices: Uint32Array; // 3 per triangle
  colors: Float32Array; // 3 per triangle, linear 0..1
}

/** Resolves a Shot node `asset` (not `primitive:*`) to its meshes, or throws. */
export type MeshResolver = ((asset: string) => Mesh[]) & {
  /** The parsed model, when the file carries a node animation. The renderer then poses it at each frame's time. */
  animated?: (asset: string) => GltfModel | null;
};

export const isPrimitiveAsset = (asset: string) => asset.startsWith("primitive:");

type Mat4 = number[]; // column-major, like glTF

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}

function trs(t: number[], q: number[], s: number[]): Mat4 {
  const [x, y, z, w] = q as [number, number, number, number];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * s[0]!, 2 * (xy + wz) * s[0]!, 2 * (xz - wy) * s[0]!, 0,
    2 * (xy - wz) * s[1]!, (1 - 2 * (xx + zz)) * s[1]!, 2 * (yz + wx) * s[1]!, 0,
    2 * (xz + wy) * s[2]!, 2 * (yz - wx) * s[2]!, (1 - 2 * (xx + yy)) * s[2]!, 0,
    t[0]!, t[1]!, t[2]!, 1,
  ];
}

interface GltfJson {
  asset?: { version?: string };
  extensionsRequired?: string[];
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { children?: number[]; mesh?: number; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: unknown }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  animations?: { channels: { sampler: number; target: { node?: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[];
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** A glTF whose node animation (translation, rotation, scale; rigid parts, no skins) can be sampled at any time. */
export interface GltfModel {
  /** Triangles in model space. `time` is seconds on the shot clock (looped); omit it for the rest pose / first frame. */
  meshesAt(time?: number): Mesh[];
  /** Set when the file has an animation: the clip is looped, starting at its first key. */
  animation: { start: number; end: number; period: number } | null;
}

/** Map a shot time (s) to the clip time: the clip loops, starting at its first key. */
export function clipTime(a: { start: number; period: number }, t: number): number {
  const m = ((t % a.period) + a.period) % a.period;
  return a.start + m;
}

type Track = { node: number; path: "translation" | "rotation" | "scale"; times: Float32Array; values: Float32Array };

function slerp(a: number[], b: number[], u: number): number[] {
  let [bx, by, bz, bw] = b as [number, number, number, number];
  let d = a[0]! * bx + a[1]! * by + a[2]! * bz + a[3]! * bw;
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let ka: number, kb: number;
  if (d > 0.9995) { ka = 1 - u; kb = u; }
  else { const th = Math.acos(d), sn = Math.sin(th); ka = Math.sin((1 - u) * th) / sn; kb = Math.sin(u * th) / sn; }
  const q = [ka * a[0]! + kb * bx, ka * a[1]! + kb * by, ka * a[2]! + kb * bz, ka * a[3]! + kb * bw];
  const l = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!) || 1;
  return q.map((c) => c / l);
}

function sampleTrack(tr: Track, t: number): number[] {
  const n = tr.times.length, k = tr.path === "rotation" ? 4 : 3;
  const at = (i: number) => Array.from(tr.values.subarray(i * k, i * k + k));
  if (t <= tr.times[0]!) return at(0);
  if (t >= tr.times[n - 1]!) return at(n - 1);
  let i = 0;
  while (i < n - 2 && tr.times[i + 1]! < t) i++;
  const u = (t - tr.times[i]!) / (tr.times[i + 1]! - tr.times[i]!);
  const a = at(i), b = at(i + 1);
  return tr.path === "rotation" ? slerp(a, b, u) : a.map((v, c) => v + (b[c]! - v) * u);
}

/** Parse a GLB (or a .gltf with embedded base64 buffers). Throws a readable error on anything unsupported. */
export function loadGltf(bytes: Uint8Array): GltfModel {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let json: GltfJson;
  const bins: Uint8Array[] = [];
  if (bytes.byteLength >= 12 && dv.getUint32(0, true) === 0x46546c67) {
    if (dv.getUint32(4, true) !== 2) throw new Error("only glTF 2.0 is supported");
    let off = 12;
    let parsed: GltfJson | null = null;
    while (off + 8 <= bytes.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      const body = bytes.subarray(off + 8, off + 8 + len);
      if (type === 0x4e4f534a) parsed = JSON.parse(new TextDecoder().decode(body)) as GltfJson;
      else if (type === 0x004e4942) bins.push(body);
      off += 8 + len + ((4 - (len % 4)) % 4);
    }
    if (!parsed) throw new Error("GLB has no JSON chunk");
    json = parsed;
  } else {
    try {
      json = JSON.parse(new TextDecoder().decode(bytes)) as GltfJson;
    } catch {
      throw new Error("not a GLB or glTF file");
    }
    if (json.asset?.version !== "2.0") throw new Error("only glTF 2.0 is supported");
    for (const b of json.buffers ?? []) {
      const m = /^data:[^;,]*;base64,(.*)$/.exec(b.uri ?? "");
      if (!m) throw new Error("a .gltf must embed its buffers as base64 (or use a .glb)");
      bins.push(new Uint8Array(Buffer.from(m[1]!, "base64")));
    }
  }
  const bad = (json.extensionsRequired ?? []).filter((e) => /draco|meshopt|quantization/i.test(e));
  if (bad.length) throw new Error(`unsupported glTF extension: ${bad.join(", ")} (export without compression)`);

  const readAccessor = (idx: number): { data: Float32Array | Uint32Array; n: number } => {
    const a = json.accessors?.[idx];
    if (!a || a.bufferView === undefined || a.sparse) throw new Error("unsupported accessor (missing bufferView or sparse)");
    const view = json.bufferViews![a.bufferView]!;
    const bin = bins[view.buffer];
    if (!bin) throw new Error("buffer missing");
    const comps = COMPONENTS[a.type];
    if (!comps) throw new Error(`unsupported accessor type ${a.type}`);
    const start = bin.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType];
    if (!size) throw new Error(`unsupported component type ${a.componentType}`);
    const stride = view.byteStride ?? comps * size;
    const v = new DataView(bin.buffer, 0, bin.buffer.byteLength);
    const out = a.componentType === 5126 ? new Float32Array(a.count * comps) : new Uint32Array(a.count * comps);
    for (let i = 0; i < a.count; i++)
      for (let c = 0; c < comps; c++) {
        const p = start + i * stride + c * size;
        out[i * comps + c] =
          a.componentType === 5126 ? v.getFloat32(p, true) : a.componentType === 5125 ? v.getUint32(p, true) : a.componentType === 5123 ? v.getUint16(p, true) : v.getUint8(p);
      }
    return { data: out, n: a.count };
  };

  // Per-node geometry in node-local space (read once); world transforms are applied per sampled time.
  const geom = new Map<number, { pos: Float32Array; idx: Uint32Array; colors: Float32Array }[]>();
  for (const [ni, node] of (json.nodes ?? []).entries()) {
    if (node.mesh === undefined) continue;
    const list: { pos: Float32Array; idx: Uint32Array; colors: Float32Array }[] = [];
    for (const prim of json.meshes?.[node.mesh]?.primitives ?? []) {
      if ((prim.mode ?? 4) !== 4) continue; // triangles only
      const pos = readAccessor(prim.attributes.POSITION!).data as Float32Array;
      const idx = prim.indices !== undefined ? (readAccessor(prim.indices).data as Uint32Array) : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
      const base = json.materials?.[prim.material ?? -1]?.pbrMetallicRoughness?.baseColorFactor ?? [0.7, 0.7, 0.7, 1];
      const col = [srgbToLinear(base[0]!), srgbToLinear(base[1]!), srgbToLinear(base[2]!)];
      const tris = Math.floor(idx.length / 3);
      const colors = new Float32Array(tris * 3);
      for (let t = 0; t < tris; t++) colors.set(col, t * 3);
      list.push({ pos, idx: idx.subarray(0, tris * 3), colors });
    }
    geom.set(ni, list);
  }

  const tracks: Track[] = [];
  const clip = json.animations?.[0];
  if (clip) {
    for (const ch of clip.channels) {
      const path = ch.target.path;
      if (ch.target.node === undefined || (path !== "translation" && path !== "rotation" && path !== "scale")) continue; // weights etc. are ignored
      const smp = clip.samplers[ch.sampler];
      if (!smp) continue;
      if ((smp.interpolation ?? "LINEAR") !== "LINEAR") throw new Error(`unsupported animation interpolation ${smp.interpolation} (bake to linear keys)`);
      tracks.push({ node: ch.target.node, path, times: readAccessor(smp.input).data as Float32Array, values: readAccessor(smp.output).data as Float32Array });
    }
  }
  let animation: GltfModel["animation"] = null;
  if (tracks.length) {
    let start = Infinity, end = -Infinity, dt = Infinity;
    for (const tr of tracks) {
      start = Math.min(start, tr.times[0]!);
      end = Math.max(end, tr.times[tr.times.length - 1]!);
      for (let i = 1; i < tr.times.length; i++) dt = Math.min(dt, tr.times[i]! - tr.times[i - 1]!);
    }
    // A looping clip of N keys spaced dt repeats every N * dt, not (N - 1) * dt: the last key sits one step before the first again.
    animation = end > start ? { start, end, period: end - start + (Number.isFinite(dt) ? dt : 0) } : null;
  }
  const byNode = new Map<number, Track[]>();
  for (const tr of tracks) byNode.set(tr.node, [...(byNode.get(tr.node) ?? []), tr]);

  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_, i) => i).filter((i) => !(json.nodes ?? []).some((n) => n.children?.includes(i)));
  const meshesAt = (time?: number): Mesh[] => {
    const clipT = animation ? clipTime(animation, time ?? 0) : null;
    const meshes: Mesh[] = [];
    const visit = (ni: number, parent: Mat4, depth: number) => {
      if (depth > 64) throw new Error("glTF node hierarchy too deep");
      const node = json.nodes?.[ni];
      if (!node) throw new Error(`glTF node ${ni} missing`);
      let tr = node.translation ?? [0, 0, 0], rot = node.rotation ?? [0, 0, 0, 1], sc = node.scale ?? [1, 1, 1];
      if (clipT !== null) for (const k of byNode.get(ni) ?? []) { const v = sampleTrack(k, clipT); if (k.path === "translation") tr = v; else if (k.path === "rotation") rot = v; else sc = v; }
      const local = node.matrix ? node.matrix : trs(tr, rot, sc);
      const m = mul(parent, local);
      for (const g of geom.get(ni) ?? []) {
        const world = new Float32Array(g.pos.length);
        for (let i = 0; i < g.pos.length; i += 3) {
          const x = g.pos[i]!, y = g.pos[i + 1]!, z = g.pos[i + 2]!;
          world[i] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
          world[i + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
          world[i + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
        }
        meshes.push({ positions: world, indices: g.idx, colors: g.colors });
      }
      for (const c of node.children ?? []) visit(c, m, depth + 1);
    };
    for (const r of roots) visit(r, IDENTITY, 0);
    if (!meshes.length) throw new Error("glTF has no triangle meshes");
    return meshes;
  };
  meshesAt(); // fail early on an unusable file, with the same messages as before
  return { meshesAt, animation };
}

/** Parse a GLB at its first frame (static use: scenes, uploads, bounds). */
export function parseGltf(bytes: Uint8Array): Mesh[] {
  return loadGltf(bytes).meshesAt();
}

export function countTriangles(meshes: Mesh[]): number {
  return meshes.reduce((a, m) => a + m.indices.length / 3, 0);
}

/** Axis-aligned bounds of the meshes in model space. */
export function meshBounds(meshes: Mesh[]): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes)
    for (let i = 0; i < m.positions.length; i += 3)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a]!, m.positions[i + a]!);
        max[a] = Math.max(max[a]!, m.positions[i + a]!);
      }
  return { min, max };
}

/** Triangles in world space (node transform applied) with a median-split BVH. */
export interface WorldBvh {
  tris: Float32Array; // 9 floats per triangle (v0, v1, v2), in BVH leaf order
  colors: Float32Array; // 3 per triangle, same order
  lo: Float32Array; // node min xyz
  hi: Float32Array; // node max xyz
  left: Int32Array; // child index, or -1 for a leaf
  right: Int32Array; // child index, or first triangle for a leaf
  count: Int32Array; // triangles in a leaf, 0 for an inner node
}

export function buildBvh(meshes: Mesh[], pos: Vec3, R: number[], scale: Vec3): WorldBvh {
  const n = countTriangles(meshes);
  const raw = new Float32Array(n * 9), rawCol = new Float32Array(n * 3);
  let t = 0;
  for (const m of meshes) {
    for (let i = 0; i < m.indices.length; i += 3, t++) {
      for (let v = 0; v < 3; v++) {
        const p = m.indices[i + v]! * 3;
        const x = m.positions[p]! * scale[0], y = m.positions[p + 1]! * scale[1], z = m.positions[p + 2]! * scale[2];
        raw[t * 9 + v * 3] = R[0]! * x + R[1]! * y + R[2]! * z + pos[0];
        raw[t * 9 + v * 3 + 1] = R[3]! * x + R[4]! * y + R[5]! * z + pos[1];
        raw[t * 9 + v * 3 + 2] = R[6]! * x + R[7]! * y + R[8]! * z + pos[2];
      }
      rawCol.set(m.colors.subarray((i / 3) * 3, (i / 3) * 3 + 3), t * 3);
    }
  }
  const cen = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) cen[i * 3 + a] = (raw[i * 9 + a]! + raw[i * 9 + 3 + a]! + raw[i * 9 + 6 + a]!) / 3;
  const order = Array.from({ length: n }, (_, i) => i);
  const lo: number[] = [], hi: number[] = [], left: number[] = [], right: number[] = [], count: number[] = [];
  const build = (a: number, b: number): number => {
    const id = left.length;
    left.push(-1); right.push(0); count.push(0); lo.push(0, 0, 0); hi.push(0, 0, 0);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let k = a; k < b; k++)
      for (let q = 0; q < 9; q++) {
        const v = raw[order[k]! * 9 + q]!, ax = q % 3;
        if (v < mn[ax]!) mn[ax] = v;
        if (v > mx[ax]!) mx[ax] = v;
      }
    for (let ax = 0; ax < 3; ax++) { lo[id * 3 + ax] = mn[ax]!; hi[id * 3 + ax] = mx[ax]!; }
    if (b - a <= 4) { right[id] = a; count[id] = b - a; return id; }
    const ext = [mx[0]! - mn[0]!, mx[1]! - mn[1]!, mx[2]! - mn[2]!];
    const ax = ext[0]! >= ext[1]! && ext[0]! >= ext[2]! ? 0 : ext[1]! >= ext[2]! ? 1 : 2;
    const part = order.slice(a, b).sort((p, q) => cen[p * 3 + ax]! - cen[q * 3 + ax]!);
    for (let k = 0; k < part.length; k++) order[a + k] = part[k]!;
    const mid = (a + b) >> 1;
    left[id] = build(a, mid);
    right[id] = build(mid, b);
    return id;
  };
  if (n > 0) build(0, n);
  const tris = new Float32Array(n * 9), colors = new Float32Array(n * 3);
  order.forEach((src, dst) => { tris.set(raw.subarray(src * 9, src * 9 + 9), dst * 9); colors.set(rawCol.subarray(src * 3, src * 3 + 3), dst * 3); });
  return { tris, colors, lo: Float32Array.from(lo), hi: Float32Array.from(hi), left: Int32Array.from(left), right: Int32Array.from(right), count: Int32Array.from(count) };
}

const stack = new Int32Array(128);
export const meshHit = { t: Infinity, nx: 0, ny: 0, nz: 0, tri: -1 };

/** Nearest triangle hit along o + t*d (d need not be unit; t is the ray parameter), closer than `best`. Sets `meshHit`. */
export function hitBvh(b: WorldBvh, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, best: number): boolean {
  if (b.count.length === 0) return false;
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
  let sp = 0, found = false;
  stack[sp++] = 0;
  while (sp > 0) {
    const n = stack[--sp]!;
    let t0 = 0, t1 = best;
    let a = (b.lo[n * 3]! - ox) * ix, c = (b.hi[n * 3]! - ox) * ix;
    t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
    a = (b.lo[n * 3 + 1]! - oy) * iy; c = (b.hi[n * 3 + 1]! - oy) * iy;
    t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
    a = (b.lo[n * 3 + 2]! - oz) * iz; c = (b.hi[n * 3 + 2]! - oz) * iz;
    t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
    if (t0 > t1) continue;
    const cnt = b.count[n]!;
    if (cnt === 0) {
      stack[sp++] = b.right[n]!;
      stack[sp++] = b.left[n]!;
      continue;
    }
    for (let k = b.right[n]!; k < b.right[n]! + cnt; k++) {
      const o = k * 9, T = b.tris;
      const e1x = T[o + 3]! - T[o]!, e1y = T[o + 4]! - T[o + 1]!, e1z = T[o + 5]! - T[o + 2]!;
      const e2x = T[o + 6]! - T[o]!, e2y = T[o + 7]! - T[o + 1]!, e2z = T[o + 8]! - T[o + 2]!;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const sx = ox - T[o]!, sy = oy - T[o + 1]!, sz = oz - T[o + 2]!;
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t <= 1e-6 || t >= best) continue;
      best = t;
      found = true;
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; } // face the viewer
      meshHit.t = t; meshHit.nx = nx; meshHit.ny = ny; meshHit.nz = nz; meshHit.tri = k;
    }
  }
  return found;
}
