# Comfy-OSH: the camera move that checks itself

Draw a camera move in 3D, let LTX generate N takes, measure which takes actually followed the move, rank them, and regenerate only the segment that drifted. Open weights only (LTX-2.x + Depth Anything 3 Small/Base), running on Comfy. MIT licence.

Full plan: [SPEC.md](SPEC.md). Tooling: [SKILLS.md](SKILLS.md).

## Layout

```
SPEC.md  SKILLS.md  CLAUDE.md  LICENSE  .claude/  docs/
src/
├─ apps/studio/          Vite + React + R3F studio (M2)
├─ apps/server/          Fastify + @comfyorg/sdk: graphs, fan-out, job store
├─ packages/contracts/   JSON Schema + zod + pydantic + fixtures
├─ packages/rig-core/    camera math, presets, sampler, depth renderer
├─ verifier/             Python: Umeyama Sim(3), metrics, segment scoring
├─ comfy_nodes/          fallback V3 node SaveCameraPosesJSON
├─ workflows/            API-format Comfy graphs
└─ tests/golden/         clip metadata + expected scores (mp4s are regenerated, see docs/setup.md)
```

## Run locally

Needs Node 22, pnpm 11, uv and Python 3.11. Rendering the golden clips also needs **ffmpeg on your `PATH`** (macOS: `brew install ffmpeg`; Debian/Ubuntu: `sudo apt install ffmpeg`). Tests do not need it. Details: [docs/setup.md](docs/setup.md).

```bash
cd src
cp .env.example .env      # fill COMFY_API_KEY / COMFY_BASE_URL
pnpm install && uv sync
pnpm -r test && uv run pytest verifier
```

Studio (author a move, generate takes, see the ranked table and recovered path), two terminals from `src/`:

```bash
pnpm serve                              # API on 127.0.0.1:5198; renders the depth guide with ffmpeg
pnpm --filter @comfy-osh/studio dev     # http://localhost:5199
```

"Run dry" uses synthetic poses and costs nothing. "Run live" needs `COMFY_API_KEY`, the 3:2 (768x512) aspect, and a credit confirmation; it is capped at 5 takes. CLI: `pnpm loop --shot <shot.json> --n 4 [--live]`.

**Repair.** A take with a drifted segment gets a "Repair segment N" button on its tile. It regenerates from 8 frames before that segment to the end of the clip, pinned to the original frames before it, then re-solves and re-scores the whole patched clip (so a bad seam shows up). CLI: `pnpm repair --run <run dir> --shot <shot.json> --take <take id>`. Repair always spends a live job (about 13 credits estimated, 8 measured on a warm worker). Guidance strength is capped at 1.0, so a repair at the default strength differs from the failed take by seed and pinned context, not by stronger guidance.

## Run on your own ComfyUI (local mode)

Same code as Cloud; only `src/.env` changes. This is the "Open Weights Only" path: no API key, no partner nodes.

1. Start ComfyUI with the LTXVideo node pack (`LTXICLoRALoaderModelOnly`, `LTXAddVideoICLoRAGuide`) and the `ComfyUI-DepthAnythingV3` pack. ComfyUI Desktop does not use 8188: use the port in Settings > Server (usually 8000).
2. Set `COMFY_BASE_URL=http://127.0.0.1:8000` in `src/.env` and leave `COMFY_API_KEY` empty.
3. Put these files in the matching `models/` folders:

| File | Folder |
|---|---|
| `ltx-2.5-22b-distilled-transformer-bf16.safetensors` | `diffusion_models` (or `unet`) |
| `ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors` | `loras` |
| `gemma4-12b-with-proj-ltx-2.5-bf16.safetensors` | `text_encoders` |
| `ltx-2.5-video-vae-bf16.safetensors`, `ltx-2.5-audio-vae-bf16.safetensors` | `vae` |
| `da3_base.safetensors` (Small also allowed; never Large or Giant) | `geometry_estimation` |

4. From `src/`, run `pnpm preflight`. It reads `/object_info` and lists every missing node pack and model file for the three loop graphs, and flags any partner node. Exit code 0 means ready; it spends nothing.
5. Run `pnpm loop --shot <shot.json> --n 4 --live`, or use the studio. "Live" then means your server.

Status: preflight is tested against fixtures only. The full loop has been run on Comfy Cloud, not yet on a self-hosted ComfyUI (SPEC section 9, `docs/spikes/local.md` is still to be written).

## TODO

Status as of Oct 16, 2026. `[x]` = done and tested.

