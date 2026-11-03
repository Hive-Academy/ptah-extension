# Cold-start onboarding route restore

## Fix (file:line)

`apps/ptah-extension-webview/src/app/initial-navigation.ts:58-59,116-128`: the restored-route branch now waits for `ElectronLayoutService.workspaceResolved` before calling `navigateToUrl` when the first primary segment is `onboarding` and the URL contains a `tab` query parameter. It captures the service and `Injector` in the injection context. If a newer host navigation began or landed during the wait, it returns `cancelled` so that navigation keeps precedence. Other routes and the existing fallback remain unchanged.

## Hang analysis of workspaceResolved

`workspaceResolved` starts true outside Electron. In Electron, `restoreLayout()` starts `syncFromBackend`, whose `finally` sets the signal true after success, failed RPC results, thrown RPC errors, and the no-workspace path. A superseded sync leaves resolution to its newer sync. `workspace:getInfo` and `workspace:switch` use the default 30-second RPC timeout; the cache fallback awaits its own switch before resolution. No wait timeout was added because these paths settle the signal. A synchronous failure before `syncFromBackend` starts would abort service construction instead of leaving an active wait.

## Tests added

`apps/ptah-extension-webview/src/app/webview-routing.spec.ts:517-593`: one test holds the workspace unresolved and the tab undiscoverable, then makes the tab valid and resolves the workspace; it expects the saved onboarding route to land. A second test keeps the workspace unresolved and expects a saved `/settings` route to land immediately. A third test makes a newer host navigation land during the wait and checks that the restore does not override it.

## Verification (exact Nx summary lines)

`npm run verify -- -p ptah-extension-webview -- --testPathPatterns=webview-routing.spec.ts`:

```text
 NX   3 tasks: 1 succeeded, 2 failed
✖ nx run ptah-extension-webview:typecheck
✖ nx run ptah-extension-webview:lint
```

The one succeeded task was the scoped Jest test. The two failures came from verify forwarding `--testPathPatterns=webview-routing.spec.ts` to `tsc` and `eslint`; their logs respectively say `error TS5023: Unknown compiler option '--testPathPatterns=webview-routing.spec.ts'.` and `Invalid option '--testPathPatterns' - perhaps you meant '--ignore-pattern'?` These are command-argument failures, not source diagnostics. The known pre-existing circular-dependency lint failure could not be observed in this run because ESLint rejected that argument first.

`npm run verify -- -t typecheck -p ptah-extension-webview,ptah-electron`:

```text
 NX   2 tasks: 2 succeeded
```

The rerun after the race correction passed both webview and Electron typechecks without cache hits. An earlier run also passed with one cached task (` NX   2 tasks: 2 succeeded, 1 cached`). The first command was also rerun after the correction, with the same ` NX   3 tasks: 1 succeeded, 2 failed` summary and the same argument-forwarding failures for typecheck and lint.

## Decisions

Used the supplied worktree and preserved its existing uncommitted changes. The instruction to work there and the explicit ban on checkout precluded creating another worktree from `main`. The Angular, orchestration, and agent-lanes skill files were read directly because no skill invocation tool is exposed to this lane. `ElectronLayoutService` is exported through the `@ptah-extension/core` service barrel; outside Electron its constructor does not run the workspace sync. An independent Kimi Code reviewer identified the host-navigation race in the first version and passed the corrected guard and regression test on re-review.

## Not done

No commit, push, stash, restore, checkout, reset, clean, build, serve, dev, e2e, or package target. No standalone lint run was allowed by the two-command verification rule, so the accepted pre-existing `ptah-extension-webview:lint` circular dependency remains unverified here. An initial Antigravity review attempt failed before verdict because its provider returned quota exhaustion; the Kimi Code review completed.
