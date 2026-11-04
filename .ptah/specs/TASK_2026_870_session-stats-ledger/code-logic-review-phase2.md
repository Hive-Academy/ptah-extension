# Code Logic Review — `TASK_2026_870` Phase 2

## Summary

| Metric              | Value                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Overall score       | 5/10                                                                  |
| Assessment          | NEEDS_REVISION                                                        |
| Blocking issues     | 0 (critical)                                                          |
| Serious issues      | 3 (major)                                                             |
| Moderate issues     | 2 (minor)                                                             |
| Minor issues        | 1                                                                     |
| Failure modes found | 5                                                                     |

Reviewed the uncommitted diff on `feat/session-stats-finalizer` at `4fa334e18` (`git diff HEAD` for `libs/`, plus the new Phase 2 report). `task-tracking/` was ignored. No source was edited. Tests, typecheck, and `ptah_get_diagnostics` were not run; the task forbids them, and the implementation report records a sandbox `spawn EPERM` before any scoped verify result.

This is a 5, not a 7. The seal predicate, the Stop path, static S0003 SQL, and the dashboard lower-bound fold are real and mostly right, so the design is not wrong at the foundation (that would be 3–4). It is also not sound: quiet live sessions are sealed without a true end, Electron quit never requests finalization, and the welcome tiles drop the lower bound the dashboard now shows.

Skill note: this review was not assigned a skill. Angular checks use the task's stated rules (standalone, OnPush, `inject()`, signals, no new `@Input`/`@Output`, no `[innerHTML]`). `angular-frontend-patterns` was not loaded.

## Decisions

- **Idle sweep is not a true end.** The plan's idle scan is for unfinished rows after startup or a crash, and it says not to close sessions on Stop or compaction. The worker instead seals every `active` row whose event time is 30 minutes old, including chats this process still holds. Options were: accept the 30-minute quiet seal as the product rule, or treat it as a defect. Evidence: component 3 of `implementation-plan.md` ("startup scans", "no blanket closing on Stop or compaction") and `interruptSession` still refusing to finalize. Reversible: change the candidate query.
- **App quit must not seal a resumable session by accident.** Electron shutdown never reaches `SdkAgentAdapter.dispose()`, so quit does not write `finalize_pending`. The idle sweep then becomes the quit finalizer and seals too widely. That is a defect in both wiring and the sweep, not an approval of quit-as-true-end.

## Five logic questions

### 1. How does this fail silently?

The idle worker reports success when it seals a session the user did not end. `reconcileFinalizations` selects `status = 'active' AND last_usage_at_ms <= now - 30min` and sets `finalized` (`session-stats-repository.ts:250-263`). `last_usage_at_ms` is `MAX(occurred_at_ms)`, not the write time (`session-stats-repository.ts:191-202`). No live-session set is consulted. The caller only sees a candidate count. Analytics never read `status`, so spend totals stay the same while the row is marked finished.

A second silent path: `requestFinalization` returns immediately when the sink has no method (`session-stats-owner.service.ts:460-461`). Electron's sqlite sink has the method, so this is latent on any other binding.

### 2. What user action produces unexpected behaviour?

Leave a chat open for 30 minutes after the last usage event. The next worker pass (startup `setTimeout(0)` or the 60-second interval) marks that session `finalized` even though Stop, compaction, and turn interrupt did not (`sdk-agent-adapter.ts:2005-2017` does not call `requestFinalization`; compaction only records a budget boundary).

Change a setting that triggers config re-init. Every live id captured before `disposeAllSessions` is finalized (`sdk-agent-adapter.ts:415-417`). A `chat:start` that reuses one of those ids during the dispose await is left running by `SessionControl` (`session-control.service.ts:430-434`) while its ledger row is still queued for sealing.

