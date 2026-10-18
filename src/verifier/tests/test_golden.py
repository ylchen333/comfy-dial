"""Golden tests (SPEC.md section 6): pure-math trajectories from the five Shot fixtures.

The "recovered" trajectory is the authored one, perturbed, then moved into an
arbitrary Sim(3) world (DA3 poses have arbitrary scale and frame).
"""

import json
import os
from pathlib import Path

import numpy as np
import pytest
from comfy_osh_contracts import ScoreReport, Shot

from verifier.geom import qmul, qnormalize, qslerp
from verifier.sampler import sample_shot
from verifier.score import score

SRC = Path(__file__).resolve().parents[2]
SHOTS = SRC / "packages/contracts/fixtures/shots"
EXPECTED = SRC / "tests/golden/expected/golden_scores.json"
NAMES = ["push_in", "orbit", "pan", "zoom_only", "dolly_zoom"]

# Arbitrary world: scale 3.7, rotation 90 deg about Y, translation. Quaternion for it:
WORLD_S = 3.7
WORLD_Q = qnormalize(np.array([0.0, np.sin(np.pi / 4), 0.0, np.cos(np.pi / 4)]))
WORLD_B = np.array([5.0, -2.0, 11.0])


def load(name):
    return Shot.model_validate_json((SHOTS / f"{name}.json").read_text())


def quat_to_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def to_world(pos, quat, fov):
    A = quat_to_mat(WORLD_Q)
    frames = [
        {
            "index": i,
            "position": (WORLD_S * A @ pos[i] + WORLD_B).tolist(),
            "quaternion": qnormalize(qmul(WORLD_Q, quat[i])).tolist(),
            "fov_v_deg": float(fov[i]),
        }
        for i in range(len(pos))
    ]
    return {"schema": "comfy-osh/poses/1", "frames": frames}


def perturb(kind, pos, quat, fov):
    if kind == "exact":
        return pos, quat, fov
    if kind == "reversed":
        return pos[::-1], quat[::-1], fov[::-1]
    if kind == "half":
        inv0 = quat[0] * np.array([-1, -1, -1, 1.0])
        ident = np.array([0, 0, 0, 1.0])
        q = np.array([qmul(quat[0], qslerp(ident, qmul(inv0, qi), 0.5)) for qi in quat])
        return pos[0] + 0.5 * (pos - pos[0]), q, fov[0] + 0.5 * (fov - fov[0])
    if kind == "zoom_for_dolly":
        # Camera stays put; the framing change is faked with FOV so a subject at
        # distance d0 along the frame-0 view axis keeps the image size a dolly gives.
        fwd = -quat_to_mat(quat[0])[:, 2]
        d0 = 6.0
        d = d0 - (pos - pos[0]) @ fwd
        t = np.tan(np.radians(fov[0]) / 2) * d / d0
        return np.tile(pos[0], (len(pos), 1)), quat, np.degrees(2 * np.arctan(t))
    if kind == "dolly_no_zoom":
        return pos, quat, np.full_like(fov, fov[0])
    if kind == "zoom_no_dolly":
        return np.tile(pos[0], (len(pos), 1)), quat, fov
    if kind == "mirrored":  # reflect across x=0: reverses orbit / pan direction
        return pos * [-1, 1, 1], quat * [1, -1, -1, 1], fov
    raise KeyError(kind)


# (shot, perturbation) pairs where the perturbation is not the identity.
CASES = [
    ("push_in", "reversed"), ("orbit", "reversed"), ("pan", "reversed"),
    ("zoom_only", "reversed"), ("dolly_zoom", "reversed"),
    ("push_in", "half"), ("orbit", "half"), ("pan", "half"),
    ("zoom_only", "half"), ("dolly_zoom", "half"),
    ("push_in", "zoom_for_dolly"), ("orbit", "zoom_for_dolly"), ("dolly_zoom", "zoom_for_dolly"),
    ("dolly_zoom", "dolly_no_zoom"), ("dolly_zoom", "zoom_no_dolly"),
    ("orbit", "mirrored"), ("pan", "mirrored"),
]


