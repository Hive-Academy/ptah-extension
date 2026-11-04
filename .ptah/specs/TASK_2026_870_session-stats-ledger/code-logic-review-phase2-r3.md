# Code Logic Review — `TASK_2026_870` Phase 2, round 3

## Summary

| Metric              | Value                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Overall score       | 8/10                                                                  |
| Assessment          | APPROVED                                                              |
| Blocking issues     | 0                                                                     |
| Serious issues      | 0                                                                     |
| Moderate issues     | 1                                                                     |
| Minor issues        | 0                                                                     |
| Failure modes found | 1                                                                     |

Reviewed `62ddec9e1` (`git show 62ddec9e1 -- libs apps`) on `feat/session-stats-finalizer`. The later merge `0acad229f` only brings in `origin/main` and does not touch the session-stats, shutdown, vitals, or usage-dashboard files in that commit. `task-tracking/` was ignored. No source was edited. Tests, typecheck, and `ptah_get_diagnostics` were not run; this assignment forbids them. The fix report's verify still ends at Nx `spawn EPERM` and is not evidence.

This is an 8, not a 9. The three round-2 defects are fixed in the paths that caused them: the startup scan waits until a live-id provider exists and does not block boot or quit; Electron queues `requestFinalization` before the 5-second interrupt; a higher revision no longer clears a true end. It is not a 7. What remains is one bounded page: that startup scan seals at most 32 idle `active` rows and then never selects `active` rows again until the next process start. Pending true ends are not in that gap.

Skill note: this review was not assigned a skill. Angular checks use the task's stated rules. `angular-frontend-patterns` was not loaded.

## Round-2 findings

| Round-2 finding | Status | Evidence |
| --- | --- | --- |
| Startup idle scan runs before the live-id provider is installed, so `active` rows are never scanned | **Fixed** | `startupScanPending` stays true until a pass actually runs with a provider (`sqlite-session-usage-sink.ts:62`, `:143-146`). `setTimeout(0)` with a null provider reconciles pending rows only and does not clear the flag. `setLiveSessionIdsProvider` starts a pass immediately, or sets `providerChangedDuringPass` when one is already running, and the `finally` runs one follow-up (`sqlite-session-usage-sink.ts:117-122`, `:150-155`). `flush()` runs one leftover startup pass when the provider is already set (`sqlite-session-usage-sink.ts:171-174`). Spec covers provider-first and timer-first and keeps the live id `active` (`session-stats-repository.spec.ts:69-86`). |
| Electron 2s dispose budget closes SQLite before `requestFinalization` is queued | **Fixed** | Quit reads live usage ids and awaits `requestFinalization` before chat dispose (`shutdown.ts:303-317`). `SdkAgentAdapter.dispose` queues the same kind of request before `disposeAllSessions` (`sdk-agent-adapter.ts:818-821`). Both waits stay inside `withBudget` (`shutdown.ts:307-311`, `:338-344`, `:358-364`), so quit cannot block forever. The sink attaches the write to `this.tail` synchronously (`sqlite-session-usage-sink.ts:97-104`). `flush()` awaits that tail before it returns (`sqlite-session-usage-sink.ts:169`), and SQLite close is the next step (`shutdown.ts:367`). The new spec holds chat dispose open and still sees `finalize session-a` first (`shutdown.spec.ts:380-405`). |
| A higher aggregate revision reopens a true end, and the periodic pass never seals it again | **Fixed** | The upsert keeps `status`, `finalized_at_ms`, and `finalize_revision` whenever `finalize_revision` is already set (`session-stats-repository.ts:205-210`). Only `resumeSession` clears them (`session-stats-repository.ts:250-255`), called from `prepareRun` and `startNew` (`session-stats-owner.service.ts:490-512`). Spec: revision 2 after a seal stays `finalized`, `resumeSession` returns the row to `active`, and a later request seals again (`session-stats-repository.spec.ts:93-112`). |

The round-2 note that the retry-metadata catch logs and does not rethrow is unchanged (`session-stats-repository.ts:296-301`). The fix report correctly left it. Rethrowing would drop the rest of the page.

## Decisions