Quit Electron. The session is not finalized on the way out (see Serious issue 2). Reopen within 30 minutes and the row stays `active` until either a new usage write or the idle sweep. Reopen after 30 minutes without a new usage write and the startup pass seals it while the chat is on screen. Nothing clears `finalized` except a later `recordEvent` upsert (`session-stats-repository.ts:202-203`). Reopening the transcript is not that write.

### 3. What input data produces a wrong answer?

A usage event whose `occurredAtMs` is already 30 minutes behind wall clock is eligible on the next pass, including the pass that follows the insert. The new spec does this on purpose: it writes the idle session and then calls `reconcileFinalizations(90_000_000)` against `occurredAtMs` `86_400_000` and expects `finalized` (`session-stats-repository.spec.ts:97-99`). The same input in production is a delayed or historical live checkpoint. The row is sealed even though it was just accepted.

On the dashboard, a grouped fact with `costUsd: null` and `knownCostUsd` set is a lower bound (`usage-summary-fold.ts:106-107`). The welcome tiles ignore `knownCostUsd` and treat that fact as fully unknown (`usage-vitals.model.ts:134-137`). The same RPC payload draws two different costs.

An empty week still says historical coverage is partial, because `claude-ledger` is always pushed as `partial` when the ledger answers (`usage-summary.service.ts:92-95`, `usage-dashboard.component.html:115-117`). A range after capture start with no rows is not the same fact as "no history was backfilled".

### 4. What happens when a dependency fails?

SQLite `busy_timeout` is 5 seconds (`session-store-database.ts:18`). If a seal statement still throws, the catch marks that one row `finalize_pending` with backoff, then rethrows (`session-stats-repository.ts:264-277`). The sink logs the error and ends the pass (`sqlite-session-usage-sink.ts:113-116`). Rows after the failure wait until the next interval. If the retry `UPDATE` also throws, the empty catch leaves the original row unchanged and the comment calls that a busy outcome. Any error is swallowed there, not only `SQLITE_BUSY`.

The busy spec never enters that catch. It uses a repository whose `ready()` throws (`session-stats-repository.spec.ts:111-113`). The original pending row stays pending because the second repository never touches it. That does not show a busy seal.

`flush()` clears the startup timer and the interval, then awaits only the tail that already exists (`sqlite-session-usage-sink.ts:130-140`). CLI shutdown calls `flush()` before `sdkAdapter.dispose()` (`with-engine.ts:444`, then `disposeSdkAdapter` at `462`). `dispose()` does not return the promise that queues finalization (`sdk-agent-adapter.ts:813-828`). Those quit requests are not in the drained tail. A process exit immediately after `dispose()` returns drops them.

If `disposeAllSessions` rejects, the `then` that would request finalization is skipped (`sdk-agent-adapter.ts:823-828`). The idle sweep is the only retry, with the over-broad predicate above.

### 5. What is missing that the requirements never mentioned?

The plan asked for a finalizer service, a one-time JSONL backfill, and guard-spec updates. The user decision forbids JSONL backfill; its absence is correct. There is no separate finalizer type and no guard-spec diff. The worker is started from `registerSessionStoreServices` (`register-session-store.ts:56`), which Electron phase 1 and the CLI container already call, so resolution does not need a new token. What is missing is a host-supplied set of live session ids, an awaited quit hook on the Electron path, and the same lower-bound rule on welcome tiles. Seal does not recompute totals; it trusts `session_stats.revision = MAX(session_usage_turns.revision)` (`session-stats-repository.ts:261-262`). That matches the single-transaction writer. It is not a second reconciliation.

## Failure modes

### Idle sweep seals an open chat

