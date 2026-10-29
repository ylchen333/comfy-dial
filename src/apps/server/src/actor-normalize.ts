// Turns a raw image-to-3D mesh (Hunyuan3D output: arbitrary axes, scale and origin, stray fragments, 100k+ triangles)
// into an actor the studio can use as the subject: one body, Y-up, a set height, soles 0.9 m below the origin
// (so a subject at y = 0.9 stands on the ground), facing +Z, and a triangle count the depth renderer accepts.
import { countTriangles, parseGltf, type Mesh, type Vec3 } from "@comfy-osh/rig-core";

export interface NormalizeOptions {
  /** Height the figure is scaled to, metres. */
  heightM?: number;
  /** Which source axis points up. "auto" takes the longest extent of the main body. */
  up?: "auto" | "x" | "y" | "z";
  /** Extra yaw about the vertical, degrees, for a figure that does not face +Z. */
  turnDeg?: number;
  /** Stop simplifying once the mesh has at most this many triangles. */
  maxTriangles?: number;
}

export interface ActorReport {
  ok: boolean;
  problems: string[];
  notes: string[];
  triangles: number;
  sourceTriangles: number;
  heightM: number;
  sourceUp: "x" | "y" | "z";
  droppedFragments: number;
}

export const ACTOR_DEFAULTS = { heightM: 1.7, maxTriangles: 80_000, soleY: -0.9 } as const;

interface Soup { pos: Float64Array; tris: Uint32Array }

/** All meshes as one welded triangle list (vertices at the same spot share an index). */
function weld(meshes: Mesh[]): Soup {
  let lo = Infinity, hi = -Infinity;
  for (const m of meshes) for (let i = 0; i < m.positions.length; i++) { lo = Math.min(lo, m.positions[i]!); hi = Math.max(hi, m.positions[i]!); }
  const q = (hi - lo || 1) / 1e6;
  const ids = new Map<string, number>();
  const pos: number[] = [];
  const tris: number[] = [];
  for (const m of meshes) {
    const map = new Uint32Array(m.positions.length / 3);
    for (let v = 0; v < map.length; v++) {
      const x = m.positions[v * 3]!, y = m.positions[v * 3 + 1]!, z = m.positions[v * 3 + 2]!;
      const key = `${Math.round(x / q)},${Math.round(y / q)},${Math.round(z / q)}`;
      let id = ids.get(key);
      if (id === undefined) { id = pos.length / 3; ids.set(key, id); pos.push(x, y, z); }
      map[v] = id;
    }
    for (let t = 0; t < m.indices.length; t += 3) {
      const a = map[m.indices[t]!]!, b = map[m.indices[t + 1]!]!, c = map[m.indices[t + 2]!]!;
      if (a !== b && b !== c && a !== c) tris.push(a, b, c);
    }
  }
  return { pos: Float64Array.from(pos), tris: Uint32Array.from(tris) };
}

/**
 * Keep the biggest connected component plus every piece that touches it (hair, a belt, a hand that did not weld);
 * drop pieces apart from it. Reports how many were dropped and how big everything dropped was relative to the body.
 */
function mainBody(s: Soup): { soup: Soup; dropped: number; runnerUp: number } {
  const n = s.pos.length / 3;
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]!; } return a; };
  for (let t = 0; t < s.tris.length; t += 3) {
    const ra = find(s.tris[t]!), rb = find(s.tris[t + 1]!), rc = find(s.tris[t + 2]!);
    parent[rb] = ra;
    parent[rc] = ra;
  }
  const comp = new Map<number, { tris: number; min: number[]; max: number[] }>();
  for (let t = 0; t < s.tris.length; t += 3) {
    const r = find(s.tris[t]!);
    let c = comp.get(r);
    if (!c) comp.set(r, (c = { tris: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
    c.tris++;
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) {
      const v = s.pos[s.tris[t + k]! * 3 + a]!;
      c.min[a] = Math.min(c.min[a]!, v); c.max[a] = Math.max(c.max[a]!, v);
    }
  }
  const sorted = [...comp.entries()].sort((a, b) => b[1].tris - a[1].tris);
  const main = sorted[0]?.[1];
  if (!main) return { soup: { pos: s.pos, tris: new Uint32Array(0) }, dropped: 0, runnerUp: 0 };
  // Grow from the biggest piece: absorb any piece whose box touches the body's box (limbs, hair and clothing that did not weld).
  const box = { min: [...main.min], max: [...main.max] };
  const reach = () => 0.2 * Math.max(...box.max.map((m, a) => m - box.min[a]!)); // grows with the body, so a gap between head and torso is bridged but a far fragment is not
  const keep = new Set<number>([sorted[0]![0]]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [r, c] of sorted) {
      if (keep.has(r) || ![0, 1, 2].every((a) => c.min[a]! <= box.max[a]! + reach() && c.max[a]! >= box.min[a]! - reach())) continue;
      keep.add(r);
      for (let a = 0; a < 3; a++) { box.min[a] = Math.min(box.min[a]!, c.min[a]!); box.max[a] = Math.max(box.max[a]!, c.max[a]!); }
      grew = true;
    }
  }
  const kept: number[] = [];
  for (let t = 0; t < s.tris.length; t += 3) if (keep.has(find(s.tris[t]!))) kept.push(s.tris[t]!, s.tris[t + 1]!, s.tris[t + 2]!);
  const outside = sorted.filter(([r]) => !keep.has(r));
  return { soup: { pos: s.pos, tris: Uint32Array.from(kept) }, dropped: outside.length, runnerUp: outside.reduce((a, [, c]) => a + c.tris, 0) / Math.max(1, [...keep].reduce((a, r) => a + comp.get(r)!.tris, 0)) };
}

