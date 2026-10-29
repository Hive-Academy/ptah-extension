# Code Logic Review — `TASK_2026_851_5cef`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 4/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 1 |
| Serious issues | 2 |
| Moderate issues | 3 |
| Failure modes found | 6 |

The Linux digest and the normal operation restore are coherent. The score is below 5–6 because one new failure path can reclaim an operation while its console is still alive, and the auth fallback misses the adapter's initialization path. It is above 1–2 because the migration, epoch guard, and ordinary lease release path are implemented, rather than absent.

## Numbered defects

1. **Blocking — a failed console PID write permits wrong reclaim.** `libs/backend/auth-providers/src/lib/accounts/provider-account-actions.service.ts:401-409` records the spawned PID in a detached promise and only logs a failed write; `libs/backend/auth-providers/src/lib/accounts/provider-account.store.ts:698-715` then treats `child_pid = NULL` as sufficient to delete the operation after the host dies. Scenario: the console starts, SQLite is busy or unavailable during `recordOperationChild`, then the host crashes while the console remains open. A second host proves only the old host PID gone, restores the profile, and admits a competing auth operation against the live console. Make an unrecorded child an explicitly unresolved persisted state, or prevent recovery until the child PID is durably recorded or its absence is proved. The same gap exists between spawn and the detached write (`provider-account-actions.service.ts:383-390`). The new specs cover a successful PID write and a recorded live child, but not a failed write (`provider-account-actions.service.spec.ts:255-268`; `provider-account.store.spec.ts:1020-1042`).

2. **Serious — the safe auth default is only applied to per-workspace snapshots.** `libs/backend/auth-providers/src/lib/auth/auth-method.utils.ts:52-53` still maps missing or unknown values to `apiKey`; `libs/backend/auth-providers/src/lib/auth/active-provider-resolver.ts:25-34` uses that result for global auth. `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:674-693` configures that method during initialization. With no stored or environment key and a connected Claude login, `ApiKeyStrategy` returns `configured: false` (`libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts:529-537`), so adapter initialization reports an error even though `workspace-provider-profile-resolver.ts:133-159` would later choose `claudeCli`. Apply one credential-aware default at the active auth configuration boundary and use it consistently for initialization and workspace resolution; preserve explicit `apiKey` and a stored key.

3. **Serious — a session admitted during quit can escape the settlement snapshot.** `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/named-admission-settlements.ts:63-78` snapshots `live` once and has no shutdown gate. `SessionLifecycleManager.disposeAllSessionsForShutdown` runs that snapshot beside `SessionControl.disposeAllSessions` (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:675-686`), whose implementation explicitly allows a session registered during its interrupt wait to survive (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:377-406`). Scenario: a queued `chat:start` reaches named admission after `settleAll` snapshots, while quit is waiting for interrupts; its lease is absent from the drain and SQLite closes at `apps/ptah-electron/src/activation/shutdown.ts:314-318`. Stop new admission before taking the snapshot and drain any in-flight admission that may still acquire a reservation.

4. **Moderate — naturally completed named flows remain in the settlement set.** Tracking removes a flow only on abort (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/named-admission-settlements.ts:34-54`). On normal child termination the code sets `childEnded` and calls `dispose` (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:974-975`), and `dispose` deliberately skips abort for that case (`session-query-executor.service.ts:1032-1041`). Every completed named turn therefore remains strongly referenced until host shutdown and is disposed again then. Untrack on the actual settlement promise, including the natural completion path; add a repeated-completion spec.

5. **Moderate — the connected-login default can use a stale status for one minute.** The new fallback calls `ambientLogin.read()` without refresh (`libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:141-159`), while the reader returns the last result for 60 seconds (`libs/backend/auth-providers/src/lib/accounts/claude-ambient-login-status.ts:6-11,127-134`). Scenario: a user signs out externally after a connected probe, or signs in after a signed-out probe. A new session chooses the wrong method for up to a minute despite current credentials. Refresh for a new auth choice, or invalidate the cache on login changes; cover both transitions.

