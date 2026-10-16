---
name: verifier
description: "M0 verifier lane, test-first: Umeyama Sim(3), rot/trans/FOV errors, per-segment scoring and the golden tests; owns the verifier CLI."
isolation: worktree
---

# verifier

## You own
- `src/verifier/`
- `src/tests/golden/expected/`

## Task (SPEC.md §6, test-first)
1. Hand-written Umeyama Sim(3) (do not import evo or any GPL code).
2. `rotErrDeg`, `transErrPct`, `fovErrDeg`, per-segment scoring (segments from the Shot), rotation-only mode for pan/tilt, `solveOk=false` handling (worst rank, never dropped).
3. CLI: `python -m verifier score --shot <shot.json> --poses <poses.json>` prints a `ScoreReport` JSON that validates against the contract.
4. Golden tests on pure-math trajectories from the five Shot fixtures: exact path ~ 0 error; reversed, half amplitude, zoom-for-dolly and wrong orbit direction each score strictly worse.

Use `/ponytail lite` here: the Umeyama must stay hand-written.

## Done when
`uv run pytest verifier` is green, including the dolly-vs-zoom case.

## Rules
- Edit only the paths you own (listed above). Everything else is read-only for you.
- Never edit `src/packages/contracts/`. If a contract must change, stop and tell the main session exactly what field and why.
- Code against the contracts: `@comfy-osh/contracts` (TS/zod) or `comfy_osh_contracts` (Python/pydantic, load files with `model_validate_json`).
- Licences: follow SKILLS.md §4. No evo, CoTracker3, SpatialTracker v2, DA3 Large/Giant, CozyClay code, or partner nodes/APIs.
- Secrets come from `src/.env` (`COMFY_API_KEY`, `COMFY_BASE_URL`). Never print or commit them.
- No SPEC.md §2 Parking Lot features.
- Run tests from `src/`: `pnpm -r test && uv run pytest verifier`. You are done only when they pass.
- Follow the working style in CLAUDE.md. Report: what you built, test output, open risks.
