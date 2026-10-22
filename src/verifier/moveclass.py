"""Advisory move class from the focal ratio r = cot(fov_last/2) / cot(fov_first/2) (docs/calibration.md)."""

import math

NONE_TOL = 0.10  # |ln r| within this is 'no zoom' (push_in takes recover 0.92-0.98; dolly 1.00-1.03)
NONE_LO, NONE_HI = math.exp(-NONE_TOL), math.exp(NONE_TOL)
REL_TOL = 0.6  # for zoom shots: recovered log-ratio may be this fraction off the authored one


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


def moves_match(r_auth, r_rec):
    """Advisory: did the recovered focal change follow the authored one? (docs/calibration.md)

    Authored 'no zoom': match if the recovered change is also within NONE_TOL.
    Authored zoom: same direction and within REL_TOL of the authored log-ratio.
    """
    la, lr = math.log(r_auth), math.log(r_rec)
    if abs(la) <= NONE_TOL:
        return abs(lr) <= NONE_TOL
    return la * lr > 0 and abs(lr - la) <= REL_TOL * abs(la)
