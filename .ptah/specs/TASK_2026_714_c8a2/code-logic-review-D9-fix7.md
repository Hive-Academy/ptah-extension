# Code Logic Review — TASK_2026_714_c8a2 / D9 fix7 (re-review of fix6 findings)

Static read only; no tests, lint, typecheck, build or git writes.

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | REVISE (one serious cache-staleness defect; otherwise close to APPROVE) |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 3 |

## Prior findings

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 frontend restore ungated | FIXED, with a caveat (N1) | `session-history-replayer.service.ts:364-411` is gated on `tab.providerId === 'openai-codex'`. Existing non-terminal records are skipped, terminal records are not rewritten, and logs are debug. Claude replay is unchanged. |
| S2 full re-read per call | FIXED but introduces staleness (S-new) | `subagent-rpc.handlers.ts:102-167`, per-session cache, 8 entries, in-flight dedupe. Failed reads are not cached: the rejection skips `.then`, and `finally` clears the in-flight entry. |
| S3 compaction hides children | FIXED | `chat-history-read.service.ts:105-114` adds `includeCompactedEvents`; default behaviour is unchanged (`checkCompactionBoundary: !undefined` is `true`). The handler passes `true`. |
| M1 unbound reader | FIXED (warn once) | Still `isOptional`, but it logs once. Per-process flag, so later sessions fail silently. Acceptable. |
| M2 query swallow | Pattern kept; the log is now a real Error. Acceptable. |
| M4 quadratic scan | FIXED (single-pass index) | Replayer `~L371-381`. Direct children only, which is documented. |
| M5 overwrite of live child | FIXED | `restoreHistoryChild` refuses if `state !== null`, `finalized.length > 0`, `history === 'loading'`, or live with events. It no longer resets `finalized`. |
| Missing specs | MOSTLY FIXED | Claude-negative, running-record, unbound and failure cases now exist. Cache TTL, eviction and staleness are not tested. |

## Serious

### S-new. The sliding-TTL cache serves a stale snapshot indefinitely to an active Codex session
`subagent-rpc.handlers.ts:~148-155`. On every hit the entry is re-inserted with `expiresAt = now + 120s`. That is a sliding window with no absolute cap.
- Scenario: a Codex session is live and the user opens a child lane, or the agents panel polls `loadSubagentCacheInfo` (`agent-monitor.store.ts:2577`) more than once every 2 minutes. The snapshot never refreshes, so later child events and newly spawned children are invisible. The lane stays on a partial transcript, and a new child returns `not-found`, until a 2 minute idle gap.
- Cursor recovery is blocked too. `HISTORY_CURSOR_STALE` tells the client to restart from the first page, but the restart hits the same stale snapshot.
- The history-page path does not consult the registry, so a live Codex child's lane goes through this cache. Before fix7 it re-read fresh data, so this is a regression for live sessions.
- Fix: use an absolute max age (for example 10-15 s from the read, not sliding), or drop the entry on a `HISTORY_CURSOR_STALE` or `not-found` result. Alternatively skip the cache when the session is live in the lifecycle and cache only completed or resumed sessions. Add a fake-timer spec for TTL and refresh.

## Moderate

- N1. The backend gates on `codexExecution.runtime === 'codex-app-server'`, but the frontend restore gates on `tab.providerId === 'openai-codex'`. That value comes from `resumeResult.data.providerId` via `setSessionProvider` (`session-loader.service.ts:1082-1086`), which in turn comes from `metadata.providerId` (`chat-session.service.ts:1942`). If native Codex metadata lacks `providerId` (it is optional), the card, panel entry and lane recovery silently do nothing on the frontend. The two gates should be derived from the same signal. I could not confirm that `providerId` is always written for native sessions. `setSessionProvider` also no-ops when the tab's `claudeSessionId` does not yet equal `sessionId`, so a timing mismatch leaves it undefined.
- N2. Replay is idempotent and does not touch Claude sessions. However, `restoreHistoryChild` returns `false` when `existing.state !== null`, even if that state came from the replay's own `processStreamEvent` routing and holds only a partial tree. In that case the replayer skips recovery. This matches the prior design intent, but it means "recovery" depends on routing having not claimed the events. A spec using real stores would show which case actually occurs; the specs still use mocks.
- N3. Cache hit objects share the same `events` array across calls. `readNativeChild` only filters (copies), so there is no mutation today. `retainSubagentEventsTail` receives a fresh filtered array. No bug, but the cache is typed `readonly`, which is good.

## Specs
- Backend: repeated-page call count (1 read), Claude path, unbound reader, query failure. Good. Missing: TTL expiry, LRU eviction, concurrent in-flight dedupe, failed-read not cached, stale-cursor-after-refresh.
- Replayer: Claude synthetic and running-record cases added; the stores are still mocks, so the actual restoration into real stores is not demonstrated (`execution.restoreHistoryChild` can only be proven by the execution-store spec, which uses a mocked builder).
- `agent-monitor.store.spec.ts:87-99` covers forwarding of the parent session ID.

## Claude-session behaviour
No regression found. Backend: Claude metadata returns `null` before any native read, and `readForResume` defaults are unchanged. Frontend: the restore is skipped unless the provider is `openai-codex`. The only added Claude cost is one `metadataStore.get` per `chat:subagent-query` that carries both `toolCallId` and `sessionId` and misses the registry.

## Verdict
REVISE, 7/10. Fix S-new (absolute TTL or invalidation on stale/not-found) and align the two Codex gates (N1). The remaining items are non-blocking.
