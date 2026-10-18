"""Verifier scoring (SPEC.md section 6).

Pass/fail is driven by three independent gates: rot, trans, fov. FOV is its own
score because DA3 FOV estimates can be unreliable; `fov_gate=False` reports FOV
but keeps it out of pass/composite.
"""

import numpy as np
from comfy_osh_contracts import ScoreReport, SegmentScore

from .geom import qangle_deg, qconj, qmul, umeyama
from .sampler import sample_shot

GATES = {"rot": 3.0, "trans": 10.0, "fov": 2.0}  # provisional, SPEC section 6
ROTATION_ONLY_PATH = 1e-3  # authored path length below this => pan/tilt/zoom


def _failed(shot, cid):
    seg = [SegmentScore(start=s.start, end=s.end, rotErrDeg=None, transErrPct=None,
                        fovErrDeg=None, passed=False) for s in shot.segments]
    return ScoreReport(candidateId=cid, solveOk=False, mode="full", rotErrDeg=None,
                       transErrPct=None, fovErrDeg=None, perSegment=seg, composite=None, passed=False)


def parse_poses(poses, n_frames):
    """Return (pos, quat, fov) arrays or None when the solve is unusable."""
    if not isinstance(poses, dict) or poses.get("solve_ok") is False:
        return None
    fr = sorted(poses.get("frames") or [], key=lambda f: f.get("index", 0))
    if len(fr) != n_frames:
        return None
    try:
        pos = np.array([f["position"] for f in fr], float)
        quat = np.array([f["quaternion"] for f in fr], float)
        fov = np.array([f["fov_v_deg"] for f in fr], float)
    except (KeyError, TypeError, ValueError):
        return None
    if pos.shape != (n_frames, 3) or quat.shape != (n_frames, 4) or fov.shape != (n_frames,):
        return None
    if not (np.isfinite(pos).all() and np.isfinite(quat).all() and np.isfinite(fov).all()):
        return None
    norms = np.linalg.norm(quat, axis=1)
    if (norms < 1e-6).any():
        return None
    return pos, quat / norms[:, None], fov


def frame_errors(shot, pos_r, quat_r, fov_r):
    """Per-frame (rot deg, position error or None, fov deg) and authored path length."""
    pos_a, quat_a, fov_a = sample_shot(shot)
    # Local rotation relative to frame 0 is invariant to the recovered world frame.
    rot = np.array([
        qangle_deg(qmul(qconj(qmul(qconj(quat_a[0]), qa)), qmul(qconj(quat_r[0]), qr)))
        for qa, qr in zip(quat_a, quat_r)
    ])
    fov = np.abs(fov_r - fov_a)
    path = float(np.linalg.norm(np.diff(pos_a, axis=0), axis=1).sum())
    if path < ROTATION_ONLY_PATH:
        return rot, None, fov, path
    ca, cr = pos_a - pos_a[0], pos_r - pos_r[0]
    s, R, t = umeyama(cr, ca)
    err = np.linalg.norm((s * (R @ cr.T)).T + t - ca, axis=1)
    return rot, err, fov, path


def _agg(rot, err, fov, path, sl, fov_gate):
    r, f = float(rot[sl].mean()), float(fov[sl].mean())
    tr = None if err is None else float(err[sl].mean() / path * 100)
    ok = r < GATES["rot"] and (tr is None or tr < GATES["trans"]) and (not fov_gate or f < GATES["fov"])
    return r, tr, f, bool(ok)


def score(shot, poses, candidate_id, fov_gate=True):
    parsed = parse_poses(poses, shot.frames)
    if parsed is None:
        return _failed(shot, candidate_id)
    rot, err, fov, path = frame_errors(shot, *parsed)
    r, tr, f, ok = _agg(rot, err, fov, path, slice(None), fov_gate)
    terms = [r / GATES["rot"]]
    if tr is not None:
        terms.append(tr / GATES["trans"])
    if fov_gate:
        terms.append(f / GATES["fov"])
    segs = []
    for s in shot.segments:
        sr, st, sf, sok = _agg(rot, err, fov, path, slice(s.start, s.end), fov_gate)
        segs.append(SegmentScore(start=s.start, end=s.end, rotErrDeg=sr, transErrPct=st, fovErrDeg=sf, passed=sok))
    return ScoreReport(candidateId=candidate_id, solveOk=True, mode="full" if err is not None else "rotation_only",
                       rotErrDeg=r, transErrPct=tr, fovErrDeg=f, perSegment=segs,
                       composite=float(sum(terms) / len(terms)), passed=ok)


def drivers(rep, fov_gate=True):
    """Human-readable line: which gate(s) decided pass/fail."""
    if not rep.solveOk:
        return "solveOk=false: worst rank, pass=false"
    checks = [("rot", rep.rotErrDeg), ("trans", rep.transErrPct), ("fov", rep.fovErrDeg)]
    out = []
    for name, v in checks:
        if v is None:
            continue
        g = GATES[name]
        note = " (reported, not gating)" if name == "fov" and not fov_gate else ""
        out.append(f"{name}={v:.3g}{'<' if v < g else '>='}{g:g}{note}")
    return f"pass={rep.passed} [{rep.mode}] " + " ".join(out)
