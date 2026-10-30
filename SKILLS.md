# SKILLS.md — Claude Code skills, plugins and MCP servers for Comfy-Dial

**Install block (copy-paste, in this order):**

```
# 1. Anthropic example skills (webapp-testing, frontend-design, skill-creator, mcp-builder)
/plugin marketplace add anthropics/skills
/plugin install example-skills@anthropic-agent-skills

# 2. Comfy: Cloud MCP (node search, test runs, batches) + official node-authoring skills
/plugin marketplace add Comfy-Org/comfy-skills
/plugin install comfy-cloud@comfy-skills          # then /mcp → comfy-cloud → Authenticate
pip install "comfy-cli>=1.14.0" comfy-mcp
comfy skills install                              # adds comfy-custom-nodes and others
claude mcp add comfy-mcp -e COMFY_BIN=/path/to/venv/bin/comfy -- comfy-mcp

# 3. 3D studio
npx skills add EnzeD/r3f-skills
claude mcp add threejs-devtools-mcp -- npx threejs-devtools-mcp

# 4. Browser validation
claude mcp add playwright npx @playwright/mcp@latest
claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest

# 5. Code quality (official marketplace; install syntax inferred, confirm with /plugin)
/plugin install code-review@claude-plugins-official
/plugin install pr-review-toolkit@claude-plugins-official
/plugin install typescript-lsp@claude-plugins-official
/plugin install pyright-lsp@claude-plugins-official
/plugin install hookify@claude-plugins-official

# 6. Minimal-code discipline (MIT, DietrichGebert/ponytail; run as two separate prompts)
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
```

Verified = repo, README or manifest read on Oct 16, 2026.

---

## 0. Local ComfyUI on this Mac (surveyed Oct 16, 2026)

| Path | What's there |
|---|---|
| `/Users/loriechen/ComfyUI-Installs/ComfyUI/` | ComfyUI Desktop standalone install. Code in `ComfyUI/` (version **0.36.0**), Python **3.13.12** in `standalone-env/bin/python`, torch 2.12.1 (**MPS**, Apple Silicon). Desktop snapshots in `.launcher/snapshots/` |
| `/Users/loriechen/ComfyUI-Shared/models/` | Shared model store. Has only `birefnet`, `dino_v3_vit_h`, `triposplat_fp16`, `flux2-vae`. **No LTX, no IC-LoRA, no DA3 weights yet** |
| `/Users/loriechen/ComfyUI-Shared/{input,output}/` | Desktop input/output dirs |
| `/Users/loriechen/comfy-projects/` | Empty `inputs/ outputs/ workflows/` scratch dirs (not a `comfy project init` project) |

| Check | Status | Consequence |
|---|---|---|
| Core DA3 nodes (`LoadDA3Model`, `DA3Inference`, `DA3Render`, `DA3GeometryToMesh`, `DA3GeometryToPointCloud`) | ✅ in `comfy_extras/nodes_depth_anything_3.py` | Spike B needs no custom pack to *run* DA3 |
| DA3 pose export | ❌ no core node writes poses out. `DA3_GEOMETRY["extrinsics"]` is `(1,S,3,4)` **world-to-camera** `[R\|t]`; `["intrinsics"]` is `(1,S,3,3)` **pixel-space** K; multiview only | `SaveCameraPosesJSON` V3 node is needed (SPEC §4.3 fallback). Invert w2c → c2w before the verifier |
| DA3 weights | ❌ drop Small/Base into `models/geometry_estimation/` | `LoadDA3Model` combo is empty until then |
| LTX IC-LoRA nodes (`LTXICLoRALoaderModelOnly`, `LTXAddVideoICLoRAGuide`) | ❌ not in core or installed packs (core has only `GetICLoRAParameters`, `LTXVAddGuide`) | Need the Lightricks LTXVideo pack locally; check its licence against §4 before installing |
| Custom packs installed | `comfyui-kjnodes`, `comfyui_essentials`, `comfyui-vosr2` | — |
| `hivemind` | ❌ **not found** anywhere under the three paths | Row in §1 is wrong until it's installed |
| `comfy` CLI | ❌ not on PATH | Run step 2 of the install block |
| `ponytail` plugin | ❌ not installed (only `claude-plugins-official` marketplace is added) | Run step 6 of the install block |

Local server address for the CLI: Desktop does not use 8188. Set `COMFY_LOCAL_URL` to the port shown in Desktop → Settings → Server (usually `http://127.0.0.1:8000`).

**Build pin trap:** this install freezes macOS / Python 3.13 / MPS torch. If you ever `comfy build init` it, empty `pipDependencies` before the first cut (see `comfy-build-pins`). The verifier targets Python 3.11 separately; don't share the Desktop venv.

---

## 1. By build lane

