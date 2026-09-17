# PR #494 electron-e2e systemic timeout fix

## Root cause

The RPC handlers were registered correctly. The e2e harness was calling them
before registration completed.

Commit `90c3ded29b26f75441eb5cfc49bdef1855cb4863` (`perf(electron):
gate workspace restore on state storage readiness`) changed Electron startup so
the first `BrowserWindow` is now the preparing shell. The proof is
`apps/ptah-electron/src/main.ts:84`: `createMainWindow(...)` runs there,
`preparing-workspace.html` is loaded at line 98, and only afterward does
`bootstrapElectron(...)` begin at line 110. Bootstrap owns the real IPC bridge
and RPC registration.

The e2e contract did not change with it. `launchPtah()` returned the application
and fixtures/callers treated `electronApplication.firstWindow()` as "the Angular
renderer and its IPC/RPC surface are ready." It now means only "the preparing
shell exists." Fast tests therefore emitted `rpc`, `get-state`, `set-state`, and
clipboard messages before those listeners existed. Slower tests happened to
outlive bootstrap and passed. This one race explains the cross-domain shape:

- RPC calls waited 10 or 120 seconds for a listener that was not installed yet.
- state reads returned the harness's uncaptured default and writes were dropped,
  producing `{}` / empty values.
- clipboard messages were sent before clipboard IPC registration.
- the smoke assertion saw `assets/preparing-workspace.html?state=preparing`
  instead of `renderer/index.html`.

The CI log for run `34671008971`, job `103492236267`, also shows successful
`[IpcBridge] IPC listeners initialized`, `RPC surface registered`, and
`All 365 RPC methods correctly registered` messages. That rules out a missing
`ALLOWED_METHOD_PREFIXES` entry, a DI phase omission, or 44 handler bugs.

### Reproduction before the fix

After making the existing dependency tree visible to this worktree, I ran:

```text
npx nx run ptah-electron-e2e:e2e -- --grep "rpc channel envelope"
```

Result: exit 1, **10 tests: 1 passed, 9 failed**, 2.7 minutes. All nine failures
were `RpcBridge sendRpc timed out after 10000ms`. The main-process output printed
`IpcBridge IPC listeners initialized` after the failing calls had already begun,
which directly reproduced the race.

## Changes

No product boot, DI, RPC handler, or individual functional spec was changed.

- `apps/ptah-electron-e2e/src/support/electron-launcher.ts`
  - Added `waitForPtahRenderer()`, which waits for the reusable first window to
    navigate from the preparing asset to the file URL ending in
    `/renderer/index.html`.
  - Normal `launchPtah()` calls now await that boundary before returning.
  - Added `waitForRenderer: false` for the small number of tests that
    intentionally need access during startup.
  - A readiness failure closes the launched app before rethrowing, so a failed
    boot does not leak an Electron process.
- `apps/ptah-electron-e2e/src/specs/auto-updater.spec.ts`
  - The production updater test opts out long enough to attach its log collector
    and network block, then explicitly awaits `waitForPtahRenderer()`.
- `apps/ptah-electron-e2e/src/specs/lifecycle.spec.ts`
  - The one test whose purpose is to quit before renderer settlement explicitly
    opts out; its early-boot coverage remains intact.

The central readiness helper fixes every ordinary launch consumer at one
boundary. None of the 44 failing assertions or RPC methods was patched.

## Verification

### Focused regression, after the change

```text
npx nx run ptah-electron-e2e:e2e -- --grep "rpc channel envelope"
```

Exit 0. **10 passed, 0 failed** in 1.6 minutes. Nx reported the e2e target and
both dependencies successful.

### Full suite

```text
npx nx run ptah-electron-e2e:e2e
```

Exit 1 after 1,382 seconds. Playwright report statistics:

```text
total: 175
passed/expected: 166
failed/unexpected: 1
skipped: 8
flaky: 0
```

All formerly systemic categories passed, including auto-updater, clipboard,
electron browser capabilities, real git hunk RPC, license watcher, permission
survival, `rpc-new-features`, the full RPC envelope file, smoke, and state.

The sole failure was
`mcpDirectory:listOAuthConnected returns an empty servers array on a fresh launch`:
expected 0, received 1. This machine has one OAuth connection in its real home;
`launchPtah` isolates Electron user data and SQLite but deliberately does not
replace `HOME` / `USERPROFILE`. It is unrelated to readiness and was not one of
the timeout signatures. Re-running only that test with both home variables set
to an empty worktree-local directory produced **1 passed, 0 failed** in 5.9
seconds (Nx exit 0). CI runners use a fresh home, so the local entry is not
present there.

### Static checks

```text
npx nx run-many -t lint typecheck -p ptah-electron-e2e
```

Exit 0. Nx reported both targets successful. TypeScript emitted no errors.
ESLint emitted 0 errors and 9 pre-existing warnings in files outside this
change (non-null assertions, unused disables, and empty fixture cleanup
callbacks).

`git diff --check` also passed with no output.

## Anything not fixed

- I did not change the unrelated local-home OAuth isolation behavior. The
  isolated-home focused rerun proves the product result is correct; changing
  profile semantics is outside this CI timeout fix.
- The full suite therefore did not produce a completely green local summary in
  the unmodified developer environment: it produced 166 pass / 1 unrelated
  fail / 8 skip. The original systemic failure was reproduced red and then
  verified green both in the focused RPC file and across every affected area in
  the full run.
- The Nx/Playwright process prints a `MaxListenersExceededWarning` after runs.
  It was present before and after this patch and did not fail a target.

No commit was created and nothing was pushed.
