# Fix round B — TASK_2026_614_327a, Stage F + G

Scope: M1 and M2 from `reviews/fg-code-logic-review-b.md`. Nothing else in that review was touched.

## Files changed

- D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\apps\ptah-extension-vscode\src\main.ts
- D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\apps\ptah-extension-vscode\src\deactivate-order.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\run-check.tool.ts
- D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\run-check.tool.spec.ts

## M1 — VS Code flush waited behind the check kill

`deactivate()` still starts `killRunningChecksWithin(RUN_CHECK_KILL_BUDGET_MS, logger)` (`checksKilled`) and the agent reap (`agentsReaped`) together. The single `await Promise.all([checksKilled, agentsReaped])` is gone. The order is now:

1. `await agentsReaped;`
2. the Ptah CLI registry dispose (agents before proxies, as before)
3. `await flushSessionMetadataStores();`
4. `await checksKilled;`
5. the extension dispose, the Sentry flush and so on, as before

Decision G-A still holds: the kill is still awaited, its 5 s budget is unchanged, and it starts at the same moment as the reap. Leaving `checksKilled` unawaited while the reap and the flush run is safe. `killRunningChecks` is documented never to reject, and `killRunningChecksWithin` only races it against a timer and clears the timer in `finally`. The code comment above the kill now describes the new order.

Spec: `deactivate-order.spec.ts`. The test "runs the run-check kill beside the agent reap … awaits both" is replaced by "starts the bounded run-check kill beside the agent reap and awaits it after the metadata flush". It checks the following:
- The kill starts before the reap.
- `await agentsReaped;` comes after the agent dispose and before the proxy dispose.
- `await flushSessionMetadataStores()` comes after the reap await.
- `await checksKilled;` comes after the flush and appears exactly once.
- `Promise.all([checksKilled` and `await killRunningChecks()` are both absent.

## M2 — Windows retry could hit a reused pid

`run-check.tool.ts`:
- `CheckProcess` gains the `on('exit', …)` overload. `ChildProcess` already provides it.
- A new per-run flag, `rootPidReleased`, is set by a `child.on('exit')` listener on win32 only. On POSIX the tree kill targets the process group, which outlives its leader, so the retry stays useful there.
- If the run has already settled when `exit` fires, `unregister()` drops the listed retry. Because `unregister` only removes its own entry, a reused pid's entry is never touched.
- `settle` now lists `retryKill` only when `killFailure !== undefined && !closed && !rootPidReleased`. A root that exited before the backstop settled therefore never gets a retry.
- The doc comments on `liveChecks` and `retryKill` now state the rule: the retry is kept only while the root is alive.

No logging was added. The function has no injected Logger (`RunCheckDependencies` has none), the kill failure is already in the run's log and reply, and dropping the retry is an internal state change. The Logger instruction did not apply to this file.

Specs: a new `describe('a failed kill whose root process exits (TASK_2026_614 M2)')` in `run-check.tool.spec.ts`. It overrides `process.platform` with `Object.defineProperty`, following the precedent in `platform-core/src/utils/process-tree-reaper.spec.ts`, and restores it in `afterEach`. It has three cases:
- **win32, root exits after the backstop settles.** The pid is listed, then dropped on `exit`. `killRunningChecks()` makes no second `killTree` call.
- **win32, root exits before the run settles.** No retry is listed, and no second `killTree` call is made.
- **POSIX, root exits.** The retry stays listed. Dispose retries `killTree(9494)`, and `close` unlists it.

## Checks run

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint,test -p ptah-extension-vscode vscode-lm-tools ptah-electron --parallel=2` (first run) | 130 |
| `npx jest src/lib/code-execution/mcp-core/run-check.tool.spec.ts`, run from `libs/backend/vscode-lm-tools` after the fix, 20 passed | 0 |
| `npx nx run-many -t typecheck,lint,test -p ptah-extension-vscode vscode-lm-tools ptah-electron --parallel=2 --output-style=static` (re-run) | 0 |
| `npx nx run di-lint:lint` | 0 |
| `npx nx run degradation-audit:lint` | 0 |

The first run failed for two reasons:
- **TS2322 in the new spec.** The `killTree` mock was typed with no parameters. It is now `jest.fn<Promise<void>, [number]>().mockRejectedValue(...)`.
- **`@ptah-extension/skill-synthesis:build` failed** in the same run. It is not in these files, and it passed on the re-run.

The re-run reported "Successfully ran targets typecheck, lint, test for 3 projects and 34 tasks". Lint gave warnings only (existing `preserve-caught-error`) and 0 errors. The known `protocol-dispatcher.spec.ts` flake did not occur.
