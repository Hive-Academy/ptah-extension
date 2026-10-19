# Batch B backend style fix

## Completed

- Replaced agent-sdk validation message matching with exported `SubagentHistoryValidationError`. Caller supplied session, tool, and agent identifiers now receive this type; invalid server correlated agent identifiers remain persistence failures. The RPC handler maps the typed error to `INVALID_PARAMS` and treats an ordinary Error with identical wording as `PERSISTENCE_UNAVAILABLE`.
- Exported `SubagentEventsReadResult` from the agent-sdk barrel. Extracted the 10,000 event tail policy into `retainSubagentEventsTail` with `SUBAGENT_EVENTS_TAIL_LIMIT`.
- Made cursor event kinds compile-time exhaustive, narrowed parsed kinds with a guard, changed `historyCursor` to accept only identity fields, and removed the cursor and fallback event casts. Replaced unchecked path casts with guarded access.
- Oversized lifecycle events now produce a valid `text_delta` notice with the same id, message id, timestamp, and routing fields. The page cursor still comes from the original source event, preserving v1 token behavior.
- The handler rejects a nonterminal page whose cursor repeats the request with `HISTORY_CURSOR_STALE`. The frontend stops paging, sets `history = 'error'`, stores the reason, and logs it.
- Added specs for typed validation, untyped error classification, tail boundaries, oversized lifecycle placeholders, and repeated cursors at both the RPC and store boundaries.

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\lib\session-history-reader.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\agent-sdk\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-history-page.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-history-page.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.handlers.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\backend\rpc-handlers\src\lib\handlers\subagent-rpc.handlers.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\subagent-execution.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat-streaming\src\lib\subagent-execution.store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-B-backend-style-fix.md`

## Evidence and risks

- M1/m-B: reader validation throws the exported subclass; handler uses `instanceof`. Correlated invalid IDs are wrapped as read failures because they did not come from caller input.
- M2/m-E: `Record<FlatStreamEventUnion['eventType'], true>` requires every event kind. A guard validates unknown cursor payloads; canonical v1 encoding remains unchanged.
- M3: tail selection is pure and shared by the reader and spec; the named cap is 10,000.
- m-A: the fallback emits a valid union member with required `blockIndex`, retaining identity and routing; specs include agent, progress, background agent, compaction, and turn state events.
- m-C: duplicate event identities cannot produce an endlessly repeated cursor; both backend and frontend guards have regression specs.
- Ptah AST analysis reported clean syntax for the edited production files and page spec. Scoped `ptah_get_diagnostics` was invoked after edits but timed out at 45 seconds on three attempts and returned no TypeScript result. No test, typecheck, lint, build, serve, e2e, or package command was run per lane rule.

## Decisions

- **Invalid correlated agent id:** classify as persistence failure; options were INVALID_PARAMS or persistence failure. Evidence: the id comes from replay correlation, not request parameters. Reversible.
- **Oversized non-content event:** emit a minimal valid text delta notice with the original event id; options were retaining every event kind with its required fields or a valid accumulator-accepted placeholder. The latter bounds the payload even when an event has large nonstring content and avoids a malformed union member. Reversible.

## Deferred

- Test and TypeScript execution: team-leader-owned by the batch rules. Diagnostics was unavailable after its 45-second timeout.
- Per-page reread, very long running agent stale cursors, and tool input shape clipping: existing known limits outside this fix scope.
