# Code Logic Review — TASK_2026_619 Batch 13b correction

## Verdict: APPROVED — 8/10

Both prior findings and the orchestrator's joiner-upgrade finding are fixed. I found no path that returns success for an incomplete census, hangs, or starts two concurrent censuses for one root. Two moderate gaps remain: a user click that joins a run already waiting on the governor stays blocked for that wait, and a progress listener is deduplicated by function identity. Neither is a correctness break.

Scope: read `workspace-index-lifecycle.ts` in full, and in `code-symbol-indexer.service.ts` the ActiveCensus record, `indexWorkspace`, `startCensus`, `joinActiveCensus`, `runIndex` and `yieldToForeground`. Also read the `boot-thoth-runtime.ts` runSymbols deps, `startBackgroundRun` in the namespace builder, the new lifecycle and indexer specs, and the indexer spec diff. I ran no tests, as instructed.

## Prior findings

- Review finding 1, lifecycle treated a foreign abort as its own clean stop: FIXED.
  - `workspace-index-lifecycle.ts:386-393`: the catch returns silently only when `this.disposed || controller.signal.aborted`. Otherwise it reports, then sets `followUp = true` if `isAbort(error)`.
  - The `.finally` consumes `followUp` once and calls `requestFullRun`.
  - `requestFullRun` clears pending timers and takes the `fullRun === undefined` branch, so one replacement starts.
  - A storm that already latched `followUp` while the join was in flight uses the same boolean. Still one replacement (spec `workspace-index-lifecycle.spec.ts:179`).
  - `isAbort` (`:~166`) now checks `typeof error === 'object' && 'name' in error`. `'name' in DOMException` is true through the prototype getter, so the indexer's DOMException abort is recognised.
- Review finding 2, missing cross-layer tests: FIXED, with a caveat. Real-indexer tests exist at `code-symbol-indexer.service.spec.ts:356`, `:1068` and `:1101`. The lifecycle specs at `:156`, `:179` and `:203` use a hand-built promise double rather than the real indexer. That is acceptable because the double reproduces exactly the rejection shape `joinActiveCensus` produces.
- Orchestrator finding, a user click joining a background census lost progress and governor bypass: FIXED, with a residual (see Finding 1).
  - `code-symbol-indexer.service.ts:729-733`: `joinActiveCensus` flips the monotonic `active.userInitiated` and adds the listener.
  - `:1070`: `yieldToForeground` is gated by `!active.userInitiated`, read per batch.
  - `:1101`: progress goes to `active.progressListeners`.
- Earlier history (`code-logic-review-b13b-final.md`):
  - Abort-after-commit success: the throw checks at `:1069` and after the batch loop are retained, and joiner abort never touches the census. Still impossible.
  - Third census: `activeCensuses` is a single record per key, `startCensus` is reached only when no record exists, and the record is deleted in `finally` before the promise settles (`:709-717`). There is no follow-up queue, so a third census is impossible.
  - First-waiter option control: caps, `batchSize` and `signal` are read only from the starter's `options` in `runIndex`. A joiner can change only `userInitiated` and its listener. Impossible by construction.

## New findings

1. MODERATE — `userInitiated` join does not release a governor wait already in progress.
   - Evidence: `code-symbol-indexer.service.ts:1070`. The flag is read only before `yieldToForeground`; the wait itself (`:1169-1180`) is bound to the starter's signal and governor only.
   - Scenario: the background census is blocked in `whenClear` before batch N. The user clicks `indexing:start` and joins. It receives no progress and no work until the governor clears or hits its starvation ceiling. The report's "bypass at the next batch boundary" is accurate, but the click can still sit behind a long wait. The `:356` test only covers a join made during a progress callback, between batches.
   - Fix: give the record a wake promise or abort controller that `joinActiveCensus` triggers when `userInitiated` flips. Race it against `whenClear` in `yieldToForeground`. Alternatively document it as accepted.

2. MINOR — Progress listeners are deduplicated and removed by function identity.
   - Evidence: `Set` at `:305`, `add` at `:732`, `delete` at `:736,744,750`.
   - Scenario: if a joiner passes the same function reference as the starter or another joiner, its abort or settle removes the shared registration, so the other party loses events. The current callers (`boot-thoth-runtime.ts:515` and the lifecycle, which passes none) create fresh closures, so this is not reachable today.
   - Fix: wrap each registration in a unique token object.