- **Queuing the quit snapshot before interrupt is the right fix.** A session that is live when Electron begins shutdown is ending with the process. Options were: wait until `disposeAllSessions` removes it, and risk the 2s budget closing the database first, or queue first and let the sink serialize behind accepted usage. The code does the second. Evidence: `shutdown.ts:303-311` and `sdk-agent-adapter.ts:818-821`. Reversible.
- **One 32-row startup page is a remaining gap, not a reason to reject the seal predicate.** Pending rows are retried every 60 seconds. Idle `active` rows are not. Evidence is Moderate issue 1. Reversible: keep `startupScanPending` set when the startup page comes back full.

## Five logic questions

### 1. How does this fail silently?

The startup pass reports a changed-row count after a single `LIMIT 32` page and then clears `startupScanPending` (`sqlite-session-usage-sink.ts:144-146`, `session-stats-repository.ts:266-271`). Idle `active` rows that did not fit that page stay `active` for the rest of the process. The caller cannot tell a short page from a finished scan. Pending rows are not stuck this way: the interval keeps selecting `finalize_pending`.

No path turns a failed seal into a success flag for the whole store. A row error is logged and the loop continues (`session-stats-repository.ts:286-301`).

### 2. What user action produces unexpected behaviour?

Run Electron for a long time with more than 32 sessions whose last usage and last write are both at least 30 minutes old, and which are not in the live-id list. The first startup pass seals the oldest 32. The rest stay `active` until the next process start, which seals the next oldest 32. Spend totals do not read `status`. The ledger status is still wrong for those rows during this process.

Leave a chat registered. Its ids come from `getLiveSessionIds` expanded by `sessionKeys` (`sdk-agent-adapter.ts:294-296`). The startup `UPDATE` skips those ids (`session-stats-repository.ts:273-274`). A periodic pass cannot select an `active` row at all (`session-stats-repository.ts:268-270`). Stop, compaction, turn interrupt, and config re-init still do not request finalization (`sdk-agent-adapter.ts:410-422` has no request; `interruptSession` still only ends the record).

### 3. What input data produces a wrong answer?

An idle `active` row beyond the first 32, as above.

A later usage event no longer does. Once `requestFinalization` has stored `finalize_revision`, a higher `MAX(revision)` updates tokens, cost, and `revision`, and leaves `status` alone (`session-stats-repository.ts:205-216`). A null `costUsd` with a null `knownCostUsd` stays a null total. `formatSpendAmount` returns `text: null` for a non-finite cost (`usage-vitals.model.ts:110-111`). `toSpendCell` renders that as an empty cell, not `$0.00` (`welcome-vitals.view.ts:131-132`). `buildUsageViewModel` sets `totalCostUsd` only when `totalCostKnown` (`usage-summary.view-model.ts:172`). `finalizeCost` returns null when the accumulator never saw a cost (`usage-summary-fold.ts:48-49`). The fold's `(cost ?? 0) > 0` is only the emptiness check (`usage-summary-fold.ts:109`). A known zero stays 0 (`usage-summary.view-model.spec.ts:275-288`). An unpriced fact with `knownCostUsd` is a lower bound: welcome text is `≥ $2.50` (`usage-vitals.model.ts:113-114`, `welcome-vitals.view.spec.ts:149-158`), and the dashboard KPI shows `Unknown` when the total is null and `≥` only after a real number (`usage-kpi-strip.component.ts:60-61`).

### 4. What happens when a dependency fails?

The live-id provider is a callback, not a promise. Nothing awaits it. Boot returns after `setTimeout(0)` (`sqlite-session-usage-sink.ts:128-134`, `unref`). If the provider is never installed, pending rows still reconcile and idle `active` rows are never guessed. If it is installed during a pass, one follow-up pass runs (`sqlite-session-usage-sink.ts:150-155`). That follow-up is not awaited by the pass that scheduled it, so the passes cannot deadlock on each other. `flush` awaits the current pass and at most one startup pass (`sqlite-session-usage-sink.ts:169-174`).

Quit's finalization wait, chat dispose, SDK dispose, and usage drain each give up at their budget and continue (`shutdown.ts:466-486`). A rejected dispose is logged and does not skip `flush` or SQLite close. The finalization write is already on the sink tail before those budgets start. `flush` waits for that tail. Close is after `flush` returns, or after the drain budget expires. A `better-sqlite3` write holds the thread, so the budget timer cannot close the database in the middle of the statement. The request that was queued at `shutdown.ts:309` reaches SQLite before close on that path.

