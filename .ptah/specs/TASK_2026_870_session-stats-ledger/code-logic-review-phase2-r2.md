# Code Logic Review — `TASK_2026_870` Phase 2, round 2

## Summary

| Metric              | Value                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Overall score       | 6/10                                                                  |
| Assessment          | NEEDS_REVISION                                                        |
| Blocking issues     | 0                                                                     |
| Serious issues      | 2                                                                     |
| Moderate issues     | 1                                                                     |
| Minor issues        | 0                                                                     |
| Failure modes found | 3                                                                     |

Reviewed the uncommitted diff on `feat/session-stats-finalizer` at `4fa334e18` (`git diff HEAD` and `git status`, excluding `task-tracking/`). `welcome-vitals.view.ts` was not reviewed; another lane is editing the lower-bound marker there. No source was edited. Tests, typecheck, and `ptah_get_diagnostics` were not run; this assignment forbids verify, build, and test. The fix report's scoped verify still ends at Nx `spawn EPERM` and is not evidence.

This is a 6, not a 5. The periodic worker no longer seals open chats, config re-init no longer requests finalization, a fast Electron quit queues `finalize_pending` before `flush()`, the CLI awaits adapter dispose before the sink drain, one bad row no longer drops the page, and welcome totals keep `knownCostUsd`. It is not a 7. On both hosts the one startup idle scan runs before any live-id provider exists, so it never scans `active` rows, and Electron's 2s dispose budget is shorter than the 5s interrupt wait inside `disposeAllSessions`, so a slow quit closes SQLite before that request is queued. Nothing retries either miss.

Skill note: this review was not assigned a skill. Angular checks use the task's stated rules. `angular-frontend-patterns` was not loaded.

## Round-1 findings

| Round-1 finding | Status | Evidence |
| --- | --- | --- |
| Idle sweep seals an open chat (`session-stats-repository.ts` active arm on every pass) | **Fixed** for the periodic pass. The startup arm is still in the SQL and does not run on a real boot (Serious issue 1). | Periodic candidates are only `finalize_pending` unless `startup = 1` (`session-stats-repository.ts:269-274`). The sink passes startup only when the provider is already set (`sqlite-session-usage-sink.ts:127-129`). The interval calls `pass` with the default `startup = false` (`sqlite-session-usage-sink.ts:122`, `:142`). Live ids are skipped (`session-stats-repository.ts:277`). Spec: periodic idle row stays active; startup seals it only when it is not in the live list (`session-stats-repository.spec.ts:97-103`). |
| Config re-init finalizes a replacement session | **Fixed** | `requestConfigReinit` disposes and re-initializes with no `requestFinalization` (`sdk-agent-adapter.ts:410-422`). Workspace dispose finalizes only ids absent after the await (`sdk-agent-adapter.ts:969-974`). |
| Quit never requests finalization; CLI flushes first | **Partially fixed** | CLI: `disposeSdkAdapter` is awaited before `shutdownHostRuntime` on the failure path and the `finally` path (`with-engine.ts:347-348`, `:435-447`). `dispose()` returns the session-disposal promise (`sdk-agent-adapter.ts:814-842`), and `requestFinalization` attaches to the sink tail synchronously, so the later `flush()` sees it. Electron: ids are snapshotted, chat dispose runs, survivors are filtered, requests are queued, then the adapter is disposed, then the sink is flushed (`shutdown.ts:303-364`). That order is what `shutdown.spec.ts:380-402` asserts, with dispose resolving immediately. A dispose that is still inside the 5s interrupt wait is not awaited (Serious issue 2). |
| Late higher revision reopens a true end | **Partially fixed** | Equal or lower aggregate revisions keep `status` and `finalize_revision` (`session-stats-repository.ts:205-213`). Spec at `session-stats-repository.spec.ts:109-121`. An explicit resume clears the row with no new usage (`session-stats-owner.service.ts:477-512`, `session-stats-repository.ts:253-258`, spec `:126-136`). A higher `MAX(revision)` still forces `active` (`session-stats-repository.ts:208-210`, spec `:78-80`). The periodic pass will not seal that row again. See Moderate issue 1. |
| One bad row drops the rest of the batch | **Fixed** | The seal loop catches per row, logs a real `Error`, continues, and returns the changed-row count (`session-stats-repository.ts:276-306`). A trigger test seals the next row (`session-stats-repository.spec.ts:156-176`). |
| Welcome tiles drop `knownCostUsd` | **Fixed** in the model this review was allowed to read | `pricedCost` uses `costUsd ?? knownCostUsd ?? null` and sets `unpriced` when `costUsd === null` (`usage-vitals.model.ts:149-156`). A null or non-finite known sum stays `null`. `(costUsd ?? 0)` runs only after a finite cost exists (`usage-vitals.model.ts:216`, `:236`). Specs: `usage-vitals.model.spec.ts` lower bound, zero, and non-finite; cache keeps `knownCostUsd` (`usage-vitals.cache.spec.ts`). The `≥` marker in `welcome-vitals.view.ts` is out of scope. |
| Empty catch swallows every retry-metadata failure | **Partially fixed** | The retry `UPDATE` logs `retryError` (`session-stats-repository.ts:299-302`). It does not rethrow. Rethrowing would abort the page, which round 1 also forbade. A metadata failure leaves the original row unchanged and the pass still returns a count. Not filed again: the caller already cannot tell a skipped row from a row that was not a candidate, and the next pending pass retries a row that stayed `finalize_pending`. |
| Empty range over-claims partial coverage | **Fixed** | Empty partial copy is "Earlier usage may be incomplete." (`usage-dashboard.component.html:115-116`). `claude-ledger` stays `partial` because history is not backfilled (`usage-summary.service.ts:92-95`). That matches the no-backfill decision. |

