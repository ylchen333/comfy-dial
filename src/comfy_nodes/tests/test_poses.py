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
    assert d["frame_count"] == 3 and d["image"] == {"width": 448, "height": 252}
    assert abs(d["frames"][0]["fov_v_deg"] - 2 * np.degrees(np.arctan(126 / 400))) < 1e-9
    assert d["frames"][0]["quaternion"][3] == 1.0