`ready()` throwing still fails the whole pass (`session-stats-repository.ts:263`). The sink logs it (`sqlite-session-usage-sink.ts:147-149`). `startupScanPending` stays true because it is cleared only after `reconcileFinalizations` resolves. The next pass retries. S0003 is still a static string (`session-store-migrations.ts:99-104`).

### 5. What is missing that the requirements never mentioned?

Nothing beyond the single startup page. JSONL backfill is still absent, which matches the user decision. There is still one unref'd timer, started from `registerSessionStoreServices`, with no new DI token.

## Failure modes

### Startup scan seals one page and then ignores `active` rows

- Trigger: more than 32 `active` rows are idle on both `last_usage_at_ms` and `updated_at_ms`, and they are not in the live-id list, at the moment the provider is installed.
- Symptom: the oldest 32 become `finalized`. The others stay `active` until a later process start runs its own one-page scan. A true end is not in this set: `finalize_pending` is selected on every pass.
- Evidence: `session-stats-repository.ts:266-271` (`LIMIT 32` over pending and, only when `startup = 1`, idle `active` rows). `sqlite-session-usage-sink.ts:143-146` clears `startupScanPending` after that one call even when the page is full. The interval calls `runFinalizerPass` with the flag already false (`sqlite-session-usage-sink.ts:133`).
- Current handling: live ids in the page are skipped (`session-stats-repository.ts:274`), which can make the sealed count even smaller. The next process start scans again because the flag is in memory.
- Recommendation: if the startup select returns 32 rows, leave `startupScanPending` true so the next pass continues. Stop when a startup pass returns a short page.

## Blocking issues

None.

## Serious issues

None. The round-2 startup race and the round-2 quit race are not still present. See the table above.

## Moderate and minor issues

- Moderate. The startup idle scan is one 32-row page per process (`session-stats-repository.ts:271`, `sqlite-session-usage-sink.ts:146`). Idle `active` rows after that page are not sealed until the next launch. Continue while the page is full.

Checked and not filed:

- No unbounded wait on the provider. The flag is polled by the existing interval and by `setLiveSessionIdsProvider`. Boot is not awaited on it. Quit's extra startup work is one `flush` pass, still under the drain budget.
- Quit does not wait out the 5-second interrupt before queueing. `session-control.service.ts` still races interrupt at 5 seconds, and the dispose budgets are still 2 seconds. The request no longer sits behind that race.
- `dispose()` and the Electron snapshot both finalize ids captured before teardown. A same-id replacement that appears during the interrupt is not in that snapshot. Workspace dispose still skips ids that are live after the await (`sdk-agent-adapter.ts:968-972`). Config re-init does not request finalization (`sdk-agent-adapter.ts:410-422`).
- A registered chat is excluded from the startup seal. A periodic pass cannot seal it. `resumeSession` sets `updated_at_ms` to now (`session-stats-repository.ts:252-255`), so a resume that lands before the scan is also outside the 30-minute idle predicate.
- After `requestFinalization`, a late higher revision does not return the row to `active`. The periodic pass can still seal `finalize_pending`. The row is not left active for lack of a re-seal.
- `endSession` and the token-matched stream exit still request only after the record actually ends (`sdk-agent-adapter.ts:1163-1165`, `:1627-1628`). If `endSession` rejects, the `.then()` does not request. That is the previous failure path, and the catch logs it (`sdk-agent-adapter.ts:1168-1172`).
- Welcome: null and non-finite costs format as no text (`usage-vitals.model.ts:110-111`). A finite unpriced cost, including a known 0, formats as `≥` plus the amount (`usage-vitals.model.ts:113-114`). `toSpendCell` maps a null amount to an empty cell (`welcome-vitals.view.ts:123-132`). The `empty` load state still shows `$0.00` (`welcome-vitals.view.ts:141-146`); that branch is "no spend at all", not a null ledger cost.
- Dashboard: `totalCostUsd` is null when no in-range fact had a cost (`usage-summary.view-model.ts:172`). Provider and model costs go through `finalizeCost` (`usage-summary-fold.ts:48-49`). The KPI label is `Unknown` for null (`usage-kpi-strip.component.ts:60-61`). Top-session null cost is the word `Unpriced`, and `≥` is used only when `costUsd` is a number (`usage-top-sessions.component.ts:43-45`).
- The dashboard template still interpolates coverage text (`usage-dashboard.component.html`). This commit adds no `[innerHTML]`, `@Input`, or `@Output`. No new `any`, `@ts-ignore`, or `as unknown as` in the reviewed seal path.

