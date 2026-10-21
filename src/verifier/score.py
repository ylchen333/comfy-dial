"""Verifier scoring (SPEC.md section 6).

Pass/fail is driven by three independent gates: rot, trans, fov. FOV is its own
score because DA3 FOV estimates can be unreliable; `fov_gate=False` reports FOV
but keeps it out of pass/composite.
"""

import json

import numpy as np
from comfy_osh_contracts import Poses, ScoreReport, SegmentScore
from pydantic import ValidationError

from .geom import qangle_deg, qconj, qmul, quat_to_mat
from .sampler import interpolate, sample_shot

GATES = {"rot": 3.0, "trans": 15.0, "fov": 2.0}  # provisional, SPEC section 6
ROTATION_ONLY_PATH = 1e-3  # authored path length below this => pan/tilt/zoom


def _failed(shot, cid):
    seg = [SegmentScore(start=s.start, end=s.end, rotErrDeg=None, transErrPct=None,
                        fovErrDeg=None, passed=False) for s in shot.segments]
    return ScoreReport(candidateId=cid, solveOk=False, mode="full", rotErrDeg=None,
                       transErrPct=None, fovErrDeg=None, perSegment=seg, composite=None, passed=False)


def parse_poses(poses, shot):
    """Resample recovered poses onto the Shot's frame times; None when the solve is unusable.

    Coverage rule: solved frames must span [0, (frames-1)/fps]. An end may be held
    for at most one source-frame period (the larger of 1/poses.fps and the median
    gap between solved frames); more missing than that is a failed solve.
    """
    try:
        p = Poses.model_validate_json(json.dumps(poses))  # JSON mode: the mirror's strict tuples need it
    except (ValidationError, TypeError, ValueError):  # ValidationError is a ValueError
        return None
    if not p.solve_ok:
        return None
    fr = p.frames
    ts = np.array([f.t for f in fr])
    pos = np.array([f.position for f in fr], float)
    quat = np.array([f.quaternion for f in fr], float)
    fov = np.array([f.fov_v_deg for f in fr], float)
    if not (np.isfinite(pos).all() and np.isfinite(quat).all() and np.isfinite(fov).all() and np.isfinite(ts).all()):
        return None
    if (np.linalg.norm(quat, axis=1) < 1e-6).any():
        return None
    period = 1 / p.fps
    if len(ts) > 1:
        period = max(period, float(np.median(np.diff(ts))))
    end = (shot.frames - 1) / shot.fps
    if ts[0] > period + 1e-9 or ts[-1] < end - period - 1e-9:
        return None
    return interpolate(ts, pos, quat, fov, [i / shot.fps for i in range(shot.frames)])


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
    # Express both paths in the frame-0 camera's axes and fit scale only. A free rotation
    # (Sim(3)) would let a reversed straight dolly match its original; DA3's frame is camera 0,
    # so the frame-0 axes are shared and only the scale is arbitrary.
    ca = (pos_a - pos_a[0]) @ quat_to_mat(quat_a[0])
    cr = (pos_r - pos_r[0]) @ quat_to_mat(quat_r[0])
    den = float((cr * cr).sum())
    s = max(float((ca * cr).sum()) / den, 0.0) if den > 1e-18 else 0.0
    err = np.linalg.norm(ca - s * cr, axis=1)
    return rot, err, fov, path


def _agg(rot, err, fov, path, sl, fov_gate):
    r, f = float(rot[sl].mean()), float(fov[sl].mean())
    tr = None if err is None else float(err[sl].mean() / path * 100)
    ok = r < GATES["rot"] and (tr is None or tr < GATES["trans"]) and (not fov_gate or f < GATES["fov"])
    return r, tr, f, bool(ok)


def score(shot, poses, candidate_id, fov_gate=True):
    parsed = parse_poses(poses, shot)
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