/** Vertex clustering on a grid: cheap, deterministic, and keeps the silhouette the depth guide needs. */
function cluster(s: Soup, cell: number): Soup {
  const ids = new Map<string, number>();
  const sum: number[] = [];
  const cnt: number[] = [];
  const map = new Uint32Array(s.pos.length / 3);
  for (let v = 0; v < map.length; v++) {
    const x = s.pos[v * 3]!, y = s.pos[v * 3 + 1]!, z = s.pos[v * 3 + 2]!;
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    let id = ids.get(key);
    if (id === undefined) { id = cnt.length; ids.set(key, id); sum.push(0, 0, 0); cnt.push(0); }
    sum[id * 3] = sum[id * 3]! + x; sum[id * 3 + 1] = sum[id * 3 + 1]! + y; sum[id * 3 + 2] = sum[id * 3 + 2]! + z;
    cnt[id] = cnt[id]! + 1;
    map[v] = id;
  }
  const pos = new Float64Array(cnt.length * 3);
  for (let i = 0; i < cnt.length; i++) for (let a = 0; a < 3; a++) pos[i * 3 + a] = sum[i * 3 + a]! / cnt[i]!;
  const tris: number[] = [];
  for (let t = 0; t < s.tris.length; t += 3) {
    const a = map[s.tris[t]!]!, b = map[s.tris[t + 1]!]!, c = map[s.tris[t + 2]!]!;
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  return { pos, tris: Uint32Array.from(tris) };
}

function bounds(s: Soup) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < s.pos.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, s.pos[i + a]!); max[a] = Math.max(max[a]!, s.pos[i + a]!); }
  return { min, max, size: [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!] };
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

/** Normalise raw meshes into an actor; returns the GLB bytes (null when the mesh is unusable) and a report. */
export function normalizeActor(meshes: Mesh[], opts: NormalizeOptions = {}): { glb: Uint8Array | null; report: ActorReport } {
  const heightM = opts.heightM ?? ACTOR_DEFAULTS.heightM;
  const maxTriangles = opts.maxTriangles ?? ACTOR_DEFAULTS.maxTriangles;
  const problems: string[] = [], notes: string[] = [];
  const sourceTriangles = countTriangles(meshes);
  const fail = (msg: string, up: "x" | "y" | "z" = "y", dropped = 0): { glb: null; report: ActorReport } => ({ glb: null, report: { ok: false, problems: [...problems, msg], notes, triangles: 0, sourceTriangles, heightM: 0, sourceUp: up, droppedFragments: dropped } });
  if (!sourceTriangles) return fail("the mesh has no triangles");

  const welded = weld(meshes);
  const { soup: body, dropped, runnerUp } = mainBody(welded);
  if (!body.tris.length) return fail("no connected surface found");
  if (runnerUp >= 0.25) problems.push(`more than one object in the mesh (the second is ${Math.round(runnerUp * 100)}% the size of the first); generate a single figure on a plain background`);
  if (dropped) notes.push(`dropped ${dropped} stray fragment${dropped > 1 ? "s" : ""}`);

  const b0 = bounds(body);
  const axis = ((opts.up ?? "auto") === "auto" ? (["x", "y", "z"] as const)[b0.size.indexOf(Math.max(...b0.size))]! : opts.up as "x" | "y" | "z");
  const ai = { x: 0, y: 1, z: 2 }[axis];
  if ((opts.up ?? "auto") === "auto") {
    const others = b0.size.filter((_, i) => i !== ai);
    if (Math.max(...others) > 0.75 * b0.size[ai]!) problems.push("the figure is not standing upright (its width is close to its height); use a front view with the arms down");
  }
  if (axis !== "y") notes.push(`source up axis was ${axis}`);

  // Rotate so the source up axis becomes +Y. x->y and z->y are proper rotations, so triangle winding is kept.
  const rotated: Soup = { pos: new Float64Array(body.pos.length), tris: body.tris };
  for (let i = 0; i < body.pos.length; i += 3) {
    const x = body.pos[i]!, y = body.pos[i + 1]!, z = body.pos[i + 2]!;
    const [nx, ny, nz] = axis === "y" ? [x, y, z] : axis === "z" ? [x, z, -y] : [-y, x, z];
    rotated.pos[i] = nx; rotated.pos[i + 1] = ny; rotated.pos[i + 2] = nz;
  }

  const b1 = bounds(rotated);
  const scale = heightM / b1.size[1]!;
  const cx = median(Array.from({ length: rotated.pos.length / 3 }, (_, i) => rotated.pos[i * 3]!));
  const cz = median(Array.from({ length: rotated.pos.length / 3 }, (_, i) => rotated.pos[i * 3 + 2]!));
  const yaw = ((opts.turnDeg ?? 0) * Math.PI) / 180, c = Math.cos(yaw), sn = Math.sin(yaw);
  const placed: Soup = { pos: new Float64Array(rotated.pos.length), tris: rotated.tris };
  for (let i = 0; i < rotated.pos.length; i += 3) {
    const x = (rotated.pos[i]! - cx) * scale, z = (rotated.pos[i + 2]! - cz) * scale;
    placed.pos[i] = c * x + sn * z;
    placed.pos[i + 1] = (rotated.pos[i + 1]! - b1.min[1]!) * scale + ACTOR_DEFAULTS.soleY;
    placed.pos[i + 2] = -sn * x + c * z;
  }

  // Simplify until it fits, from fine to coarse cells.
  let out = placed;
  for (let n = 400; out.tris.length / 3 > maxTriangles && n >= 12; n = Math.round(n * 0.85)) out = cluster(placed, heightM / n);
  if (out.tris.length / 3 > maxTriangles) problems.push(`still ${out.tris.length / 3} triangles after simplifying`);
  if (out.tris.length < placed.tris.length) notes.push(`simplified ${placed.tris.length / 3} to ${out.tris.length / 3} triangles`);

  const report: ActorReport = { ok: problems.length === 0, problems, notes, triangles: out.tris.length / 3, sourceTriangles, heightM, sourceUp: axis, droppedFragments: dropped };
  return { glb: problems.length ? null : writeGlb(out), report };
}

