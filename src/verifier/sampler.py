"""Sample keyframes to poses at given times. Matches rig-core's sampler.ts.

Position linear, rotation shortest-arc slerp, FOV linear in cot(fov/2) (so a
linear dolly plus a linear focal ramp is an exact dolly zoom). Held outside the key range.
"""

import numpy as np

from .geom import qnormalize, qslerp


def _cot(fov_deg):
    return 1 / np.tan(np.radians(fov_deg) / 2)


def _fov(cot):
    return float(np.degrees(2 * np.arctan(1 / cot)))


def interpolate(ts, P, Q, F, times):
    """Interpolate (positions, unit quats, fov deg) keyed by increasing `ts` at `times`."""
    ts, P, F = np.asarray(ts, float), np.asarray(P, float), np.asarray(F, float)
    Q = [qnormalize(np.asarray(q, float)) for q in Q]
    C = _cot(F)
    pos, quat, fov = [], [], []
    for t in times:
        if len(ts) == 1 or t <= ts[0]:
            j, u = 0, 0.0
        elif t >= ts[-1]:
            j, u = len(ts) - 2, 1.0
        else:
            j = int(np.searchsorted(ts, t, side="left")) - 1
            u = (t - ts[j]) / (ts[j + 1] - ts[j])
        k = min(j + 1, len(ts) - 1)
        pos.append(P[j] + u * (P[k] - P[j]))
        quat.append(qslerp(Q[j], Q[k], u) if k != j else Q[j])
        fov.append(_fov(C[j] + u * (C[k] - C[j])))
    return np.array(pos), np.array(quat), np.array(fov)


def sample_shot(shot):
    k = shot.track
    times = [i / shot.fps for i in range(shot.frames)]
    return interpolate([x.t for x in k], [x.position for x in k], [x.quaternion for x in k],
                       [x.fov_v_deg for x in k], times)
