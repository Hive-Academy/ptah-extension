# Code Logic Review — TASK_2026_563_2939, Batch 5

## Post-cap correction review

This review supersedes the round-2 verdict. All three findings are resolved; the bounded post-cap correction is **APPROVED**.

References are relative to `D:\projects\ptah-extension-memory-quality-source`. Short source filenames are under `libs/backend/memory-curator/src/lib/`; collector filenames are under `curator-llm/`.

| Finding                                                         | Final status                | Evidence                                                                                                                                                                                                                                    |
| --------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — Eligibility changes during append preparation (Blocking)    | RESOLVED in round 1         | `memory.store.ts:747–779` performs eligibility, chunk numbering, chunk/vector inserts and lifecycle update within one transaction after embedding. `memory-curator.service.ts:692–734` counts only appended and inserts once on ineligible. |
| 2 — Abandoned queries accumulate (Serious)                      | RESOLVED by this correction | Collector `:225` tracks every non-response outcome, including abort; `:189` suppresses new tier-2 work before evaluating cooldown; `:284–289` clears only the matching promise on fulfillment or rejection.                                 |
| 3 — Optional enrichment can spend nearly 150 seconds (Moderate) | RESOLVED in round 2         | Collector `:39`, `:194`, `:207–216` bounds cumulative query waiting to 20 seconds under normal clock/event-loop behavior, with an 8-second individual cap.                                                                                  |

**Batch 3 appendChunks delta remains APPROVED**, limited to the atomic append/caller contract examined in round 1, not other concurrently revised Batch 3 work.

## Summary

| Metric              | Value        |
| ------------------- | ------------ |
| Overall score       | 8/10         |
| Assessment          | APPROVED     |
| Blocking issues     | 0            |
| Serious issues      | 0            |
| Moderate issues     | 0            |
| Failure modes found | 0 unresolved |

The remaining ownership gap is closed: on the serialized production path, at most one abandoned search from this collector can remain outstanding. The exact-scope atomic merge and cumulative latency safeguards from prior rounds remain in place. That evidence supports the sound 7–8 band over the previous 5–6 band. Production worker recovery, real latency and cross-process/dual-driver verification were not established by this review, so an exemplary 9–10 score is not warranted.

Scope: reread the complete revised collector, the revised timeout/budget/abort/recovery tests, and reconfirmed the production singleton/queue wiring. Unchanged collector tests and all five initial Batch 5 files were read in prior rounds. The store append delta and caller/regressions were reviewed in round 1. Task context, M3.1–7/M5.8, component 7 and Gate 2 D4=B remain the behavioral contract. CONVENTIONS.md and the existing style review were examined previously; no style issues are duplicated.

Verification: ran once from the specified worktree:

`npx jest -c libs/backend/memory-curator/jest.config.ts --testPathPatterns "merge-candidate-collector" --runInBand`

**1 suite, 22 tests passed**, 2.925 seconds. PowerShell printed its native-stderr wrapper; Jest reported success. Earlier evidence: round 2 passed 2 suites/81 tests; round 1 passed 3 suites/155 tests including store; initial review passed 3 suites/80 tests including DI. These are separate scoped runs, not a claim of rerunning unchanged suites today or dual-driver verification.

`ptah_get_diagnostics` again returned **Unavailable: None of the requested files are inside the workspace root**. No lint/typecheck, real-worker leak measurement, production latency measurement, mutation test or new fault-injection test was performed. Only this review artifact was rewritten; no source, git state or existing database was modified.

## Five logic questions

### 1. How does this fail silently?

No unresolved silent-success defect was established in the correction. Pending suppression returns the original tier-1 candidates with explicit `tier2Skipped: 'abandoned-pending'`, zero tier-2 queries and zero new rows (`merge-candidate-collector.ts:169–189`). The existing curator diagnostic logging exposes those fields (`memory-curator.service.ts:620–629`). Atomic append success remains explicit (`memory-curator.service.ts:692`).

### 2. What user action produces unexpected behaviour?

Repeated passes after cancelling a still-pending search now receive tier 1 without launching more searches (`merge-candidate-collector.ts:189`, `:225–226`). The regression verifies zero additional calls until settlement, then recovery (`merge-candidate-collector.spec.ts:577–630`). If the dependency never settles, semantic enrichment stays disabled for this collector's lifetime; this is acceptable optional-capability degradation, discussed below, rather than a new defect.

### 3. What input data produces a wrong answer?

No new wrong candidate or merge result was established. The pending/cooldown gates run after exact tier-1 lookup and strict D4=B (`merge-candidate-collector.ts:161–190`). Empty tier 1 still produces no tier-2 query. Scope filtering, dedupe and 5/25/10/512 bounds remain at `:23–29`, `:192`, `:199–250`. Late results are ignored by the completed collector and cannot contaminate a later pass's candidate array (`:224–231`, `:269–275`).

### 4. What happens when a dependency fails?

