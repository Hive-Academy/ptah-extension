# Backend implementation — `TASK_2026_851_5cef`, batch B

**Tasks completed**: Item 2. Electron quit now disposes the main-chat SDK sessions and waits for each named Claude account run lease to be released before `SQLite close`. The wait is bounded.

## Root cause

- A named-account session releases its lease in `NamedAccountQueryAdmission.dispose()` (`session-query-executor.service.ts`). The release is `admission.releaseReservation` or `retainUnresolvedReservation`, and it runs only after the session's child has exited. The session's abort signal starts it without awaiting it (`onAbort` -> `void this.dispose()`).
- Electron's `will-quit` chain never touched the SDK sessions. `SdkAgentAdapter.dispose()` exists but is never called on quit. It is also fire-and-forget, so it would not have helped.
- The existing `SessionControl.disposeAllSessions()` aborts the sessions but does not wait for the lease settlements. Its interrupt race can also take up to 5 s per session.

## Files

- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-account-followups/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/named-admission-settlements.ts` — `NamedAdmissionSettlements`. It tracks named-account flows until the dispose started by their abort settles. `settleAll()` disposes every flow it still tracks and waits for each release write. It never rejects and logs failures through the injected `Logger`.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/claude-account-followups/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/named-admission-settlements.spec.ts` — 6 tests:
  - waits for every tracked flow;
  - an aborted flow stays tracked until its release settles;
  - a flow is untracked after it settles;
  - a signal that was already aborted is never tracked;
  - a rejected settlement is logged at shutdown and still resolves;
  - a rejection after abort is logged.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-account-followups/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts`:
  - The executor owns a `NamedAdmissionSettlements`, created in the constructor.
  - Every `NamedAccountQueryAdmission` is tracked right after it is constructed.
  - New method `settleNamedAccountReservations(): Promise<void>`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-account-followups/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` — new `disposeAllSessionsForShutdown(): Promise<void>`:
  - Runs `SessionControl.disposeAllSessions()` and `settleNamedAccountReservations()` side by side with `Promise.allSettled`.
  - Rejects only if the session teardown rejects, and only after the lease settlement has finished.
  - The existing `disposeAllSessions()` (config re-init) is unchanged.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-account-followups/apps/ptah-electron/src/activation/boot-coordinator.ts` — new `BootRefs.chatSessions: { disposeAllSessionsForShutdown(): Promise<void> } | null`, set to `null` in `createEmptyBootRefs`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-account-followups/apps/ptah-electron/src/activation/wire-runtime.ts` — `captureShutdownHandles` captures `SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER` early, guarded by `isRegistered`, right after `sessionSpawner`. A failed resolve is logged as non-fatal and leaves the ref `null`.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-account-followups/apps/ptah-electron/src/activation/shutdown.ts`:
  - New exported constant `CHAT_SESSION_DISPOSE_BUDGET_MS = 2000`, with a `chatSessionDisposeBudgetMs` override in `QuitSequenceDeps` and `DisposalDeps`.
  - New helper `disposeChatSessions` (`withBudget`, never rejects).
  - New step in `disposeAfterPersistence`, guarded inline like the other awaits.
  - `requiresDeferredDisposal` now also returns true when `refs.chatSessions !== null`.
  - Doc comments updated.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-account-followups/apps/ptah-electron/src/activation/shutdown.spec.ts` — new describe block with 4 tests:
  - chat sessions alone defer the quit;
  - SQLite closes only after the session dispose settles, and the order is checked;
  - a hung dispose is bounded by `CHAT_SESSION_DISPOSE_BUDGET_MS`: nothing closes at budget−1, SQLite closes at the budget and the "exceeded" warning is logged;
  - a rejected dispose is logged and the chain still closes SQLite and diagnostics, then quits.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/claude-account-followups/apps/ptah-electron/src/main.quit-path.spec.ts`:
  - `makeFullRefs` now fills in `chatSessions`.
  - `EXPECTED_LIFO_ORDER` includes `chatSessions` between `sessionSpawner` and `agentProcessManager`.
  - The synchronous-path test and the `requiresDeferredDisposal` test set `chatSessions` to `null` where they null the other awaited refs.

## Chain ordering (deferred path)

`providerProxyPool` → timers → `updateManager` → `integrityService` → run-check kill started → watchers, status bridges, triggers, cron, memory → `chatBridge` → **messaging gateway stop (awaited)** → `sessionSpawner.dispose` → **`chatSessions.disposeAllSessionsForShutdown()` (awaited, at most 2000 ms)** → agent reap (awaited) → lane-outcomes drain (awaited) → **`SQLite close`** → voice worker → CLI registry → workspace watcher → diagnostics → run-check kill (awaited) → final metadata flush (awaited) → `quit()`.

## Stack observed

- **Wiring**: tsyringe. `SDK_SESSION_LIFECYCLE_MANAGER` is registered as a singleton (`libs/backend/agent-sdk/src/lib/di/register.ts`, around line 490). No new DI registration and no new token, so the DI guard specs did not need changes.
- **Quit chain**: Electron's quit chain reads structural refs from `BootRefs` (`boot-coordinator.ts`). They are captured early in `wire-runtime.ts` `captureShutdownHandles`, following the `sessionSpawner` and `agentProcessManager` precedent.
- **Shutdown file conventions**: `shutdown.ts` uses `withBudget`, `nonFatal` and `console.warn`; the app layer has no injected logger.
- **Logging in libs**: the agent-sdk code logs through the injected `Logger` (`Pick<Logger,'warn'>`).

## Verification

- `npm run verify -- -p ptah-electron,@ptah-extension/agent-sdk` (lint, test, typecheck) → `NX 12 tasks: 12 succeeded`, exit 0.
- `npm run verify -- -t typecheck -p ptah-extension-vscode,ptah-cli` → `NX 2 tasks: 2 succeeded`, exit 0. These are the other hosts that depend on agent-sdk.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`:
  - `apps/ptah-electron: 2 ok (baseline 4)`, `libs/backend/agent-sdk: 4 ok (baseline 4)`.
  - None of the flagged sites are in the files changed here.
  - The baseline was not edited.
