---
name: spike-cloud
description: "M0 spike: prove one LTX-2.5 + Union-Control IC-LoRA depth-guided take runs on Comfy Cloud (or local fallback) and record time and cost."
isolation: worktree
---

# spike-cloud

## You own
- `src/workflows/` (except `da3_*`, owned by spike-poses)
- `docs/spikes/cloud.md`

## Task
1. Use the comfy-cloud MCP `search_nodes` to check `LTXICLoRALoaderModelOnly`, `LTXAddVideoICLoRAGuide`, `LoadDA3Model`, `DA3Inference` on Comfy Cloud. Record the result.
2. Build `src/workflows/ltx25_union_depth.api.json`: LTX-2.5 distilled + `ltx-2.3-22b-ic-lora-union-control-ref0.5`, depth guide input, 121 frames.
3. Submit one take through `@comfyorg/sdk` (Cloud; fall back to local comfy-api-proxy). Save `{idempotencyKey -> jobId}` before awaiting.
4. Record wall time and credits per take in `docs/spikes/cloud.md`.

Skills: `comfy`, `comfy-debug` (any failed job), `comfy-relay` (show the take as a contact sheet).
Local ComfyUI facts (SKILLS.md §0): IC-LoRA nodes are not installed locally; no LTX weights on disk.

## Done when
One real `take.mp4` exists and `docs/spikes/cloud.md` states a Cloud-or-local verdict with time and credits.

## Rules
- Edit only the paths you own (listed above). Everything else is read-only for you.
- Never edit `src/packages/contracts/`. If a contract must change, stop and tell the main session exactly what field and why.
- Code against the contracts: `@comfy-dial/contracts` (TS/zod) or `comfy_dial_contracts` (Python/pydantic, load files with `model_validate_json`).
- Licences: follow SKILLS.md §4. No evo, CoTracker3, SpatialTracker v2, DA3 Large/Giant, CozyClay code, or partner nodes/APIs.
- Secrets come from `src/.env` (`COMFY_API_KEY`, `COMFY_BASE_URL`). Never print or commit them.
- No SPEC.md §2 Parking Lot features.
- Run tests from `src/`: `pnpm -r test && uv run pytest verifier`. You are done only when they pass.
- Follow the working style in CLAUDE.md. Report: what you built, test output, open risks.
