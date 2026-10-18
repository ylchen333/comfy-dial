# Spike: LTX-2.5 + Union-Control IC-LoRA on Comfy Cloud

Date: 2026-10-16. Lane: spike-cloud.

## Verdict: Cloud works. Use Cloud as the primary generation backend.

One 121-frame depth-guided take ran end to end on Comfy Cloud with open-weights nodes only.

| Metric | Value |
|---|---|
| prompt_id | `6711e8b5-8ccf-4eed-a5cb-8ecba9262909` |
| Idempotency map | `src/workflows/spike_jobs.json` (`spike-cloud-take-0-seed42` -> prompt_id), saved before awaiting |
| Wall time (submit -> completed, `jobs wait`) | 44 s |
| Credits per take | 11 credits (7389 -> 7378), about $0.05 (balance $35.02 -> $34.97) |
| Output | 768x512, 121 frames, 25 fps, 4.84 s, with audio; `src/workflows/out/take.mp4` |
| Plan | CREATOR, max 3 concurrent jobs |

Eight takes (SPEC demo) is about 90 credits (about $0.40) and, at 3 concurrent, roughly 2 to 3 minutes of wall time.

## Node availability on Comfy Cloud (`nodes show --where cloud`)

| Node | Present |
|---|---|
| LTXICLoRALoaderModelOnly | yes |
| LTXAddVideoICLoRAGuide | yes |
| LoadDA3Model | yes |
| DA3Inference | yes |
| GetICLoRAParameters, ImagePrepForICLora, LTXVCropGuides, LTXVConcatAVLatent, LTXVSeparateAVLatent | yes |

Run via `comfy workflow validate`: 0 errors, `partner_nodes: []`, `spends_credits: false` (no `LtxApi25*`).

## Workflow: `src/workflows/ltx25_union_depth.api.json`

API format, 25 nodes, single stage (no spatial upscale), distilled 8-step sigmas
(`1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0`), euler_ancestral, CFG 1/1.

Weights (all verified in Cloud enums): `ltx-2.5-22b-distilled-transformer-bf16`, `gemma4-12b-with-proj-ltx-2.5-bf16`
(CLIPLoader type `ltxv`), `ltx-2.5-video-vae-bf16`, `ltx-2.5-audio-vae-bf16` (via VAELoader),
LoRA `ltx-2.3-22b-ic-lora-union-control-ref0.5` (loads unchanged on 2.5).

Graph spine: UNETLoader -> LTXICLoRALoaderModelOnly -> LTXVDualCFGGuider; LoadVideo (depth) -> GetVideoComponents ->
LTXAddVideoICLoRAGuide (frame_idx 0, strength 1.0, `latent_downscale_factor` wired from the loader's 2nd output) ->
LTXVConcatAVLatent (with LTXVEmptyLatentAudio) -> SamplerCustomAdvanced -> LTXVSeparateAVLatent -> LTXVCropGuides ->
VAEDecodeTiled -> CreateVideo (+ audio) -> SaveVideo.

Inputs the server must set per take: `9.file` (LoadVideo, the uploaded depth video), `6.text` (prompt), `16.noise_seed`,
`11.length` and `13.frames_number` (both 121, must be 1+8k), width/height (`11`, multiples of 32).

## Gotchas

- Depth guide input: a depth **mp4 uploaded with `comfy upload --where cloud`** appears in `LoadVideo` choices under its hashed
  `cloud_name` (`<sha256>.mp4`). Use that name verbatim. (The comfy skill note that pushed videos are not catalogued for LoadVideo did not apply to `comfy upload`.)
  The server lane should upload the rendered depth mp4 per shot and substitute `9.file`.
- `SaveVideo` dynamic combo needs flat keys in API JSON: `"format": "auto", "format.codec": "auto"`. Without `format.codec`, validate fails.
- No IC-LoRA gallery template exists; the graph was derived from `video_ltx2_5_i2v` plus the IC-LoRA node schemas.
- Template text encoder/UNET names default to int8-convrot variants; this graph uses bf16 names that are present in the Cloud enums.
- Output list from `jobs wait` includes the input video as a second URL; pick the `type=output` entry (node 25).
- Quality: the take follows the corridor and doorway layout of the guide (geometry is respected). The synthetic guide (dolly 2 units
  into a tunnel) produced only subtle forward motion, so this run proves the plumbing, not camera-move fidelity. The verifier golden
  test and a real rig-renderer depth clip are the right next check.
- `@comfyorg/sdk` is not installed in the workspace and was not used for this spike; submission went through the `comfy` CLI
  (`comfy run --where cloud` then `jobs wait`, `download`). The server lane should wrap the same `/api/prompt` submit with
  `extra_data` / client idempotency and persist `{idempotencyKey -> prompt_id}` before awaiting, as done here.

## Local fallback

Not needed. Local has no IC-LoRA nodes or LTX weights (SKILLS.md section 0), so Cloud is the only runnable path on this machine.

## Follow-up: dolly zoom vs dolly control (same seed 42, strength 1.0)

Guides are throwaway numpy+ffmpeg renders (person silhouette at world z=0, mountains, tower, hut, rock, ground; fixed log depth
normalization, near=1, far=100). Subject distance 5 -> 3 (-40%). Dolly zoom: f = f0*d/d0 (subject height constant). Control: f fixed.

| Take | prompt_id | Wall (2 parallel) |
|---|---|---|
| dollyzoom | `7565f1a4-b961-43f4-869a-6b1972caf48c` | 54 s for both |
| dolly_control | `cb2adc39-dcb5-4c8c-93b9-78307ba3fcc6` | |

Credits: 7376 -> 7357 for both takes (about 19, roughly 9 to 10 each). Files: `src/workflows/out/{dollyzoom,dolly_control}_{guide,take}.mp4`, `*_sheet.png`.

Read: LTX follows both guides. Dolly zoom: person constant size; tower, mountains and hut shrink and pull inward, tower base moves toward centre. Control: person
grows about 1.7x, background grows slowly. Rough finding: the model reproduces framing and scale of the guide, so a verifier measuring subject-vs-background scale ratio can separate the two.
Caveat: the two takes have different people (seed same, guide differs), and take content (eg the mountain became a pyramid) is prompt-dependent.
