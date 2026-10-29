# Backend fix — `TASK_2026_851_5cef`, code-logic-review defects 1 and 6

**Tasks completed**: defect 1 (Blocking, failed console pid write) and defect 6 (Moderate, a plain
list does not recover a crashed pending profile).

**Files** (all under `libs/backend/auth-providers/src/lib/accounts/`)

- MODIFIED `provider-account-actions.service.ts`
  - `recordConsolePid`: when `recordOperationChild` throws, the `.catch()` calls the logger
    directly. It then calls `finishSignIn(operation, { code: 'unavailable-storage', state:
    operation.priorState })`.
    - That is the normal end path: abort, then `settle`. `ledger.stop()` kills the console tree and
      waits for its close. `completeAuth` then restores the prior state, deletes the row and bumps
      the revision. The end is emitted to listeners.
  - If the write fails before `startSignIn` returns, the failure is already set when `startSignIn`
    resumes. `startSignIn` sees `operation.terminal` and returns `unavailable-storage`, never `ok`.
  - If the write fails after `startSignIn` returned, the end reaches listeners through
    `onStateChanged`, the same way a console failure does.
  - The code comment documents the remaining spawn→write window. It is the same window a run lease
    has before `recordRunChild`.
  - The constructor subscribes to the new `store.onOperationsReclaimed` and emits a state change for
    each restored profile. `dispose()` releases the subscription. The private `reclaimAbandoned()`
    now only calls the store, so the notify logic lives in one place.
- MODIFIED `provider-account.store.ts`
  - New `onOperationsReclaimed(listener): () => void`.
  - `reclaimAbandonedOperations()` runs the existing transaction, moved unchanged to the private
    `reclaimOperationRows()`. After the commit it calls each listener with the restored ids, and
    only when there are some.
  - The reclaims inside `reserveAuth` and `acquireRunLease` now notify listeners too.
- MODIFIED `provider-account.service.ts`
  - `list()` calls `store.reclaimAbandonedOperations()` before it reads.
  - The service has no `get`. `selection` reads no profile state.
- MODIFIED `provider-account-actions.service.spec.ts` (3 new specs, 1 extracted helper):
  - The pid write fails before start returns:
    - `startSignIn` returns `unavailable-storage`;
    - `killProcessTree(4321)` is called;
    - the operation row is gone;
    - the profile is back to `signed-in` with its identity ref and revision +2;
    - exactly one warning carries `{ code: 'busy' }`;
    - no timers are left.
  - The pid write fails after start returned `ok`:
    - the console is killed and the row is gone;
    - the prior state is restored;
    - one state change is emitted;
    - the warning carries `{ code: 'unknown' }`.
  - A plain `service.list()` restores a crashed pending profile, emits one state change and
    deletes the row.
  - The crash setup is extracted into `crashPendingSignIn()`. The existing readStatus reclaim
    spec reuses it.
- MODIFIED `provider-account.store.spec.ts` (1 new spec). Reclaim listeners:
  - get the restored ids after the commit (the listener reads `signed-in`);
  - get no call when nothing was restored;
  - get no call after unsubscribe.

**Stack observed**: tsyringe `@injectable` classes with explicit `@inject`. The store is a
`Lifecycle.Singleton` (`libs/backend/auth-providers/src/lib/di/register.ts:188-193`), so the
actions service and `ProviderAccountService` share one store and its listeners. Synchronous
better-sqlite3 runs inside `atomic()` (BEGIN IMMEDIATE). Specs use real SQLite with migrations
58–62.

**Verification**

- `npm run verify -- -p auth-providers`: 3 tasks; 1 succeeded (typecheck), 2 failed, both known.
  - test: 89 suites passed, 1 failed, 1 skipped. Tests: 2472 passed, 4 failed, 10 skipped. All 4
    failures are in `translation-proxy.sdk.integration.spec.ts`, the known failure.
  - lint: the only error is the known `@nx/dependency-checks` error on persistence-sqlite. The only
    warning in my files is the existing unused `rollbackError` at `provider-account.service.ts:312`.
  - The command ran twice. In the first run my output filter dropped the per-task log lines, so I
    reran once with the output saved to a file.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: exit 0. No new site
  in the changed files, and no baseline was raised.
- `ptah_get_diagnostics`: unavailable (45 s timeout). Typecheck evidence comes from the verify run.
- The ptah-electron typecheck was not run. The change only adds a store method and calls it from
  the store's own lib; no public signature was removed.

## Decisions

- **The pid-write failure restores `priorState` with code `unavailable-storage`**, instead of
  `failure()`, which would give `failed`/`disconnected`.
  - Evidence: the brief asks for "profile restored". A storage error says nothing about the
    account, and `runStatus` already restores the prior state for an unobserved end.
  - Reversible.
- **Reclaim notification moved into the store as a subscription.** Alternative: inject
  `ProviderAccountActionsService` into `ProviderAccountService`.
  - Evidence: the subscription avoids a heavier DI graph for the admission service and keeps one
    notify path. It also covers the admission-time reclaims, which before notified nobody.
  - Reversible.

**Plan deviations**: none.

**Out-of-scope observations**

- A listener that throws inside `onStateChanged` now also propagates out of admission reclaims.
  The current listeners (`provider-account-rpc.handlers.ts`, `claude-named-account-persistence.ts`)
  guard their reads, so none throws today.
- If storage is down, `completeAuth` itself can fail after the console was killed. The row then
  stays with `child_pid` NULL but no live console, which is the correct state for a later reclaim.
- If the console survives the kill grace, the operation stays blocked in this host until the
  console closes.