### M0 · Contracts and scaffolding (main session)
- [x] Scaffold the `src/` pnpm workspace (TS strict, vitest) and the Python 3.11 + pytest project.
- [x] Add the git repo, MIT licence, `.gitignore` and `src/.env.example`.
- [x] Write JSON Schemas for `Shot`, `ControlPacket`, `Candidate` and `ScoreReport`.
- [x] Mirror the schemas in zod and pydantic, including the cross-field rules JSON Schema can't express.
- [x] Generate the five golden shot fixtures (push_in, orbit, pan, zoom_only, dolly_zoom) from a stdlib script.
- [x] Validate every fixture, valid and invalid, in both TypeScript and Python from one shared set.
- [x] Define the five lane agents with worktree isolation, owned dirs and done-when criteria.
- [x] Add the Stop hook that blocks "done" while tests are red.

### M0 · Spikes (parallel lanes)
- [ ] spike-cloud: confirm whether the LTX IC-LoRA and DA3 nodes exist on Comfy Cloud.
- [ ] spike-cloud: build `workflows/ltx25_union_depth.api.json` with a depth guide input and 121 frames.
- [ ] spike-cloud: submit one real take through `@comfyorg/sdk` and record wall time and credits.
- [ ] spike-poses: build `workflows/da3_poses.api.json` with DA3 Small/Base in multiview mode.
- [ ] spike-poses: get extrinsics and intrinsics out of the job, writing `SaveCameraPosesJSON` if no core node does it.
- [ ] spike-poses: document DA3's pose convention and the conversion to three.js camera-to-world.
- [ ] verifier: hand-write Umeyama Sim(3) alignment of recovered to authored camera centres.
- [ ] verifier: compute `rotErrDeg`, `transErrPct` and `fovErrDeg` relative to frame 0.
- [ ] verifier: score per segment, with rotation-only mode for pans and `solveOk=false` ranked last.
- [ ] verifier: ship `python -m verifier score --shot --poses` that prints a valid `ScoreReport`.
- [ ] verifier: golden tests prove exact paths score ~0 and reversed, half-amplitude, zoom-for-dolly and wrong-orbit paths score worse.
- [ ] rig-renderer: implement camera math, the five move presets and focal length ↔ FOV conversion.
- [ ] rig-renderer: sample keyframes to one deterministic pose per frame (1+8k frames, 25 fps).
- [ ] rig-renderer: render depth offscreen with fixed near/far normalization for the whole clip.
- [ ] rig-renderer: render the five golden clips (RGB + depth) into `tests/golden/clips/`.
- [ ] Gate: run DA3 on the golden clips, score them, and confirm the correct path wins and zoom_only ≠ dolly_zoom.

### M1 · Loop end-to-end (CLI)
- [ ] server: build Comfy graphs from a `Shot` + `ControlPacket`.
- [ ] server: fan out N takes with distinct seeds, saving `{idempotencyKey → jobId}` before awaiting.
- [ ] server: persist jobs so a crash or retry never double-submits.
- [ ] server: chain takes → DA3 job → poses → verifier → `ScoreReport`.
- [ ] rig-renderer: encode the depth pass as an mp4 ready for upload.
- [x] main: wire `pnpm loop --shot <fixture> --n 4` to print a ranked table of real takes.
- [ ] verifier: calibrate the pass thresholds on 10 real takes, then freeze them.

### M2 · Studio
- [x] studio: import glTF/GLB models and pick one of two bundled sets (Courtyard, Street). The sets are generated by `pnpm --filter @comfy-osh/rig-core build:scenes`, so they contain no third-party assets. The depth guide is rendered from the same GLB (triangle meshes, flat colour; no textures, Draco or sparse accessors).
- [x] studio: key camera position, look-at and focal length on a timeline.
- [x] studio: apply the five move presets as editable keyframes.
- [x] studio: contact sheet of ranked takes: video (live runs), PASS/FAIL/NO SOLVE badge, per-segment strip, errors; click a tile to overlay its recovered path.
- [x] studio: overlay the authored path against each recovered path in 3D (recovered path scaled and anchored to the authored frame-0 camera).
- [x] studio: add a guidance-strength (`attention_strength`) slider.
- [x] server: expose REST endpoints and job events for the studio.
- [ ] testing: cover author → generate → ranked takes with a Playwright E2E test.

### M3 · Repair and the hard shot
- [x] server: regenerate one failing segment from pinned context (`ltx25_extend_segment`), at strength up to 1.0. One live Cloud sample: dolly-zoom take 3002, segment 3 went from 3.1° (failed) to 2.5° (holds).
- [x] verifier: re-score the whole clip after a patch (DA3 + verifier run on the stitched clip).
- [ ] main: run the dolly-zoom test and pick the matching demo script line.
- [x] main: local-mode README section and `pnpm preflight` (lists missing nodes and models).

### M4 · Ship
- [ ] Freeze code Wed Oct 28 noon and run the code-review + pr-review-toolkit pass.
- [ ] Get three people to try it at SF Build Night and fix the top issue.
- [ ] Record the ≤2 min demo video from the SPEC.md §1 script.
- [ ] Finish the README with the licences table and prior-art credits.
- [ ] Submit the form and post with #OpenSourceHiggsfield on Thu Oct 29.