- Trigger: an `active` row whose latest `occurred_at_ms` is at least 30 minutes before the pass, including a chat the user still has open or has just resumed without a new usage write.
- Symptom: `status` becomes `finalized` and `finalized_at_ms` is the pass time. The next accepted newer contribution flips the row back to `active`. Until that write, the session is stored as finished.
- Evidence: `session-stats-repository.ts:250-263`, `session-stats-repository.ts:202-203`, `session-stats-repository.spec.ts:97-99`.
- Current handling: the seal `UPDATE` also requires the captured revision and status, so a usage write that commits a newer revision first makes the seal match zero rows. A write that commits after the seal reopens the row. Totals are not dropped.
- Recommendation: select only `finalize_pending` in the periodic pass. Run the idle predicate at startup for rows that are not in the host's live id set, and compare `updated_at_ms` (or require both event time and write time to be idle).

### Config re-init finalizes a replacement session

- Trigger: a config re-init snapshots live ids, awaits dispose, then calls `requestFinalization` for those ids. A replacement registered under one of those ids during the await is kept in the registry.
- Symptom: the replacement's ledger row becomes `finalize_pending` and the next pass seals it within 60 seconds even if `last_usage_at_ms` is new. Pending does not use the idle predicate (`session-stats-repository.ts:252` and `:260`).
- Evidence: `sdk-agent-adapter.ts:415-417`, `session-control.service.ts:430-434`, `session-stats-repository.ts:257-263`.
- Current handling: a later usage write with a higher revision clears finalization. A resumed chat with no new usage yet stays sealed. `requestFinalization` will not touch a row that is already `finalized` (`session-stats-repository.ts:239`).
- Recommendation: do not request finalization for a config re-init. If a dispose must seal, skip ids that are in the registry again after the await.

### Electron quit never requests finalization

- Trigger: Electron shutdown calls `disposeAllSessionsForShutdown`, then `sessionUsageSink.flush()`, then closes SQLite.
- Symptom: quit does not write `finalize_pending`. `flush()` also cancels the worker, so an in-process pass cannot seal afterwards. The next launch seals by the idle rule instead.
- Evidence: `shutdown.ts:303-347`, `session-lifecycle-manager.ts:782-791` (dispose only), `sdk-agent-adapter.ts:813-835` (the only quit hook, and it is not awaited), `sqlite-session-usage-sink.ts:130-140`. CLI is the mirror image: `shutdownHostRuntime` flushes at `shutdown-host-runtime.ts:188` before `with-engine.ts:462` disposes the adapter.
- Current handling: accepted usage writes that are already on the tail are drained. Finalization requested inside `dispose()`'s `then` is not part of that drain.
- Recommendation: on the Electron shutdown path, snapshot ids, await session dispose, queue `requestFinalization`, then `flush()` the sink. Make `dispose()` return that promise. Do not clear the interval until those requests are on the tail. Keep quit from sealing ids that the next process still considers resumed; clearing pending belongs on resume, not only on the next usage upsert.

### Late higher revision reopens a true end

- Trigger: `requestFinalization` is chained on the sink tail (`sqlite-session-usage-sink.ts:94-96`). Any `recordUsage` that arrives after that call runs later and the stats upsert forces `status = 'active'`, `finalized_at_ms = NULL`, and zeroes the retry columns (`session-stats-repository.ts:202-203`). A duplicate or older revision returns before that upsert (`session-stats-repository.ts:141-145`), so only a newer revision reopens.
- Symptom: a checkpoint that accepts a higher revision after stream-end finalization leaves the session `active` until the idle sweep. The true end does not stick.
- Evidence: `sqlite-session-usage-sink.ts:94-101`, `session-stats-repository.ts:141-145` and `:199-203`.
- Current handling: the tail orders writes that were already queued ahead of the finalize request. That part is right. The upsert cannot tell a resume from a late checkpoint.
- Recommendation: store `finalize_revision` at the request and clear pending only when the new contribution's revision is greater and the caller is a resume, or ignore writes whose revision was already visible when finalization was requested.

### One bad row drops the rest of the batch

