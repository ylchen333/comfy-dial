"""Generate a mannequin that walks, as a GLB with its animation baked per frame.

Run headless (from src/):
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/blender/make_actor.py -- assets/actors/mannequin_walk.glb [walk|stand|stride]

walk   : animated, walks along +X (121 frames); origin at the floor start point.
stand / stride : one static pose for the depth guide's subject. Faces +Z (towards the studio's default camera), and the
                 origin is about the body centre (soles 0.9 m below it), so a node at position [0, 0.9, 0] stands on the ground and presets
                 that aim at the "subject" position aim at the body, as they do for the box stand-in.

Everything is made here from primitives, so the file has no third-party licence. The rig is a plain object hierarchy
(no armature, no skinning): each joint is an empty, each body part a mesh under it, so the glTF animation is node
translation/rotation only. Two anchors are named for camera presets to read: `anchor.root` (hips) and `anchor.head`.
The actor faces and walks along +X (glTF +X after export), 121 frames at 25 fps, passing the origin at mid-clip.
"""
import json
import math
import sys

import bpy

FPS, FRAMES = 25, 121
SPEED = 1.35          # m/s
CYCLE_S = 1.05        # one full stride cycle (left+right step)
_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = _args[0] if _args else "mannequin_walk.glb"
MODE = _args[1] if len(_args) > 1 else "walk"
assert MODE in ("walk", "stand", "stride"), MODE

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, FRAMES

mat = bpy.data.materials.new("mannequin")
mat.diffuse_color = (0.72, 0.72, 0.74, 1.0)


