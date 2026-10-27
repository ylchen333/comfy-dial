// Procedural low-poly sets for the studio: node --experimental-strip-types scripts/build-scenes.ts [outDir]
// Generated from code (no third-party assets), so they carry the repo's licence. Output: src/assets/scenes/*.glb
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SceneKit, type V3 } from "./scene-kit.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(process.argv[2] ?? resolve(here, "../../../assets/scenes"));

const STONE: V3 = [0.62, 0.6, 0.56], WALL: V3 = [0.78, 0.7, 0.58], DARK: V3 = [0.3, 0.3, 0.33], WOOD: V3 = [0.5, 0.33, 0.2], WATER: V3 = [0.25, 0.5, 0.65];

/** Walled courtyard with a fountain, four columns and two benches. The subject stands at the origin. */
function courtyard(): SceneKit {
  const k = new SceneKit();
  k.box([0, -0.05, 0], [16, 0.1, 16], STONE);
  for (const [x, z, w, d] of [[0, -8, 16, 0.6], [-8, 0, 0.6, 16], [8, 0, 0.6, 16]] as const) k.box([x, 2, z], [w, 4, d], WALL);
  k.box([0, 2, 8], [16, 4, 0.6], WALL); // front wall is behind the default camera; keep the room closed
  for (const x of [-5, 5]) for (const z of [-5, 3]) { k.cylinder([x, 1.5, z], 0.35, 3, STONE, 12); k.box([x, 3.1, z], [0.9, 0.2, 0.9], STONE); }
  k.cylinder([0, 0.15, -4], 1.6, 0.3, STONE, 16);
  k.cylinder([0, 0.4, -4], 1.3, 0.2, WATER, 16);
  k.cylinder([0, 0.9, -4], 0.25, 1.0, STONE, 10);
  k.box([-4, 0.25, 5], [2, 0.5, 0.6], WOOD, 20);
  k.box([4.2, 0.25, 4.5], [2, 0.5, 0.6], WOOD, -25);
  for (let i = 0; i < 3; i++) k.box([0, 0.08 + i * 0.16, -7.2 + i * 0.4], [4 - i * 0.6, 0.16, 0.6], DARK); // steps
  return k;
}

/** Street canyon: road, kerbs, five building blocks with window bands, lamp posts and a parked car. */
function street(): SceneKit {
  const k = new SceneKit();
  k.box([0, -0.05, 0], [40, 0.1, 40], DARK);
  for (const x of [-4.5, 4.5]) k.box([x, 0.08, 0], [3, 0.16, 40], STONE);
  const WINDOW: V3 = [0.2, 0.3, 0.45];
  const blocks: [number, number, number, number, V3][] = [
    [-9, -10, 8, 12, [0.7, 0.45, 0.38]], [-9, -1, 9, 8, [0.62, 0.62, 0.66]], [-9, 9, 8, 15, [0.78, 0.68, 0.5]],
    [9, -9, 9, 10, [0.55, 0.6, 0.7]], [9, 4, 8, 14, [0.72, 0.5, 0.42]],
  ];
  for (const [x, z, d, h, c] of blocks) {
    const w = 6, face = x < 0 ? 1 : -1;
    k.box([x, h / 2, z], [w, h, d], c);
    for (let y = 2; y < h - 1; y += 2.5) for (let dz = -d / 2 + 1.2; dz < d / 2 - 0.8; dz += 2.2)
      k.box([x + face * (w / 2 + 0.05), y, z + dz], [0.15, 1.2, 1.0], WINDOW);
  }
  for (const [x, z] of [[-3.2, -6], [3.2, -2], [-3.2, 3], [3.2, 7]] as const) { k.cylinder([x, 2.2, z], 0.08, 4.4, DARK, 8); k.box([x, 4.5, z], [0.5, 0.15, 0.3], [0.95, 0.9, 0.6]); }
  k.box([-2.6, 0.55, 5.5], [1.8, 0.7, 4.2], [0.7, 0.15, 0.15]);
  k.box([-2.6, 1.1, 5.3], [1.6, 0.5, 2.2], [0.25, 0.3, 0.38]);
  return k;
}

mkdirSync(outDir, { recursive: true });
for (const [name, kit] of [["courtyard", courtyard()], ["street", street()]] as const) {
  writeFileSync(resolve(outDir, `${name}.glb`), kit.toGlb());
  console.log(`${name}.glb  ${kit.triangles()} triangles`);
}