- Trigger: any throw from a seal `UPDATE`, including a busy error after `busy_timeout`.
- Symptom: that row is armed for retry when the second `UPDATE` succeeds; later candidates in the 32-row page are not attempted until the next pass. If the oldest row always throws, later pending rows wait behind it because the page is `ORDER BY updated_at_ms`.
- Evidence: `session-stats-repository.ts:255-277`, `sqlite-session-usage-sink.ts:107-118`.
- Current handling: the error is logged. The pass is not stuck in a tight loop. The interval is a single unref'd timer (`sqlite-session-usage-sink.ts:125-126`), so this is not an unbounded per-session timer.
- Recommendation: catch per row, continue the page, and return the number of rows actually changed.

## Blocking issues

None. Tokens and known cost are not deleted by a wrong seal. `recordEvent` rewrites `session_stats` from the turns in the same transaction, and a newer contribution reopens a sealed row.

## Serious issues

### Idle finalization does not mean true end

- File: `libs/backend/persistence-sqlite/src/lib/session-store/session-stats-repository.ts:250`
- Scenario: every 60 seconds, and once at startup, any `active` session whose latest event time is 30 minutes old is finalized. The process can still hold that session. Stop, compaction, and `interruptCurrentTurn` do not request finalization; this path does not need a request.
- Impact: a paused or resumed chat is stored as finalized until the next accepted usage write. `finalized_at_ms` is the worker clock, not a session end. After quit, this sweep is the only sealer (Serious issue 2), so it also seals sessions the user has reopened and not yet continued.
- Fix: remove the `status = 'active'` arm from the periodic pass. Apply an idle predicate only at startup, only to ids the host says are not live, and require `updated_at_ms` to be idle as well as `last_usage_at_ms`.

### Quit and config re-init do not match the true-end list