def empty(name, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    o.empty_display_size = 0.05
    scene.collection.objects.link(o)
    o.parent = parent
    o.location = loc
    o.rotation_mode = "XYZ"
    return o


def part(name, parent, kind, size, loc):
    """A mesh under a joint: a capsule-ish cylinder (radius, length) or a sphere (radius), centred at `loc` in joint space."""
    if kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=size[0], segments=12, ring_count=8, location=(0, 0, 0))
    else:
        bpy.ops.mesh.primitive_cylinder_add(radius=size[0], depth=size[1], vertices=12, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    o.parent = parent
    o.location = loc
    return o


# Proportions for a 1.8 m figure (metres).
THIGH, SHIN, TORSO, UARM, FARM, NECK_HEAD = 0.43, 0.43, 0.55, 0.30, 0.27, 0.24
HIP_H = THIGH + SHIN + 0.04                      # hip joint height above the floor when standing

hips = empty("anchor.root", loc=(-SPEED * FRAMES / FPS / 2, 0, HIP_H))
part("pelvis", hips, "cyl", (0.14, 0.16), (0, 0, 0.0))
chest = empty("chest", hips, (0, 0, 0.10))
part("torso", chest, "cyl", (0.15, TORSO), (0, 0, TORSO / 2))
head = empty("anchor.head", chest, (0, 0, TORSO + 0.04))
part("head", head, "sphere", (0.105,), (0, 0, 0.10))

legs, arms = {}, {}
for side, sy in (("L", 0.09), ("R", -0.09)):
    hip = empty(f"hip.{side}", hips, (0, sy, -0.02))
    part(f"thigh.{side}", hip, "cyl", (0.06, THIGH), (0, 0, -THIGH / 2))
    knee = empty(f"knee.{side}", hip, (0, 0, -THIGH))
    part(f"shin.{side}", knee, "cyl", (0.05, SHIN), (0, 0, -SHIN / 2))
    foot = empty(f"foot.{side}", knee, (0, 0, -SHIN))
    part(f"foot_mesh.{side}", foot, "cyl", (0.045, 0.22), (0.07, 0, -0.03)).rotation_euler = (0, math.pi / 2, 0)
    legs[side] = (hip, knee, foot)
    sh = empty(f"shoulder.{side}", chest, (0, sy * 2.0, TORSO - 0.05))
    part(f"uarm.{side}", sh, "cyl", (0.04, UARM), (0, 0, -UARM / 2))
    elbow = empty(f"elbow.{side}", sh, (0, 0, -UARM))
    part(f"farm.{side}", elbow, "cyl", (0.035, FARM), (0, 0, -FARM / 2))
    arms[side] = (sh, elbow)

# Rotation about Y swings a hanging limb in the walking plane; a positive angle moves the lower end toward -X (backward).
def key(o, frame, **vals):
    for attr, v in vals.items():
        setattr(o, attr, v)
        o.keyframe_insert(attr, frame=frame)


def pose_at(ph):
    """One frame of the walk cycle as static joint angles (no keyframes)."""
    for side, off in (("L", 0.0), ("R", math.pi)):
        p = ph + off
        hip, knee, foot = legs[side]
        hip.rotation_euler = (0.0, -0.42 * math.sin(p), 0.0)
        knee.rotation_euler = (0.0, 0.05 + 0.75 * max(0.0, math.sin(p + math.pi / 2)) * 0.9, 0.0)
        foot.rotation_euler = (0.0, -0.10 * math.sin(p + 0.8), 0.0)
        sh, elbow = arms[side]
        sh.rotation_euler = (0.0, 0.34 * math.sin(p), 0.0)
        elbow.rotation_euler = (0.0, 0.18 + 0.12 * math.sin(p + 0.6), 0.0)


if MODE == "walk":
    w = 2 * math.pi / (CYCLE_S * FPS)               # radians per frame
    for f in range(1, FRAMES + 1):
        ph = (f - 1) * w
        t = (f - 1) / FPS
        key(hips, f, location=(-SPEED * FRAMES / FPS / 2 + SPEED * t, 0.0, HIP_H - 0.012 + 0.022 * math.cos(2 * ph)))
        key(chest, f, rotation_euler=(0.0, 0.04 + 0.02 * math.cos(2 * ph), 0.05 * math.sin(ph)))
        key(head, f, rotation_euler=(0.0, -0.03, -0.04 * math.sin(ph)))
        for side, off in (("L", 0.0), ("R", math.pi)):
            p = ph + off
            hip, knee, foot = legs[side]
            key(hip, f, rotation_euler=(0.0, -0.42 * math.sin(p), 0.0))                       # forward swing (negative = lower end forward)
            key(knee, f, rotation_euler=(0.0, 0.05 + 0.75 * max(0.0, math.sin(p + math.pi / 2)) * 0.9, 0.0))
            key(foot, f, rotation_euler=(0.0, -0.10 * math.sin(p + 0.8), 0.0))
            sh, elbow = arms[side]
            key(sh, f, rotation_euler=(0.0, 0.34 * math.sin(p), 0.0))                         # arms swing against the legs
            key(elbow, f, rotation_euler=(0.0, 0.18 + 0.12 * math.sin(p + 0.6), 0.0))

    # Constant-speed-friendly interpolation: the keys are already one per frame, so linear is exact.
    for a in bpy.data.actions:
        for fc in a.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"

else:
    if MODE == "stride":
        pose_at(math.pi / 2)                                   # legs apart, arms swinging
    else:
        for side in ("L", "R"):
            arms[side][1].rotation_euler = (0.0, 0.12, 0.0)    # relaxed arms, feet together
    hips.rotation_euler = (0.0, 0.0, -math.pi / 2)             # built facing +X; turn to face glTF +Z (Blender -Y)
    # Origin ~ body centre. The soles are 0.02 + THIGH + SHIN + 0.075 below the hips, so lift the figure until they are exactly
    # 0.9 m below the origin: a node at position [0, 0.9, 0] then has its feet on the ground.
    hips.location = (0.0, 0.0, 0.02 + THIGH + SHIN + 0.075 - 0.9)

# Report: travel, lowest foot, tri count (checked by the caller).
bpy.context.view_layer.update()
lowest, tris = 9.0, 0
for f in (1, 30, 61, 91, 121):
    scene.frame_set(f)
    for s in ("L", "R"):
        lowest = min(lowest, legs[s][2].matrix_world.translation.z)
for o in bpy.data.objects:
    if o.type == "MESH":
        tris += sum(len(p.vertices) - 2 for p in o.data.polygons)
scene.frame_set(1)
print("ACTOR_REPORT", json.dumps({"frames": FRAMES, "fps": FPS, "tris": tris, "lowest_foot_z": round(lowest, 3), "travel_m": round(SPEED * (FRAMES - 1) / FPS, 2)}))

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", export_animations=(MODE == "walk"), export_animation_mode="ACTIVE_ACTIONS", export_frame_range=True,
    export_force_sampling=True, export_yup=True, use_selection=False, export_cameras=False, export_lights=False,
)
print("ACTOR_EXPORTED", OUT)
