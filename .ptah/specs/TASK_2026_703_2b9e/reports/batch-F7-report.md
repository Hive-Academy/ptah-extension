# Batch F7 report - remove the dead `agent:summary-chunk` path

Scope change from the user (via the coordinator): remove the path completely. Nothing replaces it;
sub-agent text reaches the UI as forwarded sub-agent messages (`forwardSubagentText`).

## Files changed

Message type and transport
- `libs/shared/src/lib/types/messages/message-constants.ts` - `AGENT_SUMMARY_CHUNK` removed.
- `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts` - `'agent:summary-chunk'` removed.
- `libs/frontend/core/src/lib/services/message-router.service.ts` - dropped from
  `SIGNAL_ONLY_STREAM_TYPES` (doc comment updated).
- `apps/ptah-electron/src/ipc/ipc-bridge.ts` - dropped from `BATCHABLE_STREAM_TYPES`.
- `apps/ptah-electron/src/ipc/ipc-bridge.batching.spec.ts` - batchable list updated; the dispose
  case now uses `CHAT_THINKING`.
- `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts` - subscription, `case`,
  handler and doc line removed.
- `libs/frontend/chat/src/lib/services/chat.store.ts` - `handleAgentSummaryChunk` removed.
- `libs/frontend/chat/src/lib/services/chat-store/chat-lifecycle.service.ts` (+ spec) -
  `handleAgentSummaryChunk`, `appendAgentSummary`, the now-unused `BatchedUpdateService` injection
  removed; spec loses the summary describe and its rAF plumbing.

Accumulator state and its readers (only the summary chunk ever wrote them)
- `libs/frontend/chat-types/src/lib/chat-types.ts` - `StreamingState.agentSummaryAccumulators`,
  `agentContentBlocksMap`, `AgentContentBlock`, their init and eviction cleanup removed.
- `libs/frontend/chat-execution-tree/src/lib/builders/agent-node.fn.ts`, `tool-node.fn.ts`,
  `builder-deps.ts`, `src/index.ts` (+ `builders.spec.ts`) - summary/content-block children and the
  now-unused `buildInterleavedChildren` removed.
- `libs/frontend/chat-streaming/src/lib/execution-tree-cache.ts` - `foldAgentContent`,
  `agentOwnerToolCalls`, `TOOL_USE_ID_PREFIX`, `TreeDigests.unattributedAgentContent`, and the
  accumulator terms of `agentMemoKey` removed (signature now `(build, toolCallId, depth)`).
- `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts` (+ spec) - deps entry,
  epoch input and `summaryContent` fingerprint term removed; the summary-chunk invalidation cases and
  the `summaryContent` fingerprint case removed.
- `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts`,
  `chat/src/lib/services/chat-store/session-history-replayer.service.ts` - map copies removed.
- `libs/frontend/chat-streaming/src/lib/session-manager.service.ts` - the never-called
  `bufferAgentChunk` buffer removed; `registerAgent` returns `void`.
  `accumulator-core.service.ts` - the pending-delta re-register removed.
- `execution-tree-retention.ts` - doc comment updated.
- Spec state literals updated: `batched-update`, `event-deduplication`,
  `message-finalization{,.retention,.session-history}`, `permission-handler`,
  `streaming-event-cascade-clean` (case for the removed maps and its helper deleted),
  `session-history-replayer`.

`ExecutionNode.summaryContent` (written only from the accumulator / pending deltas)
- `libs/shared/src/lib/types/execution/node.ts`, `schemas.ts` - field removed from the node type and
  `ExecutionNodeSchema`.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts` (+ spec, three
  fixtures now use `content`), `chat/.../execution/subagent-tile.component.ts`,
  `chat/.../transcript/transcript-agent-facts.spec.ts` - readers removed.

e2e
- `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts` - emitter, constant and the
  two pushes removed; header rewritten to the `agent_progress` path. Not run (no e2e).

## Left in place (report, not removed)

- `AgentInfo.summaryContent` / `hasSummary` (`libs/shared/src/lib/types/execution/agent.ts`,
  `AgentInfoSchema`) and their only reader `AgentExecutionComponent` (`ptah-agent-execution`). No code
  sets `AgentInfo` and no template renders `ptah-agent-execution`; it is a dead exported component,
  not part of the summary-chunk transport. Removing it is a separate cleanup.
- A stale 3-line template comment in `inline-agent-bubble.component.ts:443` mentions
  `summaryContent`. Not edited: the parallel task owns that file.
- `AgentSessionWatcherService`: no class exists in this tree; only doc comments mention it
  (`subagent-hook-handler.ts:23`, `apps/ptah-electron/src/ipc/webview-manager-adapter.ts:7`).
- `host-source-registry.baseline.ts` says "Any change to this baseline requires a Gate 2 exception in
  TASK_2026_610". The entry was removed as instructed; the guard spec ignores it either way
  (`agent:summary-chunk` does not match the host-source name pattern).
- Old persisted trees that carried `summaryContent` no longer show it (field dropped from the type;
  the zod object schema strips it). No current producer writes it.

## Checks (one at a time)

- `npx nx typecheck` PASS: `@ptah-extension/shared`, `core`, `chat-types`, `chat-execution-tree`,
  `chat-streaming`, `chat-ui`, `chat`, `canvas`, `ptah-electron`, `ptah-electron-e2e`.
- `npx nx test --parallel=1` PASS: shared (119 suites / 3675), core (42 / 1285), chat-execution-tree
  (3 / 30), chat-streaming (28 / 684, 1 skipped), chat-ui (83 / 1471), chat (253 / 4479, 2 skipped).
  `chat-types` has no test target.
- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/ipc/ipc-bridge.batching.spec.ts
  --coverage=false --maxWorkers=2`: PASS (9 tests).
- `npx nx lint` 0 errors: shared, core, chat-types, chat-execution-tree, chat-streaming (one new
  unused-helper warning fixed), chat-ui, chat, ptah-electron, ptah-electron-e2e.

## Note on formatting

All changed files were run through prettier (lint-staged would do the same at commit). Several were
not prettier-clean on `main` (e.g. `session-history-replayer.service.ts`, `agent-card.component.ts`),
so the diff carries formatting-only hunks beyond the edits above.
