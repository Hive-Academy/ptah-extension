# D9 fix 7: review follow-up

## Findings and changes

1. **S1 — Claude replay could recreate dismissed or settled agents.** `session-history-replayer.service.ts:364-411` now runs completed-child recovery only when the resumed tab's provider is `openai-codex`. `session-loader.service.ts:1082-1086` sets that provider from the resume response before replay. Existing monitor records are never rewritten; running records are skipped. The event lookup is indexed in one pass. Recovery logs use debug. Synthetic Claude and running-record cases are at `session-history-replayer.service.spec.ts:222-240`.
2. **S2 — Every child query/page reread native history.** `subagent-rpc.handlers.ts:102-167` now keeps at most eight parent-session snapshots for a sliding two-minute TTL and shares concurrent reads. Failed reads are not cached. Pages derive from the same cached event snapshot during active paging; expiry or LRU eviction refreshes it. The repeated-page assertion is at `subagent-rpc.handlers.spec.ts:382-389`.
3. **S3 — Compaction could hide a child.** `chat-history-read.service.ts:102-116` adds `includeCompactedEvents` for child lookup, leaving ordinary resume behavior unchanged. `subagent-rpc.handlers.ts:151-154` uses that option and `:208-211` warns with a reason when the child still cannot be found. The full-history option is asserted at `chat-history-read.service.spec.ts:99-109` and the handler option at `subagent-rpc.handlers.spec.ts:382-384`. The native Codex router currently ignores the compaction option, but this also covers the legacy reader if routing changes.
4. **M1/M2 — Missing native reader and read failures looked empty.** `subagent-rpc.handlers.ts:193-198` warns once if the optional native reader is unbound. The existing `chat:subagent-query` catch at `:313-322` logs a real `Error` and returns an empty result; its native failure behavior is now asserted at `subagent-rpc.handlers.spec.ts:686-702`. The history-page catch at `:588-591` now passes a real `Error` to the logger. The missing-reader case is at `subagent-rpc.handlers.spec.ts:402-415`.
5. **M4/M5 — Replay scan cost and partial live child overwrite.** `session-history-replayer.service.ts:370-381` indexes children and results once. `subagent-execution.store.ts:420-438` refuses recovery over a partial live state, a loading history, or a finalized tree, and no longer clears `finalized`. The running-child case is at `subagent-execution.store.spec.ts:142-151`. Nested grandchildren remain outside this direct-child recovery path.
6. **Missing coverage for query ownership.** `agent-monitor.store.spec.ts:87-99` asserts that `loadSubagentCacheInfo` forwards the child record's parent session ID. Claude history remains on its legacy reader, asserted at `subagent-rpc.handlers.spec.ts:392-400` and `:675-685`.

## Verification and limits

I inspected the edited source and the existing `SessionId.safeParse` contract, which returns a branded ID or `null`. I did not run npm, Nx, Jest, lint, typecheck, build, verify, or git commands, per the task rules. Compilation, spec execution, and rendered UI behavior remain unverified. The two-minute cache is intended to cover ordinary paging; a long pause or eviction can refresh the snapshot, in which case the existing stale-cursor response may still apply.

## Changed files

- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts`
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts`
- `libs/frontend/chat-streaming/src/lib/subagent-execution.store.ts`
- `libs/frontend/chat-streaming/src/lib/subagent-execution.store.spec.ts`
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.ts`
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-history-read.service.spec.ts`
- `.ptah/specs/TASK_2026_714_c8a2/task-D9-fix7-report.md`

The `angular-frontend-patterns` skill was not available in the discovered skill inventory. The project guidance for Angular services and signals was followed.