| Lane | Skill / tool | Use it for | Accelerate or Validate | Verified |
|---|---|---|---|---|
| **Comfy backend** | `comfy-cloud` plugin (hosted MCP: `search_nodes`, `get_node`, `submit_workflow`, `submit_batch`, `wait_for_batch`) | Day 1: confirm LTX IC-LoRA nodes exist on Cloud; prototype N-take batches before the SDK layer exists | Both | ✅ |
| Comfy backend | `comfy-mcp` (local: `validate_workflow`, `run_workflow`, `search_nodes`) | Validate API-format graphs against local ComfyUI | Validate | ✅ |
| Comfy backend | artokun/comfyui-mcp skills `ltxv2-video`, `video-extend` (community) | LTX IC-LoRA settings; extend pattern for segment repair | Accelerate | ✅ |
| Comfy backend | `hivemind` (Banodoco corpus) | Search real user reports on LTX, IC-LoRA, DA3. Run locally (endpoint blocked from cloud) | Accelerate | ⚠️ Not found on disk Oct 16 (see §0); install before relying on it |
| Comfy backend | `comfy-debug` | Map any failed job's `error.code` to a fix (`prompt_rejected`, `transient_auth`, missing model) before improvising | Validate | ✅ installed in `~/.claude/skills` |
| Comfy backend | `comfy-relay` | Show every take as a contact sheet (`comfy preview take.mp4` → `Read`), never just a path. Use during spikes and the M1 calibration on 10 real takes | Validate | ✅ installed |
| **Custom node** (fallback) | `comfy-custom-nodes` (from `comfy skills install`) | `SaveCameraPosesJSON` V3 node; optional `CS_VERIFIER` adapter | Both | ✅ |
| Custom node | jtydhr88/comfyui-custom-node-skills | Reference only; overlaps the official set, don't install both | Accelerate | ✅ |
| **Studio** | EnzeD/r3f-skills (11 skills, R3F 9.7 / three r185) | Scene, camera, loaders, render targets | Accelerate | ✅ |
| Studio | `threejs-devtools-mcp` (`capture_frames` on virtual time) | Inspect live camera + render targets; frame-exact depth-pass capture | Validate | ✅ |
| Studio | `frontend-design` | Contact sheet + overlay UI that doesn't look templated | Accelerate | ✅ |
| Studio | `dataviz` | Per-segment error bars, rot/trans/FOV charts, pass/fail colours that work in light and dark | Accelerate | ✅ installed |
| Studio | Blender MCP (`search_assets` → Poly Haven, `import_asset`, `execute_blender_code`) | Build the 2 bundled CC0 scenes and export GLB. Poly Haven only (CC0). Skip `generate_3d` (may spend credits, licence unclear) | Accelerate | ✅ connected in this Claude app |
| Studio | `run` | Launch the studio/server and confirm a change works in the real app, not just tests | Validate | ✅ built in |
| **Testing** | `webapp-testing` (Anthropic) | Playwright scripts against the local studio | Validate | ✅ |
| Testing | Playwright MCP / Chrome DevTools MCP | E2E flows, screenshots, perf traces, WebGL memory | Validate | ✅ |
| **Verifier** | `skill-creator` | Build the project skill `camera-adherence-eval` (below) with evals | Both | ✅ |
| **Review** | `code-review`, `pr-review-toolkit`, `typescript-lsp`, `pyright-lsp` | Merge parallel worktree branches safely | Validate | ✅ |
| Review | `hookify` | Hooks that block "done" until tests pass | Validate | ✅ |
| Review | `/code-review [low…max]`, `/simplify`, `/security-review` (built into Claude Code) | Per-branch bug pass before merge; `/simplify` as the non-bug cleanup; `/security-review` once before submit to catch leaked `COMFY_API_KEY` | Validate | ✅ built in |
| **Docs / demo** | `humanizer` | Rewrite README and the §1 voiceover so they don't read as AI text | Accelerate | ✅ installed |
| **Code size (all lanes)** | `ponytail` (MIT; `/ponytail [lite\|full\|ultra\|off]`) | Before writing code, checks: already in repo → stdlib → platform feature → new code. Keeps validation, error handling, security. Use `lite` in `verifier/` (the ~30-line Umeyama must stay hand-written, not replaced by a library) | Accelerate | ✅ README read Oct 16, 2026 |
| Code size | `/ponytail-review [uncommitted\|staged\|branch\|<PR link>]` | Diff review for bugs, untested risky code, cuttable code. Run per lane branch before merge, alongside `code-review` | Validate | ✅ |
| **Comfy CLI** | `comfy`, `comfy-build`, `comfy-deploy`, `comfy-debug`, `comfy-relay`, `comfy-custom-nodes` (via `comfy skills show <name>`) | Build/release/deploy the environment, decode failed-job error codes, present results | Both | ✅ skill files in `~/.claude/skills`; CLI itself not installed (§0) |
| Comfy CLI | `comfy-build` → `comfy-deploy` | Only if Cloud lacks the IC-LoRA nodes: package local install + LTXVideo pack into a build, deploy as an endpoint. **Deploy bills continuously**; always `comfy deploy stop` after a session | Accelerate | ✅ |

