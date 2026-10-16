"""Regenerate fixtures/shots/*.json. Run: python packages/contracts/scripts/gen_fixtures.py (stdlib only)."""

import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "fixtures" / "shots"
FRAMES, FPS = 121, 25
DURATION = (FRAMES - 1) / FPS  # 4.8 s
TARGET = (0.0, 1.0, 0.0)


def _norm(v):
    n = math.sqrt(sum(c * c for c in v))
    return tuple(c / n for c in v)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def look_at(eye, target=TARGET):
    """Quaternion [x, y, z, w] for a three.js camera at eye looking at target (camera looks down -Z)."""
    z = _norm(tuple(e - t for e, t in zip(eye, target)))  # camera +Z points away from target
    x = _norm(_cross((0.0, 1.0, 0.0), z))
    y = _cross(z, x)
    m00, m01, m02 = x[0], y[0], z[0]
    m10, m11, m12 = x[1], y[1], z[1]
    m20, m21, m22 = x[2], y[2], z[2]
    tr = m00 + m11 + m22
    if tr > 0:
        s = 0.5 / math.sqrt(tr + 1.0)
        q = ((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s)
    elif m00 > m11 and m00 > m22:
        s = 2.0 * math.sqrt(1.0 + m00 - m11 - m22)
        q = (0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s)
    elif m11 > m22:
        s = 2.0 * math.sqrt(1.0 + m11 - m00 - m22)
        q = ((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s)
    else:
        s = 2.0 * math.sqrt(1.0 + m22 - m00 - m11)
        q = ((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s)
    return [round(c, 9) for c in q]


def yaw(deg):
    h = math.radians(deg) / 2
    return [0.0, round(math.sin(h), 9), 0.0, round(math.cos(h), 9)]


def key(t, pos, quat, fov):
    return {"t": round(t, 6), "position": [round(c, 9) for c in pos], "quaternion": quat, "fov_v_deg": round(fov, 6)}


def shot(shot_id, name, track):
    return {
        "version": 1,
        "id": shot_id,
        "name": name,
        "scene": {
            "nodes": [
                {"id": "ground", "asset": "primitive:plane",
                 "transform": {"position": [0, 0, 0], "quaternion": [-0.707106781, 0, 0, 0.707106781], "scale": [20, 20, 1]}},
                {"id": "subject", "asset": "primitive:box",
                 "transform": {"position": [0, 1, 0], "quaternion": [0, 0, 0, 1], "scale": [1, 2, 1]}},
                {"id": "pillar_l", "asset": "primitive:cylinder",
                 "transform": {"position": [-3, 1.5, -2], "quaternion": [0, 0, 0, 1], "scale": [0.5, 3, 0.5]}},
                {"id": "pillar_r", "asset": "primitive:cylinder",
                 "transform": {"position": [3, 1.5, -2], "quaternion": [0, 0, 0, 1], "scale": [0.5, 3, 0.5]}},
            ]
        },
        "fps": FPS,
        "frames": FRAMES,
        "resolution": {"width": 768, "height": 512},
        "track": track,
        "segments": [{"start": 0, "end": 40}, {"start": 40, "end": 80}, {"start": 80, "end": FRAMES}],
    }


def dolly_zoom_fov(fov0_deg, d0, d):
    """Keep the subject's framed height constant: d * tan(fov/2) = const."""
    return math.degrees(2 * math.atan(math.tan(math.radians(fov0_deg) / 2) * d0 / d))


def build():
    eye_h = 1.6
    shots = {}

    a, b = (0, eye_h, 6.0), (0, eye_h, 3.0)
    shots["push_in"] = shot("fx_push_in", "Push-in 6m -> 3m, 40 deg",
                            [key(0, a, look_at(a), 40), key(DURATION, b, look_at(b), 40)])

    r, track = 5.0, []
    for i, ang in enumerate((0, 30, 60, 90)):
        eye = (r * math.sin(math.radians(ang)), eye_h, r * math.cos(math.radians(ang)))
        track.append(key(DURATION * i / 3, eye, look_at(eye), 40))
    shots["orbit"] = shot("fx_orbit", "Orbit 90 deg counter-clockwise (seen from above), r=5m", track)

    eye = (0, eye_h, 5.0)
    shots["pan"] = shot("fx_pan", "Pan left 30 deg from a fixed position",
                        [key(0, eye, yaw(0), 40), key(DURATION, eye, yaw(30), 40)])

    eye = (0, eye_h, 5.0)
    shots["zoom_only"] = shot("fx_zoom_only", "Zoom 50 -> 25 deg, camera fixed",
                              [key(0, eye, look_at(eye), 50), key(DURATION, eye, look_at(eye), 25)])

    d0, d1, fov0 = 8.0, 4.0, 25.0
    track = []
    for i in range(5):
        d = d0 + (d1 - d0) * i / 4
        eye = (0, eye_h, d)
        track.append(key(DURATION * i / 4, eye, look_at(eye), dolly_zoom_fov(fov0, d0, d)))
    shots["dolly_zoom"] = shot("fx_dolly_zoom", "Dolly-in 8m -> 4m while widening 25 -> ~47.8 deg", track)
    return shots


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in build().items():
        (OUT / f"{name}.json").write_text(json.dumps(data, indent=2) + "\n")
        print(f"wrote {OUT / (name + '.json')}")
