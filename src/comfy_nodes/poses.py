"""Pure-numpy DA3 pose conversion. No ComfyUI imports, so it is testable anywhere.

DA3 convention (OpenCV): extrinsics are world-to-camera [R|t] (3x4); camera x right, y down,
z forward; world frame == camera 0 frame. Intrinsics are pixel-space K (3x3).
Output convention (project / three.js): right-handed, Y-up, camera looks down local -Z,
quaternion [x, y, z, w], camera-to-world.
"""
from __future__ import annotations

import json
import math
import sys

import numpy as np

SCHEMA = "comfy-dial/poses/1"
# 180 deg about X: OpenCV (x right, y down, z fwd) <-> three.js (x right, y up, -z fwd).
_S = np.diag([1.0, -1.0, -1.0])


def w2c_to_threejs_c2w(extrinsic_3x4) -> np.ndarray:
    """DA3 world-to-camera (OpenCV) -> 4x4 camera-to-world in three.js axes.

    c2w_cv = inv([R|t]); c2w_three = S @ c2w_cv @ S  (S flips y and z of both world and camera).
    """
    m = np.eye(4)
    m[:3, :4] = np.asarray(extrinsic_3x4, dtype=np.float64).reshape(3, 4)
    c2w = np.linalg.inv(m)
    out = np.eye(4)
    out[:3, :3] = _S @ c2w[:3, :3] @ _S
    out[:3, 3] = _S @ c2w[:3, 3]
    return out


def mat_to_quat_xyzw(r: np.ndarray) -> np.ndarray:
    """Rotation matrix -> unit quaternion [x, y, z, w] (Shepperd)."""
    t = np.trace(r)
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        q = [(r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s, 0.25 * s]
    elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
        s = math.sqrt(1.0 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
        q = [0.25 * s, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s, (r[2, 1] - r[1, 2]) / s]
    elif r[1, 1] > r[2, 2]:
        s = math.sqrt(1.0 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
        q = [(r[0, 1] + r[1, 0]) / s, 0.25 * s, (r[1, 2] + r[2, 1]) / s, (r[0, 2] - r[2, 0]) / s]
    else:
        s = math.sqrt(1.0 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
        q = [(r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, 0.25 * s, (r[1, 0] - r[0, 1]) / s]
    q = np.asarray(q)
    return q / np.linalg.norm(q)


def build_poses(extrinsics, intrinsics, fps: float = 25.0, width: int | None = None,
                height: int | None = None, source: dict | None = None,
                indices: list[int] | None = None, stride: int = 1) -> dict:
    """extrinsics: (S,3,4) w2c; intrinsics: (S,3,3). Returns a comfy-dial/poses/1 document.

    indices: source-clip frame index of each solved frame (default i*stride); t = index / fps.
    """
    ext = np.asarray(extrinsics, dtype=np.float64).reshape(-1, 3, 4)
    k = np.asarray(intrinsics, dtype=np.float64).reshape(-1, 3, 3)
    if len(ext) != len(k):
        raise ValueError(f"extrinsics ({len(ext)}) and intrinsics ({len(k)}) frame counts differ")
    if width is None:
        width = int(round(2 * k[0, 0, 2]))   # principal point is image centre in DA3
    if height is None:
        height = int(round(2 * k[0, 1, 2]))
    if indices is None:
        indices = [i * stride for i in range(len(ext))]
    if len(indices) != len(ext):
        raise ValueError("indices length differs from frame count")
    if not fps or fps <= 0:
        raise ValueError("fps must be > 0")
    frames, prev = [], None
    for i in range(len(ext)):
        c2w = w2c_to_threejs_c2w(ext[i])
        q = mat_to_quat_xyzw(c2w[:3, :3])
        if prev is not None and float(np.dot(q, prev)) < 0:  # keep hemisphere continuous
            q = -q
        prev = q
        fy = k[i, 1, 1]
        frames.append({
            "index": int(indices[i]),
            "t": float(indices[i]) / fps,
            "position": [float(x) for x in c2w[:3, 3]],
            "quaternion": [float(x) for x in q],
            "fov_v_deg": float(math.degrees(2 * math.atan(height / (2 * fy)))),
            "fx": float(k[i, 0, 0]), "fy": float(fy),
            "cx": float(k[i, 0, 2]), "cy": float(k[i, 1, 2]),
        })
    return {
        "schema": SCHEMA,
        "convention": {
            "handedness": "right", "up": "+Y", "camera_forward": "-Z", "quaternion": "xyzw",
            "transform": "camera-to-world", "units": "relative (non-metric), world = camera 0 frame",
        },
        "image": {"width": width, "height": height},
        "fps": float(fps),
        "solve_ok": len(frames) > 0,
        "source": source or {"model": "depth-anything-3", "mode": "multiview"},
        "frames": frames,
    }


def _load_da3_text(path: str, key: str):
    """Parse the JSON text emitted by ComfyUI-DepthAnythingV3 (list of {"image_i": matrix})."""
    return [list(d.values())[0] for d in json.load(open(path))[key]]


def main(argv: list[str]) -> int:
    """python poses.py <extrinsics.txt> <intrinsics.txt> <out.json> [fps=25] [stride=1]  (Cloud text outputs)."""
    ext = _load_da3_text(argv[1], "extrinsics")
    k = _load_da3_text(argv[2], "intrinsics")
    fps = float(argv[4]) if len(argv) > 4 else 25.0
    stride = int(argv[5]) if len(argv) > 5 else 1
    doc = build_poses(ext, k, fps=fps, stride=stride)
    with open(argv[3], "w") as f:
        json.dump(doc, f, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
