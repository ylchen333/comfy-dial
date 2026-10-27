// Tiny GLB writer for procedural low-poly scenes: flat-shaded boxes and cylinders, one material per colour.
export type V3 = [number, number, number];

interface Group { color: [number, number, number]; pos: number[]; nor: number[]; idx: number[] }

export class SceneKit {
  private groups = new Map<string, Group>();

  private group(color: V3): Group {
    const k = color.join(",");
    let g = this.groups.get(k);
    if (!g) this.groups.set(k, (g = { color, pos: [], nor: [], idx: [] }));
    return g;
  }

  private quad(g: Group, a: V3, b: V3, c: V3, d: V3) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    const base = g.pos.length / 3;
    for (const p of [a, b, c, d]) { g.pos.push(...p); g.nor.push(n[0]! / l, n[1]! / l, n[2]! / l); }
    g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Axis-aligned box centred at c, rotated by yawDeg about Y. */
  box(c: V3, size: V3, color: V3, yawDeg = 0) {
    const g = this.group(color);
    const s = Math.sin((yawDeg * Math.PI) / 180), co = Math.cos((yawDeg * Math.PI) / 180);
    const v = (sx: number, sy: number, sz: number): V3 => {
      const x = (sx * size[0]) / 2, z = (sz * size[2]) / 2;
      return [c[0] + x * co + z * s, c[1] + (sy * size[1]) / 2, c[2] - x * s + z * co];
    };
    this.quad(g, v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)); // +z
    this.quad(g, v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)); // -z
    this.quad(g, v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1)); // +x
    this.quad(g, v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)); // -x
    this.quad(g, v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1)); // +y
    this.quad(g, v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)); // -y
  }

  /** Upright cylinder centred at c. */
  cylinder(c: V3, radius: number, height: number, color: V3, segments = 12) {
    const g = this.group(color);
    const h = height / 2;
    const ring = (i: number, y: number): V3 => [c[0] + radius * Math.cos((i / segments) * 2 * Math.PI), c[1] + y, c[2] + radius * Math.sin((i / segments) * 2 * Math.PI)];
    for (let i = 0; i < segments; i++) {
      this.quad(g, ring(i + 1, -h), ring(i, -h), ring(i, h), ring(i + 1, h));
      const t0: V3 = [c[0], c[1] + h, c[2]];
      this.quad(g, t0, ring(i + 1, h), ring(i, h), t0); // top fan (degenerate 4th vertex keeps quad() simple)
    }
  }

  triangles(): number {
    return [...this.groups.values()].reduce((a, g) => a + g.idx.length / 3, 0);
  }

  toGlb(node: { translation?: number[]; scale?: number[] } = {}): Uint8Array {
    const groups = [...this.groups.values()];
    const chunks: Uint8Array[] = [];
    const views: object[] = [], accessors: object[] = [], primitives: object[] = [], materials: object[] = [];
    let off = 0;
    const push = (bytes: Uint8Array, target: number) => {
      const pad = (4 - (bytes.byteLength % 4)) % 4;
      chunks.push(bytes, new Uint8Array(pad));
      views.push({ buffer: 0, byteOffset: off, byteLength: bytes.byteLength, target });
      off += bytes.byteLength + pad;
      return views.length - 1;
    };
    groups.forEach((g, i) => {
      const pos = new Float32Array(g.pos), nor = new Float32Array(g.nor), idx = new Uint32Array(g.idx);
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let k = 0; k < pos.length; k++) { mn[k % 3] = Math.min(mn[k % 3]!, pos[k]!); mx[k % 3] = Math.max(mx[k % 3]!, pos[k]!); }
      const a0 = accessors.length;
      accessors.push({ bufferView: push(new Uint8Array(pos.buffer), 34962), componentType: 5126, count: pos.length / 3, type: "VEC3", min: mn, max: mx });
      accessors.push({ bufferView: push(new Uint8Array(nor.buffer), 34962), componentType: 5126, count: nor.length / 3, type: "VEC3" });
      accessors.push({ bufferView: push(new Uint8Array(idx.buffer), 34963), componentType: 5125, count: idx.length, type: "SCALAR" });
      materials.push({ pbrMetallicRoughness: { baseColorFactor: [...g.color, 1], metallicFactor: 0, roughnessFactor: 1 } });
      primitives.push({ attributes: { POSITION: a0, NORMAL: a0 + 1 }, indices: a0 + 2, material: i, mode: 4 });
    });
    const bin = new Uint8Array(off);
    let p = 0;
    for (const c of chunks) { bin.set(c, p); p += c.byteLength; }
    const json = {
      asset: { version: "2.0", generator: "comfy-osh scene-kit" },
      scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, ...node }], meshes: [{ primitives }],
      materials, accessors, bufferViews: views, buffers: [{ byteLength: bin.byteLength }],
    };
    let jb = new TextEncoder().encode(JSON.stringify(json));
    const jpad = (4 - (jb.byteLength % 4)) % 4;
    if (jpad) { const t = new Uint8Array(jb.byteLength + jpad).fill(0x20); t.set(jb); jb = t; }
    const total = 12 + 8 + jb.byteLength + 8 + bin.byteLength;
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jb.byteLength, true); dv.setUint32(16, 0x4e4f534a, true); out.set(jb, 20);
    const bo = 20 + jb.byteLength;
    dv.setUint32(bo, bin.byteLength, true); dv.setUint32(bo + 4, 0x004e4942, true); out.set(bin, bo + 8);
    return out;
  }
}
