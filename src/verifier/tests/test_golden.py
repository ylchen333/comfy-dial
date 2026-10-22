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


def to_world(pos, quat, fov, step=1):
    """Poses JSON in the arbitrary world, keeping every `step`-th frame."""
    A = quat_to_mat(WORLD_Q)
    frames = [
        {
            "index": i,
            "t": i / 25,
            "position": (WORLD_S * A @ pos[i] + WORLD_B).tolist(),
            "quaternion": qnormalize(qmul(WORLD_Q, quat[i])).tolist(),
            "fov_v_deg": float(fov[i]),
        }
        for i in range(0, len(pos), step)
    ]
    return {"schema": "comfy-osh/poses/1", "fps": 25, "image": {"width": 448, "height": 252}, "solve_ok": True, "frames": frames}


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
    # Synthetic FOV is exact, so these tests switch the (default-off) FOV gate on.
    return score(shot, to_world(*perturb(kind, *sample_shot(shot))), "c", fov_gate=True)


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
    # Known limits: half amplitude of a straight dolly is absorbed by the fitted scale, and zoom-no-dolly on a
    # dolly_zoom shot is not translation-gated (docs/calibration.md), so neither is required to fail.
    if kind != "half" and (name, kind) != ("dolly_zoom", "zoom_no_dolly"):
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
    assert not score(shot, poses, "c", fov_gate=True).passed
    r = score(shot, poses, "c")  # default: FOV reported, not gated
    assert r.passed and r.fovErrDeg > 2


def test_solve_failed_is_worst_not_dropped():
    shot = load("push_in")
    r = score(shot, {"schema": "comfy-osh/poses/1", "fps": 25, "image": {"width": 8, "height": 8}, "solve_ok": False, "frames": []}, "c")
    assert not r.solveOk and not r.passed and r.composite is None and r.rotErrDeg is None
    ScoreReport.model_validate(r.model_dump(by_alias=True))
    nan = to_world(*sample_shot(shot))
    nan["frames"][5]["position"][0] = float("nan")
    assert not score(shot, nan, "c").solveOk
    bad = to_world(*sample_shot(shot))
    bad["solve_ok"] = False
    assert not score(shot, bad, "c").solveOk
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


CLIPS = SRC / "tests/golden/clips"
META = sorted(CLIPS.glob("*.meta.json"))


def _shot(d):
    return Shot.model_validate_json(json.dumps(d))


def _check_against_ts(shot, ref_poses):
    pos, quat, fov = sample_shot(shot)
    assert len(ref_poses) == shot.frames
    for i, ref in enumerate(ref_poses):
        assert pos[i] == pytest.approx(ref["position"], abs=1e-6)
        q = np.array(ref["quaternion"])
        assert min(np.abs(quat[i] - q).max(), np.abs(quat[i] + q).max()) < 1e-6
        assert fov[i] == pytest.approx(ref["fov_v_deg"], abs=1e-6)


@pytest.mark.parametrize("path", META, ids=lambda p: p.name)
def test_sampler_matches_rig_core_clips(path):
    d = json.loads(path.read_text())
    _check_against_ts(_shot(d["shot"]), d["poses"])


@pytest.mark.parametrize("path", sorted(SHOTS.glob("*.json")), ids=lambda p: p.name)
def test_sampler_matches_rig_core_shot_fixtures(path):
    d = json.loads(path.read_text())
    shot = _shot(d)
    # TS reference = the clip meta rendered from the same track (same shot id and track).
    refs = [m for m in (json.loads(p.read_text()) for p in META) if m["shot"]["track"] == d["track"]]
    assert refs, f"no clip meta carries {path.name}'s track"
    _check_against_ts(shot, refs[0]["poses"])


@pytest.mark.parametrize("name", NAMES)
def test_subsampled_poses_still_near_zero(name):
    shot = load(name)
    r = score(shot, to_world(*sample_shot(shot), step=4), "c")
    assert r.solveOk and r.rotErrDeg < 0.5 and r.fovErrDeg < 0.5
    if r.mode == "full":
        assert r.transErrPct < 1.0