def run(name, kind):
    shot = load(name)
    return score(shot, to_world(*perturb(kind, *sample_shot(shot))), "c")


@pytest.mark.parametrize("name", NAMES)
def test_exact_path_near_zero(name):
    r = run(name, "exact")
    assert r.solveOk and r.passed
    assert r.rotErrDeg < 1e-3 and r.fovErrDeg < 1e-6 and r.composite < 1e-3
    if r.mode == "full":
        assert r.transErrPct < 1e-3
    ScoreReport.model_validate(r.model_dump(by_alias=True))


def test_modes():
    assert run("pan", "exact").mode == "rotation_only"
    assert run("zoom_only", "exact").mode == "rotation_only"
    assert run("push_in", "exact").mode == "full"


@pytest.mark.parametrize("name,kind", CASES)
def test_perturbed_strictly_worse(name, kind):
    good, bad = run(name, "exact"), run(name, kind)
    assert bad.composite > good.composite + 0.05, (name, kind, bad.composite)
    if kind != "half":  # half amplitude of a straight dolly is absorbed by the Sim(3) scale
        assert not bad.passed


def test_dolly_vs_zoom():
    """Authored dolly vs recovered zoom: told apart by transErrPct (path collapses)
    and fovErrDeg (FOV drifts), not by rotation."""
    r = run("push_in", "zoom_for_dolly")
    assert r.transErrPct > 20 and r.fovErrDeg > 5 and not r.passed
    # Dolly zoom: dolly without zoom is caught by FOV, zoom without dolly by translation.
    nz = run("dolly_zoom", "dolly_no_zoom")
    assert nz.fovErrDeg > 5 and nz.transErrPct < 1e-3
    nd = run("dolly_zoom", "zoom_no_dolly")
    assert nd.transErrPct > 20 and nd.fovErrDeg < 1e-6


def test_segments_localise_drift():
    shot = load("push_in")
    pos, quat, fov = sample_shot(shot)
    pos[80:] += np.linspace(0, 2.0, len(pos) - 80)[:, None] * [1, 0, 0]  # drift in last segment
    r = score(shot, to_world(pos, quat, fov), "c")
    assert len(r.perSegment) == 3
    assert r.perSegment[2].transErrPct > r.perSegment[0].transErrPct


def test_fov_gate_can_be_disabled():
    shot = load("zoom_only")
    pos, quat, fov = sample_shot(shot)
    poses = to_world(pos, quat, np.full_like(fov, 35.0))  # DA3-style wrong FOV
    assert not score(shot, poses, "c").passed
    r = score(shot, poses, "c", fov_gate=False)
    assert r.passed and r.fovErrDeg > 2


def test_solve_failed_is_worst_not_dropped():
    shot = load("push_in")
    r = score(shot, {"schema": "comfy-osh/poses/1", "frames": []}, "c")
    assert not r.solveOk and not r.passed and r.composite is None and r.rotErrDeg is None
    ScoreReport.model_validate(r.model_dump(by_alias=True))
    nan = to_world(*sample_shot(shot))
    nan["frames"][5]["position"][0] = float("nan")
    assert not score(shot, nan, "c").solveOk
    assert not score(shot, {"solve_ok": False, "frames": []}, "c").solveOk
    assert not score(shot, None, "c").solveOk


def test_expected_snapshot():
    cases = [(n, "exact") for n in NAMES] + CASES
    got = {f"{n}/{k}": round(float(run(n, k).composite), 3) for n, k in cases}
    if os.environ.get("UPDATE_GOLDEN"):
        EXPECTED.write_text(json.dumps(got, indent=1) + "\n")
    assert got == pytest.approx(json.loads(EXPECTED.read_text()), abs=2e-3)


def test_cli(tmp_path, capsys):
    from verifier.__main__ import main

    p = tmp_path / "poses.json"
    p.write_text(json.dumps(to_world(*sample_shot(load("push_in")))))
    assert main(["score", "--shot", str(SHOTS / "push_in.json"), "--poses", str(p)]) == 0
    out = json.loads(capsys.readouterr().out)
    ScoreReport.model_validate(out)
    assert out["pass"] is True
