## Verdict: REVISE — 5/10

Two serious concurrency/cancellation defects remain after the bounded correction. This is above 3–4 because per-root census writes are now serialized and the obsolete sink wiring is removed; it is below 6 because cancellation can resolve as success and the lifecycle can turn one requested follow-up into two full censuses.

## Round-2 findings

1. **FIXED — SERIOUS: concurrent same-root full censuses.** `indexWorkspace` now joins an existing root slot rather than launching another run (`libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:552-557`); the active run settles before the shared follow-up is launched (`:680-693`, `:712-766`). The per-run kept-path and tombstone state therefore belongs to the one active census, while `beginRun` creates a fresh state for the follow-up (`:821-850`). The focused serialization tests exercise one delayed second call and three shared waiters (`code-symbol-indexer.service.spec.ts:1046-1089`).

2. **FIXED — MINOR: dead `sink` adapter argument.** The adapter takes only the indexer and forwards its locked delete operation (`libs/backend/thoth-runtime/src/lib/workspace-index-lifecycle.ts:135-148`); both hosts construct it without resolving a symbol sink (`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:571-575`, `libs/backend/cli-engine/src/lib/bootstrap/cli-workspace-index.ts:126-133`).

## New findings

1. **SERIOUS — an abort after the follow-up commits resolves as a successful index instead of rejecting that waiter.** `onAbort` returns immediately once `followCommitted` is true (`libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:721-727`). The waiter remains attached to `queued` and resolves with the follow-up stats (`:731-743`), even though its `AbortSignal` has fired. A user cancelling during the follow-up is therefore told the requested index completed; the requirement says an aborted waiter rejects without cancelling the active work. The only abort test aborts before the first run settles (`code-symbol-indexer.service.spec.ts:1091-1118`), so it cannot detect this path.

2. **SERIOUS — a lifecycle follow-up plus an indexer waiter schedules a third census.** While its original `indexWorkspace` promise is outstanding, the lifecycle records `followUp = true` (`libs/backend/thoth-runtime/src/lib/workspace-index-lifecycle.ts:360-365`). Independently, an indexer caller during that same run commits the indexer's shared follow-up (`libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:712-766`). Once the original promise settles, lifecycle `finally` calls `requestFullRun` (`libs/backend/thoth-runtime/src/lib/workspace-index-lifecycle.ts:389-395`); if the indexer follow-up has already begun, that call joins it and makes the indexer queue another follow-up (`code-symbol-indexer.service.ts:552-557`, `:712-766`). Thus one active run plus concurrent lifecycle and indexer requests produces three full scans, violating the requested no-double-queue behavior and extending the stale window. Lifecycle tests cover its local `fullRun` queueing only, not this cross-layer sequence (`workspace-index-lifecycle.spec.ts:415-433`).

3. **MODERATE — conflicting follow-up options are silently selected from the first waiter, including a callback belonging to an aborted caller.** `rememberWaiter` copies all options except `signal` only for the first waiter; later callers can only elevate `userInitiated` (`libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts:786-799`). Consequently the first waiter's `batchSize`, `maxFilesPerRun`, and `onProgress` control the shared census. If that first waiter later aborts while another remains, its `onProgress` callback is still retained and invoked, while the remaining caller's cap/progress choices are ignored. A small first cap can make a later uncapped caller receive statistics from a truncated census without an `IndexingStats` completeness field (`:45-90`, `:1018-1025`). No test covers divergent waiter options or a first waiter that aborts while another remains (`code-symbol-indexer.service.spec.ts:1070-1118`).

## Failure-mode checks

1. **Silent failure:** post-commit cancellation is converted into a success-looking result (finding 1).
2. **Unexpected user action:** a watcher burst while another caller has already queued an indexer follow-up creates a redundant third full scan (finding 2).
3. **Wrong input/result:** different valid caller options select the first waiter's cap and progress handler for every waiter (finding 3).
4. **Dependency failure:** an active-run rejection still permits the separately requested follow-up because the slot settles in `finally` and waiters receive that follow-up's result (`code-symbol-indexer.service.ts:685-693`, `:712-743`); rejected runs clear the active state and slot when no waiter remains (`:685-692`), so no stuck `isIndexing` path was found (`:567-574`).
5. **Unspecified requirement:** the bounded design does not define a safe merge policy for incompatible census options; preserving only the first waiter is not safe for caps or progress ownership (finding 3).

No tests, builds, lint, typecheck, or benchmarks were run, as instructed. Source and changed tests were inspected; orchestrator gate evidence was not yet available.