def test_full_length_unchanged():
    shot = load("push_in")
    a = score(shot, to_world(*sample_shot(shot)), "c")
    assert a.composite < 1e-3 and a.passed


def test_coverage_rule():
    shot = load("push_in")
    full = to_world(*sample_shot(shot))
    # hold one source period at the end: ok; two: failed solve
    ok = dict(full, frames=full["frames"][:-1])
    assert score(shot, ok, "c").solveOk
    short = dict(full, frames=full["frames"][:-2])
    assert not score(shot, short, "c").solveOk
    late = dict(full, frames=full["frames"][2:])
    assert not score(shot, late, "c").solveOk
    # subsampled by 4 and truncated by more than one 4-frame period
    sub = to_world(*sample_shot(shot), step=4)
    assert not score(shot, dict(sub, frames=sub["frames"][:-2]), "c").solveOk


def test_floor(tmp_path, capsys):
    from verifier.__main__ import main

    poses_dir = tmp_path / "poses"
    poses_dir.mkdir()
    for i, m in enumerate(META):
        d = json.loads(m.read_text())
        clip = m.name[: -len(".meta.json")]
        if i == 0:
            continue  # missing poses file: reported as a failed solve, not dropped
        w = to_world(*sample_shot(_shot(d["shot"])), step=1 if i % 2 else 4)
        (poses_dir / f"{clip}.poses.json").write_text(json.dumps(w))
    assert main(["floor", "--clips-dir", str(CLIPS), "--poses-dir", str(poses_dir)]) == 0
    out = capsys.readouterr().out
    rows = json.loads(out[out.index("[") :])
    assert len(rows) == len(META)
    assert not rows[0]["solveOk"]
    assert all(r["solveOk"] and r["pass"] and r["composite"] < 1e-2 for r in rows[1:])
    assert META[0].name[:-10] in out.split("\n\n")[0]


# ---- Real DA3 Base takes (docs/calibration.md) ----
import copy
import math

from verifier.moveclass import classify, focal_ratio
from verifier.score import GATES

G = SRC / "tests/golden"
BASE, SC2 = G / "da3_poses_real_base", G / "parallax_scene2"


def _clip_shot(name):
    return json.loads((CLIPS / f"{name}.meta.json").read_text())["shot"]


def real_shots():
    d, dz = _clip_shot("dolly_5to3"), _clip_shot("dolly_zoom_5to3")
    z = copy.deepcopy(d)
    z["id"] = "fx_zoom_5to3"
    p0 = z["track"][0]
    z["track"][1]["position"], z["track"][1]["quaternion"] = p0["position"], p0["quaternion"]
    z["track"][1]["fov_v_deg"] = 2 * math.degrees(math.atan(math.tan(math.radians(p0["fov_v_deg"] / 2)) / (5 / 3)))
    return {k: _shot(v) for k, v in {"dolly": d, "dollyzoom": dz, "zoom": z}.items()}


FILES = {"dolly": "dolly_5to3", "dollyzoom": "dolly_zoom_5to3", "zoom": "zoom_5to3"}
POSITIVES = [
    (mv, tag, path)
    for mv, fn in FILES.items()
    for tag, path in [
        ("s42", BASE / f"{fn}.poses.json"), ("s43", BASE / f"{fn}.s43.poses.json"), ("s44", BASE / f"{fn}.s44.poses.json"),
        ("sc2s42", SC2 / f"{fn}.scene2.s42.poses.json"), ("sc2s43", SC2 / f"{fn}.scene2.s43.poses.json"),
    ]
]
ids = lambda v: v if isinstance(v, str) else None  # noqa: E731


def _real(shotkey, path):
    shot = real_shots()[shotkey]
    poses = json.loads(Path(path).read_text())
    return shot, poses, score(shot, poses, Path(path).name)


def test_gates_frozen():
    assert GATES["rot"] == 2.75 and GATES["trans"] == 12.0


@pytest.mark.parametrize("mv,tag,path", POSITIVES, ids=lambda v: v if isinstance(v, str) else "")
def test_real_positives_pass(mv, tag, path):
    assert len(POSITIVES) == 15
    _, _, r = _real(mv, path)
    assert r.solveOk and r.passed, (mv, tag, r.rotErrDeg, r.transErrPct)