Synchronous search throws and rejected searches enter the existing warning/fallback catch (`merge-candidate-collector.ts:218–265`). Rejections are settled operations and do not need pending suppression. Deadline or abort tracks the underlying promise, then immediately exits the query loop (`:225–231`). The race clears its timer/listener (`:118–120`); late rejection is observed (`:104`, `:113`, `:289`). The pending entry clears on either settlement with an identity check (`:284–289`). Timeout/budget abandonment additionally retains cooldown; abort alone adds no time cooldown.

### 5. What is missing that the requirements never mentioned?

The earlier implicit need for cross-pass ownership is now explicit in `abandoned` (`merge-candidate-collector.ts:136–141`). A permanently unresponsive dependency has no automatic cancellation/restart path in this correction. Retaining one outstanding query and falling back to exact-subject candidates is an acceptable bounded policy for the current optional feature; broader worker recovery remains a follow-up, not an unresolved Batch 5 defect.

## Failure modes

No unresolved failure mode was established in this correction. The following adversarial traces were checked:

- **Repeated timeout/cooldown cycles:** the abandoned-pending gate precedes the clock check, so any number of passes after cooldown expiry still issue zero queries while the old one is pending (`merge-candidate-collector.ts:189–190`). The spec advances the full cooldown and proves this (`merge-candidate-collector.spec.ts:422–434`).
- **Settlement before cooldown expiry:** clearing the pending reference does not clear cooldown; a subsequent pass returns cooldown until time elapses (`merge-candidate-collector.ts:287`, `:296–303`; spec `:456–490`).
- **Settlement after cooldown expiry:** the next eligible pass can close/log the breaker once and search again (`merge-candidate-collector.ts:296–303`; spec `:436–453`).
- **Abort mid-flight:** tracking happens before the abort break, fixing the prior bypass (`merge-candidate-collector.ts:225–226`; spec `:618–629`). An already-aborted signal launches no query (`:202`; spec `:664`).
- **Budget-capped deadline:** the same non-response branch tracks the query before classifying timeout versus budget (`merge-candidate-collector.ts:225–230`). Budget exhaustion between completed queries launches no new query and therefore correctly does not create pending state (`:207–214`).
- **Late fulfillment/rejection:** both handlers clear the matching promise only (`merge-candidate-collector.ts:284–289`). `clear` neither throws nor returns a rejected promise, so its unawaited `.then` introduces no unhandled rejection path. A promise settling just before tracking is also safe: attaching handlers to the already-settled native promise schedules cleanup.
- **Multiple abandoned queries in one pass:** impossible on this production path: each query is awaited, and every abandonment immediately breaks (`merge-candidate-collector.ts:224–231`). The next pass checks pending state before dispatch.

Residual uncertainty: these traces combine source inspection and the existing passing specs. The identity check and repeated-cycle invariant were traced rather than exercised through new mutation tests; actual Electron worker memory retention was not measured.

## Blocking issues

None. Previous finding 1 remains resolved by atomic store/caller behavior (`memory.store.ts:747–779`; `memory-curator.service.ts:692–734`).

## Serious issues

None. Previous finding 2 is resolved by pending suppression and settlement cleanup (`merge-candidate-collector.ts:189`, `:225`, `:284–289`).

## Moderate and minor issues

None established in the bounded correction. Previous finding 3 remains resolved (`merge-candidate-collector.ts:207–216`). Non-gating follow-ups are listed below rather than counted as defects.

## Data flow

1. **OK — production serialization:** one collector is constructed by the singleton curator (`memory-curator.service.ts:210`; `di/register.ts:157–159`). All passes flow through its job queue (`memory-curator.service.ts:168`, `:390–391`), whose promise chain waits for the current job (`curator-job-queue.ts:144–152`). Two production collector calls cannot run concurrently. Direct concurrent use of this internal helper is not its current production contract.
2. **OK — exact tier 1 and D4=B:** tier-1 lookup precedes no-search/blank-root/empty-tier-1 returns (`merge-candidate-collector.ts:161–186`). No runtime A/B switch was introduced.
3. **OK — suppression precedence:** outstanding abandoned work is checked before cooldown (`:189–190`). Passing time alone cannot cause another request while the prior one remains pending.
4. **OK — normal collection:** each query uses the exact scope and bounded size; accepted rows remain deduplicated and tier 1 retains its original order (`:199–250`, `:270`). No usage/salience write was added.
5. **OK — stop and retain:** all non-response outcomes track the same underlying search promise before breaking (`:219–231`). At most one operation from the collector can be abandoned on the serialized path; stopped passes cannot accumulate more behind it.
6. **OK — recovery:** identity-checked handlers clear only the tracked operation on either settlement (`:284–289`). Abort recovery can resume immediately after settlement; deadline recovery also waits for cooldown (`:296–317`).
7. **OK — merge accounting:** prior approved behavior remains: eligibility is rechecked transactionally, appended increments merged, ineligible reaches exactly one insert, and thrown persistence errors count skipped (`memory.store.ts:747–790`; `memory-curator.service.ts:681–734`).

