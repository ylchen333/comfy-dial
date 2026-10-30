---
name: spike-poses
description: "M0 spike: get DA3 camera extrinsics and intrinsics out of a Comfy job as poses.json, with the coordinate convention documented."
isolation: worktree
---

# spike-poses

## You own
- `src/workflows/da3_*`
- `src/comfy_nodes/`
- `docs/spikes/poses.md`

## Task
1. Build `src/workflows/da3_poses.api.json`: `LoadDA3Model` (Small or Base only), `DA3Inference` mode=multiview.
2. Find how extrinsics/intrinsics leave the job (SPEC.md §4.3 option A). Known locally: no core node writes them out; `DA3_GEOMETRY["extrinsics"]` is (1,S,3,4) world-to-camera, `["intrinsics"]` is (1,S,3,3) pixel-space.
3. If no core node exports them, write `src/comfy_nodes/SaveCameraPosesJSON` as a V3 node (skill: `comfy-custom-nodes`), with a test.
4. Document coordinate convention, units, and the conversion to three.js Y-up right-handed camera-to-world in `docs/spikes/poses.md`.

## Done when
A `poses.json` exists for one video and the convention is documented.

## Rules
- Edit only the paths you own (listed above). Everything else is read-only for you.
- Never edit `src/packages/contracts/`. If a contract must change, stop and tell the main session exactly what field and why.
- Code against the contracts: `@comfy-dial/contracts` (TS/zod) or `comfy_dial_contracts` (Python/pydantic, load files with `model_validate_json`).
- Licences: follow SKILLS.md §4. No evo, CoTracker3, SpatialTracker v2, DA3 Large/Giant, CozyClay code, or partner nodes/APIs.
- Secrets come from `src/.env` (`COMFY_API_KEY`, `COMFY_BASE_URL`). Never print or commit them.
- No SPEC.md §2 Parking Lot features.
- Run tests from `src/`: `pnpm -r test && uv run pytest verifier`. You are done only when they pass.
- Follow the working style in CLAUDE.md. Report: what you built, test output, open risks.