## Decisions

- **The startup-provider gap is a defect.** The fix report calls it a known gap and keeps the scan conditional so a host with no adapter does not guess. Both shipping hosts do construct the adapter, and they construct it only after an `await` that lets `setTimeout(0)` run. Options were: accept a scan that never fires, or require the first pass to wait until the provider is installed. Evidence is the boot order in Serious issue 1. Reversible: run the startup predicate on the first pass after `setLiveSessionIdsProvider`.
- **A higher aggregate revision is still a reopen, not a resume.** The new spec expects `revision: 2` after a seal at revision 1 to set `active` (`session-stats-repository.spec.ts:78-80`). That is a second reopen channel beside `resumeSession`. It is not what round 1 asked for, and the periodic worker cannot put the seal back. Filed as moderate, not serious, because an in-order SDK end queues the usage write before `requestFinalization` on the same tail.

## Five logic questions

### 1. How does this fail silently?

The startup pass reports success after scanning only pending rows. `startFinalizer` schedules `pass(true)` on `setTimeout(0)` (`sqlite-session-usage-sink.ts:137-140`). `pass` forces `startup` to false when `liveSessionIdsProvider` is null (`sqlite-session-usage-sink.ts:127-129`). On Electron and the CLI that provider is still null when the timer fires (Serious issue 1). `reconcileFinalizations` then returns the pending count. Idle `active` rows stay `active`. No later pass sets `startup` again.

A slow Electron quit has the same shape. `withBudget` resolves on the deadline and does not cancel the step (`shutdown.ts:466-486`). `flush()` then awaits whatever `this.tail` is at that moment (`sqlite-session-usage-sink.ts:147-157`) and SQLite closes (`shutdown.ts:367`). The `requestFinalization` that `dispose()` puts in a `.then()` after `disposeAllSessions` (`sdk-agent-adapter.ts:819-822`) is not on that tail yet. The sink logs the failed write later. The row stays `active`.

### 2. What user action produces unexpected behaviour?

Quit Electron while a session `interrupt()` is still running. `disposeAllSessions` waits up to 5 seconds (`session-control.service.ts:405-410`). Chat dispose and SDK dispose are each given 2 seconds (`shutdown.ts:141`, `:305-307`, `:338-344`). At 2 seconds the sessions are still in the registry, so the pre-dispose filter treats them as live and does not request finalization (`shutdown.ts:311-315`). The adapter's own request is still behind that interrupt. The process closes the database. Relaunch does not idle-scan the row (Serious issue 1). The chat is stored as never ended.

Leave a crashed or killed session untouched for any length of time and start the app. The row stays `active` for the life of the process. Stop, compaction, and turn interrupt still do not request finalization (`sdk-agent-adapter.ts:2023-2028` has no `requestFinalization`). That part is right. The startup scan was the path that was supposed to seal a session the process no longer holds.

### 3. What input data produces a wrong answer?