## Data flow

1. True ends (`endSession`, token-matched stream exit, workspace dispose of ids that are gone, Electron quit, `dispose`) call `requestFinalization`. Stop, compaction, turn interrupt, and config re-init do not. OK.
2. Electron queues those requests, then disposes chats, then disposes the adapter (which queues again), then `flush`, then closes SQLite. The queue is on the tail before the slow interrupt. OK.
3. CLI still awaits adapter `dispose` before `shutdownHostRuntime` flushes. Unchanged and still ordered.
4. `requestFinalization` sets `finalize_pending` and `finalize_revision` unless the row is already `finalized`. A missing row matches nothing. OK.
5. A later `recordEvent` keeps that seal. `resumeSession` is the only clear. OK.
6. The worker seals due pending rows every 60 seconds, at most 32 per pass. The startup pass also seals idle `active` rows that are not live, once, one page. The pending half is OK. The idle half stops after 32. Not OK for a larger set.
7. Welcome and the dashboard view model treat a missing cost as unknown and a partial known sum as `≥`. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| True end queues `finalize_pending`; Stop, compaction, turn abort, and config re-init do not | COMPLETE | Quit queues before the interrupt budget. |
| Startup scan waits for live ids, does not seal an open chat, does not block startup | PARTIAL | The wait and the live-id exclusion are in place. One pass seals at most 32 idle rows. |
| Quit is not blocked, and the finalization write is on the tail before SQLite close | COMPLETE | Budgets remain. The request is synchronous on the tail; `flush` observes that tail. |
| A true end is not reopened by a later revision | COMPLETE | Explicit `resumeSession` is the only clear. |
| Bounded worker, one pass at a time, no per-session timer | COMPLETE | One unref'd interval. A provider installed mid-pass schedules one follow-up, not a loop. |
| S0003 static SQL | COMPLETE | No interpolation. |
| Null cost stays null; a known partial sum shows `≥` | COMPLETE | Welcome `formatSpendAmount` / `toSpendCell` and dashboard `finalizeCost` / KPI label. |
| No JSONL backfill | COMPLETE | None added. |

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Provider installed before the first timer | YES | `setLiveSessionIdsProvider` runs a pass when the timer exists; otherwise the timeout sees the provider | None |
| Timer fires before the provider | YES | Flag stays set; provider install or a later pass runs the startup scan | None |
| Provider installed during a pass | YES | One follow-up after `finalizerRunning` clears | Not awaited by the in-flight pass, so no deadlock |
| Provider never installed | YES | Pending rows still seal; idle `active` rows are not guessed | Hosts that never construct the adapter |
| Open chat in the registry | YES | Live ids skipped; periodic SQL has no `active` arm | None |
| Resume just before the scan | YES | `resumeSession` refreshes `updated_at_ms`, so the idle predicate misses it | None |
| More than 32 idle `active` rows | NO | First page seals; flag clears | Next process start continues |
| Quit while interrupt is still inside 5s | YES | Request already queued; `flush` waits for the tail; close follows | Budget can abandon `flush`'s wait; the sync write itself is not preempted |
| Higher revision after seal | YES | Status preserved | Totals still update |
| Explicit resume | YES | Clears seal; a later request can seal again | `startNew` uses the same statement; a new id matches no row |
| Null cost | YES | Welcome dash; dashboard `Unknown` / null | Known zero still displays as zero |
| Unpriced with `knownCostUsd` | YES | `≥` plus the amount | Welcome view included |
| One bad row | YES | Log, retry metadata, continue | Unchanged |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: a process with more than 32 idle sessions seals only the oldest page, and no later pass in that process selects `active` rows.
- What a robust implementation would add: repeat the startup scan until a short page, then clear `startupScanPending`.

Verification gap: this review did not execute the new specs or a scoped `nx` target.