**Not relevant here (installed, skip):** `comfy-director` (narrative multi-shot films, not a camera verifier), Cloudflare skills, Figma skills.

---

## 2. Project skills to WRITE (no existing skill covers these)

Put them in `.claude/skills/` so every worktree agent shares them.

| Skill | What it encodes | Build with |
|---|---|---|
| `camera-adherence-eval` | How to run the verifier: Sim(3)/Umeyama alignment, rot/trans/FOV error, per-segment scoring, the golden test, perturbation set (reversed, half amplitude, zoom-for-dolly, wrong orbit). "A change to `verifier/` is done only when the golden test passes." | `skill-creator` (with evals) |
| `comfy-dial-graphs` | Which API-format graph does what, node IDs to `setInput`, frame rule (1+8k), `attention_strength`, SDK idempotency rules (save `{key → jobId}` before awaiting) | `skill-creator` |
| `licence-guard` | Allowed: LTX-2.x Community, DA3 Small/Base (Apache-2.0), COLMAP/GLOMAP (BSD), TAPIR/BootsTAP (Apache-2.0). **Banned:** DA3 Large/Giant, CoTracker3, SpatialTracker v2 (CC BY-NC), `evo` (GPL), CozyClay code (AGPL), any partner node/API | `skill-creator` |
| *(dev-use exception, Oct 29)* | **Optional actor generation only:** Hunyuan3D 2.1 shape model (local weights node chain, not the `Tencent*` partner nodes) and FLUX.1 schnell (Apache-2.0). Hunyuan3D's Tencent licence excludes the EU, UK and South Korea and bars using outputs to train other models, so generated meshes are never bundled or committed (they live in the runs folder). Tripo is a partner API: banned. | n/a |
| *(allowed, Oct 29)* | **Optional take upscale:** SeedVR2 3B (ByteDance-Seed, Apache-2.0) via the local `SeedVR2*` nodes (pack ComfyUI-SeedVR2_VideoUpscaler). Not the partner upscalers (Topaz, WaveSpeed FlashVSR, HitPaw, ByteDance vCube, BFL, Clarity). The score never uses the upscaled video. | n/a |

---

## 3. Claude Code parallel setup

| Setting | Value | Why |
|---|---|---|
| `.claude/agents/*.md` | `isolation: worktree` | Each lane gets its own checkout |
| `.claude/settings.json` | `"worktree": { "baseRef": "head" }` | Agents build on in-progress work |
| `.worktreeinclude` | `src/.env` | Comfy API key reaches every worktree |
| Hook | `Stop` / `TaskCompleted` runs `.claude/hooks/stop-tests.sh` (`cd src && pnpm -r test && uv run pytest verifier`) | Nothing is "done" with red tests |
| Agent teams | Off (experimental, higher token cost) | Use only for a final review pass |

---

## 4. Don't use

| Tool | Why |
|---|---|
| `evo` | GPL-3.0; write Umeyama yourself |
| CoTracker3, SpatialTracker v2 | CC BY-NC weights |
| DA3 Large / Giant | CC BY-NC weights |
| Comfy Router LTX endpoints | Text-to-video only, no IC-LoRA; breaks Open Weights Only |

---

**Parking Lot**
- ponytail's headline numbers (~53% less code, ~41% less time) are the author's benchmarks, not ours. Keep it only if it doesn't fight test-first work in `verifier/`.
- Spark (World Labs) splat renderer has no skill; write one only if splats come back into scope.
- ffmpeg/video-analysis community skills are unverified; use plain ffmpeg in scripts instead.
- Tentative, after submission only: [ComfyUI-Sharp](https://github.com/PozzettiAndrea/ComfyUI-Sharp) (GPL-3.0 wrapper for Apple SHARP, photo to Gaussian splat). Use it only as an external pack the user installs; never vendor its code. Blocker: the SHARP weights are under the Apple ML Research Model License (read in full Oct 29): "exclusively for Research Purposes", which "does not include … product development or use in any commercial product or service"; revocable, delete on termination. Not on the §2 allowed list, so it is not in the install block or the demo. Revisit the licence reading before any use. Unchecked: output format, novel-view rendering, Mac/MPS and Cloud support, ml-sharp ACKNOWLEDGEMENTS.
- Tentative: [peteromallet/VibeComfy](https://github.com/peteromallet/VibeComfy) (MIT, Python workflow authoring layer + CLI). Only the README was read (Oct 26); LTX IC-LoRA support and Cloud behaviour unchecked. Possible use: `doctor` / `nodes ensure` logic for the M3 local preflight. Not in the install block until used.

**Quick Next Move:** Run step 2 of the install block, then ask the comfy-cloud MCP: `search_nodes "LTXAddVideoICLoRAGuide"`.