A usage event whose aggregate `MAX(revision)` is greater than `finalize_revision` reopens a sealed or pending row (`session-stats-repository.ts:205-213`). The event does not have to come from `resumeSession`. After that write the status is `active`, and only a startup pass would seal it again. That pass does not run.

`pricedCost` does not coerce null to 0 (`usage-vitals.model.ts:154-156`). Dashboard fold still uses `costUsd ?? knownCostUsd ?? null` (`usage-summary-fold.ts:105-107`). Top-session `costUsd` is null when `known_cost_micro_usd` is null (`usage-summary.service.ts:84`). The pre-existing `?? 0` on a priced fact (`usage-summary.service.ts:69`) still applies only when `costSource !== 'unpriced'`.

### 4. What happens when a dependency fails?

A seal `UPDATE` that throws is logged, the retry metadata update is attempted, and the loop continues (`session-stats-repository.ts:289-304`). If the retry update also throws, that error is logged and the original row is left as it was. A `finalize_pending` row is eligible again on the next interval. An `active` row is eligible only on a startup pass, which has already been consumed.

`ready()` throwing still rejects the whole pass before the loop (`session-stats-repository.ts:266`). The sink logs it and ends the pass (`sqlite-session-usage-sink.ts:130-135`). Pending rows wait for the next interval. The busy spec still uses a repository whose `ready()` throws (`session-stats-repository.spec.ts:141-151`). The trigger spec is the one that enters the per-row catch.

`SdkAgentAdapter.dispose()` skips `requestFinalization` when `disposeAllSessions` rejects, because that call sits in `.then()`, not `.finally()` (`sdk-agent-adapter.ts:819-829`). The catch logs and the returned promise fulfills. Electron shutdown then flushes and closes SQLite as if dispose had queued the ends.

SQLite `busy_timeout` remains 5 seconds (`session-store-database.ts:18`). S0003 is a static string with no `${}` (`session-store-migrations.ts:99-104`). The new columns default so existing rows stay `active` with `finalize_revision` null.

### 5. What is missing that the requirements never mentioned?

Nothing new beyond round 1. The user decision still forbids JSONL backfill; none was added. There is still no separate finalizer token. `registerSessionStoreServices` starts the one timer (`register-session-store.ts:56`), called from Electron phase 1 (`phase-1-infra.ts:167`) and the CLI container (`container.ts:483`). Guard specs did not need a new registration. What is missing is a startup pass that runs after the adapter exists, and a quit path that waits for the finalization queue itself rather than for a budget shorter than session interrupt.

## Failure modes

### Startup idle scan runs before the live-id provider exists

- Trigger: process start on Electron or the CLI. The sink arms `setTimeout(0)` during container registration. The adapter that installs the provider is constructed only after a later `await`.
- Symptom: the one startup pass treats `startup` as false. Idle `active` rows from a crash or a killed process stay `active` until some later true-end request. Pending rows still seal on the 60-second pass.
- Evidence: `register-session-store.ts:56`; `sqlite-session-usage-sink.ts:115-142`; adapter provider install at `sdk-agent-adapter.ts:294-296` (constructor, lazy `useClass` in `register.ts`). Electron resolves that adapter in `captureShutdownHandles` (`wire-runtime.ts:556-558`), called from `postWindow` (`wire-runtime.ts:537`) after `await wireRuntimePreWindow` and `await registerPostWindow` (`main.ts:351-380`). CLI registers the store during sync bootstrap (`container.ts:483`), then awaits `workspaceReady` before `initializeSdk` (`with-engine.ts:288`, `:329`).
- Current handling: `setLiveSessionIdsProvider` only stores the function (`sqlite-session-usage-sink.ts:115-117`). The interval never passes `startup = true`.
- Recommendation: remember that the startup scan has not run, and run it once on the first pass after the provider is set. Keep `startup` false when the provider is missing so a host with no adapter still does not guess.

### Electron quit closes SQLite before a slow dispose queues finalization

