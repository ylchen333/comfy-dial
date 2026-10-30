"""Export the Huangshan mist scene as a bundled studio set (GLB, flat colours, low poly).

Run headless (from src/):
  /Applications/Blender.app/Contents/MacOS/Blender -b <test_huangshan.blend> -P tools/blender/make_huangshan_scene.py -- assets/scenes/huangshan.glb

Input is the procedural scene we authored in Blender (granite spires, pines, a stair path with rail; no third-party assets), so the
output carries the repo's licence. Only geometry matters for the depth guide, so fog, node materials, shrubs and the foreground
branches (they would sit in front of any camera) are dropped, each part gets one flat colour, and spires and pines are decimated to
stay well under the depth renderer's triangle budget.

Placement: the origin is the top of a stair step with the stairs descending away in -Z (glTF), so a subject at [0, 0.9, 0] stands on
the stairs and the default camera (6 m behind, looking -Z) looks down the path past the rail toward the spires.
"""
import sys

import bpy
from mathutils import Vector

_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = _args[0] if _args else "huangshan.glb"
PINE_MAX_DIST = float(_args[1]) if len(_args) > 1 else 1e9   # drop pines farther than this from the standing point (m)

STAND_XY = (-1.45, 4.9)   # Blender X/Y of the step the subject stands on
SPIRE_FACES = 600         # target faces per spire (from ~13.5k)
PINE_FACES = 60          # target faces per pine (from 580 to 1120)

COLORS = {                # original material -> flat linear colour
    "granite": (0.40, 0.40, 0.39),
    "wet_stone": (0.28, 0.29, 0.29),
    "log": (0.30, 0.20, 0.12),
    "pine_bark": (0.22, 0.15, 0.10),
    "pine_needles": (0.09, 0.20, 0.09),
}
flat = {}
for name, rgb in COLORS.items():
    m = bpy.data.materials.new(f"flat_{name}")
    m.diffuse_color = (*rgb, 1.0)
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*rgb, 1.0)
    flat[name] = m

sc = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()
hit, loc, _n, _i, _ob, _m = sc.ray_cast(dg, Vector((*STAND_XY, 60.0)), Vector((0, 0, -1)))
assert hit and loc.z > -5, "no stair step under the standing point"
offset = Vector((STAND_XY[0], STAND_XY[1], loc.z))   # becomes the origin

keep = []
for coll in ("rock", "path", "pines"):
    keep += [o for o in bpy.data.collections[coll].objects if o.type == "MESH" and not o.hide_render
             and (coll != "pines" or (o.location - Vector((*STAND_XY, loc.z))).length <= PINE_MAX_DIST)]
keep.append(bpy.data.objects["slope"])

for o in bpy.data.objects:
    o.select_set(False)
for o in keep:
    o.location -= offset
    n = len(o.data.polygons)
    target = SPIRE_FACES if o.name.startswith("spire") else PINE_FACES if o.name.startswith("pine") else 0
    if target and n > target:
        mod = o.modifiers.new("decimate", "DECIMATE")
        mod.ratio = target / n
    for slot in o.material_slots:
        if slot.material and slot.material.name in flat:
            slot.material = flat[slot.material.name]
    o.select_set(True)

dg = bpy.context.evaluated_depsgraph_get()
tris = sum(sum(len(p.vertices) - 2 for p in o.evaluated_get(dg).data.polygons) for o in keep)
print(f"EXPORT objects={len(keep)} triangles~{tris}")

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
    export_materials="EXPORT", export_image_format="NONE", export_cameras=False, export_lights=False, export_extras=False,
)
print("WROTE", OUT)
