# Batch B3a — store prerequisites

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-types\src\lib\chat-types.ts` — optional per-state `eventCap`; FIFO writer uses it and retains the 5000-event default.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\streaming-event-cap.spec.ts` — new cap behavior specs.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\execution-tree-builder.service.ts` — optional `rootParentToolUseId` third argument and root filtering.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\execution-tree-builder.service.spec.ts` — root selection, nested agent, and cache invalidation case.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\accumulator-core.service.ts` — optional `skipStoreEffects` guard for the listed agent monitor calls and `onAgentStart` hook.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\accumulator-core.service.spec.ts` — skipped effects and preserved accumulation/registration cases.
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B3a.md` — this report.

## Acceptance by task

- **B3a.1:** `StreamingState.eventCap` is optional. `setStreamingEventCapped` reads `state.eventCap ?? STREAMING_EVENT_CAP` for eviction and warning text. Existing states use the original default. New specs cover the absent option, a two-event FIFO cap, and replacement at capacity.
- **B3a.2:** `buildTree(state, cacheKey, { rootParentToolUseId })` selects starts with that exact parent. The original root rule applies when the option is absent. A spec creates a subagent root and a nested agent, verifies only the selected root is returned, and verifies root and nested deltas invalidate the cached tree. The isolated subagent root has no parent `tool_start` in its state, so the existing digest index attributes it to its own message ID; `execution-tree-cache.ts` needed no change.
- **B3a.3:** `skipStoreEffects` defaults to false through the optional context field. When true, `getSubagent`/`onTaskToolResult`, `onAgentStart` (monitor and callback), and `onSubagentMessageComplete` are skipped. Event retention, `SessionManager.registerAgent`, and `onStateChanged` still run. Existing callers are unchanged.

## Decisions

- **Use the existing digest implementation.** Option: extend `execution-tree-cache.ts`. Evidence: the store's isolated state has no parent tool start, so `rootMessageIdByMessageId` falls back to the subagent message ID; the new spec covers updates to that root and a nested message. Reversible if a later producer includes the parent tool start in the same state.
- **Guard only the listed agent store effects.** Option: also guard background-only event cases. Evidence: plan section 7 says store-only event types are never claimed and names the Task result, agent start, and message complete sites for this option. Reversible if the store's event ownership contract changes.

## Verification handoff

No test, typecheck, lint, build, or git command was run, per the batch rules. Scoped `ptah_get_diagnostics` was requested twice for the six changed TypeScript files; both requests returned **unavailable** after a 45-second TypeScript check timeout, with all six files unchecked. This is not a passing diagnostic result.

Run sequentially, one command at a time:

1. `npx nx test @ptah-extension/chat-streaming --parallel=1`
2. `npx nx run-many -t typecheck -p @ptah-extension/chat-types @ptah-extension/chat-streaming --parallel=1`
3. `npx nx run-many -t lint -p @ptah-extension/chat-types @ptah-extension/chat-streaming --parallel=1`

Risk 4 is avoided: B3a adds no RPC or store. Risk 5 is handled by placing the event-cap spec in chat-streaming, which has a test target. No screenshots apply.
