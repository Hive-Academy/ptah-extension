# Fix report: batch B, defects 3 and 4 (`TASK_2026_851_5cef`)

**Tasks completed**:
- Defect 3 (Serious): named admissions now have a shutdown gate, and the drain covers an admission that is still in flight.
- Defect 4 (Moderate): a flow is untracked when its settlement finishes, on every completion path.

## Files

- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/named-admission-settlements.ts`
  - `SettleableNamedAdmission` now requires `terminal: Promise<void>`. It resolves once the flow holds no unsettled lease and never rejects.
  - `track(named): boolean` no longer takes a signal. It untracks the flow when `terminal` resolves, which covers natural exit, abort, refusal and shutdown (defect 4). After shutdown it returns `false` and tracks nothing.
  - `settleAll()` sets `closed` synchronously before it takes its snapshot (defect 3). Then for each flow it:
    1. calls `dispose()`, which aborts the flow;
    2. waits for `terminal`;
    3. reads the final settlement from a second, idempotent `dispose()`, which catches a reservation that came back late;
    4. logs any rejection once through the injected `Logger`.
  - New `isClosed` getter.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`
  - `NamedAccountQueryAdmission`:
    - New `admitting` flag and a `terminal` promise.
    - `bootstrap` refuses with `aborted` before it calls `admitClaudeRoute` if the flow is already disposed.
    - The admission handler clears `admitting`, records a late reservation, and calls `dispose()` again if the flow was disposed or aborted while the call was in flight. This applies to both the success and the rejection path.
    - `dispose()` resolves `terminal` when there is no reservation and no admission in flight. Otherwise it resolves `terminal` when the settlement settles (`settlement.then(resolve, resolve)`).
  - `SessionQueryExecutor`: if `namedSettlements.track(named)` returns false, the run is refused with `namedAccountRefusal('cancelled', 'shutting-down')` before any reservation. The existing catch disposes the flow, removes the registry record, aborts and logs `reason: 'shutting-down'`.
  - New `'shutting-down'` member in `NamedRefusalReason`.
  - Updated the `settleNamedAccountReservations` doc.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts`
  - `disposeAllSessionsForShutdown()` now starts `settleNamedAccountReservations()` before `SessionControl.disposeAllSessions()`. Admission is therefore closed before the interrupt wait begins.
  - The method still rejects only when the teardown rejects, and only after settlement.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/named-admission-settlements.spec.ts`
  - Rewritten for the new API. 6 tests:
    - waits for every tracked flow;
    - five repeated self-settlements leave the set empty;
    - a flow stays tracked until `terminal`;
    - a late reservation is waited for, with `dispose` called twice;
    - `track` is refused after close, and the refused flow is never disposed;
    - a rejected settlement is logged exactly once and the drain still resolves.
- MODIFIED `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.accounts.spec.ts`
  - These tests use the real `NamedAccountQueryAdmission` fixture:
    - Three naturally completed named runs: the child ends by itself, there is no abort, the lease is released once per run, and the set ends empty.
    - An admission paused inside `admitClaudeRoute` while the drain runs: the drain does not resolve until the call returns, the late reservation is released (not retained), and the set ends empty. A later `track` is refused.
    - A flow disposed by the drain while it is still in its lookup step never calls `admitClaudeRoute`.
  - Executor level: after `settleNamedAccountReservations()`, `executeQuery` with a named selection rejects `cancelled`. It does not call `admitClaudeRoute`, the module loader or `invokeNamedQuery`, removes the registry record, and logs `{ reason: 'shutting-down', step: 'bootstrap' }`.
  - The existing `executorWith` helper now also returns `logger` and `executor`.
- `apps/ptah-electron/src/activation/shutdown*`: not changed. The 2 s `CHAT_SESSION_DISPOSE_BUDGET_MS` is kept, and the existing specs still pass.

## Verification

- `npm run verify -- -p @ptah-extension/agent-sdk,ptah-electron -- --output-style=static` → `Successfully ran targets lint, test, typecheck for 2 projects and 6 tasks they depend on`.
  - agent-sdk tests: 4246 passed, 3 skipped.
  - ptah-electron tests: 1340 passed, 3 skipped.
  - Lint: warnings only, 0 errors. All warnings are the existing `preserve-caught-error`.
- Earlier runs of the same command:
  - The first run printed `12 tasks: 11 succeeded, 1 failed`, with `@ptah-extension/agent-sdk:test` failing. My filter hid the failing spec name.
  - Another developer was running `verify test (agent-sdk,auth-providers)` in this worktree at the same time and editing agent-sdk files.
  - On the current inputs, `agent-sdk:test` passed: as a cache hit, and in the full static run above. I did not identify which spec failed in the first run.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`:
  - `libs/backend/agent-sdk: 4 ok (baseline 4)`, `apps/ptah-electron: 2 ok (baseline 4)`.
  - None of the flagged sites are in my files, and the baseline was not edited.
- `ptah_get_diagnostics`: unavailable (timed out after 45 s). The typecheck target above covers it.
- Not run, per the rules: build, serve, e2e, package. Other hosts: the public API change is internal to agent-sdk (`SettleableNamedAdmission`, `track`), and no host imports it.

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| The flow exposes a passive `terminal` promise, and the tracker untracks on it | Untrack inside `dispose()` through a callback; a passive promise | Natural completion calls `dispose()` without abort (`childEnded`). A promise observes every path without changing who calls dispose. | yes |
| `dispose()` does not wait for an in-flight admission; only the drain does, through `terminal` | Make `dispose()` await the admission call | Refusal paths `await named.dispose()` before throwing. Making them wait for the admission port would delay refusals past the step and admission deadlines (D72/D73). | yes |
| Shutdown refusal code `cancelled`, reason `shutting-down` | `unavailable-storage`; `cancelled` | `cancelled` is an existing `ProviderAccountResultCode`. The reason is a fixed, log-safe literal, so the refusal the renderer receives keeps only code and summary. | yes |
| Admission stays closed after shutdown, with no reopen | Reopen after the drain | The method is only reached from host shutdown. Config re-init uses `disposeAllSessions()`, which does not touch the gate. | yes |

## Plan deviations

None.

## Out-of-scope observations

- A settlement that is still pending when Electron's 2 s budget expires can still write after SQLite closes. This is the bounded-shutdown trade-off already noted in the review (Q4). The stale-lease reclaim on the next launch picks up that lease.
