# Batch 9 report

## Files written

- `apps/ptah-electron/src/activation/shutdown.ts` — required sign-in quit dependency, active deferral, bounded stop in the LIFO chain.
- `apps/ptah-electron/src/activation/shutdown.spec.ts` — active, inactive, rejected, and timed-out stop cases.
- `apps/ptah-electron/src/main.ts` — imports and passes the Batch 8 quit handle.
- `apps/ptah-electron/src/main.quit-path.spec.ts` — adds an inactive handle to the shared test dependency factory; assertions unchanged.
- `.ptah/specs/TASK_2026_864_1376/batch-9-report.md` — this report.

## Quit order

Before: process kill for running checks started after integrity abort; the chain then continued through watchers, gateway, persistence, and final flush. An active sign-in alone did not defer quit.

After: the Codex sign-in stop starts immediately after the running-check kill, before watchers and SQLite close. Active sign-in now defers quit. The chain waits for both kills before its final flush and reissued quit.

## Budget handling

`CODEX_SIGN_IN_STOP_BUDGET_MS` is 2000. `withBudget` catches a rejected stop and resolves on timeout, allowing the quit to continue. A synchronous throw is handled by `nonFatal` at the start position. The budget runs beside the existing running-check kill budget.

## Decisions

- **Decision:** Add the import in `main.ts` as well as the single dependency line. **Options:** import the existing Batch 8 handle or leave the required field unwired. **Evidence:** `main.ts` had no binding for `codexSignInQuitHandle`, and the quit dependency is required. **Reversible:** yes.
- **Decision:** Start sign-in stop even when inactive. **Options:** always call the no-op handle or branch on `isActive`. **Evidence:** the plan specifies the start immediately after `killRunningChecks`; the Batch 8 handle resolves without creating a service when no login exists. **Reversible:** yes.

## Risks and limits

The supplied sandbox prohibits Jest, TypeScript, Nx, `npm run verify`, builds, and all git commands, so the specs and project verification could not run. `ptah_get_diagnostics` was called twice for the four changed TypeScript files; both calls timed out after 45 seconds with all four files unchecked, so there is no passing compiler result. The two-second limit bounds waiting, but a hung stop promise remains pending after quit proceeds, matching the existing shutdown budget behavior. No real `codex login` ran.
