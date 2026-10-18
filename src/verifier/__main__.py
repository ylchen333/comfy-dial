"""python -m verifier score --shot shot.json --poses poses.json"""

import argparse
import json
import sys
from pathlib import Path

from comfy_osh_contracts import Shot

from .score import drivers, score


def main(argv=None):
    ap = argparse.ArgumentParser(prog="verifier")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sc = sub.add_parser("score", help="score recovered poses against an authored Shot")
    sc.add_argument("--shot", required=True)
    sc.add_argument("--poses", required=True)
    sc.add_argument("--candidate-id")
    sc.add_argument("--no-fov-gate", action="store_true", help="report FOV error but keep it out of pass/composite")
    a = ap.parse_args(argv)
    shot = Shot.model_validate_json(Path(a.shot).read_text())
    try:
        poses = json.loads(Path(a.poses).read_text())
    except (OSError, ValueError):
        poses = None  # unreadable poses = failed solve, never dropped
    gate = not a.no_fov_gate
    rep = score(shot, poses, a.candidate_id or Path(a.poses).stem, fov_gate=gate)
    print(json.dumps(rep.model_dump(by_alias=True), indent=2))
    print(drivers(rep, gate), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
