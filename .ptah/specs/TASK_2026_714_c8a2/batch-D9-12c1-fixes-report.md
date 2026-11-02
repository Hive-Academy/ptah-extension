# Batch D9 12c-1 review fixes

## Findings addressed

| Finding | Change |
| --- | --- |
| M1, m3 | `codex-history-projector.ts:30,50,70,164` carries the previous timestamp across items and turns; partial or earlier item entries cannot reorder a turn. The first known snapshot time supplies a deterministic fallback when a thread time is missing. |
| M2 | `codex-history-projector.ts:55-79` links child threads through any matching collaboration receiver, preferring spawn tools. If no tool can be found, events retain a synthetic `parentToolUseId` derived from `parentThreadId`, and `skippedItems` records `unresolvedParentTool`. |
| M3 | `codex-history-projector.ts:140-143` presents replayed async questions as assistant text through the live mapper's `userInputAsync` text branch. |
| M4 | `codex-history-projector.ts:152-158` uses `HistoryEventFactory.createAgentStart`, then replaces only its random index-based id with a stable native id. `agentType` is `unknown` because native history has no Claude Task input; `source` is `history`, with the same optional Claude history card fields. The decision is in `plan-d9-history.md:29`. |
| M5 | `codex-history-projector.spec.ts:59-186` checks unique ids, assistant message fields, live message identity parity and tool shape parity, partial/non-monotonic item entries, failed/interrupted/in-progress turns, empty reasoning, async questions, unsupported user content, unresolved parent fallback, non-spawn and nested child links. |
| m1 | `codex-history-projector.ts:135` skips empty final reasoning before the mapper can open an empty assistant message. |
| m2 | `codex-history-projector.ts:136-139,195-210` records compaction items and includes snapshot error text in a failed turn's assistant message, including a failure with no prior assistant item. |
| m4 | `codex-history-projector.ts:110-122` uses the callback's `kind` to emit a complete-source text or thinking delta. |

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-history-projector.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\libs\backend\agent-sdk\src\lib\codex-app-server\codex-history-projector.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\.ptah\specs\TASK_2026_714_c8a2\plan-d9-history.md`
- `D:\projects\ptah-extension\.claude-worktrees\codex-removal-a\.ptah\specs\TASK_2026_714_c8a2\batch-D9-12c1-fixes-report.md`

## Evidence and limits

- CR counts using `tr -cd '\r' < file | wc -c`: projector 0; spec 0; plan 0; this report 0. All four files were written as UTF-8 without BOM.
- Tests, lint, typecheck, build, Nx, npm, diagnostics, commit, and push were not run; the coordinator owns verification.
- UNCONFIRMED: the pinned App Server binary's replay payload and Electron rendering have not been exercised. A child whose parent tool cannot be identified remains scoped through a synthetic parent id with a diagnostic; the UI behavior for that damaged history case is unconfirmed.
- Skill discovery found no skill that covers this deterministic native-history projection. The local `typesafe-ai` skill was read but concerns a different integration and supplied no implementation rule for this batch.
