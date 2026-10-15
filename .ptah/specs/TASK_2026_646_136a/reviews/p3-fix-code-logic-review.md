# P3 fix code logic re-review — `TASK_2026_646_136a`

Scope: Batch 37 commit `8d29af556`, `libs/backend/lane-routing`. Paths and line numbers below are relative to `libs/backend/lane-routing/src` at that commit. I compared the changed code, the first P3 review, Batch 37 report, and targeted specs. The orchestrator reports 18 suites / 385 tests, lint, typecheck, host container smoke, degradation audit and DI lint passing. I ran no Nx, Jest, build, or git writes. A direct `ptah_get_diagnostics` request timed out while its TypeScript check remained in progress, so it supplied no additional result.

## Summary

| Metric | Value |
| --- | --- |
| Score | 5/10 |
| Verdict | NEEDS_REVISION |
| Blocking / serious / moderate / minor | 0 / 2 / 2 / 0 |
| Failure modes | 4 |

Two serious boundary defects and two moderate concurrency/budget defects remain. The bounded structured call and failed-mark-read fixes are sound; those separate this score from 3–4. Provider-controlled logging and a stale persisted mark keep it below 7. M-2 (gather deadline) is excluded by decision #93.

## Findings status

| Original finding | Status | Evidence and remaining impact |
| --- | --- | --- |
| S-1, provider text in logs/marks | **PARTIAL — Serious.** Error HTTP bodies are removed from failure detail (`lib/decision-model/system-one.client.ts:160-170`), and the Ollama probe compares bodies without returning them (`lib/decision-model/decision-model.probe.ts:124-135`). But a successful response's provider-controlled `model` field is logged at `lib/decision-model/system-one.client.ts:181-196`; a server that echoes request text there puts it in debug logs. A transport rejection's raw `error.message` also enters failure detail and warn logs at `:206-235`; a transport that includes request body in its error can expose prompt text. **Fix:** log the requested model or fixed metadata, and classify transport failure without copying exception messages into returned detail/logs. |
| S-2, structured call can hang | **CLOSED.** `lib/pipeline/model-call.ts:107-136,259-298` races completion against a deadline and returns `timeout`; `lib/failure-class/decision-model-failure-classifier.ts:171-187,416-455` returns `null` on expiry. Both attach handlers to the work promise before the race and clear the timer in `finally`. A rejection between deadline settlement and setting `deadlineWon` is consumed by `Promise.race`'s rejection handler, so it does not become unhandled. It may miss the late-rejection log in that narrow window, without changing the result. |
| S-3, stale probe marks new selection | **PARTIAL — Serious.** The pre-await key capture and check at `lib/decision-model/decision-model.config.ts:255-259,415-431` discard an already stale probe, and `markUnsupported` checks the key again at `:284-292`. But `markUnsupported` sets the in-memory mark, then awaits `storage.update` at `:293-308`. If selection B is saved while A's update is pending, `setSelection` clears the mark at `:159-171` and writes `undefined` through `clearMark` (`:584-593`); A's delayed write can finish last and persist an A mark. A restart or a later return to A reads that old unsupported verdict (`:551-580`). `applyProbe` can also return A's row after B was selected while the write was pending (`:430-437`). **Fix:** serialize selection/mark writes or use a generation check plus an ordered repair after each await; recheck the current key before returning the row. |
| M-1, concurrent rotation | **PARTIAL — Moderate.** `lib/ranking/rotation.store.ts:204-231` now serializes merges and preserves other keys; `lib/route-decide.service.ts:372-381` passes only this call's picks, and `rotation.load()` still reads the full document (`lib/ranking/rotation.store.ts:158-183`). But two calls can both load the same cursor at `lib/route-decide.service.ts:173-200`, choose the same next executor, then serialize identical writes at `:365-381`. The lock covers persistence, not load/plan/choose, so same-key rotation still repeats under concurrent spawns. **Fix:** serialize the whole read/choose/save decision for each rotation key, or reserve the next pick atomically and retry planning on conflict. |
| M-3, mark read throws during construction | **CLOSED.** `lib/decision-model/decision-model.config.ts:120,551-562` catches the read, logs only the error name, and starts with `null`; the targeted spec at `lib/decision-model/decision-model.config.spec.ts:777-793` exercises it. |

## New issues

| Severity | Issue |
| --- | --- |
| Moderate | The stale-probe retry has no bound: `lib/decision-model/decision-model.config.ts:422-424` calls `getStatus()` again whenever the key changed; `getStatus()` starts another probe at `:245-259`. Repeated user selection changes during each probe can keep a status request pending indefinitely and issue one probe per change, despite the per-probe timeout at `:502-519`. **Fix:** allow one retry for the current selection, then return a current-selection pending/unreachable row or use a generation-aware loop with an overall deadline. |

## Five logic questions

1. **Silent failure:** two same-key route calls can both return the same chosen lane while their rotation writes both succeed (`lib/route-decide.service.ts:173-200,365-381`).
2. **User action:** change the Ollama selection while an unsupported-mark storage write is pending; the old write can persist after the new selection's clear (`lib/decision-model/decision-model.config.ts:159-171,293-308,584-593`).
3. **Wrong input data:** a schema-valid provider `model` field containing echoed prompt text enters the debug log (`lib/decision-model/system-one.client.ts:181-196`).
4. **Dependency failure or timeout:** the structured completer now times out even if it ignores abort (`lib/pipeline/model-call.ts:259-298`); a failed mark read degrades to no mark (`lib/decision-model/decision-model.config.ts:551-562`).
5. **Unspecified case:** the requirements do not define a total status-call budget across repeated selection changes; the recursive retry is unbounded (`lib/decision-model/decision-model.config.ts:245-259,422-424`).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat deadline-window rejection as handled, not an unhandled-rejection finding | Report it / accept the race handler | `lib/pipeline/model-call.ts:268-298` and `lib/failure-class/decision-model-failure-classifier.ts:425-455` attach `Promise.race` to the rejecting branch before either timer can settle; `finally` clears the timer. | Yes |
| Treat probe response bodies as contained but transport errors as untrusted | Close all of S-1 / mark partial | `lib/decision-model/decision-model.probe.ts:124-135` compares bodies only; `lib/decision-model/system-one.client.ts:193-196,206-235` still logs provider/transport-controlled strings. | Yes |
| Keep M-2 outside this verdict | Reopen / defer | Decision #93 reserves the gather deadline for a later task; Batch 37 does not change `gather.ts`. | Yes |

No clarification is needed for these fixes.