- Trigger: quit while `query.interrupt()` has not settled. The lifecycle waits up to 5 seconds. Shutdown stops waiting at 2 seconds, twice.
- Symptom: no `finalize_pending` write for sessions that were still registered when the first budget expired. The database closes. The late `requestFinalization` fails or lands after close. Relaunch does not idle-scan the row.
- Evidence: interrupt race `session-control.service.ts:405-410` (`setTimeout(..., 5000)`); `CHAT_SESSION_DISPOSE_BUDGET_MS = 2000` at `shutdown.ts:141`; chat dispose `shutdown.ts:305-307`; live filter `shutdown.ts:311-315` (still-live ids are excluded); SDK dispose budget `shutdown.ts:338-344`; `flush` then `sqliteConnection.close` at `shutdown.ts:358-367`. `dispose()` requests finalization only after `disposeAllSessions` resolves (`sdk-agent-adapter.ts:819-822`). `withBudget` documents that the step is not cancelled (`shutdown.ts:462-464`). `flush` awaits the tail it observes at call time (`sqlite-session-usage-sink.ts:156-157`).
- Current handling: a dispose that settles inside 2 seconds is ordered correctly, and `shutdown.spec.ts:380-402` covers that settle. Failure isolation is real for a rejected step (`shutdown.ts:487-490`): shutdown continues. The deadline path continues too, which is what drops the not-yet-queued request. `dispose()` also does not re-read live ids after the await, unlike workspace end (`sdk-agent-adapter.ts:970-973`). On this budget path the `.then()` usually has not run yet; when it does run after a same-id replacement survived `disposeAllSessions` (`session-control.service.ts:430-434`), that replacement's id is sealed.
- Recommendation: queue `requestFinalization` for ids that `disposeAllSessions` has actually removed, and `await` those sink promises, or include them in the tail, before `flush` and SQLite close. Do not use a 2s budget to stand in for a 5s interrupt. After the await, skip ids that are live again.

### Higher revision undoes a true end for good

- Trigger: `recordEvent` commits a turn whose `MAX(revision)` is greater than `finalize_revision` after `requestFinalization` or after the seal.
- Symptom: `status` returns to `active` and `finalized_at_ms` is cleared. The periodic worker will not select the row. The session stays unfinished unless another explicit `requestFinalization` runs.
- Evidence: `session-stats-repository.ts:205-213`; spec `session-stats-repository.spec.ts:78-80` expects that reopen. `resumeSession` is a separate statement (`session-stats-repository.ts:253-258`) used from `prepareRun` and `startNew` (`session-stats-owner.service.ts:490-512`).
- Current handling: a lower revision keeps the seal. Duplicate or older revisions of the same event key return before the upsert (`session-stats-repository.ts:143-146`). Tail order saves the usual SDK end, because capture calls `recordUsage` before `endSession`'s `.then()` calls `requestFinalization` (`sdk-agent-adapter.ts:1163-1166`).
- Recommendation: reopen from `resumeSession` only. Keep a higher revision's tokens and cost, and leave `status` and `finalize_revision` alone unless that resume ran.

## Blocking issues

None. A missed seal does not delete tokens or known cost. A wrong `active` flag is durable, which is the serious set above, and spend totals still do not read `status`.

## Serious issues

### Startup idle scan never observes the live-id provider

- File: `libs/backend/persistence-sqlite/src/lib/session-store/sqlite-session-usage-sink.ts:127`
- Scenario: `startFinalizer` is called from `registerSessionStoreServices` while the container is still being built. The only `pass(true)` is a `setTimeout(0)`. Electron installs the provider when `postWindow` resolves `SdkAgentAdapter`, after two awaited boot phases. The CLI installs it in `initializeSdk`, after `await workspaceReady`. The timer has already fired with a null provider, so `startup && this.liveSessionIdsProvider !== null` is false.
- Impact: crash and kill recovery does not seal idle sessions the new process is not holding. The fix for "do not seal a live chat" also removed the only scan that was allowed to seal an `active` row, and that scan does not run. Pending rows from a fast, successful quit still seal within 60 seconds.
- Fix: on `setLiveSessionIdsProvider`, if the startup scan has not completed with a provider, run one startup pass. Leave the periodic pass pending-only.

### Quit finalization is bounded below the interrupt it waits on

