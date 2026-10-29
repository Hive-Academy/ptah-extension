# Backend implementation — `TASK_2026_851_5cef`, batch A

**Tasks completed**:

- Item 1: CURRENT_LEASE_HOST pid-namespace digest.
- Item 3: crash recovery for `provider_account_operations`.
- Coordinator follow-up: gap 1 is closed. The sign-in console child pid is now recorded, and
  reclaim waits for that process.

## Files

- MODIFIED `libs/backend/auth-providers/src/lib/accounts/provider-account-host.ts`
  - Adds the exported pure function `computeLeaseMachine(platform, host, readPidNamespace)`.
  - `CURRENT_LEASE_HOST.machine` is now built from it, reading `readlinkSync('/proc/self/ns/pid')`.
  - Doc comments are updated.
- MODIFIED `libs/backend/auth-providers/src/lib/accounts/provider-account-host.spec.ts`. New specs:
  - the namespace is part of the digest;
  - an unreadable namespace gives a random digest;
  - the win32/darwin digest is unchanged, and the reader is not called there.
- CREATED `libs/backend/persistence-sqlite/src/lib/migrations/0062_provider_account_operation_host.ts`
  - Adds four nullable columns to `provider_account_operations`: `host_pid`, `host_machine`,
    `child_pid` and `prior_state`.
  - The CHECK constraints follow 0061. `prior_state` also has `<> 'pending'`.
- CREATED `libs/backend/persistence-sqlite/src/lib/migrations/0062_provider_account_operation_host.spec.ts`
  - Registration, legacy rows and owned rows.
  - CHECK rejects: zero or negative pid, a machine digest of the wrong length, a pending prior state,
    and a zero `child_pid`.
- MODIFIED `libs/backend/persistence-sqlite/src/lib/migrations/index.ts`: registers version 62.
- MODIFIED the migration specs that assert the highest version, 61 → 62:
  - 0028, 0030, 0038–0047, 0051–0056, 0059, 0060 and 0061.
  - The 0061 test is renamed, because 0061 is no longer the highest version.
- MODIFIED `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts`
  - Status and auth inserts record the host. Auth inserts also record `prior_state`.
  - New `recordOperationChild(operationId, ownerId, authEpoch, pid): boolean`. It checks owner and
    epoch, accepts only sign-in or sign-out rows, and returns `false` when the row is no longer held.
  - New `reclaimAbandonedOperations(): readonly string[]`. It is called before `reserveAuth` and
    before `acquireRunLease`.
- MODIFIED `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts`
  - New private `reclaimAbandoned()`: runs the reclaim, then emits a state change for each restored
    profile. It is called before the 'pending' check in `readStatus`, `cancelSignIn` and `reserve`
    (sign-in and sign-out).
  - New private `recordConsolePid`: after `trackConsole`, it waits for `whenSpawned` and writes the
    pid through `recordOperationChild`.
  - A failed write logs through `this.logger?.warn`, called directly inside `.catch()`. The log
    carries the store result code only.
- MODIFIED `libs/backend/auth-providers/src/lib/accounts/provider-account.store.spec.ts`
  - The test schema includes migration 62.
  - New describe `operations of an ended host`:
    - host and prior state are recorded;
    - when the host is gone, the row is deleted and the prior state is restored (log carries counts
      only);
    - a status row is deleted before admission;
    - kept: a live host, this process, another machine, a legacy row, a row with no prior state, and
      a row whose probe returns EPERM;
    - the console pid is recorded only for the right owner and epoch;
    - **console still running after the host is gone → kept; host and console both gone → reclaimed
      and restored**.
- MODIFIED `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.spec.ts`
  - The test schema includes migration 62.
  - End-to-end: a profile left pending by a crashed host is restored, a state change is emitted, and
    the status read then succeeds.
  - Console mode: the spawned pid 4321 is recorded on the row; a console that never spawned records
    no pid.

## Design choices

**Machine digest**

| Platform | Digest input |
| --- | --- |
| linux | `linux\0host\0ns\0<pid:[…]>` |
| linux, namespace unreadable | `linux\0host\0random\0<32 random bytes, hex>`, computed once per process |
| win32, darwin | `platform\0host`, unchanged |

- With an unreadable namespace, no other process can match this machine, so nothing is reclaimed.
  That is fail-closed.
- Windows and macOS values are byte-identical to before.
- Linux rows written by older builds no longer match, so they stay held. That is the safe direction.

**Where the prior state is stored**

- Before this change it existed only in memory, as `AuthOperation.priorState` in the actions service.
- Migration 0062 adds `prior_state` to the operation row.
- `reserveAuth` writes the state the profile had before 'pending'.
- It writes NULL for ambient operations, for status operations (they never set 'pending'), and for a
  profile that was already 'pending'.

**Console child**

