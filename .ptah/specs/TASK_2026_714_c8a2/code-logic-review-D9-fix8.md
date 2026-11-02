# Code Logic Review — TASK_2026_714_c8a2 / D9 fix8

Scope: D9 files only (`libs/backend/codex-runtime/**` ignored). Static read; no tests, lint, typecheck, build or git writes were run.

| Metric | Value |
| --- | --- |
| Score | 8/10 |
| Verdict | APPROVE (non-blocking notes below) |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 3 |

## fix7 findings

| Finding | Status | Evidence |
| --- | --- | --- |
| S-new sliding TTL stale forever | FIXED | `subagent-rpc.handlers.ts` `nativeEvents`: a hit re-inserts the same `cached` object (LRU touch only) and `expiresAt` is set once, at read completion, to now+15 s. A hot lane can no longer extend the snapshot. |
| Recovery after stale | FIXED | The cache entry is deleted on a missing `agent_start` or empty child events (`readNativeChild`), on a non-ok native page, on a cursor-anchor miss, and on a non-advancing cursor (`~L545-580`). A client retry re-reads. |
| Failed read / race | OK | A rejection skips `.then`, so nothing is cached; `finally` clears the in-flight entry. An invalidation during an in-flight read cannot be undone by a stale write, because that read started after the last cache miss. |
| N1 mismatched gates | FIXED (see M-a) | The replayer gate (`~L364-376`) is `providerId === 'openai-codex' || hasNativeCodexAgent`. The marker requires `source === 'history'`, an id starting with `[`, and an id ending in `,"agent_start","item/(started\|completed)",N]`. This matches the projector (`codex-history-projector.ts:224-229`: `JSON.stringify([thread, turn, item, eventType, method, index])`, with `source:'history'` on `agent_start`). Claude event ids are not JSON arrays, so Claude replay stays ungated and untouched. |
| N2 partial state blocks recovery | FIXED | `restoreHistoryChild` now replaces `finalized`, merges against any partial state, and refuses only for a non-terminal monitor record, `history==='loading'`, or live-with-events and no record. |
| Idempotency | OK | `restoredEventIds` (`subagent-execution.store.ts:110,225,427,446`): the same event set returns `false`. A larger set on a later replay re-merges, and `mergeSubagentHistory` builds a fresh state, so duplicates are not appended. The replayer never rewrites an existing monitor record and skips non-terminal ones. |

## Moderate (non-blocking)

- M-a. Marker coupling: the frontend gate depends on a string format owned by the backend projector (`/,"agent_start","item\/(?:started|completed)",\d+\]$/`). If the projector's event id format or method set changes (for example another item phase), the fallback gate silently stops matching. The `providerId` path still covers the normal case. Share the format via a helper or constant in `libs/shared`, or have the projector set an explicit flag.
- M-b. `entry.finalized = []` plus a merge replaces a tree that live streaming already built for a terminal child (for example a Codex session that finished a child live and then is resumed again within the app run). If the live message ids differ from the projected history ids, the merger's dedupe-by-messageId cannot match them and, with a non-null `entry.state`, content could duplicate. The spec uses identical ids, so this case is not demonstrated. I found no evidence it occurs for a finalized entry (state is moved into `finalized` on finalize), so I rate it a risk, not a defect.
- M-c. The 15 s snapshot window means that a live running child's lane can show events up to 15 s late. A cursor that falls off the end triggers invalidation and `HISTORY_CURSOR_STALE`, so the client self-heals, but a running Codex child viewed in its lane may flicker through one stale-cursor restart per refresh. Acceptable.

## Specs
- Backend: absolute expiry despite hits, LRU eviction, in-flight deduplication, stale-cursor and missing-child invalidation are now asserted (`subagent-rpc.handlers.spec.ts:357-444`), plus the earlier Claude-negative, unbound-reader and failure cases. Fake-timer use should be checked in CI.
- Replayer: projector-shaped marker, missing-provider Codex, and Claude-negative fixtures (`session-history-replayer.service.spec.ts:177-241`). The stores are still mocks, so the real restore is proved only by the execution-store spec.
- Execution store: partial-state merge with event-id dedupe and finalized replacement (`subagent-execution.store.spec.ts:143-184`) — the builder is mocked, so tree equality is weak evidence.

## Claude-session behaviour
Unchanged: backend returns `null` for non-Codex metadata before any native read, and the compaction default is untouched. The frontend recovery does not run without the provider or marker. Query forwarding of `sessionId` costs one metadata get on a registry miss.

## Verdict
APPROVE, 8/10. All fix7 findings are addressed. Treat M-a and M-b as follow-ups; no blocker.
