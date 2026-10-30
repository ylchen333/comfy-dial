---
name: rig-renderer
description: "M0 rig-renderer lane: camera math, move presets, frame sampler, FOV conversions and the fixed-normalization depth renderer; renders the golden clips."
isolation: worktree
---

# rig-renderer

## You own
- `src/packages/rig-core/`
- `src/tests/golden/clips/`

## Task
1. Camera math (three.js Y-up right-handed), 5 move presets (push-in, pull-out, orbit, pan, dolly zoom) compiled to Shot keyframes.
2. Sampler: keyframes -> one pose per frame, frames = 1+8k at 25 fps, deterministic.
3. Focal length (mm) <-> vertical FOV conversion.
4. Offscreen depth-pass renderer with FIXED near/far normalization for the whole clip (never per frame).
5. Render the 5 golden clips (RGB + depth) from `@comfy-dial/contracts/fixtures/shots/*.json` into `src/tests/golden/clips/`.

## Done when
Clips exist and vitest covers the conversions and sampler determinism.

## Rules
- Edit only the paths you own (listed above). Everything else is read-only for you.
- Never edit `src/packages/contracts/`. If a contract must change, stop and tell the main session exactly what field and why.
- Code against the contracts: `@comfy-dial/contracts` (TS/zod) or `comfy_dial_contracts` (Python/pydantic, load files with `model_validate_json`).
- Licences: follow SKILLS.md §4. No evo, CoTracker3, SpatialTracker v2, DA3 Large/Giant, CozyClay code, or partner nodes/APIs.
- Secrets come from `src/.env` (`COMFY_API_KEY`, `COMFY_BASE_URL`). Never print or commit them.
- No SPEC.md §2 Parking Lot features.
- Run tests from `src/`: `pnpm -r test && uv run pytest verifier`. You are done only when they pass.
- Follow the working style in CLAUDE.md. Report: what you built, test output, open risks.
