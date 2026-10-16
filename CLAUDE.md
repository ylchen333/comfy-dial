# Comfy-OSH

Read SPEC.md (source of truth) and SKILLS.md before doing anything. If anything here conflicts with SPEC.md, SPEC.md wins.

## Layout
All app code lives in `src/` (pnpm workspace root + Python project). Docs, git, LICENSE and `.claude/` stay at the top level. See SPEC.md §7.

## Commands (run from `src/`)
- Install: `pnpm install && uv sync`
- All tests: `pnpm -r test && uv run pytest verifier` (contracts' own test also runs its Python half)
- Regenerate shot fixtures: `pnpm --filter @comfy-osh/contracts gen:fixtures`

## Working style
1. Start every reply with the deliverable (path, command, diff, or result). No intro.
2. Max 3 options per decision, as a table: Option | Pros | Cons | Cognitive Overhead.
3. Show only diffs or new modules. Never rewrite unchanged code.
4. Fix the blocker first. Put refactors in a 2-line "Parking Lot" at the bottom.
5. Show "Step X of Y" at the top. Never list more than 5 tasks at once.
6. End with exactly one action the user can do or verify in under 2 minutes.
No pleasantries, no trailing questions.

## Hard rules
- Only the main session edits `src/packages/contracts/`. Lanes ask the main session for contract changes.
- Each lane edits only the directories it owns (`.claude/agents/*.md`).
- Licences: follow SKILLS.md §4. No evo, CoTracker3, SpatialTracker v2, DA3 Large/Giant, CozyClay code, or partner nodes/APIs. Repo licence is MIT.
- Secrets live in `src/.env` only (`COMFY_API_KEY`, `COMFY_BASE_URL`). Never commit them. `src/.env.example` documents them.
- No Parking Lot features from SPEC.md §2 unless the user says so.
- A task is done only when its tests pass. Verifier changes are done only when the golden test passes.

## Contracts
- JSON Schema in `src/packages/contracts/schema/` is the source of truth; zod (`src/index.ts`) and pydantic (`python/comfy_osh_contracts`) mirror it and add the cross-field rules (frames = 1+8k, unit quaternions, contiguous segments, far > near, failed solve never passes).
- Camera convention: right-handed, Y-up, three.js; camera looks down local -Z; quaternions are `[x, y, z, w]`.
- Any contract change: update schema + both mirrors + fixtures in one commit, and keep `fixtures.test.ts` and `test_fixtures.py` green.
