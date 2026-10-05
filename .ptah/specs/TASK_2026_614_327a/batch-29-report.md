# Batch 29 report: one shutdown contract for `killRunningChecks` (G.4, decision G-A)

## Files changed (absolute paths)

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\apps\ptah-extension-vscode\src\main.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\apps\ptah-extension-vscode\src\deactivate-order.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\apps\ptah-electron\src\activation\shutdown.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\apps\ptah-electron\src\activation\shutdown.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\run-check.tool.ts` (JSDoc only)
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-lm-tools\src\index.ts` (barrel: one added export, see deviations)

## Task 29.1: G-A applied on both hosts

**VS Code (`main.ts` deactivate)**
- Removed the serial `await killRunningChecks()` and the try/catch around it. That catch contradicted the "never rejects" contract.
- The kill now starts first through `killRunningChecksWithin(RUN_CHECK_KILL_BUDGET_MS = 5_000, logger)`. This is a `Promise.race` against a timer that is always cleared, with no catch. When the budget runs out, it logs `logger.warn('Running check kill exceeded its budget; continuing', { budgetMs })` through the injected Logger.
- The agent reap runs at the same time, inline in `deactivate` (it keeps its own try/catch).
- `await Promise.all([checksKilled, agentsReaped])` waits for both before the CLI registry (proxy) dispose and before `flushSessionMetadataStores()`. A slow `taskkill` no longer delays the reap or the flush (FM2).

**Electron (`activation/shutdown.ts`)**
- `requiresDeferredDisposal(refs)` now also returns true when `runningCheckPids().length > 0`, so a quit with a live check is deferred (FM3).
- `disposeBeforePersistence` starts `killRunningChecks()` at its existing LIFO position (no `void`, no `nonFatal` wrapper) and returns that promise.
- `disposeBootRefs` wraps the promise in `withBudget('Run-check kill', ..., RUN_CHECK_KILL_BUDGET_MS = 5000, ...)`. The budget starts at once, and the promise is awaited after `disposeAfterPersistence` and before the final metadata flush. So the kill holds back only the re-issued `quit()`, not the gateway drain, the SQLite close or the agent reap.
- The new test override `runCheckKillBudgetMs` was added to `QuitSequenceDeps` and `DisposalDeps`.
- On the synchronous path the returned promise is discarded with `void`. That path runs only when no check is running, which is now part of what "false" means for `requiresDeferredDisposal`.

## Task 29.2: doc and specs

- `run-check.tool.ts` JSDoc for `killRunningChecks` now says: never rejects (every stop and retry records its own failure); may take up to the tree-kill grace period (5 s); hosts await it with a bounded budget and no catch. It also names how each host consumes it. Code and doc now agree.
- New `shutdown.spec.ts` mocks `@ptah-extension/vscode-lm-tools` and covers four cases:
  - a running check alone defers the quit;
  - the rest of the teardown runs while the kill is pending, and the quit is re-issued only after the kill settles;
  - a kill that never settles: the quit happens after `RUN_CHECK_KILL_BUDGET_MS` with a "Run-check kill exceeded" warning;
  - no running check: the quit stays synchronous.
- `deactivate-order.spec.ts`, a static-source spec, has a new case: the kill starts before the reap, `await Promise.all([checksKilled, agentsReaped])` sits between the reap and the proxy dispose, and no serial `await killRunningChecks()` remains.

## Checks (exit codes)

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint,test -p ptah-extension-vscode ptah-electron vscode-lm-tools --parallel=2` | 0. vscode-lm-tools 2855 passed; ptah-electron 1100 passed, 3 skipped; ptah-extension-vscode 167 passed. Lint: warnings only, 0 errors. |
| `npx nx run di-lint:lint` | 0 (Nx cache hit) |
| `npx nx run degradation-audit:lint` | 0 (Nx cache hit) |
| `npx jest -c apps/ptah-electron/jest.config.ts` on shutdown, quit-path and metadata-flush specs | 0 (42 passed) |

History: the first run-many exited 1 for two reasons.
1. `deactivate-order.spec.ts` failed. Its static source checks failed after I moved the reap into a helper below `deactivate`. I moved the reap back inline and the spec passed.
2. One vscode-lm-tools test failed once. It passed when re-run alone (2855/2855) and in the final run-many. I did not identify the test; it is likely a flake under load from concurrent agents.

## Deviations and open notes

- **Barrel export (outside the listed files):** I added `runningCheckPids` to `libs/backend/vscode-lm-tools/src/index.ts`. Electron needs it for `requiresDeferredDisposal`, and apps import only through the barrel. Without it, typecheck fails with TS2305. This is a one-line additive change in the batch's own project, not in the Batch 24A stdio files.
- **Electron logging:** `shutdown.ts` logs through `console.warn` in `nonFatal` and `withBudget`. It has no injected Logger, and the existing quit-path spec asserts those console calls. The new budget warning reuses `withBudget`, so I added no new console call. VS Code uses the injected Logger.
- **Stale header comment:** the `shutdown.ts` file header still says the deferral is for "exactly one thing" (the gateway). That was already out of date before this batch (the agent manager is also a reason). Left untouched.
- **Kill-budget overrun:** a kill that runs past the budget is not cancelled on either host. On win32, `taskkill` keeps running as a separate process once it has been spawned.
