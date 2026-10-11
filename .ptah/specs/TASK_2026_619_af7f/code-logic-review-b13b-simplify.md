## Verdict: REVISE — 6/10

The per-root active-census simplification removes the former shared-follow-up and first-waiter option paths, and normal joiner cancellation settles rather than hanging. One serious ownership boundary remains: when the lifecycle joins a census whose starter is later cancelled by a different signal, it classifies that abort as a clean lifecycle stop and leaves the root incomplete without requesting a replacement run. This is above 5 because follow-ups already requested by the lifecycle do run once; it is below 7 because an externally aborted joined census can silently defeat the lifecycle's boot/full-run guarantee.

## Prior findings

1. **FIXED — prior abort-after-follow-up success.** There is no indexer follow-up state or second result to return: an active call joins exactly `active.promise` at `code-symbol-indexer.service.ts:553-558`, while a joiner signal independently rejects at `:714-739`. The only post-start result is therefore the active census's settlement, not a committed trailing census.
2. **FIXED — prior lifecycle plus indexer third census.** The indexer explicitly has no follow-up census (`code-symbol-indexer.service.ts:532-540`); lifecycle alone latches a single `followUp` while `fullRun` exists and starts it after settlement (`workspace-index-lifecycle.ts:360-395`). A lifecycle request that joins another active census cannot make the indexer enqueue another one.
3. **FIXED — prior first-waiter option leakage.** The join branch passes only `options?.signal` (`code-symbol-indexer.service.ts:553-557`), and `joinActiveCensus` has no option storage (`:706-739`). `ensureIndexFresh` starts only `{ userInitiated: false }` (`code-namespace.builder.ts:266-283,307-330`), while lifecycle supplies only its signal (`workspace-index-lifecycle.ts:367-373`), so neither caller can inherit a cap, batch size, progress callback, or truncation setting. A genuine capped starter still exposes `census: 'truncated'` from its own run via `getCoverage` (`code-symbol-indexer.service.ts:637-651`).

## New findings

1. **SERIOUS — a joined lifecycle run can be silently abandoned when a different starter aborts it.** `requestFullRun` records its own controller but may receive a joined active promise (`workspace-index-lifecycle.ts:367-373`). If that active census was started elsewhere with a different signal, its abort rejects every non-aborted joiner; `startCensus` forwards the rejection after marking coverage incomplete and removing the active record (`code-symbol-indexer.service.ts:685-697`). The lifecycle catch treats *any* `AbortError` as a clean stop, even when `controller.signal.aborted` is false (`workspace-index-lifecycle.ts:381-388`), and with no storm `followUp` is false so `finally` starts no replacement (`:389-395`).

   Concrete scenario: a signal-owning caller starts `/ws`; lifecycle starts while it is active and joins it; that other caller aborts; no watcher storm follows. The lifecycle's boot/full census has not completed, coverage remains `incomplete`, and no error/retry makes this distinguishable from lifecycle disposal. Minimal fix: regard an abort as clean only when `disposed` or this lifecycle's `controller.signal.aborted`; for another starter's abort, report it and set a single lifecycle follow-up (or directly request one after this joined promise settles).

2. **MINOR — the specs do not prove the cross-layer cancellation and join ownership cases.** The indexer tests prove a joiner's own signal rejects while an unsignalled starter completes (`code-symbol-indexer.service.spec.ts:1074-1105`), and lifecycle tests use a mock whose release is manually resolved (`workspace-index-lifecycle.spec.ts:243-264`). The namespace skip test directly stubs `isIndexing` to true (`code-namespace.builder.spec.ts:513-530`), so it cannot establish the real interaction with `CodeSymbolIndexer`.

   Missing cases: (a) start a signal-owned real census, have lifecycle join it, abort the starter without a storm, and assert one replacement census/report; (b) repeat with a storm before that abort and assert exactly one replacement, not two; (c) lifecycle-started census joined by namespace, then lifecycle disposal, asserting the namespace background promise is handled and coverage is `incomplete`; (d) an integration-style namespace/lifecycle test using the real active-census implementation to prove `isIndexing` prevents a duplicate census rather than relying on a boolean double.

## Failure-mode checks

1. **Silent failure:** an externally aborted starter is swallowed as a clean lifecycle abort although the lifecycle's controller was not cancelled (new finding 1).
2. **Unexpected user action:** cancelling a separate full-index request while lifecycle has joined it leaves the lifecycle root without its promised census (new finding 1).
3. **Wrong input/result:** valid differing lifecycle/namespace options do not leak—joiners discard all options except their own signal (`code-symbol-indexer.service.ts:553-557`); a starter-supplied cap is honestly surfaced as `truncated` (`:637-651`).
4. **Dependency failure:** normal census rejection reaches lifecycle's catch and is reported (`workspace-index-lifecycle.ts:381-387`); joiner listeners are removed on either active-promise settlement branch (`code-symbol-indexer.service.ts:721-738`), and `startCensus` forwards its terminal rejection through `.then(resolveCensus, rejectCensus)` (`:686-697`). The externally-originated AbortError exception is the remaining incorrect classification.
5. **Unspecified requirement:** cancellation ownership when lifecycle joins an externally signal-owned census is not defined. The implementation needs an explicit retry/report rule distinct from lifecycle disposal.

## Decisions

- No tests, builds, lint, typecheck, or benchmarks were run, per the task restriction; the stated orchestrator gate was treated only as existing verification evidence.
- `isIndexing` has the documented false interval after settlement (`code-symbol-indexer.service.ts:561-572`), but a concurrent first-query race does not create two censuses: the first successful freshness continuation synchronously stores the active record before the next continuation checks it (`code-namespace.builder.ts:307-330`; `code-symbol-indexer.service.ts:671-698`).
- No unhandled rejection path was found in the reviewed chains: `joinActiveCensus` attaches both fulfillment and rejection handlers (`code-symbol-indexer.service.ts:725-738`), and `startCensus` consumes both terminal outcomes (`:686-697`).
