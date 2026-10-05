# Batch 2 report

Base: `D:/projects/ptah-extension/.claude-worktrees/task-614-d-e/libs/backend/cli-agent-runtime/src/lib/cli-agents/`

## Task 2.1 (lane-budget-guard.ts + spec)
- `observe()` now counts `tool-call` as before (and remembers its `toolCallId`), plus a `command` segment that carries a `toolCallId` not yet counted. Command without id, or repeated id, is ignored.
- Counted ids are a `Set` bounded at 512 (oldest dropped), cleared in `reset()`. Repeat key still `callKey` (toolName fallback). Line-141 `localeCompare` kept; adapter untouched.
- Tests: OpenCode-style commands trip steer/stop at 40/60; tool-call + command same id counts once; no-id and repeated-id ignored; `reset()` clears the id set.

## Task 2.2 (agent-spawn-environment.service.ts + spec)
- Fallback warn logs `provided` (numbers as-is, others as `typeof`) next to `defaults`; new private `warnLaneGuardOnce` with a per-instance `Set` keyed on key + provided values, so each distinct invalid tuple warns once.
- Tests: invalid pair logs provided values (50, 'string') and defaults; two calls with the same invalid repeat value log once.

## Checks
- `npx nx run-many -t typecheck,lint,test -p cli-agent-runtime`: exit 0
- `npx nx run di-lint:lint`: exit 0
- `npx nx run degradation-audit:lint`: exit 0
