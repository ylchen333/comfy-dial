"""Generate a cha-cha dancing baby (an homage to the 1996 "Dancing Baby") as a GLB with its animation baked per frame.

Run headless (from src/):
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/make_dancing_baby.py -- assets/actors/dancing_baby.glb

Everything is made here from primitives, so the file has no third-party licence; only the idea of the dance is borrowed.
Same rig style as make_actor.py: a plain object hierarchy (no armature, no skinning), each joint an empty, each body part a
mesh under it, so the glTF animation is node translation/rotation only. Anchors for camera presets: `anchor.root` (hips) and
`anchor.head`. Faces glTF +Z (towards the studio's default camera); the origin is on the floor under the hips, so a node at
position [0, 0, 0] has its feet on the ground. Dances in place, 121 frames at 25 fps.

The dance is a hip sway of 24 frames (2 beats at 125 bpm): hips swivel and drop side to side, the bent knee follows the dropped
hip, the chest counter-rotates, the elbows pump in alternation. 120 frames is exactly 5 sways, so frame 121 equals frame 1 and
the clip loops. The lower foot of every frame is put on the floor, so the feet do not float or sink while the knees bend.
"""
import json
import math
import sys

import bpy

FPS, FRAMES = 25, 121
CYCLE = 24            # frames per hip-sway cycle
_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = _args[0] if _args else "dancing_baby.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, FRAMES


def material(name, rgb):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1.0)
    return m


SKIN, DIAPER, DARK, HAIR = (
    material("skin", (0.93, 0.70, 0.58)), material("diaper", (0.95, 0.95, 0.92)),
    material("eye", (0.04, 0.03, 0.03)), material("hair", (0.30, 0.20, 0.12)),
)
joints = []


