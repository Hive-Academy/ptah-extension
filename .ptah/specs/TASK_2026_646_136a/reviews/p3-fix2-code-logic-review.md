# P3 final short code logic re-review — Batch 37b

## Summary

| Metric | Result |
| --- | --- |
| Scope | `git show 623644993 -- libs/backend/lane-routing` |
| Score | **7/10** |
| Verdict | **NEEDS_REVISION** |
| Blocking / serious / moderate / minor | **0 / 0 / 1 / 0** |

The correction closes the provider-log, successful mark-write race, and unbounded stale-probe retry. One storage failure can still make an old unsupported mark the last durable value while the selection change reports success. This is narrower than the former serious race, but prevents approval. The orchestrator reports 18 passing suites / 388 tests, lint, and typecheck; scoped Ptah diagnostics show zero errors. I did not run tests under decision #53.

## Findings status

| Item | Status | Evidence |
| --- | --- | --- |
| S-1 rest: provider model and transport detail | **CLOSED.** | The success log uses the requested `this.options.model`, not the provider response (`lib/decision-model/system-one.client.ts:193-196`). A transport rejection returns `transport error (<name>)` without reading `error.message` (`:208-222`); the warn log copies that detail (`:232-238`). The targeted spec injects a secret in both former paths (`lib/decision-model/system-one.client.spec.ts:453-500`). |
| S-3 rest: ordered mark writes and current row | **PARTIAL — Moderate.** | The in-chain key check, common queue, and ordered clear close the successful-write race (`lib/decision-model/decision-model.config.ts:313-335,622-628,672-677`); `applyProbe` rechecks the key after awaited writes (`:465-479`). A failed clear is swallowed and can leave the old mark durable; see issue below. |
| Stale-probe budget | **CLOSED.** | `getStatus` starts with one retry allowance (`lib/decision-model/decision-model.config.ts:247-279`); a mismatch spends it once, then uses `currentRowWithoutProbe` (`:452-455,650-669`). `recheckAfterLiveNotFound` passes `false` (`:373-380`). The two-change test checks exactly two probes (`lib/decision-model/decision-model.config.spec.ts:850-897`). |

## New issues

| Severity | Issue |
| --- | --- |
| Moderate | **A failed clear can make a stale mark the last persisted value.** If A's mark write succeeds, the user selects B, and `storage.update(key, undefined)` rejects, `clearMark` has already set memory to `null` (`lib/decision-model/decision-model.config.ts:672-677`), but `persistMark` logs and swallows the rejection (`:631-643`). Consequently `setSelection` resolves (`:162-175`) with A still on disk. After restart and a later selection of A, `loadMark` restores that unsupported verdict (`:589-612`), so a current endpoint may be treated as unsupported without a fresh probe. **Fix:** surface clear failure to the selection caller and retry or reconcile the durable mark before treating the selection change as complete. Add a rejecting-storage regression test. |

The queue does not become rejected after an ordinary `storage.update` rejection: `persistMark` catches it (`lib/decision-model/decision-model.config.ts:631-643`) and `enqueueMark` also installs a recovered continuation (`:622-628`). A never-settling storage update can hold the queue and callers indefinitely (`:622-635`); this pre-existing storage-bound wait has broader impact with serialization, but no evidence here establishes a required storage deadline, so I have not scored it as a separate finding. No other defect was established in the bounded diff.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Score the failed clear as moderate rather than reopening the successful-write race as serious | Accept the queue as a full durability guarantee / distinguish successful writes from failed storage | `lib/decision-model/decision-model.config.ts:631-643,672-677` catches the failed clear; the held-write spec at `lib/decision-model/decision-model.config.spec.ts:805-848` verifies only successful storage updates. | Yes |
| Keep M-1 and M-2 outside this verdict | Reopen / defer | Neither `rotation.store.ts` nor `gather.ts` changes in commit `623644993`; the handoff assigns LT-P3-4 and LT-P3-1. | Yes |
