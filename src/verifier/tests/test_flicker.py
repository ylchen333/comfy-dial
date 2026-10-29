import shutil
import subprocess

import numpy as np
import pytest

from verifier.flicker import brightness_jitter, decode_gray, report, second_difference


def clip(n=121, step_at=None, step=6.0, seed=0):
    """Frames of constant grey that drift slowly, with optional one-frame brightness jump at `step_at` (and back)."""
    rng = np.random.default_rng(seed)
    b = 100 + 0.05 * np.arange(n) + rng.normal(0, 0.05, n)
    if step_at is not None:
        b[step_at:step_at + 1] += step
    return np.broadcast_to(b[:, None, None], (n, 8, 8)).astype(np.float32).copy()


def test_smooth_drift_has_no_jitter():
    f = np.broadcast_to((100 + 0.5 * np.arange(60))[:, None, None], (60, 4, 4)).astype(np.float32)
    assert brightness_jitter(f).max() < 1e-4
    assert second_difference(f).max() < 1e-4


def test_a_one_frame_jump_is_the_worst_frame_and_a_seam_there_scores_high():
    r = report(clip(step_at=56), seams=(56, 112))
    assert r["worstFrame"] == 56
    assert r["seamRatio"][56] > 20
    assert r["seamRatio"][112] < 4          # nothing happens at the second seam
    assert 56 in r["spikeFrames"]


def test_a_clean_clip_has_no_spikes_and_seam_ratios_stay_modest_under_noise():
    r = report(clip(), seams=(56, 112))
    assert r["spikeFrames"] == []
    assert all(v < 8 for v in r["seamRatio"].values())  # the max of 3 noisy frames over the median: chance alone gives 2 to 5


def test_rejects_a_clip_too_short_to_measure():
    with pytest.raises(ValueError):
        report(clip(n=4))


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")
def test_decodes_a_real_video(tmp_path):
    out = tmp_path / "t.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=25", "-t", "1", "-pix_fmt", "yuv420p", str(out)], check=True)
    f = decode_gray(str(out), 64, 48)
    assert f.shape == (25, 48, 64)
    assert report(f)["frames"] == 25
