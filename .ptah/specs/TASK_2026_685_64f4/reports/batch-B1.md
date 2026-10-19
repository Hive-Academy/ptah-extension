# Batch B1 — root-only turn boundary

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\chat\streaming\chat-stream-broadcaster.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\chat\streaming\chat-stream-broadcaster.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B1.md` (this report)

## Acceptance against B1.1

- The turn gate resets only on a root `message_start` and sends `CHAT_COMPLETE` only on a root `message_complete`, using the flat event's `parentToolUseId`. No new state.
- The existing event publish call remains before both gates, so subagent events still reach the webview.
- The end-of-stream fallback is unchanged.
- New spec cases cover subagent start/complete after parent completion (one completion, all four chunks published), subagent completion before parent completion (completion follows the parent chunk), two root turns (two completions), and subagent-only stream fallback (one completion after the chunks).
- The relevant plan-validation edge case is late subagent events after parent completion. The regression cases cover that and subagent events within an open parent turn. Plan-validation Risk 15 is addressed by leaving heavy checks to the team leader.
- `ptah_get_diagnostics` scoped to both changed files: clean, zero errors. No test, typecheck, lint, build, or git command was run, as required by the lane brief.

## Decisions

- Count root events by absence of `parentToolUseId`. Options: add turn state keyed by agent, or use the flat event field. The plan and `FlatStreamEvent` type specify the field, and the current broadcaster has one turn gate. This is reversible.
- Keep the stream-exit fallback for streams with no root completion. Options: suppress it for subagent-only streams, or retain existing behavior. B1 explicitly requires the fallback unchanged. This is reversible.

## Scoped check commands for team leader

Run sequentially after other heavy checks finish:

1. `npx nx test @ptah-extension/rpc-handlers --parallel=1`
2. `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1`
3. `npx nx lint @ptah-extension/rpc-handlers --parallel=1`