def empty(name, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    o.empty_display_size = 0.03
    scene.collection.objects.link(o)
    o.parent = parent
    o.location = loc
    o.rotation_mode = "XYZ"
    joints.append(o)
    return o


def part(name, parent, kind, size, loc, mat=SKIN, scale=(1, 1, 1)):
    """A mesh under a joint: a cylinder (radius, length) or a sphere (radius), centred at `loc` in joint space."""
    if kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=size[0], segments=16, ring_count=10, location=(0, 0, 0))
    else:
        bpy.ops.mesh.primitive_cylinder_add(radius=size[0], depth=size[1], vertices=12, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    o.parent = parent
    o.location = loc
    o.scale = scale
    return o


# A toddler about 0.8 m tall with a big head (metres). The baby faces Blender -Y, which exports as glTF +Z.
THIGH, SHIN, UARM, FARM, SOLE = 0.13, 0.12, 0.12, 0.10, 0.05
HIP_H = SOLE + SHIN + THIGH + 0.03             # hip height above the floor when standing straight

root = empty("anchor.root", loc=(0, 0, HIP_H))
part("diaper", root, "sphere", (0.11,), (0, 0.005, 0.0), DIAPER, (1.05, 0.9, 0.85))
chest = empty("chest", root, (0, 0, 0.06))
part("belly", chest, "sphere", (0.11,), (0, -0.01, 0.09), SKIN, (1.0, 0.9, 1.15))
head = empty("anchor.head", chest, (0, 0, 0.20))
part("head", head, "sphere", (0.13,), (0, 0, 0.11), SKIN, (1.0, 0.95, 1.0))
for sx, side in ((1, "L"), (-1, "R")):
    part(f"eye.{side}", head, "sphere", (0.016,), (sx * 0.045, -0.12, 0.13), DARK)
part("hair", head, "sphere", (0.03,), (0, -0.02, 0.24), HAIR, (1.0, 1.0, 1.3))

legs, arms = {}, {}
for sx, side in ((1, "L"), (-1, "R")):             # the baby's left is world +X when it faces -Y
    hip = empty(f"hip.{side}", root, (sx * 0.06, 0, -0.03))
    part(f"thigh.{side}", hip, "cyl", (0.045, THIGH), (0, 0, -THIGH / 2))
    knee = empty(f"knee.{side}", hip, (0, 0, -THIGH))
    part(f"shin.{side}", knee, "cyl", (0.038, SHIN), (0, 0, -SHIN / 2))
    foot = empty(f"foot.{side}", knee, (0, 0, -SHIN))
    part(f"foot_mesh.{side}", foot, "sphere", (0.05,), (0, -0.025, -0.02), SKIN, (0.8, 1.3, 0.6))
    legs[side] = (sx, hip, knee, foot)
    sh = empty(f"shoulder.{side}", chest, (sx * 0.12, 0, 0.16))
    part(f"uarm.{side}", sh, "cyl", (0.03, UARM), (0, 0, -UARM / 2))
    elbow = empty(f"elbow.{side}", sh, (0, 0, -UARM))
    part(f"farm.{side}", elbow, "cyl", (0.028, FARM), (0, 0, -FARM / 2))
    part(f"hand.{side}", elbow, "sphere", (0.035,), (0, 0, -FARM))
    arms[side] = (sx, sh, elbow)


# Rotation about X swings a limb forward/back (negative = lower end forward, towards -Y); rotation about Y swings it sideways
# (for the +X side a negative angle opens it outward).
def pose(f):
    ph = 2 * math.pi * (f - 1) / CYCLE
    s = math.sin(ph)
    roll, yaw = 0.20 * s, 0.50 * math.sin(ph - 0.7)
    root.location.x = 0.05 * s
    root.rotation_euler = (0.07 * math.sin(2 * ph), roll, yaw)
    chest.rotation_euler = (0.08 - 0.06 * math.sin(2 * ph), -0.8 * roll, -0.65 * yaw)
    head.rotation_euler = (0.12 * math.sin(2 * ph + 0.5), -0.5 * roll, -0.30 * yaw)
    for side, (sx, hip, knee, foot) in legs.items():
        bend = max(0.0, sx * s)                           # 1 when this side is the dropped hip
        th = 0.40 + 0.45 * bend + 0.06 * math.sin(2 * ph)
        k = 1.15 * th
        hip.rotation_euler = (-th, -sx * 0.12 - roll, -yaw)   # splay the stance; undo the pelvis tilt/swivel so the foot stays put
        knee.rotation_euler = (k, 0.0, 0.0)
        foot.rotation_euler = (th - k, 0.0, 0.0)              # keep the sole flat
    for side, (sx, sh, elbow) in arms.items():
        a = sx * math.sin(ph + 0.5)                       # the two arms pump in opposition
        sh.rotation_euler = (-0.55 - 0.45 * a, -sx * (0.70 + 0.30 * a), 0.0)
        elbow.rotation_euler = (-(1.25 + 0.60 * a), 0.0, 0.0)


def ground():
    """Lower or raise the hips so the lowest sole of this pose is exactly on the floor."""
    root.location.z = HIP_H
    bpy.context.view_layer.update()
    low = min(foot.matrix_world.translation.z - SOLE for (_, _, _, foot) in legs.values())
    root.location.z = HIP_H - low


lowest, top, xs = 9.0, 0.0, []
for f in range(1, FRAMES + 1):
    pose(f)
    ground()
    for j in joints:
        j.keyframe_insert("rotation_euler", frame=f)
    root.keyframe_insert("location", frame=f)
    bpy.context.view_layer.update()
    low = min(foot.matrix_world.translation.z - SOLE for (_, _, _, foot) in legs.values())
    lowest = min(lowest, low)
    top = max(top, head.matrix_world.translation.z + 0.24)
    xs.append(root.location.x)

for a in bpy.data.actions:                             # one key per frame, so linear is exact
    for fc in a.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"

tris = 0
for o in bpy.data.objects:
    if o.type == "MESH":
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
scene.frame_set(1)
print("ACTOR_REPORT", json.dumps({"frames": FRAMES, "fps": FPS, "tris": tris, "lowest_sole_z": round(lowest, 4),
                                  "approx_height_m": round(top, 2), "root_x_range": [round(min(xs), 3), round(max(xs), 3)]}))

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", export_animations=True, export_animation_mode="ACTIVE_ACTIONS", export_frame_range=True,
    export_force_sampling=True, export_yup=True, use_selection=False, export_cameras=False, export_lights=False,
)
print("ACTOR_EXPORTED", OUT)