3. MINOR — A joined user click inherits the starter's cap and its cancel semantics.
   - Evidence: `:540-548`, documented.
   - Scenario: the user's own cancel rejects only the user's call and the census continues. A joined click returns `IndexingStats` that may be truncated if the starter set `maxFilesPerRun`. No current starter sets it: the lifecycle passes none and `startBackgroundRun` passes none. Coverage stays honest through `getCoverage`.
   - Fix: none needed now.

4. MINOR — A non-abort failure of a census the lifecycle joined is reported but gets no replacement.
   - Evidence: `workspace-index-lifecycle.ts:388-392`. This matches the lifecycle's own non-abort failure, so it is unchanged from before. Coverage is `incomplete` via the indexer, and the next storm or boot retries. Not a regression.

## Failure-mode checks

- Foreign-abort retry loop: no unbounded loop.
  - The replacement starts only after the aborted census has left `activeCensuses`, because the record is deleted before the promise settles. The replacement is therefore a fresh lifecycle-owned census.
  - A further abort needs a new foreign starter each time.
- A census that always fails with a non-abort error: reported once, `followUp` stays false, no retry loop.
- Joiner `onProgress` timing: never called synchronously inside the joiner's own call. Listeners fire only after the next batch (`:1101`). The call is wrapped in `try/catch`, with one warn per listener per census. A throwing listener cannot abort the census or starve other listeners.
- Starter `onProgress` called twice: not possible, since a `Set` holds it once. Listeners are cleared in the census `finally` (`:712-713`) and on joiner abort or settle, so none leaks across censuses.
- Lifecycle disposal while a joiner waits:
  - Lifecycle as starter: `dispose` aborts its controller. The census rejects with AbortError, the catch returns silently because `disposed`, `followUp` was reset in `dispose`, and no replacement starts.
  - Lifecycle as joiner: its own signal rejects only its joiner promise. The catch sees `controller.signal.aborted` and returns. The foreign census continues, and coverage is whatever the indexer reports.
  - No unhandled rejection: `active.promise.then(ok, err)` handles both branches in `joinActiveCensus`, and the lifecycle chain has a `.catch`.
- Joiner already-aborted signal: the listener is removed and the promise rejects with AbortError. The census is untouched.
- Two concurrent censuses for one root: not possible. The lookup and `set` in `indexWorkspace` / `startCensus` are synchronous with no `await` between them.
- Success for an incomplete census: `complete` is false only for discovery failure. That returns stats with `errors:1` and leaves coverage `incomplete`. This predates the batch and is unchanged.

## Tests

- Real-indexer tests (`code-symbol-indexer.service.spec.ts`):
  - `:356` joins during the starter's progress callback and asserts `whenClear` stays at 1. It would fail if the flag were not read per batch, so it is not tautological.
  - `:1068` asserts a single discovery, shared stats, and the joiner's `onProgress` receiving `2/2`.
  - `:1101` asserts `onProgress` is not called after the joiner aborts. A leaked listener would have been called by the starter's batch, so the test is meaningful.
- 60 -> 61 with three added tests:
  - The spec diff deletes one test, `a run superseded by a newer run never publishes its state` (diff line 158).
  - It is replaced by `two calls during an active census share...`.
  - Several other tests were added in the earlier 13b work: the isIndexing, create/delete-race, joiner-abort and settle tests.
  - The deleted scenario (a newer run superseding an older one) no longer exists under join-only semantics, so no live coverage was lost.
  - The `r1/r2` coverage tests are retained.
- Lifecycle specs `:156`, `:179` and `:203` assert call counts and `onError` counts, which proves exactly one replacement and one report. The disposal test mainly proves no throw and one `indexWorkspace` call. It does not assert on unhandled rejections beyond the jest run, so it is weak but acceptable.

## Decisions

- APPROVED, not REVISE: no BLOCKING or SERIOUS finding.
- Finding 1 is rated MODERATE rather than SERIOUS. The user keeps their own cancel semantics and the wait is bounded by the governor's starvation ceiling, so the click is delayed, not lost.
- Recommend a follow-up for findings 1 and 2 if the user-click latency matters. Neither blocks the batch.
