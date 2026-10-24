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
- [ ] studio: import glTF/GLB scenes and ship two bundled CC0 scenes.
- [x] studio: key camera position, look-at and focal length on a timeline.
- [x] studio: apply the five move presets as editable keyframes.
- [ ] studio: show a contact sheet of takes with scores and pass/fail badges.
- [x] studio: overlay the authored path against each recovered path in 3D (recovered path scaled and anchored to the authored frame-0 camera).
- [x] studio: add a guidance-strength (`attention_strength`) slider.
- [x] server: expose REST endpoints and job events for the studio.
- [ ] testing: cover author → generate → ranked takes with a Playwright E2E test.

### M3 · Repair and the hard shot
- [ ] server: regenerate one failing segment via LTX extend / first-last-frame at higher strength.
- [ ] verifier: re-score the whole clip after a patch to catch bad seams.
- [ ] main: run the dolly-zoom test and pick the matching demo script line.
- [ ] main: write the local-mode README section and a preflight that lists missing models.

### M4 · Ship
- [ ] Freeze code Wed Oct 28 noon and run the code-review + pr-review-toolkit pass.
- [ ] Get three people to try it at SF Build Night and fix the top issue.
- [ ] Record the ≤2 min demo video from the SPEC.md §1 script.
- [ ] Finish the README with the licences table and prior-art credits.
- [ ] Submit the form and post with #OpenSourceHiggsfield on Thu Oct 29.