- File: `apps/ptah-electron/src/activation/shutdown.ts:338` and `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:410`
- Scenario: session interrupt is raced against 5 seconds. Shutdown's chat-dispose budget and SDK-dispose budget are 2 seconds each, and neither cancels the underlying promise. The finalization request is inside `dispose()`'s `.then()`. The live-id filter before that dispose excludes ids that are still registered, which they are until the 5 second race ends. `flush` and `sqliteConnection.close` follow the 2 second deadline.
- Impact: a quit whose interrupt is slower than 2 seconds and faster than 5 seconds does not persist `finalize_pending`. The late write hits a closed database. Combined with Serious issue 1, the row stays `active` across the next launch. A quit whose interrupt settles immediately still follows the spec order.
- Fix: persist finalization only after the dispose promise removes those ids, and make `flush` observe that queue before close. Raise or remove the budget around the step that queues the write; do not raise it by sealing ids that are still in the registry.

## Moderate and minor issues

- Moderate. A higher aggregate revision clears a true end (`session-stats-repository.ts:208-210`). `resumeSession` already clears a deliberate resume before new usage. The usage upsert should not. The periodic pass will not repair it, and the startup pass will not run.

Checked and not filed as new defects:

- S0003 is static SQL. No `${}` (`session-store-migrations.ts:99-104`). New integer columns default to 0. `finalize_revision` is nullable. Old rows stay `active`.
- Stop does not finalize (`sdk-agent-adapter.ts:2023-2028`). Compaction still does not call `requestFinalization`. Turn interrupt keeps the record (`session-control.service.ts:103-157`).
- Config re-init does not finalize. Workspace dispose skips ids that are live after the await (`sdk-agent-adapter.ts:970-973`).
- The worker is one `unref`'d interval, one in-flight pass, at most 32 rows (`sqlite-session-usage-sink.ts:122-143`, `session-stats-repository.ts:274`). Registration does not await it (`register-session-store.ts:56`). Host startup is not blocked on a scan. `flush()` still clears the timers; on the CLI that happens after `dispose()` returns (`with-engine.ts:435-447`, `shutdown-host-runtime.ts:187-188`).
- `dispose()` calls `clearAll()` before the disposal promise settles (`sdk-agent-adapter.ts:836`). `clearAll` only clears the in-memory map (`session-stats-owner.service.ts:923-925`). The sink used by the later `requestFinalization` is the injected field, so that call still queues.
- Welcome and dashboard null costs stay null when both `costUsd` and `knownCostUsd` are absent. `unpriced` is a separate flag (`usage-vitals.model.ts:153-156`, `:219`). Top-session null cost is null (`usage-summary.service.ts:84`).
- `knownCostUsd` and `coverageStart` are optional on the strict Zod objects (`rpc-analytics.types.ts:23`, `:44`). The refine still requires `costUsd === null` exactly when `costSource` is `unpriced`. The producer sets `knownCostUsd` only when the micro-USD sum is non-null (`usage-summary.service.ts:70`) and sets `coverageStart` from `first_captured_at_ms` (`usage-summary.service.ts:92`). The dashboard view model reads `coverageStart` (`usage-summary.view-model.ts:297`).
- The dashboard template interpolates text (`usage-dashboard.component.html:57-59`, `:115-116`). This diff adds no `[innerHTML]`, `@Input`, or `@Output`. The component's existing `constructor()` is unchanged.
- No new `any`, `@ts-ignore`, or `as unknown as` in the reviewed diff. Finalization failures log a real `Error`. Public alias imports are unchanged. No new `vscode` or `electron` import on the host-neutral path. Electron and CLI both reach the worker through `registerSessionStoreServices`; no new DI token and no guard-spec hole.

## Data flow

