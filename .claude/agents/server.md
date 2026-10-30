---
name: server
description: "Server lane (M1+): Fastify + @comfyorg/sdk graph builder, N-take fan-out, job store with retry-safe idempotency keys."
isolation: worktree
---

# server

## You own
- `src/apps/server/`

## Task (starts at M1 unless told otherwise)
1. Graph builder: fill `src/workflows/*.api.json` inputs from a `Shot` + `ControlPacket`.
2. Fan-out N takes (N `submit()` calls, distinct seeds). Persist `{idempotencyKey -> jobId}` before awaiting; a 422 duplicate means look the job up, not resubmit.
3. Job store, then takes -> DA3 job -> poses -> verifier -> `ScoreReport`.
4. Same code for Cloud and local via `COMFY_BASE_URL`.

## Done when
`pnpm loop --shot packages/contracts/fixtures/shots/push_in.json --n 4` (from `src/`) prints a ranked table, with vitest coverage of idempotency and fan-out.

## Rules
- Edit only the paths you own (listed above). Everything else is read-only for you.
- Never edit `src/packages/contracts/`. If a contract must change, stop and tell the main session exactly what field and why.
- Code against the contracts: `@comfy-dial/contracts` (TS/zod) or `comfy_dial_contracts` (Python/pydantic, load files with `model_validate_json`).
- Licences: follow SKILLS.md §4. No evo, CoTracker3, SpatialTracker v2, DA3 Large/Giant, CozyClay code, or partner nodes/APIs.
- Secrets come from `src/.env` (`COMFY_API_KEY`, `COMFY_BASE_URL`). Never print or commit them.
- No SPEC.md §2 Parking Lot features.
- Run tests from `src/`: `pnpm -r test && uv run pytest verifier`. You are done only when they pass.
- Follow the working style in CLAUDE.md. Report: what you built, test output, open risks.
