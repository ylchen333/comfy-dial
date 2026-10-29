# Comfy-OSH: the camera move that checks itself

Draw a camera move in 3D. An open-weights video model (LTX-2.5) generates several takes of it. A second model (Depth Anything 3) recovers the camera each take actually used, a verifier scores how closely it followed your move, and only the segment that drifted is regenerated.

**Open weights only:** LTX-2.x and Depth Anything 3 Small/Base, run through ComfyUI. MIT licence. Plan: [SPEC.md](SPEC.md). Tooling notes: [SKILLS.md](SKILLS.md). Old checklist: [docs/roadmap.md](docs/roadmap.md).

> **Status: MVP, tentative docs.** The loop has run end to end on Comfy Cloud, not yet on a self-hosted ComfyUI. Numbers below are from single samples unless stated. See [Known limits](#known-limits).

## How it works

```
 Author (3D)      Generate                 Review
 draw a move ───► LTX-2.5 makes N takes ─► DA3 recovers each take's camera
 + subject + set  guided by a depth video   verifier scores per segment (thirds)
                                            rank takes ─► repair the drifted segment
```

The model never sees your camera numbers. It sees a **depth video** rendered from your 3D scene along your path, so what stands in the scene (the set and the subject) decides what it can paint, and the path decides how the camera moves.

## Quick start

Needs Node 22, pnpm 11, uv, Python 3.11 and **ffmpeg on your `PATH`** (`brew install ffmpeg`). Details: [docs/setup.md](docs/setup.md).

```bash
cd src
cp .env.example .env          # add COMFY_API_KEY (Cloud) or COMFY_BASE_URL (your own ComfyUI)
pnpm install && uv sync
pnpm -r test && uv run pytest verifier   # all green before you start
```

Two terminals, both from `src/`:

```bash
pnpm serve                              # API on 127.0.0.1:5198
pnpm --filter @comfy-osh/studio dev     # studio at http://localhost:5173 (Vite prints the port)
```

The studio works with no key: **Run dry** uses synthetic poses and costs nothing, so you can learn the interface first.

## A 5-minute walkthrough

1. **Author** (Alt+1). Pick a set under *Scene* (Courtyard or Street) and a *Subject* (a mannequin by default). Click a move preset (push in, orbit, dolly zoom...) or add keys on the timeline. Press `D` to see the depth guide the model will get.
2. **Generate** (Alt+2). Write who is in the shot and what they do, for example *"a woman in a red coat walks through light rain, cinematic"*. Leave the camera out of the prompt; the depth guide sets the move. Choose 2 to 4 takes.
3. Press **Run dry** to rehearse, or **Run live**, tick the credit confirmation and run. A live run is capped at 5 takes.
4. **Review** (Alt+3). Compare takes: the video, your path against the recovered path, and the per-frame rotation error. Takes are ranked, and each shows PASS, FAIL or NO SOLVE per segment.
5. On a take whose segment drifted, click **Repair segment N**. It regenerates from 8 frames before that segment to the end, pinned to the frames before it, then re-scores the whole stitched clip.

The **Next** button and the numbered tabs move between pages. `/?run=<id>` opens a saved run in Review.

## Pages and controls

**Author** works like a 3D viewport.
- Orbit with middle mouse (or hold Alt and drag with the left button), pan with Shift+middle, zoom with scroll.
- Views: `1` front, `3` right, `7` top (Shift for back, left, bottom), `5` orthographic, `0` shot camera, `Home` frame all, `.` frame the selected key.
- `D` or `Z` toggles Solid and Depth shading. `N` opens the Item panel (the shot camera's numbers; typing one keys it at this frame). `G` grabs the selected position key (`X`/`Y`/`Z` constrain, click or Enter confirms, Esc cancels).
- Timeline: Left/Right step one frame, Shift+Left/Right jump to the ends, Up/Down jump between keys, Space plays. Shortcuts are ignored while you type in a text box.

**Generate** holds the prompt, the optional *Avoid* text, take count, guidance strength and earlier runs.

**Review** has the contact sheet of ranked takes, the video, the authored-versus-recovered path in 3D, and exports.

## Optional features

| Feature | Where | Cost (Cloud) | Notes |
|---|---|---|---|
| **Match a camera from a video** | Author, left panel | about 9 credits | Recovers a clip's camera and applies it as editable keys (Undo restores yours). One video cannot give the scale, so you enter the travel in metres. Use footage you made or may use. |
| **Generate an actor** | Author, Scene | about 12 credits (measured 4, 74 s) | Description or photo, then FLUX.1 schnell image, then Hunyuan3D 2.1 shape, then normalised to a 1.7 m, Y-up, +Z-facing figure of at most 80k triangles. Use the **Turn** field if the figure faces sideways. Stays on this machine. |
| **Import a model** | Author, Scene | none | glTF/GLB triangle meshes, flat colour, at most 200k triangles. No textures, Draco or sparse accessors. |
| **Repair a segment** | Review | about 13 (8 measured) | See above. |

Every paid action asks for a confirmation of the credit estimate first. Local servers are free.

### Generated actors and licences

Hunyuan3D 2.1 is under Tencent's licence, which excludes the EU, UK and South Korea. Generated meshes are therefore written to the runs folder only (`src/apps/server/.runs`, gitignored), never bundled in `src/assets`. Treat this as a dev and demo feature. Tripo and the `Tencent*` partner nodes are not used.

## CLI

All from `src/`.

| Command | What it does |
|---|---|
| `pnpm loop --shot <shot.json> --n 4 [--live] [--prompt "..." --negative "..."]` | Run the loop and print a ranked table |
| `pnpm repair --run <run dir> --shot <shot.json> --take <id> [--segment N]` | Repair a take (always a live job) |
| `pnpm preflight` | List missing node packs and models on your ComfyUI; spends nothing |
| `pnpm replay --graph <saved graph> --set node.input=value --out <dir> --yes` | Re-run one saved take with one setting changed, for same-seed comparisons |
| `uv run python -m verifier flicker take.mp4 --seams 56,112` | Brightness jitter, worst frame and seam spikes |
| `pnpm --filter @comfy-osh/contracts gen:fixtures` | Regenerate the golden shot fixtures |

## Costs

Measured on Comfy Cloud, warm worker (about 0.25 credits per GPU-second):

| Action | Credits |
|---|---|
| One take (LTX-2.5, 121 frames, 768x512) | about 4 |
| One camera solve (DA3) | about 1 |
| A 4-take run | about 28 estimated (20 measured, plus a cold-start margin) |
| One actor | about 4 measured, 12 asked |

Cold starts add up to about 8. The studio shows each estimate before you confirm.

## Results so far

Single samples, not rates:
- Repair: dolly-zoom take, segment 3 went from 3.08° to 2.55° rotation error (gate 2.75°). A repair of an unguided take whose earlier segments had also drifted failed, so the tool now refuses that case.
- A full retake of segment 0 on one take brought the whole-clip error from 5.89° to 1.76°.
- Flicker: tiling the decoder cut the worst brightness jump from 0.89 to 0.38 on a paired replay. The euler sampler halved texture shimmer in one sample; it is not the default until it is confirmed on more seeds.
- Gates (frozen): rotation under 2.75°, translation under 12% (only when the recovered focal length is within 10% of 1). FOV is reported, not gated.

## Run on your own ComfyUI (local mode)

Same code; only `src/.env` changes. No API key, no partner nodes.

1. Start ComfyUI with the LTXVideo node pack and the `ComfyUI-DepthAnythingV3` pack. ComfyUI Desktop usually listens on 8000, not 8188.
2. Set `COMFY_BASE_URL=http://127.0.0.1:8000` in `src/.env`; leave `COMFY_API_KEY` empty.
3. Put the models in place:

| File | Folder |
|---|---|
| `ltx-2.5-22b-distilled-transformer-bf16.safetensors` | `diffusion_models` |
| `ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors` | `loras` |
| `gemma4-12b-with-proj-ltx-2.5-bf16.safetensors` | `text_encoders` |
| `ltx-2.5-video-vae-bf16.safetensors`, `ltx-2.5-audio-vae-bf16.safetensors` | `vae` |
| `da3_base.safetensors` (Small also allowed; never Large or Giant) | `geometry_estimation` |
| `hunyuan_3d_v2.1.safetensors`, `flux1-schnell-fp8.safetensors` (only for actor generation) | `checkpoints` |

4. Run `pnpm preflight`; exit code 0 means ready.
5. Run `pnpm loop ... --live` or use the studio; "live" then means your server.

Preflight is tested against fixtures only, and the actor graphs are not yet in it.

## Licences

| Component | Licence | Use here |
|---|---|---|
| This repo | MIT | |
| LTX-2.x video model, Union-Control IC-LoRA | LTX Community licence | Generation |
| Depth Anything 3 Small and Base | Apache-2.0 | Camera recovery |
| COLMAP / GLOMAP, TAPIR | BSD / Apache-2.0 | Allowed, optional |
| FLUX.1 schnell | Apache-2.0 | Optional actor reference image |
| Hunyuan3D 2.1 | Tencent community licence (excludes EU, UK, South Korea) | Optional actor generation; outputs never bundled |
| Not used | DA3 Large/Giant, CoTracker3, SpatialTracker v2 (non-commercial), `evo` (GPL), CozyClay (AGPL), any partner node or API | |

Reference footage for any demo must be your own or CC0. Bundled sets and mannequins are generated from code (`pnpm --filter @comfy-osh/rig-core build:scenes`, `src/tools/blender/make_actor.py`), so they carry no third-party assets.

## Known limits

- The depth guide carries shape, not identity: your prompt says who the person is. The mannequin and the generated actors are static poses; animated actors are not supported yet.
- One reference video gives no true scale and an unreliable zoom.
- DA3 assumes a static scene, so a moving subject adds noise to the recovered camera.
- Some flicker remains (an 8-frame pulse and texture shimmer).
- Repair needs the earlier segments to hold; it refuses otherwise.
- No end-to-end browser test yet, and no self-hosted run yet.

## Layout

```
SPEC.md  SKILLS.md  CLAUDE.md  LICENSE  docs/
src/
├─ apps/studio/          Vite + React + R3F: Author, Generate, Review
├─ apps/server/          local API, Comfy graphs, job store, repair, actors
├─ packages/contracts/   JSON Schema + zod + pydantic + fixtures
├─ packages/rig-core/    camera math, presets, sampler, depth renderer
├─ verifier/             Python: Sim(3) alignment, metrics, scoring, flicker
├─ comfy_nodes/          fallback node SaveCameraPosesJSON
├─ workflows/            API-format Comfy graphs (take, repair, poses, actors)
├─ assets/               bundled sets and mannequins (no generated actors)
├─ tools/blender/        builds the mannequins
└─ tests/golden/         golden clip metadata and expected scores
```
