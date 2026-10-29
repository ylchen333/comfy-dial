"""Temporal flicker of a generated clip: how much each frame's brightness jumps against its neighbours, and where.

Brightness jitter at frame i is |b[i] - (b[i-1] + b[i+1]) / 2| on the clip's mean luminance, so smooth motion and fades
cancel and a one-frame jump does not. A decoder that works in temporal tiles leaves its seams at fixed frames (multiples of
`temporal_size - temporal_overlap`), which shows up here as spikes at those frames. Pure numpy; ffmpeg only decodes.
"""
from __future__ import annotations

import subprocess

import numpy as np


def decode_gray(path: str, width: int = 192, height: int = 128) -> np.ndarray:
    """All frames of a video as (n, height, width) float32 luminance."""
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vf", f"scale={width}:{height},format=gray", "-f", "rawvideo", "-"],
        capture_output=True, check=True,
    )
    return np.frombuffer(p.stdout, np.uint8).reshape(-1, height, width).astype(np.float32)


def brightness_jitter(frames: np.ndarray) -> np.ndarray:
    """Entry k belongs to frame k + 1 (frames 1 .. n-2)."""
    b = frames.mean(axis=(1, 2))
    return np.abs(b[1:-1] - (b[:-2] + b[2:]) / 2)


def second_difference(frames: np.ndarray) -> np.ndarray:
    """Mean |F[i+1] - 2 F[i] + F[i-1]| per frame: texture shimmer that smooth motion does not explain."""
    return np.abs(frames[2:] - 2 * frames[1:-1] + frames[:-2]).mean(axis=(1, 2))


def report(frames: np.ndarray, seams: tuple[int, ...] = ()) -> dict:
    n = len(frames)
    if n < 5:
        raise ValueError(f"need at least 5 frames, got {n}")
    jb = brightness_jitter(frames)
    base_mask = np.ones(len(jb), bool)
    for s in seams:
        base_mask[max(0, s - 3): s + 2] = False  # jb index k is frame k + 1: frames s-2 .. s+2
    base = float(np.median(jb[base_mask])) if base_mask.any() else float(np.median(jb))
    base = max(base, 1e-6)
    seam_ratio = {int(s): float(jb[max(0, s - 2): s + 1].max() / base) for s in seams if 1 <= s <= n - 2}
    # 5x the median is about 3.4 sigma of pure noise (never by chance in a 121-frame clip); the floor ignores sub-grey-level wobble.
    spikes = [int(k) + 1 for k in np.flatnonzero((jb > 5 * base) & (jb > 0.15))]
    return {
        "frames": n,
        "jitterMedian": float(np.median(jb)),
        "jitterMax": float(jb.max()),
        "worstFrame": int(np.argmax(jb)) + 1,
        "spikeFrames": spikes,
        "seamRatio": seam_ratio,
        "shimmer": float(second_difference(frames).mean()),
    }


def table(rows: list[tuple[str, dict]]) -> str:
    out = [f"{'clip':<34}{'worst':>6}{'max':>7}{'median':>8}{'shimmer':>9}  spikes / seams (x median)"]
    for name, r in rows:
        seams = ", ".join(f"{s}:{v:.1f}x" for s, v in r["seamRatio"].items())
        out.append(f"{name[-34:]:<34}{r['worstFrame']:>6}{r['jitterMax']:>7.2f}{r['jitterMedian']:>8.3f}{r['shimmer']:>9.2f}  {r['spikeFrames'][:6]} {seams}")
    return "\n".join(out)
