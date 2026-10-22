# Verifier calibration (frozen Oct 22, 2026)

Data: 15 positive real takes (dolly, dolly zoom, zoom × 5 each; 2 scenes; DA3 Base; LTX-2.5 Union-Control, guide strength 1.0), 4 labelled negatives, and the 7 rendered golden clips as the noise floor. Scores come from `verifier` after the frame-0-camera, scale-only change (SPEC §6).

## Noise floor (rendered golden clips, DA3 Base, camera known)

| clip | rot ° | trans % | abs FOV err ° |
|---|---|---|---|
| dolly_5to3 | 0.42 | 3.4 | 6.3 |
| dolly_zoom_5to3 | 0.95 | **10.2** | 6.3 |
| dolly_zoom | 0.75 | **22.7** | 8.2 |
| orbit | 1.06 | 1.2 | 3.0 |
| pan / zoom_only / push_in | 0.19–0.58 | 1.6 / n/a | 1.4–7.7 |

Two findings fixed the design: absolute FOV error sits at 1.4–8.2° on a perfect camera, so a 2° FOV gate fails everything; and translation on shots whose FOV changes is unreliable even on rendered footage (DA3 explains part of the focal change as camera travel).

## Frozen thresholds

| Metric | Rule | Evidence |
|---|---|---|
| `rotErrDeg` | pass if < **2.75°** | floor max 1.06; real positives max 2.49; `neg_noguide` 2.96 and 3.47 |
| `transErrPct` | pass if < **12%**, only when the authored focal ratio is within 10% of 1 (no zoom) | dolly positives 6.4–10.2; reversed 50; wrong-move zoom 15.7–50; dolly-zoom positives 10–50, so ungated for FOV-changing shots |
| `fovErrDeg` | reported, **not gated** (`--no-fov-gate` becomes the default) | floor 1.4–8.2° |
| Move class (advisory) | focal ratio r = cot(fov_last/2) ÷ cot(fov_first/2); "no zoom" if 0.956 ≤ r ≤ 1.046; flag a mismatch with the authored class | dolly 1.00–1.03; dolly zoom 0.52–0.94; zoom 1.27–1.91; margin is about 0.016 on each side |

Result on the labelled set: 15 of 15 positives pass; 8 of 9 failures are caught. Not caught: `neg_halfamp` (a straight dolly of the wrong amplitude; scale is fitted, so translation cannot see it).

## Limits (do not oversell)

- 2 scenes, 5 takes per move, one subject type. The thresholds were chosen after seeing this data, so the 15/15 is a fit, not a held-out result.
- The move-class margin is thin. It is a label, not a gate.
- A reversed dolly zoom is not covered by the translation gate (ungated for FOV-changing shots). It is covered only if a golden test says so; add one before relying on it.
- `neg_weak` (strength 0.3) was excluded: LTX still followed the full dolly.
- Re-run `python -m verifier floor` and the table in this file whenever DA3, the model size or the guide changes.
