# Batch G5 report

## Files changed

- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-g5-report.md

## Specs added

- `restores Auto-edit after resume and auto-accepts a plain file change`: saves Auto-edit through `updateNextTurn`, closes the context, resumes with the persisted identity, and asserts the restored level before and during the next turn. The spec also asserts automatic file-change approval without a sink prompt. It exercises `codex-context.ts:116-125`, `codex-context.ts:210-217`, `codex-context.ts:507-535`, `codex-context.ts:786-849`, `codex-runtime.ts:40-55`, `codex-approval-bridge.ts:315-347`, and `codex-permission-policy.ts:41-44`.
- `restores Ask after resume and keeps a plain file change interactive`: changes Auto-edit to Ask, resumes, and asserts the restored Ask level and an interactive file-change approval. It pins the different local behavior despite the same D14 wire policy as Auto-edit. It exercises the same context and runtime lines plus `codex-permission-policy.ts:44`.
- `restores Plan with its different wire policy and declines a file change`: saves and resumes Plan, asserts the restored Plan level, checks the `on-request` and `readOnly` turn policy, and asserts a file-change refusal without a sink prompt. It exercises the same resume lines plus `codex-permission-policy.ts:20`.

## Production change

- None. Code inspection shows that the updated level and fingerprint persist before close. The supplied resume profile initializes the restored settings. The approval bridge reads the restored level for the next turn.

## Decisions

- Kept the D14 mapping unchanged. Ask and Auto-edit retain the same wire policy, but the specs assert distinct approval behavior.
- Rebuilt the host-owned resume profile with the saved level and the persisted identity fingerprint. The runtime store persists identity only.
- Added a file-change fixture to the existing `FakeChild`. Reused the existing runtime, persistence, sink, and process fixtures.
- Did not run tests, lint, typecheck, diagnostics, or other verification commands because the lane rules prohibit them. Static inspection and the TypeScript AST parse found no syntax errors.

## Clarifications Needed

- None.
