# Context — TASK_2026_688_f6d2

- Type: BUGFIX, depth Minimal (one frontend file plus its spec).
- Worktree: `.claude-worktrees/analytics-stats-shape`, branch `fix/analytics-stats-shape` from `origin/main`.
- Gate 0.1: preference source = memory `orchestration-executor-preference` (newest; lanes first,
  codex first). Mode `enabled`. Approval `lane-review` (no document gates in a Minimal BUGFIX).

## Root cause

- `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts:481` iterates
  `result.data.sessionStats` without a shape check.
- `pageMatchesLoad` (same file, ~571) accepts a payload with no `scope`/`since`/`until`.
- `apps/ptah-electron-e2e/src/support/ui-driver.ts:139-179` answers unmocked methods with
  `success: true` and `NAMESPACE_EMPTY_DEFAULTS`, which has no `sessionStats`.
- The real handler (`session-rpc.handlers.ts:1245-1267`) always returns an array.