@pytest.mark.parametrize("name", ["neg_reversed.s42", "neg_noguide.s42", "neg_noguide.s43"])
def test_real_negatives_fail(name):
    assert not _real("dolly", BASE / f"{name}.poses.json")[2].passed


@pytest.mark.parametrize("mv,tag,path", [p for p in POSITIVES if p[0] == "zoom"], ids=lambda v: v if isinstance(v, str) else "")
def test_zoom_take_vs_dolly_shot_fails(mv, tag, path):
    assert not _real("dolly", path)[2].passed


@pytest.mark.xfail(reason="known limitation: a straight dolly of the wrong amplitude; scale is fitted so translation cannot see it", strict=True)
def test_neg_halfamp_fails():
    assert not _real("dolly", BASE / "neg_halfamp.s42.poses.json")[2].passed


@pytest.mark.parametrize("mv,tag,path", POSITIVES, ids=lambda v: v if isinstance(v, str) else "")
def test_classify_positive_matches_own_class(mv, tag, path):
    shot, poses, _ = _real(mv, path)
    assert classify(focal_ratio(shot)) == classify(focal_ratio(poses))


@pytest.mark.parametrize("mv,tag,path", POSITIVES, ids=lambda v: v if isinstance(v, str) else "")
def test_classify_wrong_move_mismatches(mv, tag, path):
    if mv == "zoom":
        shot, poses, _ = _real("dolly", path)
    elif mv == "dolly":
        shot, poses, _ = _real("zoom", path)
    else:
        pytest.skip("dolly zoom is not part of the dolly/zoom pairing")
    assert classify(focal_ratio(shot)) != classify(focal_ratio(poses))


def test_classify_thresholds():
    assert classify(1.0) == classify(0.956) == classify(1.046) == "none"
    assert classify(1.047) == "in" and classify(0.955) == "out"


def test_trans_gate_only_for_non_zoom_shots():
    # same recovered poses: translation fails the gate on a dolly shot, is reported-only on a zoom shot
    p = BASE / "dolly_zoom_5to3.s44.poses.json"  # trans ~15% > 12
    assert not _real("dolly", p)[2].passed
    r = _real("dollyzoom", p)[2]
    assert r.transErrPct > GATES["trans"] and r.passed


def test_classify_cli(tmp_path, capsys):
    from verifier.__main__ import main

    shot = tmp_path / "s.json"
    shot.write_text(json.dumps(_clip_shot("dolly_5to3")))
    assert main(["classify", "--shot", str(shot), "--poses", str(BASE / "zoom_5to3.poses.json")]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["authored"] == "none" and out["recovered"] == "in" and out["match"] is False


def test_reversed_straight_dolly_fails():
    """Fixed-orientation straight dolly vs the same path reversed: a free Sim(3) hides this."""
    shot = load("push_in")
    pos, quat, fov = sample_shot(shot)
    quat = np.tile(quat[0], (len(quat), 1))
    fov = np.full_like(fov, 40.0)
    for k in shot.track:
        k.quaternion = list(quat[0])
        k.fov_v_deg = 40.0
    good = score(shot, to_world(pos, quat, fov), "c")
    bad = score(shot, to_world(pos[::-1], quat, fov), "c")
    assert good.passed and good.transErrPct < 1e-3
    assert bad.transErrPct > 40 and not bad.passed  # exactly 50: reversed is uncorrelated, so s = 0


def test_cli_accepts_golden_meta_json(capsys):
    from verifier.__main__ import main
    import sys
    root = Path(__file__).resolve().parents[2] / "tests" / "golden"
    argv = ["verifier", "classify", "--shot", str(root / "clips" / "dolly_5to3.meta.json"),
            "--poses", str(root / "da3_poses_real_base" / "dolly_5to3.poses.json")]
    old, sys.argv = sys.argv, argv
    try:
        main()
    finally:
        sys.argv = old
    assert '"match": true' in capsys.readouterr().out
