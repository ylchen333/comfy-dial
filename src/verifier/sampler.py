"""Sample a Shot's keyframe track to one pose per frame (t = i / fps).

Linear position and FOV, slerp rotation. Must match rig-core's sampler.
"""

import numpy as np

from .geom import qnormalize, qslerp


def sample_shot(shot):
    ts = np.array([k.t for k in shot.track])
    P = np.array([k.position for k in shot.track], float)
    Q = [qnormalize(np.array(k.quaternion, float)) for k in shot.track]
    F = np.array([k.fov_v_deg for k in shot.track], float)
    pos, quat, fov = [], [], []
    for i in range(shot.frames):
        t = min(max(i / shot.fps, ts[0]), ts[-1])
        j = min(int(np.searchsorted(ts, t, side="right")) - 1, len(ts) - 2)
        u = (t - ts[j]) / (ts[j + 1] - ts[j])
        pos.append(P[j] + u * (P[j + 1] - P[j]))
        quat.append(qslerp(Q[j], Q[j + 1], u))
        fov.append(F[j] + u * (F[j + 1] - F[j]))
    return np.array(pos), np.array(quat), np.array(fov)
