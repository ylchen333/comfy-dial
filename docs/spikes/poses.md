# Spike: DA3 poses out of a Comfy job (SPEC 4.3)

Result: **Option A works on Comfy Cloud, with a pack node, not a core node.** No core node exports poses.
Cloud prompt `d9dc63dc-d616-4e5c-b42f-705ed0569001` completed in 11.7 s (17 frames, 448x252, da3_small).

## How poses leave the job

| Path | Graph | Where | Status |
|---|---|---|---|
| Cloud (A) | `LoadVideo > GetVideoComponents > DownloadAndLoadDepthAnythingV3Model(da3_small) > DepthAnythingV3_MultiView` outputs `extrinsics`, `intrinsics` (STRING, JSON) `> SaveText` (core, `.txt`) x2 | `src/workflows/da3_poses.api.json` | Verified |
| Local (B) | `LoadDA3Model > DA3Inference(multiview) > ComfyDial_SaveCameraPosesJSON` | `src/workflows/da3_poses_local.api.json`, node in `src/comfy_nodes/` | Node unit-tested; not run inside ComfyUI (no local install with DA3 weights) |

Cloud flow: `comfy upload clip.mp4 --where cloud`, put the returned `cloud_name` in node 1, `comfy run --workflow ... --where cloud --json`, `comfy jobs wait <id> --where cloud`, `comfy download <id> --where cloud` (files land in `outputs/<id8>_001.txt` = extrinsics, `_002.txt` = intrinsics). Then convert:
`uv run python comfy_nodes/poses.py <extrinsics.txt> <intrinsics.txt> poses.json [fps]` (or import `build_poses`).

Sample output: `src/workflows/da3_poses.sample.poses.json`.

## Raw DA3 convention (what the nodes emit)

- Extrinsics: per frame 3x4 `[R|t]`, **world-to-camera**, OpenCV axes (x right, y down, z forward). World frame = camera 0 (frame 0 is ~identity, not exactly: cam_dec output).
- Intrinsics: 3x3 pixel-space K at the processed image size. Principal point is the image centre. Cloud text format: `{"extrinsics":[{"image_0":[[..]]},...]}`.
- Units: **not metres.** Small/Base are relative-depth models; scale is arbitrary and per-clip. Use only scale-invariant metrics (Sim(3) alignment in the verifier). Do not use the Metric Large variants (licence banned anyway).
- Check performed: camera centre `C = -R^T t` moves along +Z (OpenCV forward) for a synthetic forward dolly, which confirms w2c.

## Conversion to project convention (right-handed, Y-up, three.js, looks down -Z, quat [x,y,z,w])

Let `S = diag(1,-1,-1)` (180 deg about X; flips y and z).
1. `M = [[R,t],[0,1]]`; `c2w_cv = inv(M)`.
2. `c2w_three = S @ c2w_cv @ S` (S applied to the world axes on the left and the camera axes on the right).
3. `position = c2w_three[:3,3]`; `quaternion = quat_xyzw(c2w_three[:3,:3])`, sign made continuous across frames.
4. `fov_v_deg = 2*atan(H / (2*fy))`, with `H = 2*cy` unless given.

Consequences: forward dolly goes toward -Z; OpenCV "down" becomes -Y. DA3 world "up" is camera 0's up, not gravity, so a camera that starts pitched gives a tilted world. Verifier must Sim(3)-align (rotation included) before comparing to the authored path.
Implemented in `src/comfy_nodes/poses.py` (`w2c_to_threejs_c2w`), tested in `src/comfy_nodes/tests/test_poses.py` (identity, dolly, down axis, yaw).

## poses.json shape (`comfy-dial/poses/1`)

`{schema, fps, image{width,height}, solve_ok, convention{...}, source{...}, frames[{index, t, position[3], quaternion[4 xyzw], fov_v_deg, fx, fy, cx, cy}]}`. Validates with `comfy_dial_contracts.Poses` (`schema/poses.schema.json`). `t = index / fps` (seconds from clip start); `index` is the source-clip frame index, so strided solves carry `index = i*stride`. Quaternions are not rounded (unit to 1e-6). CLI: `poses.py ext.txt int.txt out.json [fps=25] [stride=1]`.
Field names match Shot keyframes.

## Gotchas

- Tested Oct 18: Comfy Cloud rejects the unpublished `ComfyDial_SaveCameraPosesJSON` as `unknown_class_type`, while the pack workflow validates. Untested whether publishing the pack to the Registry changes this.

- Core `DA3Inference` returns `DA3_GEOMETRY` only; no core node reads extrinsics. The pack node `DepthAnythingV3_MultiView` returns them as strings (Cloud only has it via the ComfyUI-DepthAnythingV3 pack).
- Pack loader `DownloadAndLoadDepthAnythingV3Model` defaults to `da3_large` and lists large/giant/metric; **set `da3_small` or `da3_base` explicitly.** Core `LoadDA3Model` also lists `mono_large` and `metric_large`; use only `depth_anything_3_small|base`.
- Estimated focal on the synthetic room (true vertical FOV 60 deg) came out as ~35 deg (fx ~400 vs true 218). DA3 Small FOV is unreliable on synthetic content; treat FOV error with caution until calibrated on real takes. Translation magnitude was also unreliable (0.17 vs 2.4 m true, non-monotone at the end).
- Test clip was a synthetic raycast room (17 frames), not a real video. Rotation/translation direction check is qualitative only.
- `comfy_nodes/__init__.py` degrades to pure helpers when `comfy_api` is missing so pytest can import it.
- Local node tests are not in the standard gate (`pnpm -r test && uv run pytest verifier`); run `uv run pytest verifier comfy_nodes` from `src/`.

## Noise-floor run (Oct 18)

7 golden `*.rgb.mp4` clips, decimated locally with ffmpeg to every 4th frame (31 frames, source index 0..120), da3_small, via `da3_poses.api.json` on Cloud. Server time 6-22 s per job; 4 credits ($0.02) for all 7. Output frames 31/31 on every clip, processed size 768x512. Outputs: `src/tests/golden/da3_poses/<clip>.poses.json`. Estimated vertical FOV per clip is nearly constant (e.g. zoom_only 35.8-38.1 deg), so zoom is barely visible in DA3 Small intrinsics. Scoring is the verifier lane's job.
