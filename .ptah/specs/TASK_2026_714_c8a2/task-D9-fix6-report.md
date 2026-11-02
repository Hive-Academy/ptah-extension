# D9 fix 6: completed Codex child on resume

## Root cause and evidence

The read-only protocol probe launched the pinned native `codex app-server` with `experimentalApi: true` and made only `initialize`, `thread/list`, `thread/read`, and `thread/turns/list` calls. The probe script is outside the repository in the system temp directory. The descendant listing returned one child with `source.subAgent.thread_spawn.parent_thread_id`, `depth`, `agent_path`, `agent_nickname`, and `agent_role`; the child also had top-level `parentThreadId` and `sessionId`. The listing's `turns` array was empty with `historyMode: paginated`, while `thread/read(includeTurns: true)` returned one turn with `userMessage` and `agentMessage`. The parent turn's collaboration items named the child in `receiverThreadIds`. No turn was started and no paid call was made. This report records field names and counts only.

Ptah's descendant lookup already supplies `ancestorThreadId` (`libs/backend/codex-runtime/src/lib/codex-session-history.ts:192`). The local projection produced 24 events, including one `agent_start`, child message events keyed by the spawn tool ID, and a parent `tool_result` containing the final child output (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-history-projector.ts:53-148`). The live re-check log likewise recorded 24 resume events without warnings. Thus native discovery and backend history projection did not lose the child.

The completed child is intentionally omitted from the resumable registry (`libs/backend/vscode-core/src/services/subagent-registry/subagent-history-registrar.ts:128-134`), so the former `chat:subagent-query` tool-ID branch returned an empty list (`libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts:212-231`). The former `subagent:history-page` path called `SessionHistoryReaderService.readSubagentEvents`, which reads Claude JSONL files, not Codex threads (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:175-279`). These are deterministic reasons the resumed native lane could not load. The lane requires an agent monitor record (`libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts:51-65`), and the agents panel also reads that monitor. The inline card reads the child execution tree (`libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts:999-1029`). The resume replay previously had no check to restore either child store from the projected events when their normal stream routing did not retain them (`libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:344-375`). The live evidence shows those stores absent after resume; the exact earlier event-handler decision that led to that state was not instrumented in the evidence.

## Changes

- `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts:131-167,212-227,483-490`: read a completed native child from the existing Codex-aware resume history. `chat:subagent-query` now returns its completed record when the resumable registry has none, and `subagent:history-page` pages its child events. Warn when a native child is missing from history. Non-Codex sessions continue through the existing reader.
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:363-402`: after replay, detect a completed child from `agent_start`, child events, and the parent tool result. Restore a missing monitor record and child execution tree; warn at each recovery point.
- `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts:414-435`: add idempotent restoration of a completed child's event history into its execution tree.
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:2576-2581`: include the known parent session ID in the child query so the backend can select native history.

## Synthetic specs added

- `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.spec.ts:342,642`: native child history-page returns the synthetic child transcript; a completed child absent from the registry is queryable by tool ID and session ID.
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts:180`: replay restores the monitor entry and supplies the child's synthetic answer events to execution restoration.
- `libs/frontend/chat-streaming/src/lib/subagent-execution.store.spec.ts:121`: restoration creates a card tree, keeps the child ID, and is idempotent.

## Verification and limits

The protocol probe and source trace were completed. The requested test, typecheck, lint, Nx, build, serve, and git commands were not run because the task explicitly forbids them. `ptah_get_diagnostics` was requested twice on changed files; both requests returned `unavailable` because the TypeScript check exceeded its 45-second tool window, so no compiler result is claimed. No new UI rendering or screenshot was possible under the prohibition on starting/building the app; the existing live re-check report and screenshots were the visual reference for the missing output, lane, and agents panel. The `angular-frontend-patterns` skill could not be discovered in this workspace; its stated standalone/OnPush/signals constraints were followed for these service/store edits.

## Full changed-file list

1. `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts`
2. `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.spec.ts`
3. `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts`
4. `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts`
5. `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts`
6. `libs/frontend/chat-streaming/src/lib/subagent-execution.store.spec.ts`
7. `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`
8. `.ptah/specs/TASK_2026_714_c8a2/task-D9-fix6-report.md`

The read-only probe script was written in the system temp directory, outside the repository.
