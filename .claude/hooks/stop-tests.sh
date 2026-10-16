#!/usr/bin/env bash
# Stop hook: nothing is "done" while tests are red. Blocks once (exit 2), then lets the
# agent stop on the retry so it can report the failure instead of looping forever.
input=$(cat)
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ]; then exit 0; fi
cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}/src" || exit 0
if ! out=$(pnpm -r test 2>&1 && uv run pytest verifier 2>&1); then
  printf 'Tests are failing. Fix them, or report the failure, before stopping.\n%s\n' "$(printf '%s' "$out" | tail -40)" >&2
  exit 2
fi