- File: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:415` and `:813`; `apps/ptah-electron/src/activation/shutdown.ts:340`; `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:444`
- Scenario: config re-init and workspace dispose call `requestFinalization` and the worker then seals pending rows without waiting 30 minutes. Electron quit never calls that hook. CLI `flush()` runs first and cancels the worker; `dispose()` queues finalization on a promise it does not return.
- Impact: a settings change seals chats the user is about to keep, including a replacement id that survived dispose. A quit either drops the finalize request or, on the next launch, leaves the idle sweep to guess. Stop itself is correct: `interruptSession` (`sdk-agent-adapter.ts:2012-2017`) still does not request finalization, and the new spec asserts that.
- Fix: delete the config-reinit call. Keep workspace dispose only for ids that are gone after the await. On Electron and CLI shutdown, await dispose, queue finalization for those ended ids, then flush. Return the dispose promise from `SdkAgentAdapter.dispose`.

### Welcome tiles drop the known-cost lower bound

- File: `libs/frontend/chat/src/lib/services/vitals/usage-vitals.model.ts:134`
- Scenario: the ledger emits `costUsd: null` and `knownCostUsd` for an unpriced group that still has a priced sum (`usage-summary.service.ts:69-70`). The dashboard fold uses `costUsd ?? knownCostUsd` and still counts the fact as unpriced (`usage-summary-fold.ts:106-123`). `pricedCost` reads only `costUsd`.
- Impact: the usage dashboard shows a lower bound. The welcome tiles show an unknown total and omit that sum. Phase 2 names `usage-vitals.cache.ts`; the diff only changes a comment there (`usage-vitals.cache.ts:20-24`). The cache timeout is unchanged. The display bug is in the model those tiles already call.
- Fix: use the same null-preserving lower-bound rule as `foldUsageSummary`, and keep a separate unpriced flag so a null `knownCostUsd` stays unknown rather than becoming 0.

## Moderate and minor issues

- Moderate. A newer contribution after a finalize request always reopens the row (`session-stats-repository.ts:202-203`). A late checkpoint with a higher revision undoes a real stream-end seal until the idle pass. Clear pending only when the new revision is a resume past `finalize_revision`.
- Moderate. The seal loop rethrows and abandons the rest of the page (`session-stats-repository.ts:276`). Continue per row. The busy spec does not exercise this catch (`session-stats-repository.spec.ts:111-113`).
- Minor. The empty catch at `session-stats-repository.ts:272-275` is documented as busy-only. It swallows every failure of the retry update. Log that error and rethrow it with the original.

Checked and not filed as defects:

- S0003 is a static string with no `${}` (`session-store-migrations.ts:99-109`). The runner applies it with `db.exec` inside `BEGIN IMMEDIATE` (`migration-runner.ts:267-269`). A failed migration rolls the version insert back with the SQL.
- Stop does not finalize. Compaction does not call `requestFinalization`. Turn interrupt keeps the record (`session-control.service.ts:103-157`); the timeout path removes the record so the stream-exit token match returns false and does not finalize (`chat-stream-broadcaster.service.ts:415-420`).
- Successful `endSession` and a token-matched stream exit do request finalization, after keys are captured (`sdk-agent-adapter.ts:1156-1161` and `:1612-1620`). Those match a real record teardown. They are still subject to the quit ordering bug above.
- The worker is one unref'd interval, one in-flight pass, at most 32 rows (`sqlite-session-usage-sink.ts:104-126`). Registration does not await it (`register-session-store.ts:56`). Startup of the host function is not blocked. `flush()` is the disposal path; it is not a leak, but it runs too early (Serious issue 2).
- Dashboard fold does not coerce a null cost to a displayed zero. `totalCostUsd` stays null when no fact had a cost (`usage-summary.view-model.ts:172`). `(cost ?? 0) > 0` is only the emptiness check (`usage-summary-fold.ts:109`). Top-session `costUsd` is null when `known_cost_micro_usd` is null (`usage-summary.service.ts:84`). The pre-existing `?? 0` on priced groups (`usage-summary.service.ts:69`) applies only when `has_unpriced === 0`, so the sum is not null in that branch.
- `knownCostUsd` and `coverageStart` are optional on the strict Zod objects (`rpc-analytics.types.ts:23` and `:44`). The producer and the dashboard view model both read them (`usage-summary.view-model.ts:297`). The usage fact refine still requires `costUsd === null` exactly when `costSource` is `unpriced`.
- The dashboard template interpolates `coverageStartDay` (`usage-dashboard.component.html:57-60`). The diff adds no `[innerHTML]`, `@Input`, or `@Output`. The component was already standalone and `OnPush`. Its existing `constructor()` is unchanged and is not part of this diff.
- No new `any`, `@ts-ignore`, or `as unknown as` in the diff. Finalization failures that the owner and the sink catch are logged with a real `Error`. Public alias imports are unchanged. No new `vscode` or `electron` import in the host-neutral path.

## Data flow

1. True-end call sites (`endSession`, token-matched stream exit, workspace dispose, config re-init, `dispose`) capture ids, then call `SessionStatsOwnerService.requestFinalization`. Config re-init and the unwired quit path are gaps. Stop is OK.
2. The owner ignores a missing method and otherwise enqueues `SqliteSessionUsageSink.requestFinalization` on the same tail as usage writes. OK for writes already queued. A write enqueued later reopens the row.
3. `requestFinalization` sets `finalize_pending` unless the row is already `finalized`. A missing stats row is a silent no-op. OK for a session that never recorded usage.
4. `startFinalizer` waits for the current tail, then `reconcileFinalizations`. The revision predicate avoids sealing a row whose revision changed. The `active` idle arm seals rows that never requested finalization. Not OK.
5. `UsageAnalyticsService` turns ledger groups into facts, sets `knownCostUsd` when the micro-USD sum is non-null, and always marks `claude-ledger` partial, with `coverageStart` when coverage exists. OK for the contract. The partial flag is broader than an empty range.
6. `foldUsageSummary` / `buildUsageViewModel` keep null as unknown and add `knownCostUsd` as a lower bound. OK. Welcome `pricedCost` drops `knownCostUsd`. Not OK.
7. The template shows `Captured since` and a partial empty sentence. The date is the UTC day of `first_captured_at_ms`, which matches `UsageSummary.timeZone: 'UTC'`. The empty sentence does not compare that day to the selected range.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| True end queues `finalize_pending`; Stop, compaction, and turn abort do not | PARTIAL | Stop, compaction, and turn interrupt are clean. Config re-init seals, and Electron quit never queues. |
| Bounded startup/idle worker, startup not blocked, one pass at a time | PARTIAL | Bounds and unref are in place. The idle arm seals live sessions. `flush()` cancels the worker before quit requests are queued. |
| Resume clears pending | PARTIAL | Only a newer `recordEvent` clears it. Reopening a chat does not. A late higher revision also clears a real end. |
| Idempotent seal and revision check | COMPLETE | Second pass skips `finalized`. The `UPDATE` requires the captured revision, status, and max turn revision. |
| S0003 static SQL, old rows keep defaults | COMPLETE | No interpolation. New integer columns default to 0; `finalize_revision` is nullable. |
| SQLite busy leaves the row pending | PARTIAL | The catch tries to keep pending, then aborts the page. The new test does not hit that catch. |
| No JSONL backfill | COMPLETE | No backfill service was added. |
| Electron and CLI register the worker | PARTIAL | Both call `registerSessionStoreServices`, which starts the timer. Quit on both hosts is ordered wrong. Guard specs did not need a new token. |
| Dashboard stops aggregating what SQL already returns, null cost stays unknown, coverage shown | PARTIAL | Session and message counts stay on the SQL fields. Chart folding remains, and the RPC still has no chart series. Null cost is preserved on the dashboard. Welcome tiles do not show the lower bound. Coverage text is shown; the empty state over-claims. |
| Shared Zod contract accepted by producer and dashboard | COMPLETE | Optional fields. Welcome reader ignores `knownCostUsd`. |

Implicit requirements not addressed: a live-session exclusion for the idle sweep; an awaited finalization hook on Electron shutdown; the same cost rule in welcome tiles.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Stop / interruptSession | YES | No `requestFinalization` | None on this path |
| Compaction | YES | Budget tap only | None |
| Turn interrupt | YES | Record stays, or timeout removes it before token match | A stream error that is not an abort and still matches the token does finalize. That is the existing stream-exit teardown |
| Token-matched stream end | YES | Finalizes after a successful end | Late higher-revision write reopens |
| App quit | NO | Electron never requests; CLI flush runs first | Idle sweep seals later |
| Config re-init | NO | Finalizes snapshotted ids | Replacement id can be sealed |
| Resume after finalize | PARTIAL | Next newer usage upsert clears flags | Resume with no new usage stays sealed |
| Duplicate usage after seal | YES | Older or equal revision returns before the upsert | Does not reopen, which is right |
| SQLite busy before metadata write | PARTIAL | Empty catch, original error rethrown | Rest of the page skipped; test misses the branch |
| Empty session (no stats row) | YES | `UPDATE` matches nothing | No row to seal |
| Null cost | PARTIAL | Dashboard keeps null and optional known sum | Welcome tiles drop the known sum |
| Coverage absent | YES | `coverageStart` omitted; reason says nothing captured | Empty copy still says partial whenever any source is partial |
| Migration replay | YES | Versioned runner, static multi-statement `exec` | None found in this diff |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM
- Top risk: the 30-minute sweep is the real finalizer, and it seals sessions that are still open or were only quit, while the explicit quit hook is not on Electron's shutdown path.
- What a robust implementation would add: live-id exclusion, awaited quit ordering before `flush()`, config re-init removed from the true-end list, resume clearing that is not "any newer write", per-row busy handling, and the dashboard lower-bound rule on welcome tiles.

Verification gap: this review did not execute the new repository specs or a scoped `nx` target. The implementation report's verify command exited 1 with `spawn EPERM` and is not evidence that the seal queries pass.
