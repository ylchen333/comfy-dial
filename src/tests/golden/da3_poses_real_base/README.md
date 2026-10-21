# DA3 (base) poses of REAL LTX-2.5 takes

These are NOT from the rendered golden clips. File names use the golden-clip names the poses should be scored against. All files: `da3_base`, stride 4 (31 frames), fps 25, t = index/25, Poses contract. Authored move is a 5 to 3 subject-distance camera move unless stated.

## Seed 42 (poses worktree)
`dolly_zoom_5to3.poses.json` and `dolly_5to3.poses.json` come from `dollyzoom_take.mp4` and `dolly_control_take.mp4`.

## Seeds 43/44 and negatives (Comfy Cloud, LTX-2.5 Union-Control)
- `dolly_5to3.s43|s44`, `dolly_zoom_5to3.s43|s44`, `zoom_5to3.s43|s44` (and `zoom_5to3.poses.json` = seed 42): positives, LTX followed the guide.
- `neg_noguide.s42|s43`: INTENTIONALLY FAILING. Guide strength 0.0 with the plain-dolly guide; the model ignored the guide, camera is (nearly) static, scene differs from the dolly takes.
- `neg_weak.s42|s43`: guide strength 0.3 with the plain-dolly guide. Not actually failing: LTX still followed the dolly (subject grew about 1.6x). Kept as a documented result, not a clean negative.
- `neg_reversed.s42`: INTENTIONALLY FAILING vs the authored dolly-in. The guide is the dolly reversed (pull-out, distance 3 to 5); the take is a pull-out, subject shrinks.
- `neg_halfamp.s42`: INTENTIONALLY FAILING vs the authored 5 to 3 dolly. Guide is a half-amplitude dolly (5 to 4, subject growth 1.25x); the take follows that smaller move, so only the scale is wrong.
