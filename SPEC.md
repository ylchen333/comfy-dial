# SPEC.md — Comfy-OSH: the camera move that checks itself

**One line:** Draw a camera move in 3D → LTX generates N takes → the app **measures** which takes actually followed the move → ranks them → regenerates only the segment that drifted.

**Deadline:** Fri Oct 30, 9:00 AM PT. **Submit Thu Oct 29 evening.** Source: [comfy.org/open-source-higgsfield](https://comfy.org/open-source-higgsfield/)

---

## 0. TL;DR (read only this if busy)

- **Problem:** closed tools sell camera *labels*. The model often ignores them. Users reroll 3–5× per keeper and pay every time. Higgsfield's CEO compared parts of the process to "a slot machine."
- **Our answer:** a camera *guarantee with a number*: "5 of 8 takes held the dolly within 3°. Segment 3 drifted, so we regenerated it."
- **Gap is verified** (report: `Closed loop camera control gap.md`, Oct 16):

| Loop step | Who already does it | What's missing |
|---|---|---|
| Author camera in 3D | OmniCam, CozyClay (AGPL) | Nothing, crowded |
| Render control signals | OmniCam → LTX tracks; LTX Sparse Track Editor | Nothing, crowded |
| Generate N takes | ComfyUI-CachedSearch | Scores **aesthetics**, not camera |
| Measure adherence | shotdrift (2D labels only) | No 3D solve; we measure **camera path and move direction** (dolly vs zoom is advisory, see §6 status) |
| Rank | CachedSearch (by aesthetics) | Not by camera error |
| Repair only the failing segment | Higgsfield Katana (Oct 2026) regenerates "only the affected shots", but only when **you** spot the problem and ask in chat | Nothing picks the segment from a **measured** camera error. **Our wedge** |

- **Defensible claim:** "First tool that diffs the generated clip's recovered 3D camera against the path you drew, then ranks takes and regenerates only the segments that drift."
- **Prize targets:** Most Innovative · Open Weights Only · LTX VFX bonus ($2,000). Best Overall is automatic.

---

## 1. Pitch script (demo video voiceover, ≤90 s, video cap is 2 min)

| Time | Screen | Voiceover |
|---|---|---|
| 0:00 | Generic preset dropdown, then a reroll montage | "AI video gives you camera presets. Then it ignores them. Creators reroll three to five times per usable shot." |
| 0:10 | Studio: drag camera along a dolly rail, set 35mm | "Comfy-OSH flips it. You don't pick a preset. You draw the move." |
| 0:20 | Depth guide renders, contact sheet fills with 8 takes | "We render that move into a depth guide, and LTX generates eight takes." |
| 0:30 | 3D overlay: drawn path (white) vs recovered paths (colored), live numbers | "Then the app does what no released tool does: it recovers the camera from every take and measures it against the path you drew." |
| 0:45 | Ranked list, take 6 flagged red after frame 60 | "Take 3 held the dolly within two degrees. Take 6 drifted after frame sixty." |
| 0:55 | Only segment 3 of take 6 regenerates; its score turns green | "So we don't reroll the whole shot. We regenerate only the segment that drifted, with stronger guidance." |
| 1:05 | Dolly zoom test | **Decided Oct 26 (evidence: 5 real takes, `docs/calibration.md`):** the "if it fails" line, reworded to what the numbers support. "Hardest test: the dolly zoom. Rotation held on all five takes, but translation and field of view are unreliable on a zooming shot, so the verifier can't promise to tell a dolly zoom from a plain zoom. It says so, and its move label matched on two of five. No guessing." Do **not** use "we flag when the model zoomed instead of dollying". |
| 1:15 | Stack card, repo link, #OpenSourceHiggsfield | "Open weights only: LTX and Depth Anything 3, on Comfy through the SDK. MIT licensed. Camera control you can check." |

Rules for the video: no Higgsfield UI, logos or footage. Use our own mock preset menu. CC0 scenes only.

---

## 2. Scope

**IN (MVP)**
- glTF/GLB import + primitives + 2 bundled CC0 scenes
- Camera rig: position/look-at keyframes, focal length (mm), 5 move presets (push-in, pull-out, orbit, pan, dolly zoom) that compile to keyframes
- Control pass: depth video rendered from the authored camera (exact, from the 3D scene)
- Generate N takes (default 4, max 8) via `@comfyorg/sdk`
- Verifier: recover camera per take, score against the authored track, per segment
- Ranked contact sheet with scores + 3D path overlay
- Repair: regenerate one failing segment with higher guidance strength
- Local mode (`comfy-api-proxy`) + Comfy Cloud mode, same code

**OUT (Parking Lot, do not start)**
- Splat import, photo-to-splat, lens/DoF layer, Blender/Nuke export, phone controller
- Object motion tracks (Motion-Track IC-LoRA) are **stretch**, only if M3 is green early

---

## 3. The loop (6 boxes)

```
 AUTHOR ──► RENDER ──► GENERATE ×N ──► MEASURE ──► RANK ──► REPAIR
 (studio)   (studio)   (Comfy job)     (Comfy job   (server)  (Comfy job)
                                        + verifier)
```

| Box | Does | Tool | Output |
|---|---|---|---|
| AUTHOR | User keys the camera in 3D | R3F studio | `Shot` JSON |
| RENDER | Depth video from the authored camera | Three.js offscreen, `rig-core` | `depth.mp4` (121 frames) |
| GENERATE | N takes, distinct seeds | LTX-2.5 distilled + `ltx-2.3-22b-ic-lora-union-control-ref0.5` (depth) | N × `take.mp4` |
| MEASURE | Recover per-frame camera per take | Registry pack `ComfyUI-DepthAnythingV3`: `DownloadAndLoadDepthAnythingV3Model` + `DepthAnythingV3_MultiView` (Small/Base) → core `SaveText` (see §4.3) | poses + intrinsics |
| RANK | Sim(3)-align, compute errors, sort | `verifier/` (Python) | `ScoreReport` |
| REPAIR | Regenerate segment k only | LTX extend / first-last-frame, `attention_strength` ↑ | patched take |

Facts the build relies on:
- LTX frame count = 1 + multiple of 8 (121 frames ≈ 4.8 s at 25 fps).
- Lightricks' own LTX-2.5 workflows load the 2.3 Union-Control IC-LoRA unchanged.
- IC-LoRA strength: `attention_strength` 0–1 (default 1.0), optional spatial mask.
- SDK has **no batch call**: N takes = N `submit()` calls. Idempotency keys **reject** duplicates (422), so save `{key → jobId}` before awaiting.
- Cloud concurrency: Standard 1 / Creator 3 / Pro 5 / Team 25 jobs.

---

## 4. Architecture decisions (max 3 options each)

### 4.1 Control signal for camera

| Option | Pros | Cons | Cognitive Overhead |
|---|---|---|---|
| **A. Depth via Union-Control IC-LoRA** ✅ | Exact from 3D scene; official LTX-2.5 pairing; encodes dolly vs zoom geometrically | Relative depth normalization may weaken dolly zoom | Low |
| B. Motion tracks via Motion-Track IC-LoRA | Great for object motion | Editor is an interactive widget; headless input unproven | Medium |
| C. Cameraman IC-LoRA (driving video) | Simple | Built on 2.3, unvalidated on 2.5; no geometry to verify | Low |

**Pick A.** Use **fixed** depth normalization across all frames (not per-frame). B is stretch.

### 4.2 Pose recovery (the verifier's eyes)

| Option | Pros | Cons | Cognitive Overhead |
|---|---|---|---|
| **A. Depth Anything 3 Small/Base (multiview)** ✅ | Apache-2.0 weights; returns extrinsics + intrinsics (needed for dolly zoom) | Output units/format undocumented; untested on AI video; core DA3 nodes return geometry only, so poses come from a pack node (§4.3) | Low |
| B. COLMAP 4 / GLOMAP | BSD; trusted | Unstable on short clips; slow | Medium |
| C. VGGT-1B-Commercial | Strong | Gated licence; terms unread | High |

**Pick A.** B is a cross-check in golden tests only. **Never** DA3 Large/Giant (CC BY-NC). The `ComfyUI-DepthAnythingV3` wrapper is MIT per its author (PozzettiAndrea, relayed by the project owner, not independently checked); model weights follow each model's own licence, so only Small/Base.

### 4.3 How poses leave Comfy

| Option | Pros | Cons | Cognitive Overhead |
|---|---|---|---|
| **A. Registry pack node `DepthAnythingV3_MultiView` + core `SaveText`** ✅ | Works on Cloud and local; no code of ours; poses leave as JSON text files | Depends on a third-party pack; its loader defaults to `da3_large` (banned), so always set `da3_small`/`da3_base` | Low |
| B. Our tiny V3 node `SaveCameraPosesJSON` | Certain; clean `Poses` JSON | Local only: rejected by Cloud as `unknown_class_type` (tested Oct 18) | Medium |
| C. Python sidecar runs DA3 directly | Full control | Not "on Comfy"; extra service | Medium |

**Cloud and custom nodes (tested Oct 18 with `comfy workflow validate --where cloud`, free):**
- Cloud's node catalogue (`object_info`) includes many community packs. `da3_poses.api.json`, which uses the `ComfyUI-DepthAnythingV3` pack, validates (`valid: true`) and runs.
- `da3_poses_local.api.json`, which uses our own unpublished `ComfyOSH_SaveCameraPosesJSON`, is rejected with `unknown_class_type`. It is the only error, so the core nodes in that graph are fine.
- Not tested: whether publishing a node to the Comfy Registry puts it on Cloud, and whether the cloud.comfy.org web app lets a user add a node by hand. Until tested, assume Cloud runs only nodes already in its catalogue.
- No core node exports DA3 extrinsics/intrinsics (checked Oct 16: `DA3Inference` returns geometry only).

**Spiked Oct 16 (Cloud, `da3_small`, 11.7 s):** A works. B is the fallback and runs locally (on Cloud only if its catalogue adds it). C only for offline golden tests.

### 4.4 Runtime

| Option | Pros | Cons | Cognitive Overhead |
|---|---|---|---|
| Cloud only | "Try it" link | IC-LoRA nodes on Cloud unverified | Low |
| Local only | Certain | Judges need a GPU | Low |
| **Both via `COMFY_BASE_URL`** ✅ | Same code | Two paths to test | Medium |

---

## 5. Contracts (build FIRST, everyone codes against them)

Source of truth: JSON Schema in `src/packages/contracts/schema/`. TS (zod) and Python (pydantic) mirror it. One test validates shared fixtures in both.

| Contract | Key fields |
|---|---|
| `Shot` | `version`, `scene` (nodes: id, asset, transform), `fps` (25), `frames` (1+8k), `resolution`, `track[]` (t, position, quaternion, fov_v_deg) in **right-handed, Y-up, three.js** convention, `segments` (frame ranges) |
| `ControlPacket` | `shotId`, `depthVideo`, `depthNormalization` (near/far, fixed), `iclora` (name, strength) |
| `Candidate` | `shotId`, `seed`, `idempotencyKey`, `jobId`, `status`, `video` |
| `ScoreReport` | `candidateId`, `solveOk`, `rotErrDeg`, `transErrPct`, `fovErrDeg`, `perSegment[]`, `composite`, `pass` |
| `Poses` | `schema` (`comfy-osh/poses/1`), `fps`, `image`, `solve_ok`, `frames[]` (index, `t`, position, quaternion, fov_v_deg, optional fx/fy/cx/cy). Camera-to-world, same convention as `Shot`. Frames may be a subset: the verifier interpolates onto the Shot's frame times using `t`. |

---

## 6. Metrics (the heart of the project)

1. Make both trajectories relative to frame 0, **expressed in the frame-0 camera's own axes** (so "forward" means forward of the first frame, not of the world).
2. Fit **scale only** (s ≥ 0, no free rotation) from recovered to authored camera centers. Write it yourself. **Do not import `evo` (GPL-3.0).** Why not full Umeyama Sim(3): its free rotation absorbs a reversed straight dolly (found Oct 18: a reversed dolly scored 1.5% translation error and passed). Umeyama stays in `geom.py` for orbit-type paths if a test needs it. Known blind spot: a straight dolly of the wrong amplitude is not caught, because scale is fitted; amplitude would need scale anchoring. Translation gate widens to about 15% (correct real dollies score 6 to 9% under this metric; to be frozen in calibration).
3. `rotErrDeg` = mean per-frame geodesic angle between rotations.
4. `transErrPct` = mean position error (after the scale fit) ÷ authored path length × 100.
5. `fovErrDeg` = mean |recovered vertical FOV − authored|. DA3's FOV is biased (about +10°) and under-tracks real zooms, so the absolute value is unreliable. The **FOV ratio (last ÷ first)** follows the move direction on most real takes and is reported as an advisory move-class label, not a hard gate (decided Oct 21).
6. Score **per segment** (default 3 segments). Segment-level beats clip-level (CamVerse).
7. Pan/tilt shots (path length ≈ 0): rotation-only mode.
8. Pose solve fails → `solveOk=false`, worst rank. Never drop silently.

**Pass gate (frozen Oct 22, evidence in `docs/calibration.md`):** rot < 2.75°; trans < 12%, applied only when the authored focal ratio is within 10% of 1 (translation is unreliable on FOV-changing shots, even on rendered footage); absolute FOV error is reported, not gated (it sits at 1.4–8.2° on a perfect camera). Advisory move-class label from the focal ratio, see calibration doc.

**Calibration decision (Oct 18): calibrate once, then freeze.**
1. Noise floor: score DA3 on the RGB golden clips (known-perfect camera). No threshold may sit below the error measured there.
2. Agreement: label about 10 real takes "followed" or "didn't" by eye, and pick the thresholds that best match the labels (M1 step 4).
3. FOV may be reported but not gated if DA3 Small's FOV proves unreliable (`--no-fov-gate`).

**Not in the MVP, revisit after it works end to end:** user-adjustable thresholds (Strict / Normal / Loose presets plus an advanced override, floored at the measured noise). `ScoreReport` already carries the raw errors, so adding this later needs no change to the measurement.

**Golden test (must pass before any LTX run counts):**
- Render synthetic clips from `rig-core`: push-in, orbit, pan, zoom-only, dolly zoom.
- Correct path → near-zero error.
- Perturbed path (reversed, half amplitude, **zoom instead of dolly**, wrong orbit direction) → strictly worse score.
- A straight dolly with fixed orientation, reversed, **must fail** (added Oct 18).
- Known limit (Oct 22): on a dolly-zoom shot, translation and absolute FOV are not gated (unreliable even on rendered footage), so a zoom-only take passes; only the advisory move-class label flags it. See `docs/calibration.md`.
- If the verifier can't separate dolly from zoom on synthetic footage, **stop and fix before M1.**

**Status (Oct 18):** on real LTX takes, DA3 poses separate dolly from zoom from dolly zoom in only 6 of 9 (FOV is biased and under-tracked). A parallax statistic (f_ratio from DA3 depth and subject size) separated 9 of 9 on one scene, but fails on rendered clips and is unvalidated on other scenes. A second-scene check is running before it enters the verifier.

---

## 7. Repo layout

All code that builds the app lives in `src/` (the pnpm workspace root). Project docs, git, licence and Claude config stay at the top level. Paths elsewhere in this spec (`apps/…`, `verifier/`, `workflows/`) are relative to `src/`.

```
comfy-osh/
├─ SPEC.md, SKILLS.md, INITIAL_PROMPT.txt, CLAUDE.md, LICENSE (MIT)
├─ .claude/              agents, settings, hooks
├─ docs/                 README, licences table, spikes, demo assets
└─ src/                  pnpm-workspace.yaml, package.json, pyproject.toml, .env (gitignored), .env.example
   ├─ apps/studio/          Vite + React + R3F: scene, rig, timeline, contact sheet
   ├─ apps/server/          Node 22 + Fastify + @comfyorg/sdk: graph builder, fan-out, job store
   ├─ packages/contracts/   JSON Schema + zod + fixtures
   ├─ packages/rig-core/    camera math, move presets, sampler, depth renderer (pure TS)
   ├─ verifier/             Python: pose parsing, umeyama, metrics, segment scoring, pytest
   ├─ comfy_nodes/          (fallback) V3 node SaveCameraPosesJSON; optional CS_VERIFIER adapter
   ├─ workflows/            API-format JSON: ltx25_union_depth, da3_poses, ltx25_extend_segment
   └─ tests/golden/         clip metadata + expected scores (mp4s are git-ignored; `pnpm --filter @comfy-osh/rig-core render:golden` regenerates them, needs ffmpeg)
```

Licence: **MIT**. Don't copy CozyClay (AGPL) or archviz workflows (CC BY-SA).

---

## 8. Milestones (Step X of 5)

### Step 1 of 5 · M0 Spikes + contracts · Fri Oct 16 – Sun Oct 18
1. Scaffold repo + contracts + fixtures.
2. Spike: do LTX IC-LoRA nodes run on **Comfy Cloud**? Submit the official LTX-2.5 Union-Control graph via SDK. Record time + cost per take.
3. Spike: get DA3 extrinsics/intrinsics **out** of a Comfy job (decision 4.3). Document units and conventions.
4. Verifier v0 + golden test on pure-math trajectories.
5. `rig-core` renders the 5 synthetic golden clips.

**Gate (Sun):** verifier separates dolly from zoom on synthetic clips · one LTX+depth take runs (Cloud or local).

### Step 2 of 5 · M1 Loop end-to-end (CLI) · Mon Oct 19 – Wed Oct 21
1. Server: `Shot` → depth pass → N takes (fan-out, job store, retry-safe keys).
2. Server: takes → DA3 job → poses → verifier → `ScoreReport`.
3. CLI (from `src/`): `pnpm loop --shot fixtures/push_in.json --n 4` prints a ranked table.
4. Calibrate pass thresholds on 10 real takes. Freeze.

**Gate (Wed):** one command takes a Shot to a ranked list of real LTX takes.

### Step 3 of 5 · M2 Studio UX · Thu Oct 22 – Sat Oct 24
1. Scene import (glTF) + 2 CC0 scenes.
2. Camera keyframes + 5 move presets + focal length.
3. Contact sheet: takes, scores, pass/fail badges.
4. 3D overlay: authored path vs recovered paths.
5. Guidance-strength slider (`attention_strength`).

**Gate (Sat):** a non-dev can author a push-in and get ranked takes in the browser.

### Step 4 of 5 · M3 Repair + hard shot · Sun Oct 25 – Tue Oct 27
1. Segment regeneration (extend / first-last-frame, strength ↑), re-score.
2. Seam check: re-score whole clip after patch.
3. Dolly zoom test. Decide which script line to use.
4. Local mode README + `.env.example` + preflight (lists missing models).
5. (Stretch) Motion-Track IC-LoRA for object motion.

**Gate (Tue):** a failed segment is regenerated and its score improves.

### Step 5 of 5 · M4 Freeze + ship · Wed Oct 28 – Thu Oct 29
1. Code freeze Wed noon. Bug fixes only.
2. SF Build Night Wed Oct 28: get 3 people to try it. Fix the top issue.
3. Record demo (script in §1), ≤2 min.
4. README: run locally, licences table, prior-art credits (OmniCam, shotdrift, CachedSearch, PartiCam).
5. Submit form + social post #OpenSourceHiggsfield. **Thu evening.**

---

## 9. Risks + fallbacks

| Risk | Fallback |
|---|---|
| IC-LoRA nodes missing on Cloud | Local via `comfy-api-proxy`; demo recorded locally; Cloud "try it" for scoring only |
| DA3 pose export depends on a third-party pack in Cloud's catalogue | Pin the pack version. Fallback: `SaveCameraPosesJSON` V3 node (local mode only) |
| DA3 fails on AI video | Rotation-only scoring; COLMAP cross-check; show `solveOk=false` honestly |
| Dolly zoom fails | Verifier catches it → still proves the point (script alt line) |
| Segment seams visible | Regenerate from segment start to end of clip instead |
| Cloud concurrency (1–5) | Default N=4; queue; show progress via `job.events()` |
| Credits burn | Low-res drafts for scoring, full-res only for the winner |
| Official criteria (Oct 24): Open Weights Only = "run everything locally, no $$ other than compute"; this Mac has no LTX weights | Run the same graphs once on a self-hosted ComfyUI (own GPU or rented GPU = compute) via `COMFY_BASE_URL`; record proof in docs/spikes/local.md |

---

## 10. Submission checklist (official page)

- [ ] Built on Comfy Developer Platform (SDK/API)
- [ ] Public GitHub repo, MIT licence, workflows included, local run instructions
- [ ] Demo video ≤2 min, explains **why it's innovative** (use the §0 table)
- [ ] Optional: link to try
- [ ] Social post tagged **#OpenSourceHiggsfield**
- [ ] SFW, no unlicensed IP or likenesses; one submission
- [ ] Open Weights Only: no partner nodes or APIs anywhere in the graph. Official criteria (Oct 24): "Run everything locally, no $$ needed other than compute." Cloud is fine for development, but show the loop running on a self-hosted ComfyUI with zero paid calls.
- [ ] Replay mode: bundled takes + poses (`tests/golden/loop_runs/`) so a judge without a GPU can run studio → scores → ranking in under 2 minutes.

## 11. Re-check the week of submission

- GeoFix (arXiv 2610.14293): unread; may narrow the "first" claim.
- OmniCam + shotdrift repos: did either add a "diff the generated camera" feature?
- PartiCam (arXiv 2609.39504): code released?
- ~~Does running open weights on Comfy Cloud qualify for Open Weights Only?~~ **Answered Oct 18 (Deep Mehta, relayed by the project owner): yes.** ⚠️ Official criteria posted Oct 24 say "run everything locally", so treat a self-hosted run as required. Still to ask: can one entry win a main prize + the LTX bonus?

---

**Parking Lot**
- Splats, lens/DoF layer, Blender/Nuke camera export, phone controller, photo-to-splat.
- `CS_VERIFIER` adapter so CachedSearch users can plug in our camera scorer.
- "Bring your own generator" (the "like lego" ask): any API-format workflow whose depth-video input and video output nodes are named in a small JSON map. The verifier already scores any clip.
- Shareable score card ("Did the AI obey? 1.0° off") for Most Viral.
- Expose the scorer as an MCP tool / Claude skill (Katana precedent).
- Actor motion from a reference video (MediaPipe Pose, Apache-2.0, driving the mannequin). Avoid SMPL-based tools (WHAM, GVHMR, 4DHumans): the SMPL body model licence is non-commercial.
- Coarse static background from DA3 geometry for a reference clip (needs a faster mesh renderer).

**Status (Oct 26):** M3 repair is built: `ltx25_extend_segment` graph (validates on Cloud, no partner nodes), `repairSegment`, `pnpm repair`, studio "Repair segment" button, `pnpm preflight`. One live sample: dolly-zoom take 3002, segment 3 went from 3.1° (failed) to 2.5° (holds), whole-clip rot 1.80° to 1.58°, 8 credits. Counter-example (Oct 27): unguided push_in 2000, segment 3 repaired while segments 1 and 2 had also drifted: 11.84° to 12.13°, not fixed (7 credits). The patch continues from the drifted frames, so `repairSegment` now refuses a segment that follows a drifted one. One sample at a near-gate value (gate 2.75°) is not a rate: run the unguided push_in takes (all segments fail) and a few more seeds before the demo claims a success rate. Guidance strength is capped at 1.0 by the contract, so a default-strength repair differs by seed and pinned context only.

**Status (Oct 28):** Author has "Match a camera from a video": the server samples 32 frames, runs one DA3 pose job (about 9 credits estimated on Cloud, free on a local server), and the studio turns the recovered path into at most 12 editable keys per channel, with the camera travel stated by the user (a monocular solve has no scale), retimed to the shot, and zoom off by default (recovered FOV is biased). Round trip on our own presets reproduces a ~9 m orbit within 0.25 m; not yet run on a live reference clip. Animated actors are NOT built: `tools/blender/make_actor.py` makes `src/assets/actors/mannequin_walk.glb` (696 triangles, one 121-frame clip at 25 fps, nodes `anchor.root` and `anchor.head`, no skinning), but `parseGltf` ignores animation. Before trusting any score on an actor shot, measure the noise floor: DA3 assumes a static scene, and the 0.5 to 1.4 degree floor so far comes from static ones. Plan after submission: sample node animation in rig-core and the studio, actor-aware presets (hero orbit, follow track, push to face, crane reveal) that read the anchor path, then the noise-floor run.

**Finding (Oct 28):** takes for a "woman in a red coat" prompt showed the described background and no person, because the default subject in the depth guide was a 0.6 x 1.8 x 0.6 m box (the editor drew it as a capsule, so it looked fine). The guide is the model's only source of shape, so a box reads as a pillar or a poster. The default subject is now a static mannequin (`src/assets/actors/mannequin_{stand,stride}.glb`, origin about the body centre, soles 0.9 m below it, facing +Z) that every preset, framing and check still aims at as the node `subject`. Not yet tested on a live generation: check that a person appears, and at what distance (at the default 6 m the figure is about a fifth of the frame height).

**Finding (Oct 28, flicker):** on 14 live takes the worst frame-to-frame brightness jump was at frame 56, 57, 112 or 113 in 12 of them (median 2.1x the rest of the clip, up to 9.6x). Those are the seams of the VAE decoder's temporal tiles (64 frames, 8 overlap, so a tile starts every 56 frames). `buildTakeGraph` and `buildSegmentGraph` now size `VAEDecodeTiled` from the shot (`decodeTiling`): one spatial and one temporal tile for a clip up to about 768x512x180, a 48-frame overlap above that. Paired live test (same seed, prompt and guide, only the tiling changed, `pnpm replay`, about 2 to 4 credits): seam at frame 112 went from 8.3x to 0.8x of the median jitter, seam at frame 56 from 9.6x to 4.1x, no spike frames remain, and the worst jump fell from 0.89 to 0.38 grey levels. One take is one sample. Measure with `uv run python -m verifier flicker <take.mp4> --seams 56,112`. What remains: jitter peaks every 8 frames (frame mod 8 in 0 or 1 is 1.4x the mid-latent frames in 15 of 16 takes, up to 1.9x), the LTX VAE's temporal step, which tile settings cannot change. ffmpeg `deflicker` (pm, size 5) made it worse (median jitter 0.083 to 0.146), so do not add it. The take also shimmers in texture (second-difference 2 to 7 against 0.7 for the guide); that is the model and sampler, not the decoder, and is not addressed.

**Quick Next Move:** Run the self-hosted proof (`docs/spikes/local.md`, `pnpm preflight` first), then freeze Wed noon.

**Finding (Oct 29, actor generation):** one live run, "a woman in a long red coat": FLUX schnell image then Hunyuan3D 2.1 shape in 74 s for 4 credits (balance 11189 to 11185), 237,914 raw triangles simplified to 71,057, one connected body, Y-up. The depth silhouette reads as a woman in a long coat with hair and heels. The figure faced +X, not +Z: the reference image was a three-quarter pose, and a Turn of -90 degrees fixed it (checked by rendering front and side depth views). One sample, so the default turn stays 0 until more are seen.