/** Normalise a GLB's bytes. */
export function normalizeActorGlb(bytes: Uint8Array, opts?: NormalizeOptions) {
  return normalizeActor(parseGltf(bytes), opts);
}

/** Smooth per-vertex normals (area weighted). */
function normals(s: Soup): Float32Array {
  const n = new Float64Array(s.pos.length);
  for (let t = 0; t < s.tris.length; t += 3) {
    const [a, b, c] = [s.tris[t]! * 3, s.tris[t + 1]! * 3, s.tris[t + 2]! * 3];
    const e1: Vec3 = [s.pos[b]! - s.pos[a]!, s.pos[b + 1]! - s.pos[a + 1]!, s.pos[b + 2]! - s.pos[a + 2]!];
    const e2: Vec3 = [s.pos[c]! - s.pos[a]!, s.pos[c + 1]! - s.pos[a + 1]!, s.pos[c + 2]! - s.pos[a + 2]!];
    const f = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) n[v + k] = n[v + k]! + f[k]!;
  }
  const out = new Float32Array(n.length);
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1;
    out[i] = n[i]! / l; out[i + 1] = n[i + 1]! / l; out[i + 2] = n[i + 2]! / l;
  }
  return out;
}

/** One-mesh, one-material binary glTF with positions, normals and indices. */
function writeGlb(s: Soup): Uint8Array {
  const pos = Float32Array.from(s.pos);
  const nor = normals(s);
  const idx = s.tris;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, pos[i + a]!); hi[a] = Math.max(hi[a]!, pos[i + a]!); }
  const json = {
    asset: { version: "2.0", generator: "comfy-osh actor-normalize" },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "actor" }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.72, 0.72, 0.72, 1], metallicFactor: 0, roughnessFactor: 0.9 } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: "VEC3", min: lo, max: hi },
      { bufferView: 1, componentType: 5126, count: nor.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5125, count: idx.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: nor.byteLength, target: 34962 },
      { buffer: 0, byteOffset: pos.byteLength + nor.byteLength, byteLength: idx.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: pos.byteLength + nor.byteLength + idx.byteLength }],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(jsonBytes.length / 4) * 4;
  const binLen = json.buffers[0]!.byteLength; // every part is 4-byte aligned already
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  const b = 20 + jsonLen;
  dv.setUint32(b, binLen, true); dv.setUint32(b + 4, 0x004e4942, true);
  out.set(new Uint8Array(pos.buffer), b + 8);
  out.set(new Uint8Array(nor.buffer), b + 8 + pos.byteLength);
  out.set(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength), b + 8 + pos.byteLength + nor.byteLength);
  return out;
}
