# Code Logic Review — TASK_2026_714_c8a2 / D9 fix6

Scope: the 7 changed files named in the request (static read only, no tests/lint/typecheck run).

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Serious | 3 |
| Moderate | 5 |

Core flow is sound: the Codex gate (`codexExecution.runtime === 'codex-app-server'`) keeps the backend change inert for Claude, params still go through the existing Zod schemas (`SubagentQuerySchema.parse`, `SubagentHistoryPageSchema.safeParse`), and the frontend restore is guarded by `monitor.subagents().has(key)` and `treeFor(key).length > 0`, so a double replay is idempotent. The problems are the ungated frontend restore, the per-call full-history re-read, and specs that only assert mocks.

## Serious

### S1. Frontend restore is not Codex-gated; it can alter Claude sessions
`session-history-replayer.service.ts` (new loop, after the chunk loop, ~L364-402). It runs for every session and keys only on `agent_start` + children + `tool_result`. The goal says Claude must behave exactly as before.
- If a Claude history ever inlines child events (`parentToolUseId === toolCallId`), a record that the user dismissed or cleared from the agents panel, or that the monitor deliberately dropped, is re-created via `onAgentStart` + `onTaskToolResult`. The `has(key)` guard cannot distinguish "never routed" from "intentionally removed".
- It also overwrites the history-settled state: `onTaskToolResult` sets `settledFromHistory:false`, and `onAgentStart` passes `settledFromHistory:false`.
- The `logger.warn` fires on every legitimate restore, which is noisy.
- Fix: gate on a Codex signal (session/provider flag or `start.source`), or at least on the monitor's own "removed" memory. Add a Claude negative spec.

### S2. Full native history is re-read and re-parsed on every call
`subagent-rpc.handlers.ts` `readNativeChild` (~L131-166) calls `nativeHistory.readForResume` each time. It is invoked once per `subagent:history-page` page and, via `AgentMonitorStore.loadSubagentCacheInfo` (`agent-monitor.store.ts:2577`), once per agent card. N cards × M pages means N+M full-session reads and parses of a large Codex transcript. Nothing is cached.
- Impact: UI stalls on resume of a session with many children.
- Cursor stability depends on every page re-deriving the same list. A live append between pages shifts the tail retention in `retainSubagentEventsTail`, producing `HISTORY_CURSOR_STALE` (`~L505`).
- Fix: short-TTL per-(sessionId) memo, or have the card query reuse the page result.

### S3. `readForResume` is called with `checkCompactionBoundary: true`
`chat-history-read.service.ts:103-115`. The history is truncated at the compaction boundary, so child events before the boundary are missing. The lane then answers `not-found`, with no logged reason, for an agent that exists. It is a silent wrong answer.
- Fix: read the whole event list (`readSessionEvents`, as `readPage` does) or document and test the boundary case.

## Moderate

- M1. `nativeHistory` is injected with `isOptional: true` (`subagent-rpc.handlers.ts:127`). If the token is unbound on a host, a Codex child silently degrades to `{events: [], agentId: null}` plus one `warn` (`~L141`). The caller then returns `not-found`/an empty list as if the child had no output. `CHAT_TOKENS.HISTORY_READ` is registered in `chat/di.ts:96`, so `isOptional` is only masking a wiring error. Make it required, or throw `PERSISTENCE_UNAVAILABLE`.
- M2. In `chat:subagent-query`, errors from `readNativeChild` (e.g. `readForResume` failing) fall into the outer catch and return `{subagents: []}` (existing pattern), so a Codex read failure looks like "no agent". The history-page path correctly maps it to a coded error.
- M3. In history-page, when metadata says Codex but `SessionId.safeParse` fails or the child is not found, the handler returns an empty `not-found` page and never falls back to `historyReader`. That is acceptable for Codex but untested. The `read` object spreads `native` including `start`, which `assembleHistoryPage` ignores; harmless.
- M4. Replayer loop complexity: for each `agent_start` it runs `events.filter` and `events.find` over the whole event array, O(agents × events), on the main thread after a chunked replay that deliberately yields. Pre-index by `parentToolUseId`/`toolCallId` in one pass. Only direct children are restored; a nested grandchild (`parentToolUseId` of an inner tool call) is dropped.
- M5. `restoreHistoryChild` (`subagent-execution.store.ts` ~L413-434): `open()` followed by `entry.finalized = []` resets an existing entry that may hold partial live state, and `treeFor>0` is the only protection. A live-streaming child with zero built nodes yet gets overwritten and then finalized as complete. Also returns `true` only on tree>0, so a failed merge leaves a finalized empty entry behind.

## Specs: do they assert the behaviour?

- Replayer spec: monitor and execution stores are plain jest mocks (`subagents: () => new Map()`, `restoreHistoryChild: () => true`). The test proves the loop calls the mocks, not that a monitor record or a child tree results. Missing cases: record already present (idempotency / replay twice), no `tool_result` (running child), no children, Claude session, `isError` true.
- Backend spec: query test has no `tool_result`/terminal event, so "completed" is asserted from nothing but the presence of an event; no Claude (metadata null) regression test that `readForResume` is not called; no test for dismissed registry record; no test of `agentId` mismatch or missing nativeHistory.
- Execution store spec: covers the happy path and the second-call `false`, but uses a mocked builder (`buildTree.mockReturnValueOnce`), so tree content is a fabricated return.
- `agent-monitor.store.ts` change (sessionId forwarded) has no spec.

## Five questions (short)
1. Silent failure: S3, M1, M2 (missing child and read failure both look like "empty").
2. Unexpected user action: dismissing an agent then reloading the Claude session can resurrect it (S1).
3. Wrong answer: compaction-truncated history yields `not-found` (S3); a toolCallId reused across sessions is matched in the monitor by key alone.
4. Dependency failure: unbound HISTORY_READ (M1), read failure in query (M2).
5. Missing: provider gating on the frontend, history caching, Claude negative tests.

## Verdict
REVISE, 6/10. No data-loss or security blocker; params are Zod-validated and the Claude backend path is gated. Fix S1 (gate the frontend restore) and add real idempotency and Claude-negative specs before merge; S2/S3 should follow.