1. True-end call sites are `endSession`, a token-matched stream exit, workspace dispose for ids that are gone, and `dispose`. Config re-init is no longer on this list. Stop is not on it. OK.
2. Electron quit snapshots live usage ids, disposes chat sessions under a 2s budget, requests finalization for ids that are no longer live, disposes the adapter under a 2s budget, then flushes. OK only when both disposes settle inside the budget. Not OK when interrupt is still inside its 5s race.
3. CLI quit awaits `dispose()`, which returns the promise that queues finalization, then `shutdownHostRuntime` flushes. OK for the queue order.
4. The owner enqueues `requestFinalization` on the sink tail and ignores a missing method (`session-stats-owner.service.ts:460-461`). A missing stats row is an `UPDATE` that matches nothing. OK.
5. `recordEvent` reopens when the aggregate revision exceeds `finalize_revision`. Lower revisions keep the seal. Explicit `resumeSession` clears it first. The higher-revision arm is the remaining reopen. Not OK for a late checkpoint that is not a resume.
6. `startFinalizer` waits for the current tail, then `reconcileFinalizations`. Pending rows are revision-checked and sealed. The `active` idle arm runs only when `startup` is true. The flag is false on the only pass that could set it. Not OK.
7. `UsageAnalyticsService` emits `knownCostUsd` and `coverageStart` and marks `claude-ledger` partial. OK for the no-backfill contract.
8. Dashboard fold and welcome `pricedCost` keep a null total null and add a known sum as a lower bound. OK. The welcome view that would draw `≥` was not part of this review.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| True end queues `finalize_pending`; Stop, compaction, and turn abort do not | PARTIAL | Stop, compaction, turn interrupt, and config re-init are clean. A fast Electron quit and the CLI quit queue the request. A slow Electron quit does not. |
| Bounded startup/idle worker, startup not blocked, one pass at a time | PARTIAL | One unref'd timer, 32 rows, registration does not wait. The startup idle scan does not run after the provider is installed. |
| Resume clears pending | PARTIAL | `prepareRun` / `startNew` call `resumeSession` before new usage. Any higher aggregate revision also clears a true end, and nothing seals that row again. |
| Idempotent seal and revision check | COMPLETE | A second pass skips `finalized`. The `UPDATE` requires the captured revision, status, and max turn revision. |
| S0003 static SQL, old rows keep defaults | COMPLETE | No interpolation. Defaults are 0 and null. |
| SQLite busy leaves the row pending and the rest of the page runs | COMPLETE | Per-row catch, retry metadata, continue. The trigger spec covers one failed row. `ready()` failure still ends the pass. |
| No JSONL backfill | COMPLETE | No backfill service. |
| Electron and CLI register the worker and order quit before flush | PARTIAL | Both register the worker. CLI order is awaited. Electron order is awaited only inside 2s budgets. |
| Dashboard and welcome keep null cost unknown and show a known lower bound; coverage shown | COMPLETE | For the files in this review. `welcome-vitals.view.ts` was excluded. |
| Shared Zod contract accepted by producer and readers | COMPLETE | Optional `knownCostUsd` and `coverageStart`. Producer and the reviewed readers use them. |

Implicit requirements still open: the startup scan must run once the host can name live ids; quit must not close SQLite before the finalization queue exists.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Stop / interruptSession | YES | No `requestFinalization` | None on this path |
| Compaction | YES | Budget tap only | None |
| Turn interrupt | YES | Record stays, or timeout removes it before token match | Unchanged from round 1 |
| Token-matched stream end | YES | Finalizes after a successful end | A later higher revision reopens |
| Config re-init | YES | No finalization request | None |
| Workspace dispose | YES | Skips ids live after the await | None |
| App quit, dispose settles within 2s | YES | Filter, request, dispose, flush, close | Spec covers the immediate settle |
| App quit, interrupt still running at 2s | NO | Budget continues; request is not queued yet; SQLite closes | Startup scan will not repair it |
| Resume after finalize, before new usage | YES | `resumeSession` clears pending and finalized | `startNew` uses the same statement; a brand-new id matches no row |
| Higher revision after seal | NO | Upsert sets `active` | Periodic pass ignores `active` |
| Lower revision after seal | YES | Status and `finalize_revision` kept | Seal predicate still matches |
| One bad row in a page | YES | Catch, retry metadata, continue | Retry failure is logged and skipped |
| SQLite busy before the loop | YES | Pass throws, sink logs, pending rows remain | Next interval retries pending rows |
| Empty session (no stats row) | YES | `UPDATE` matches nothing | No row to seal |
| Null cost | YES | Null stays null; known sum is the lower bound | Welcome marker file not reviewed |
| Coverage absent | YES | `coverageStart` omitted; reason says nothing captured | Empty copy no longer claims the range itself |
| Migration replay | YES | Versioned static `exec` | None found in this diff |
| Live ids not yet provided at first timer | NO | Startup flag forced false; never retried | Both hosts hit this |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: Electron can quit without a durable `finalize_pending` row, and the startup scan that should seal an `active` row the process does not hold never runs, because the live-id provider is installed after `setTimeout(0)`.
- What a robust implementation would add: one startup pass after `setLiveSessionIdsProvider`; quit that awaits the finalization queue ahead of `flush` and SQLite close; reopen only through `resumeSession`.

Verification gap: this review did not execute the new specs or a scoped `nx` target. The fix report's verify command is not a passing run.
