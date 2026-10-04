# S4-b fix round, part 2a: finding S1 (compaction dwell scope)

**Status**: FIXED. Checks are partly blocked by a parse error in another developer's file (see Verification).

## What changed

1. **Dwell bound only where the coordinator acts.** `NoActivityWatchdog` takes a fourth constructor argument, `enforceCompactionDwell: () => boolean`, which defaults to `() => false`. The watchdog reads it on every arm and in the timer callback. When it returns false, an open compaction is reported overdue (`['compaction']`) and the timer re-arms, as in TASK_2026_411 B8 before Wave D. When it returns true, the 300 s cap (`COMPACTION_MAX_DWELL_MS`, unchanged) applies as before.
2. **The executor wires the predicate to the coordinator state.** `CompactionSessionTap.controlsSession()` is a new read-only method. It returns true only when `coordinator.getState(sessionId)` is defined and not `CompactionState.OBSERVE_ONLY`. It returns false when there is no coordinator, no bound id, the tap has been released, or `getState` throws (that case logs one warn). `CompactionObservingWatchdog` passes `() => tap.controlsSession()`. The coordinator itself was not changed: the `getState` accessor already existed.
3. **The cap has its own message.** `onTimeout` now receives a cause, `WatchdogTimeoutCause = 'no-activity' | 'compaction-dwell'`. For `'compaction-dwell'` the executor logs and aborts with `Compaction did not finish within 300s (baseUrl=…, model=…). Stopping for recovery; retry the turn.` The number comes from `COMPACTION_MAX_DWELL_MS`. The wording avoids "abort" and "cancel", so the StreamTransformer still shows it as a real error. The no-activity path and its message are unchanged.

## Files

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/no-activity-watchdog.ts`: the enforcement predicate, the timeout cause, the `WatchdogTimeoutCause` type and the doc comments.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`: `controlsSession()`, the predicate wiring, and the message chosen by cause.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/no-activity-watchdog.spec.ts`: the existing dwell cases now pass `enforced = () => true` and one asserts `'compaction-dwell'`. Two new cases: with no enforcement, a 400 s compaction is overdue twice and never times out, and closing it brings back the `'no-activity'` timeout; an enforced compaction that closes at 216 s completes.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts`: new `compaction dwell bound scope (TASK_2026_597 S1)` block that drives the real executor and coordinator:
  - an OBSERVE_ONLY session survives a 400 s compaction;
  - a controlled session (the existing `actingCoordinator()`) aborts at exactly 300 s with "Compaction did not finish within 300s" and without "no stream activity";
  - a controlled session completes a 216 s compaction (B8).
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/compaction-hook-handler.spec.ts`: its 300 s dwell case builds an unwired watchdog, so it now passes `() => true` and asserts `'compaction-dwell'`. Without this change it failed (onTimeout called 0 times), which is the intended new default. This makes 5 changed source/spec files plus one comment-only line below.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/no-activity-watchdog.lifecycle.spec.ts`: one comment line now says the cap applies only to controlled sessions. No change in behaviour.

## Verification

- Targeted specs: `npx jest -c libs/backend/agent-sdk/jest.config.ts --maxWorkers=2 no-activity-watchdog session-query-executor.service.spec.ts` gave 3 suites and 62 tests passed, exit 0. `compaction-hook-handler.spec` passed 27/27.
- `ptah_get_diagnostics` on the four edited source and spec files: 0 errors.
- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/agent-sdk`: exit 1.
  - **lint**: passed.
  - **typecheck**: failed. The only file with errors is `libs/backend/tool-output-reducers/src/lib/output-budget/spool.ts:177-186` (unterminated string literal), which another developer is editing right now.
  - **test**: 136 suites passed and 5 failed. After the hook-handler fix above, the other 4 failures (`tool-output-capper.spec`, `deleted-exports.contract.spec`, `register.compaction-boundary-registry.smoke.spec`, `sdk-adapter-events.service.spec`) are all "Test suite failed to run" caused by the same `spool.ts` parse error. None of them involves the watchdog.
- `npx nx run di-lint:lint`: exit 0.
- `npx nx run degradation-audit:lint`: exit 1, `parse failure in libs/backend/tool-output-reducers/src/lib/output-budget/spool.ts: Unterminated string literal`. The audit stops before it counts, so the baseline of 4 could not be checked. My only new `catch` (`controlsSession`) logs a warn and does not swallow the error silently.
- No `*.png` files were rewritten (git status shows none).

**Re-run needed** once `spool.ts` parses: the agent-sdk typecheck, the 4 suites blocked by `spool.ts`, and degradation-audit.

## Plan deviations

None. The gate is in the executor, which uses the existing `getState`. The coordinator was not changed.

## Out-of-scope observations

- `spool.ts` (tool-output-reducers) does not parse at the moment. It blocks the agent-sdk typecheck, tests and degradation-audit for every developer.
- Option 3 of S1 (exempt `capacityRoute.kind === 'proxy'` until it has been measured) was not done. It does not apply today, because no session is controlled while `e2Passed` is null.
