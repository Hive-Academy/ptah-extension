# M1 scoped re-review

**Score: 9/10 — APPROVED.** No blocking findings; M1 is closed.

Evidence paths below are relative to `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/`.

1. **Coverage:** `session-query-executor.service.ts:741-747` catches the only intentional pre-race throw, from `refuseIfExpired()`, and synchronously observes the already-started promise before rethrowing. This covers pending and already-rejected promises, including rejection triggered synchronously by abort. Subsequent cancellation and post-race refusal already have the race's rejection observer (`:753-765`). Ordinary Promise and non-throwing logger behavior are assumed.
2. **Semantics / logging / retention:** The same refusal is rethrown; abort still occurs in `refuseIfExpired()` (`:731-747`). The added handler runs only on early refusal and logs once per rejected step; it does not overlap that invocation's race. The settlement warning at `:702` concerns a separate cleanup failure. No timer or cancellation listener is allocated on this branch; the promise reaction lasts until settlement, as an observer must. No new persistent resource leak is apparent (`:739-769`).
3. **Regression spec:** `session-query-executor.accounts.spec.ts:643-660` supplies an expired deadline, awaits the exact refusal, checks abort, then explicitly rejects the deferred step. Real timers are restored between tests (`:235`), and the two immediate turns allow rejection processing without a timing-duration threshold. The warning assertion (`:657`) deterministically fails without the fix even if Jest intercepts the process event. The listener and flow are cleaned up in `finally`. The test does not independently prove exactly-once logging, but the implementation does. Its wall-clock expiry assumes no backward clock adjustment during setup.

Read-only logic review of the supplied M1 change and spec; no source changes, tests, builds, installs, or commits. Developer-reported scoped verification was not rerun. D74's deferred M2/N1 are unchanged by this fix and remain outside scope.
