# Batch 1c report — TASK_2026_698_4146

## Files changed

- `libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.ts`: subscribed to owner cache changes; retained dirty cache revisions through throttling, result settling, owner release, and stream disposal; recorded only result revisions whose callback returned successfully.
- `libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.spec.ts`: covered idle cache publication, deferred settling, result revision deduplication, disposal, and callback failure.
- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`: recorded published result revisions and ran the guarded synchronous release callback immediately before live publisher disposal.
- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.live-stats.spec.ts`: covered cache changes during result callback, skipped empty and duplicate result callbacks, and the final idle clear before watcher detach.
- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts`: covered pre-dispose callback order and throw isolation on normal, error, and abort teardown.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`: carried `beforeLiveStatsDispose` through `StreamTap` for new, resumed, reused, and slash-command streams.
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts`: verified forwarding on each path and retention of `onStreamEnd`.

## Behaviour

Cache-only owner revisions now reach `session:stats-live` while a stream is idle. Changes raised during `settling` are deferred until every result exit. A successfully published result revision suppresses an extra cache-only live payload, while a skipped or throwing result callback does not. The pre-dispose tap release clears `idleCompactAt` while the watcher is attached, so disposal can publish the final cache snapshot. Existing provisional context and footer handling remain intact.

## Verification

- `nx typecheck @ptah-extension/agent-sdk --parallel=1`: passed after final edits.
- Changed Jest specs: 4 suites, 279 tests passed before the final two integration cases; the affected live-stats spec then passed with 23 tests.
- `nx test @ptah-extension/agent-sdk --parallel=1 --coverage=false --maxWorkers=2`: passed after final edits.
- `nx lint @ptah-extension/agent-sdk --parallel=1`: passed with 0 errors and 77 warnings, matching the Batch 1b baseline.
- Scoped `ptah_get_diagnostics` after final edits: 0 errors, 0 warnings.

The first changed-spec run found an existing release expectation: a shown provisional estimate still needs its authoritative follow-up when the live callback throws. That behaviour was restored before the passing runs.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep `OwnerWatcher.onCacheChanged` optional. | Require it in the owner interface; implement the existing optional hook in the publisher. | Batch 1a already provided the optional hook, and the approved plan allows it to remain optional. | Yes. |
| Track the latest successfully delivered result snapshot revision in the publisher. | Infer delivery from owner state; explicitly call `noteResultPublished` after the result callback returns. | The transformer skips callbacks for duplicate and empty results, and callbacks can throw. Owner revision alone cannot prove delivery. | Yes. |
| Preserve the shown-estimate authoritative follow-up after a failing live callback. | Suppress it after callback failure; keep the established settle contract. | The existing owner-release regression test requires the follow-up, and the initial changed-spec run exposed the regression. | Yes. |

## Not done

No files outside Batch 1c ownership were changed. No git state-changing operation was performed.
