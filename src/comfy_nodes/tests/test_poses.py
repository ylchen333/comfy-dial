import importlib.util
import pathlib

import numpy as np

# Load poses.py directly: the package __init__ needs ComfyUI's comfy_api.
_p = pathlib.Path(__file__).parents[1] / "poses.py"
_spec = importlib.util.spec_from_file_location("poses", _p)
poses = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(poses)


def _w2c(c2w_cv):
    return np.linalg.inv(c2w_cv)[:3, :]


def test_identity_stays_identity():
    m = poses.w2c_to_threejs_c2w(np.eye(4)[:3])
    assert np.allclose(m, np.eye(4))


def test_forward_dolly_moves_minus_z():
    # OpenCV camera moves +Z (forward) by 2 -> three.js position z = -2.
    c2w = np.eye(4)
    c2w[2, 3] = 2.0
    m = poses.w2c_to_threejs_c2w(_w2c(c2w))
    assert np.allclose(m[:3, 3], [0, 0, -2])


def test_down_in_opencv_is_down_in_threejs():
    c2w = np.eye(4)
    c2w[1, 3] = 1.0  # +Y in OpenCV is down
    m = poses.w2c_to_threejs_c2w(_w2c(c2w))
    assert np.allclose(m[:3, 3], [0, -1, 0])


def test_yaw_left_is_positive_rotation_about_y():
    # OpenCV: turn to look toward -X (left). Camera z axis in world = (-1,0,0).
    r = np.array([[0, 0, -1], [0, 1, 0], [1, 0, 0]], float)  # columns = camera axes in world
    c2w = np.eye(4)
    c2w[:3, :3] = r
    m = poses.w2c_to_threejs_c2w(_w2c(c2w))
    fwd = m[:3, :3] @ np.array([0, 0, -1.0])   # three.js forward
    assert np.allclose(fwd, [-1, 0, 0])
    q = poses.mat_to_quat_xyzw(m[:3, :3])
    assert np.isclose(np.linalg.norm(q), 1) and q[1] > 0   # +90 deg about +Y


def test_build_poses_shape_and_fov():
    ext = np.stack([np.eye(4)[:3]] * 3)
    k = np.stack([[[400.0, 0, 224], [0, 400.0, 126], [0, 0, 1]]] * 3)
    d = poses.build_poses(ext, k, fps=25)
    assert "frame_count" not in d and d["image"] == {"width": 448, "height": 252}
    assert abs(d["frames"][0]["fov_v_deg"] - 2 * np.degrees(np.arctan(126 / 400))) < 1e-9
    assert d["frames"][0]["quaternion"][3] == 1.0


def test_validates_against_poses_contract():
    import sys
    sys.path.insert(0, str(pathlib.Path(__file__).parents[2] / "packages/contracts/python"))
    import json
    from comfy_dial_contracts import Poses

    rng = np.random.default_rng(0)
    ext = []
    for i in range(5):
        c2w = np.eye(4)
        a = 0.1 * i
        c2w[:3, :3] = [[np.cos(a), 0, np.sin(a)], [0, 1, 0], [-np.sin(a), 0, np.cos(a)]]
        c2w[:3, 3] = rng.normal(size=3)
        ext.append(_w2c(c2w))
    k = np.stack([[[400.0, 0, 224], [0, 400.0, 126], [0, 0, 1]]] * 5)
    d = poses.build_poses(np.stack(ext), k, fps=25, stride=4)
    assert [f["index"] for f in d["frames"]] == [0, 4, 8, 12, 16]
    assert abs(d["frames"][1]["t"] - 0.16) < 1e-12
    Poses.model_validate_json(json.dumps(d))


def _quat_to_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def _forward_to_da3_raw(meta):
    """Exact inverse of build_poses: authored c2w (three.js) -> DA3 3x4 w2c (OpenCV) + K."""
    S = np.diag([1.0, -1.0, -1.0])
    W, H = meta["resolution"]["width"], meta["resolution"]["height"]
    ext, ks = [], []
    for p in meta["poses"]:
        c2w = np.eye(4)
        c2w[:3, :3] = _quat_to_mat(p["quaternion"])
        c2w[:3, 3] = p["position"]
        cv = np.eye(4)
        cv[:3, :3] = S @ c2w[:3, :3] @ S
        cv[:3, 3] = S @ c2w[:3, 3]
        ext.append(np.linalg.inv(cv)[:3])
        f = (H / 2) / np.tan(np.radians(p["fov_v_deg"]) / 2)
        ks.append([[f, 0, W / 2], [0, f, H / 2], [0, 0, 1]])
    return np.stack(ext), np.stack(ks), W, H


def test_golden_meta_roundtrip():
    import json
    clips = pathlib.Path(__file__).parents[2] / "tests/golden/clips"
    for name in ("orbit", "pan", "push_in"):
        meta = json.load(open(clips / f"{name}.meta.json"))
        ext, k, W, H = _forward_to_da3_raw(meta)
        d = poses.build_poses(ext, k, fps=meta["fps"], width=W, height=H)
        assert len(d["frames"]) == len(meta["poses"])
        for f, p in zip(d["frames"], meta["poses"]):
            assert np.allclose(f["position"], p["position"], atol=1e-9), name
            q, q0 = np.array(f["quaternion"]), np.array(p["quaternion"])
            assert min(np.abs(q - q0).max(), np.abs(q + q0).max()) < 1e-9, name
            assert abs(f["fov_v_deg"] - p["fov_v_deg"]) < 1e-9, name