- Not run, per the rules: build, serve, e2e, package. di-lint was not run separately because no `@injectable` or constructor injection changed. It runs in the pre-push hook.

## Decisions

| Decision | Options | Evidence | Reversible |
|---|---|---|---|
| A new `disposeAllSessionsForShutdown()` on `SessionLifecycleManager` instead of changing `disposeAllSessions()` | Change the existing method; add a shutdown variant | `disposeAllSessions()` is awaited by the config re-init in `sdk-agent-adapter.ts` `requestConfigReinit`. Waiting for lease settlement there, up to each flow's 15 s child deadline, would slow re-init. | yes |
| Resolve the lifecycle manager in Electron, not `TOKENS.AGENT_ADAPTER` | Adapter `dispose()`; the manager | `SdkAgentAdapter.dispose()` is synchronous and fire-and-forget, and it also clears auth and model state. Electron only needs the session teardown. | yes |
| Named flows are disposed directly, side by side with `disposeAllSessions()`, not only through the abort | Only `disposeAllSessions` (abort → onAbort); direct dispose | `disposeAllSessions` first runs an interrupt race of up to 5 s per session before it aborts. That would use up the 2 s budget before any release started. `dispose()` is idempotent and returns the same settlement. | yes |
| Tracking is a small separate class | Inline in the executor; separate unit | The executor file is already very large. A separate class can be unit-tested without casting into private members. | yes |
| The step is sequential, after `sessionSpawner` and before the agent reap | Run it concurrently with the reap | Sequential keeps the LIFO order spec deterministic. It adds time only while sessions are still settling, and at most 2 s. | yes |

## Plan deviations

None. No implementation-plan or batches document exists; the scope came from the spawner brief.

## Out-of-scope observations

- `wire-runtime.ts` is now 734 lines. Its header mentions a 700-line soft ceiling, which it already exceeded before this change.
- The CLI host (`libs/backend/cli-engine` shutdown) and VS Code deactivation were not checked for the same lease leak. The brief limited this batch to Electron.
- No manager-level unit test covers `disposeAllSessionsForShutdown()`. It only composes two calls, and building the manager needs about 20 mocked collaborators. The `NamedAdmissionSettlements` spec and the Electron shutdown specs cover the behaviour.
