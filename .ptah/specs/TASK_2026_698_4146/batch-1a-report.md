# Batch 1a report — TASK_2026_698_4146

## Files changed

| File | Change |
| --- | --- |
| `libs/shared/src/lib/types/rpc/rpc-session.types.ts` | Added optional `SessionStatsEntry.cache` wire metadata. |
| `libs/shared/src/lib/types/messages/session-stats-live.ts` | Exported `parseSessionStatsCache`; live parsing drops malformed cache independently of the stats snapshot. Existing message and snapshot identity remains intact for valid or absent cache. |
| `libs/shared/src/lib/types/messages/session-stats-live.spec.ts` | Covered valid 1h/5m metadata, old payloads, and malformed cache isolation. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.types.ts` | Added cache evidence fields to the request snapshot and a native-route signal field. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-request-tracker.ts` | Captured cache evidence and the existing start anchor for the last real main request; mixed writes use 5m, ambiguous writes retain unknown TTL, and synthetic assistant frames do not replace the cache candidate. Idle TTL classification is unchanged. |
| `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-request-tracker.spec.ts` | Covered last request, read, mixed and ambiguous writes, synthetic assistant, subagent exclusion, and no-request behavior. |
| `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts` | Added fenced cache TTL/estimate/idle deadline APIs, immutable snapshot projection, revision updates only for visible changes, and watcher notification. |
| `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.spec.ts` | Covered retained TTL, no-op revisions, watcher calls, stale/replaced runs, rekey, pending prefix read, and release snapshot. |
| `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts` | Verified live-owner resume retains cache and transcript-only history has none. |

## Verification

- `nx test @ptah-extension/shared`: 117 suites passed; 3,666 tests passed.
- `nx test @ptah-extension/agent-sdk`: 171 suites passed, 2 skipped; 3,630 tests passed, 3 skipped.
- `nx typecheck @ptah-extension/shared` and `nx typecheck @ptah-extension/agent-sdk`: passed.
- Final scoped `ptah_get_diagnostics`: 0 errors, 0 warnings.
- Initial full-suite runs each caught an issue in a new test expectation or fixture; both were corrected and the full suites passed on the final runs.

## Decisions

- **Optional request cache fields and native-route signal.** Options were required fields with edits to unrelated tests/callers, or optional fields until Batch 1b wiring. Existing idle specs construct minimal request snapshots and Batch 1b adds the route signal, so optional fields preserve compilation within this batch. Reversible when those consumers are updated.
- **Optional `OwnerWatcher.onCacheChanged`.** Options were a required member plus an out-of-scope publisher edit, or an optional callback. The approved Round 2 review explicitly selected the optional form so agent-sdk compiles before Batch 1c. Reversible in Batch 1c.
- **Retained TTL is separate from visible cache.** The approved owner write contract requires preserving confirmed TTL through a request with no visible estimate and touching revisions only when the wire projection changes. Reversible in owner state without a wire migration.

## Not done

Batch 1b idle projection/route wiring, Batch 1c publisher/lifecycle wiring, and Batch 2 frontend presentation are assigned to later lanes. No files outside Batch 1a ownership were changed.
