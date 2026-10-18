# Batch 1b report — TASK_2026_698_4146

## Files changed

- `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/idle-compaction.service.spec.ts`
- `libs/backend/agent-sdk/src/lib/di/register.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`

## Behavior

The idle service now projects cache expiry from the last real request's Batch 1a evidence into the fenced stats owner. Confirmed 1h and 5m writes set the estimate and retained TTL. A read refreshes the estimate only with a retained TTL. An ambiguous write clears both; a request without cache evidence clears the estimate while retaining TTL. Proxy or unknown routes clear the projection and retained TTL. The expiry uses the existing request cache anchor plus 3,600,000 or 300,000 ms and requires a finite non-negative anchor and safe expiry.

Every idle reducer step publishes the pending attempt's `fireAt` or clears it. Release clears the pending time synchronously, including group finalization, while retaining the expiry estimate. Owner write methods fence stale run tokens. Optional projection errors are logged without interrupting idle state or the query stream.

The executor passes native-route evidence on session bind and exposes an idempotent `beforeLiveStatsDispose` release callback through `ExecuteQueryResult`; the abort and `onStreamEnd` release paths remain.

## Verification

- `nx typecheck @ptah-extension/agent-sdk --parallel=1`: passed.
- Changed Jest specs with `--coverage=false --maxWorkers=2`: 2 suites, 72 tests passed. Initial test setup lacked `reflect-metadata` and one expected idle anchor incorrectly used the cache anchor; both were corrected before the passing run.
- `nx test @ptah-extension/agent-sdk --parallel=1 --coverage=false --maxWorkers=2`: passed.
- `nx lint @ptah-extension/agent-sdk --parallel=1`: passed with 0 errors and 77 warnings. The edited idle service has 555 nonblank lines, below the 700 line warning limit.
- Scoped `ptah_get_diagnostics` after the final edits: 0 errors, 0 warnings.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Extend the local idle tap type with an optional fourth route argument, leaving the shared interface untouched. | Edit `idle-compaction.types.ts`; use a local structural extension. | Batch 1a already added `nativeAnthropic` to the signal, while Batch 1b scope excludes the types file. Existing three-argument producers remain compatible. | Yes. |
| Pass the owner as the final optional idle-service constructor argument. | Reorder constructor parameters; append owner. | Existing tests construct the service positionally; appending preserves those calls and DI optional-service isolation. | Yes. |
| Use the reducer's pending `fireAt` and the separate request cache anchor for expiry. | Recompute fire time from cache expiry; use existing reducer state. | The approved plan requires the exact pending attempt time and existing request-start cache anchor. | Yes. |

## Not done

Batch 1c must carry `beforeLiveStatsDispose` through the adapter and invoke it from `StreamTransformer`; this batch only provides the typed callback. Batch 2 frontend changes are outside this assignment. No git operation that changes the working tree was performed.