## Requirements fulfilment

| Requirement                             | Status                             | Evidence                                                                                               |
| --------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| M3.1 tier ordering/dedupe               | COMPLETE                           | Collector :192, :240, :270                                                                             |
| M3.2 5/25/10/512 bounds                 | COMPLETE                           | Collector :23–29, :199–250                                                                             |
| M3.3 exact scope                        | COMPLETE                           | Collector :161, :183, :243                                                                             |
| D4=B / M3.4 remote-call policy          | COMPLETE                           | Empty tier 1 returns at :186; adapter's empty-related short circuit unchanged                          |
| M3.5 optional failure fallback          | COMPLETE within collector contract | Collector :189, :225–231, :252–265; pending work bounded across passes                                 |
| Cumulative query budget                 | COMPLETE                           | Collector :207–216; spec :493–536                                                                      |
| M3.6 no read-side usage/salience writes | COMPLETE                           | Collector remains read-only; no search write-path change                                               |
| M3.7 / M5.8 guarded merge               | COMPLETE                           | Prior atomic store/caller approval retained                                                            |
| Optional DI / positional compatibility  | COMPLETE                           | Fourth clock parameter defaults, collector :148; service still constructs with three arguments at :210 |
| Abandoned-query lifetime bound          | COMPLETE                           | Pending gate :189; immediate break :226/:231; identity cleanup :287                                    |

## Edge cases

| Case                             | Handled                  | How                                       | Remaining limit                                          |
| -------------------------------- | ------------------------ | ----------------------------------------- | -------------------------------------------------------- |
| Empty tier 1 while pending       | YES                      | D4=B before pending gate, collector :186  | No new search                                            |
| Pending beyond cooldown          | YES                      | Pending gate before clock, :189           | Tier 1 only until settlement                             |
| Settlement before cooldown       | YES                      | Separate pending/time state, :287, :298   | Time cooldown still applies                              |
| Abort mid-query                  | YES                      | Track then break, :225–226                | No time cooldown imposed                                 |
| Multiple passes while pending    | YES                      | Return before dispatch, :189              | One retained query per production collector              |
| Late rejection                   | YES                      | Observed handlers and cleanup, :104, :289 | No late candidate insertion                              |
| Budget exhausted between queries | YES                      | Break without dispatch, :208–214          | No new pending state                                     |
| Never-settling query             | YES, bounded degradation | One retained query, tier-1 fallback       | Tier 2 remains disabled until settlement or host restart |
| Concurrent production passes     | YES                      | Singleton plus serial queue               | Internal helper is not a concurrent public API           |
| Ineligible target at commit      | YES                      | Atomic append refusal and one insert      | Prior finding resolved                                   |

## Follow-ups and accepted non-defect limitations

- **Permanent pending suppression is acceptable here.** It disables only optional semantic enrichment, keeps exact-subject candidates available, emits the explicit abandoned-pending diagnostic, and prevents additional requests against an unresponsive dependency (`merge-candidate-collector.ts:169–189`). The collector does not claim to repair the worker. If the worker exits/disposes, existing worker handlers reject pending requests, which allows the tracked search eventually to settle; otherwise restart is an operational recovery option (`embedder/embedder-worker-client.ts:151–155`, `:252–258`).
- **Actual cancellation can improve recovery later.** One retained promise/request and its continuations can remain for the host lifetime, but their count no longer grows with curator passes. Broader shared-worker cancellation/restart policy must account for other consumers and is not required to accept this bounded correction.
- **Latency tuning remains measurement work.** The 8-second/20-second defaults and five-minute cooldown are not validated against real cold/warm workloads here (`merge-candidate-collector.ts:39`, `:46`, `:53`). A bounded enrichment budget cannot guarantee a sibling survives arbitrarily long extraction/resolve or earlier backlog.
- **Clock/event-loop limits remain.** The default is `Date.now` (`merge-candidate-collector.ts:148`); consider a monotonic clock in later latency work. Timer deadlines cannot preempt synchronous SQL or a blocked event loop (`:109`, `:219`).
- **Shared embedder persistence stalls remain pre-existing.** Store writes still await embedding (`memory.store.ts:243`, `:727`). Approval of collection fallback and atomic append does not assert end-to-end recovery when every shared-worker operation hangs.
- **Additional confidence checks:** a direct late-rejection-recovery assertion and multiple repeated suppression cycles would strengthen regression coverage. Both settlement arms currently use the identical identity-checked callback (`merge-candidate-collector.ts:286–289`), so no logic defect is inferred from those unrun variations. Offline/model-cache measurements, diagnostics availability and dual-driver verification remain task-level gates.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the bounded correction and production-path invariant; actual worker recovery/performance remains unmeasured.
- Top residual limitation: a query that never settles holds semantic enrichment disabled while exact-subject collection continues.
- What a robust implementation could add later: cooperative worker cancellation, monotonic elapsed-time accounting, production latency measurements and further recovery regressions.