6. **Moderate — a plain account list does not recover a crashed pending profile.** `ProviderAccountService.list` delegates directly to `ProviderAccountStore.list` (`libs/backend/auth-providers/src/lib/accounts/provider-account.service.ts:252`; `provider-account.store.ts:177-179`). Reclaim is called only from admission and action paths (`provider-account.store.ts:417,515`; `provider-account-actions.service.ts:266,312,343`), so reopening the account settings after a crash can continue to display `pending` and the old revision until the user starts another action. Run guarded recovery before the profile list/get read, or at startup, and emit the restored revision to listeners.

## Five logic questions

1. **Silent failure:** `recordConsolePid` logs a failed write but `startSignIn` can still report `ok`; the next process later makes an unsafe reclaim (defect 1, `provider-account-actions.service.ts:299-303,401-409`).
2. **Unexpected user action:** reopening the account list after a host crash still shows `pending`; starting a chat during deferred quit can leave an unflushed lease (defects 3 and 6).
3. **Wrong answer from input:** missing or unknown `authMethod`, no key, and connected login yields `apiKey` in global adapter initialization; a cached connected or signed-out result can choose a method contrary to current login state (defects 2 and 5).
4. **Dependency failure:** a failed SQLite child-PID write changes the meaning of a null field from “no child” to “child unknown,” yet recovery treats both alike (defect 1). A timed-out session dispose is bounded by `shutdown.ts:417-445`; its later release may attempt a write after `shutdown.ts:318` closes SQLite, leaving the lease for next-launch reclaim.
5. **Unstated requirement:** shutdown must prevent new reservations while it drains a snapshot, and recovery needs a trigger for read-only account views (defects 3 and 6).

## Data flow and requirements

| Path | Trace | Result |
| --- | --- | --- |
| Linux host digest | `provider-account-host.ts:34-55` reads the PID namespace, hashes it with platform and hostname, and uses random bytes on a read error. `leaseOwnerGone` compares that digest before PID probes (`:92-97`). | Complete for the stated platforms; win32/darwin omit the namespace. |
| Auth operation | Migration `0062_provider_account_operation_host.ts:25-30` adds host, child and prior-state columns. `provider-account.store.ts:508-529` writes host and prior state atomically with `pending`; `:541-547` writes the child later; `:696-722` reads all four columns, checks host/child liveness, restores only matching pending epoch, advances revision, then deletes. | Partial: the later child write can fail without making reclaim fail closed; read-only views do not trigger recovery. Legacy hostless rows stay held. |
| Electron quit | `wire-runtime.ts:623-646` captures the singleton, `shutdown.ts:476-483` defers quit, `:291-297` waits at most two seconds, and `:318` closes SQLite. The manager drains the tracked admissions (`session-lifecycle-manager.ts:675-686`). | Partial: admissions added after the drain snapshot are missed; timed-out disposals can write after close. |
| Auth method | `auth-method.utils.ts:32-73` parses explicit methods and computes the credential-aware fallback; `workspace-provider-profile-resolver.ts:133-159` applies it for snapshots. `active-provider-resolver.ts:25-34` and adapter initialization still use the old fallback. | Partial: per-workspace snapshot works, global initialization does not. |

## Coverage and verification

I read the task context, implementation reports, root `CLAUDE.md`, the changed implementation diff, the untracked migration and settlement files, and the relevant new spec cases. Specs cover Linux/win32/darwin digest, successful operation reclaim, a recorded live child, explicit `apiKey`, stored-key priority, and the basic quit deadline. They do not exercise defects 1, 3, 4, 5, or 6. I did not run builds or tests, per the review request. Scoped `ptah_get_diagnostics` returned unavailable after its 45-second timeout, so this review makes no typecheck claim.

## Decisions

- **Verdict: NEEDS_REVISION.** Approval versus revision was decided from the demonstrated live-console reclaim path and the global initialization mismatch. This is reversible by correcting the implementation and repeating the review; no source was changed here.

## Verdict

**NEEDS_REVISION — 4/10.** The first three defects should be fixed before accepting this follow-up. The remaining uncertainty is runtime behavior under simultaneous quit, chat start, and storage failure, which the current specs do not simulate.
