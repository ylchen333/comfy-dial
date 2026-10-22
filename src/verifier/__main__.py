"""python -m verifier score --shot shot.json --poses poses.json"""

import argparse
import json
import sys
from pathlib import Path

from comfy_osh_contracts import Shot

from .moveclass import classify, focal_ratio
from .score import TRANS_GATE_RATIO_TOL, drivers, score


def main(argv=None):
    ap = argparse.ArgumentParser(prog="verifier")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sc = sub.add_parser("score", help="score recovered poses against an authored Shot")
    sc.add_argument("--shot", required=True)
    sc.add_argument("--poses", required=True)
    sc.add_argument("--candidate-id")
    sc.add_argument("--fov-gate", action="store_true", help="gate pass/composite on absolute FOV error (off by default)")
    fl = sub.add_parser("floor", help="score recovered poses for every golden clip (noise floor)")
    fl.add_argument("--clips-dir", required=True)
    fl.add_argument("--poses-dir", required=True)
    fl.add_argument("--fov-gate", action="store_true")
    cl = sub.add_parser("classify", help="advisory move class (focal ratio) of authored vs recovered")
    cl.add_argument("--shot", required=True)
    cl.add_argument("--poses", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "floor":
        from .floor import floor, table

        rows = floor(a.clips_dir, a.poses_dir, fov_gate=a.fov_gate)
        print(table(rows))
        print()
        print(json.dumps(rows, indent=2))
        return 0
    raw = json.loads(Path(a.shot).read_text())
    if raw.get("format") == "comfy-osh.golden-clip/1":  # golden-clip .meta.json wraps the Shot
        raw = raw["shot"]
    shot = Shot.model_validate_json(json.dumps(raw))
    if a.cmd == "classify":
        ra = focal_ratio(shot)
        try:
            rr = focal_ratio(json.loads(Path(a.poses).read_text()))
        except (OSError, ValueError, KeyError, IndexError):
            rr = None  # failed solve: no recovered class
        ca, cr = classify(ra), None if rr is None else classify(rr)
        print(json.dumps({"authored": ca, "recovered": cr, "authoredRatio": ra, "recoveredRatio": rr,
                          "match": cr == ca, "advisory": True}, indent=2))
        return 0
    try:
        poses = json.loads(Path(a.poses).read_text())
    except (OSError, ValueError):
        poses = None  # unreadable poses = failed solve, never dropped
    gate = a.fov_gate
    rep = score(shot, poses, a.candidate_id or Path(a.poses).stem, fov_gate=gate)
    print(json.dumps(rep.model_dump(by_alias=True), indent=2))
    print(drivers(rep, gate, abs(focal_ratio(shot) - 1) <= TRANS_GATE_RATIO_TOL), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
