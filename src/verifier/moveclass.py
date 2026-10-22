"""Advisory move class from the focal ratio r = cot(fov_last/2) / cot(fov_first/2) (docs/calibration.md)."""

import math

NONE_LO, NONE_HI = 0.956, 1.046


def _cot(fov_deg):
    return 1 / math.tan(math.radians(fov_deg) / 2)


def focal_ratio(obj):
    """Ratio for a Shot (track keys), a Poses dict/model (solved frames) or a list of fov degrees."""
    if isinstance(obj, (list, tuple)):
        fovs = list(obj)
    elif isinstance(obj, dict):
        fovs = [f["fov_v_deg"] for f in obj["frames"]]
    elif hasattr(obj, "track"):
        fovs = [k.fov_v_deg for k in obj.track]
    else:
        fovs = [f.fov_v_deg for f in obj.frames]
    return _cot(fovs[-1]) / _cot(fovs[0])


def classify(r):
    """'none' (no zoom), 'in' (narrowing FOV), 'out' (widening FOV)."""
    if NONE_LO <= r <= NONE_HI:
        return "none"
    return "in" if r > NONE_HI else "out"
