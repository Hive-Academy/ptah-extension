# Batch B4 implementation report

## Files written
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\streaming-handler.service.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\streaming-handler.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\streaming-handler.background.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\history-message-builder.service.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\history-message-builder.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-routing\src\lib\stream-router.service.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-routing\src\lib\stream-router.service.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B4.md

## B4.1
`processStreamEvent` calls `claim(event)` once at entry, inside the existing catch boundary, before turn handling, tab lookup, background routing and fan-out. A claimed event returns null immediately. The seam adds no per-event allocation on the unclaimed path. The foreground spec asserts single claim, retained-event handoff, no tab state mint, and no tab lookup; the background spec asserts no background lookup, update or accumulator call. The store's own `claim` implementation handles retention. The finalization spec was not edited.

## B4.2
`accumulate` tracks child message IDs after a `message_start` with `parentToolUseId`. These events call `historyEventsSeen` and run through a separate scratch `StreamingState`; their accumulator side effects update subagent usage while their events stay off the parent scratch state. The spec asserts this separation and usage callback. Root agent lifecycle events continue through the parent state, preserving agent nodes in the restored tree.

## B4.3
`StreamRouter` calls `clearSession(sid)` next to both `clearSessionAgents` for final surface closure and `forceClearSessionAgents` for final tab closure. The routing spec asserts each call. The store is imported through the chat-streaming public index.

## Risk and verification
- Risk 1, hot path: one direct `claim` call precedes routing; no new collection or cloned event is created for unclaimed stream events.
- Scoped `ptah_get_diagnostics` completed for all seven changed source/spec files. It reported 158 TypeScript errors across the project, including existing errors in these specs; none were reported at the newly edited lines. This is not a clean typecheck.
- No test, typecheck, lint, build, serve, e2e, package, or git command was run, per batch rules. Runtime verification remains for the team leader.
- The history spec checks retained parent events rather than invoking the real tree builder, which is mocked in that spec; a full restored-tree assertion is still a verification gap.

## Decisions
- **Child history ownership:** Identify a child sequence from `message_start.parentToolUseId` and keep subsequent events for that message ID in a separate accumulator state. Alternative: call `claim` during history replay. Evidence: the store's `historyEventsSeen` is intentionally payload-free and `claim` retains live payload. Reversible: yes.
- **Hot-path ordering:** Call `claim` before the existing turn-state branch. Alternative: claim after turn-state handling. Evidence: component 8 requires one call before routing, and the store returns false for unrelated events. Reversible: yes.