- Only sign-in launches a console window.
- `recordConsolePid` writes the pid once `whenSpawned` resolves with a pid.
- Sign-out has only bounded probe children, so its `child_pid` stays NULL.
- If the host crashes between the console spawning and the pid write, `child_pid` stays NULL. That
  short window is the same one a run lease has before `recordRunChild`.

**Reclaim rule**

- Candidate rows: `host_pid IS NOT NULL`, `host_pid` is not the current pid, and `host_machine` is the
  current machine.
- Each candidate is judged by `leaseOwnerGone({ pid, machine, childPid: child_pid })`. These are
  exactly the run-lease rules, so a recorded console that still exists keeps the row held.
- On reclaim, the row is deleted. For a named sign-in or sign-out, the profile gets
  `state = prior_state` and `revision + 1`, but only while it is still `'pending'` at the
  operation's `auth_epoch`. The epoch stays advanced, and `identity_ref` is not touched.
- These rows are kept:
  - a named auth row without `prior_state`, since there is nothing to restore (fail closed);
  - legacy rows;
  - rows from another machine;
  - rows from this process;
  - rows whose probe proves nothing (EPERM).
- One warn log line, with counts only.

**Trigger point**

- The run-lease reclaim runs inside the caller's transaction. Operations cannot do the same, for two
  reasons:
  - The actions service refuses a `'pending'` profile as `busy` before the store is ever reached.
  - A restore bumps the profile revision. That clashes with a revision the caller has already read,
    and if the caller then threw, the reclaim would roll back with it.
- So the reclaim runs in its own transaction, before the profile is read. It is called from:
  - the actions service: `readStatus`, `cancelSignIn`, and sign-in/sign-out `reserve`, with a state
    change emitted for each restored profile;
  - the store: `reserveAuth` and `acquireRunLease`, which covers ambient and status rows that would
    otherwise keep a route busy.
- A caller that read the profile earlier gets `conflict` and reads again.
- When nothing qualifies, the cost is one SELECT inside an IMMEDIATE transaction.

## Decisions

- **Store `prior_state` on the operation row (migration 0062).**
  - Alternative: derive it from the operation kind (sign-out → signed-in).
  - Evidence: `priorState` existed only in memory.
  - Reversible.
- **Run the reclaim in a separate transaction, not inside `unoccupied`.**
  - Evidence: the actions service's 'pending' check (in reserve and readStatus) and the revision CAS.
  - Reversible.
- **`recordOperationChild` returns `false` when the operation is no longer held, instead of throwing.**
  - Reason: a console can spawn after its sign-in has already settled. A `false` return avoids a
    false warning in that case. Real storage failures still throw and are logged.
  - Reversible.

## Stack observed

- The store is a tsyringe class (`@injectable`, `@inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)`).
- It uses synchronous SQLite through `atomic()` with BEGIN IMMEDIATE, and parses rows with zod
  (`provider-account.store.ts`).
- Migrations are static SQL strings registered in `migrations/index.ts`. Their specs run against real
  SQLite (as in 0061).

## Verification

**Final run, after the gap-1 change**

1. `npm run verify -- -p auth-providers,persistence-sqlite`, one full run:
   - persistence-sqlite test: 62 suites, 667 tests passed.
   - Both typechecks passed.
   - Failed tasks:
     - persistence-sqlite lint: the known 0057/0058 `${}` errors.
     - auth-providers lint: the known `@nx/dependency-checks` error.
     - auth-providers test: the known translation-proxy EPERM, plus one new actions spec.
   - That new actions spec's assertions passed, but its `afterEach` disposal waited on a console
     that never closed. I fixed the spec by emitting the console close.
2. `npm run verify -- -t test -p auth-providers -- --testPathPatterns=provider-account`: 1 task
   succeeded (exit 0). This rerun covered the fixed spec.
3. `npm run verify -- -t typecheck -p ptah-electron`: 1 task succeeded (exit 0).
4. `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: exit 0. No site is
   reported in the changed files, so the baseline was not raised. The two new handlers carry their
   justification:
   - `computeLeaseMachine` has an `optional-capability` marker;
   - the `recordConsolePid` `.catch()` calls the logger directly.

**Earlier run, before gap 1**

- auth-providers test: 2455 passed, 4 failed. All 4 failures are in the known
  `translation-proxy.sdk.integration.spec.ts`.
- No lint findings in the changed files.

## Plan deviations

None from the brief. The brief suggested store init as a possible trigger. I did not use it: a
once-per-process init cannot recover a host that crashes while another process keeps running. The
action and admission paths are used instead.

## Out-of-scope observations

- Gap 2: a profile left `'pending'` by a crash before 0062 has no host recorded, so it still needs
  manual recovery. It is out of scope; the coordinator reports it.
- `provider-account.service.ts:304` has a pre-existing lint warning: `rollbackError` is unused.
