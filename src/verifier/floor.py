"""Noise-floor scorer: score each golden clip's recovered poses against meta.shot.

Reports only; it never changes pass thresholds.
"""

import json
from pathlib import Path

from comfy_osh_contracts import Shot

from .score import score


def floor(clips_dir, poses_dir, fov_gate=False):
    rows = []
    for meta_path in sorted(Path(clips_dir).glob("*.meta.json")):
        meta = json.loads(meta_path.read_text())
        clip = meta_path.name[: -len(".meta.json")]
        shot = Shot.model_validate_json(json.dumps(meta["shot"]))
        pp = Path(poses_dir) / f"{clip}.poses.json"
        try:
            poses = json.loads(pp.read_text())
        except (OSError, ValueError):
            poses = None  # missing/unreadable = failed solve, kept in the table
        rep = score(shot, poses, clip, fov_gate=fov_gate)
        rows.append(rep.model_dump(by_alias=True))
    return rows


def _f(v, spec):
    return "-" if v is None else format(v, spec)


def table(rows):
    head = f"{'clip':<18}{'solve':<6}{'mode':<14}{'rotErrDeg':>10}{'transErrPct':>12}{'fovErrDeg':>10}{'composite':>10}  segments(pass)"
    lines = [head, "-" * len(head)]
    for r in rows:
        seg = " ".join("P" if s["pass"] else "F" for s in r["perSegment"])
        lines.append(
            f"{r['candidateId']:<18}{'ok' if r['solveOk'] else 'FAIL':<6}{r['mode']:<14}"
            f"{_f(r['rotErrDeg'], '.3f'):>10}{_f(r['transErrPct'], '.2f'):>12}"
            f"{_f(r['fovErrDeg'], '.3f'):>10}{_f(r['composite'], '.3f'):>10}  {seg}"
        )
    return "\n".join(lines)
