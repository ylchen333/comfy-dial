"""Quaternion helpers ([x, y, z, w]) and Umeyama Sim(3). Hand-written, numpy only."""

import numpy as np


def qnormalize(q):
    return q / np.linalg.norm(q)


def qconj(q):
    return np.asarray(q) * np.array([-1.0, -1.0, -1.0, 1.0])


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return np.array([
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
        aw * bw - ax * bx - ay * by - az * bz,
    ])


def qangle_deg(q):
    """Rotation angle of a unit quaternion in degrees (stable near 0)."""
    return float(np.degrees(2 * np.arctan2(np.linalg.norm(q[:3]), abs(q[3]))))


def qslerp(a, b, t):
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        return qnormalize(a + t * (b - a))
    th = np.arccos(d)
    return (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)


def umeyama(src, dst):
    """Least-squares Sim(3): returns (s, R, t) minimising |s R src + t - dst|.

    Umeyama 1991. Degenerate src (no spread) gives s = 0, so the fit collapses
    to dst's centroid and the error reflects the whole authored path.
    """
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    n = len(src)
    mu_s, mu_d = src.mean(0), dst.mean(0)
    xs, xd = src - mu_s, dst - mu_d
    var_s = (xs ** 2).sum() / n
    if var_s < 1e-18:
        return 0.0, np.eye(3), mu_d
    U, D, Vt = np.linalg.svd(xd.T @ xs / n)
    S = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[2, 2] = -1  # forbid reflections
    R = U @ S @ Vt
    s = float((D * np.diag(S)).sum() / var_s)
    return s, R, mu_d - s * R @ mu_s
