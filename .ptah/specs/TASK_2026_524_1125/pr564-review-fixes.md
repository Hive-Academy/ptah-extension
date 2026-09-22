# PR 564 review fixes

All three findings are fixed in the requested worktree. No git commands were run; the latest changes are left uncommitted.

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-524-webview-routing`.
All paths and line numbers below refer to the final files under this root.

## Finding 1 — assert against renderer console errors

- CREATED `apps/ptah-electron-e2e/src/support/renderer-console-errors.ts:1-14`: small shared helper attaches a Playwright Page `console` listener synchronously, collects only `error` messages, and exposes listener cleanup.
- MODIFIED `apps/ptah-electron-e2e/src/support/fixtures.ts:10,42-55`: adds `rendererConsoleErrors` to the existing fixture set. Its listener is registered before Playwright invokes the test body, hence before either `ui.goto(...)`; `finally` removes it even when a test fails. Existing main-process capture remains available for its legitimate consumers.
- MODIFIED `apps/ptah-electron-e2e/src/specs/marketplace/marketplace.spec.ts:20,37-41` and `apps/ptah-electron-e2e/src/specs/tribunal/tribunal.spec.ts:20,33-37`: replace the unused main-process fixture with renderer errors and reject any captured error containing `[SurfaceRouterService] Navigation to`.
- CREATED `apps/ptah-electron-e2e/src/specs/support/renderer-console-errors.spec.ts:1-40`: two isolated unit tests exercise the Page event contract using an EventEmitter. An error emitted during simulated navigation is captured and demonstrably fails the same negative assertion used by the route specs. Non-error levels are ignored, and disposal removes the listener and prevents later collection.

No renderer-console capture helper existed in the support directory. The existing fixture lifecycle and Playwright runner were reused; no new framework or test target was introduced.

## Finding 2 — invalidate only the request owned by unsuccessful navigation

- MODIFIED `libs/frontend/core/src/lib/services/app-state.service.ts:1030-1035`: adds `clearHarnessWorkflowRequest(request)`, comparing the pending signal value with the request by reference before clearing. Equal payloads from separate calls have separate ownership. The class and request type are already exported through the existing services and core barrels, so no barrel change was needed.
- MODIFIED `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts:6,100-107,127-133`: creates one request object per call, stores it, and passes that exact object into navigation settlement. `failed` and `cancelled` invalidate only that request if it remains pending. `navigated` and `already-there` retain it. Cancellation still returns without reporting an error; failure retains the existing error reporting. Resume-only navigation supplies no request and therefore clears none.
- MODIFIED `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.spec.ts:20-24,41,72-92,177,220,224-276`: uses the real AppStateManager with a router stub and a call-through spy. Failure and cancellation leave nothing consumable. Deferred navigation tests prove a newer request survives an older failure or cancellation, even with identical payloads. Both successful outcomes retain a consumable request and report no error.
- MODIFIED `libs/frontend/core/src/lib/services/app-state.service.spec.ts:56,128-163`: verifies owned-request invalidation, preservation of an identical-payload replacement, and no-op cleanup after consumption.

Stack and boundaries: `package.json` declares Angular 22.1.7, TypeScript 6.0.3, Nx 23.2.1, and Playwright; existing services use `inject()`, root providers, and signals. Cross-library references use `@ptah-extension/core`. No templates, styling, shared UI primitives, or rendering boundaries changed.

## Finding 3 — genuine lazy-route cost exceeds the individual test timeout

- MODIFIED `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:160-162,176`: adds a measurement comment and changes only the `never calls window.history while navigating every surface` test's timeout to **30,000 ms**. The loop, complete existing `JEST_RESOLVABLE_SURFACE_IDS` set, and every assertion remain unchanged. No global/project timeout or teardown configuration was changed. The existing tribunal transform exclusion was neither introduced nor expanded.

### Measurement before choosing the fix

Temporarily instrumented each awaited navigation with `performance.now()` and gave only this test a diagnostic 60-second ceiling. Ran the entire routing spec with Jest's transform cache disabled and `--detectOpenHandles`. Removed all timing instrumentation and the temporary ceiling before final verification. The cold loop took **6,788.2 ms**, already beyond the original 5,000 ms default. Its lazy-route portion accounted for **6,699.4 ms**:

| Surface         | Measured navigation duration |
| --------------- | ---------------------------: |
| chat            |                      15.1 ms |
| setup-wizard    |                       4.6 ms |
| settings        |                       4.6 ms |
| analytics       |                       3.8 ms |
| harness-builder |                     635.2 ms |
| setup-hub       |                     296.7 ms |
| thoth           |                   2,921.3 ms |
| marketplace     |                     830.0 ms |
| tasks           |                   2,016.2 ms |

These are real route-resolution costs, including Jest transformation/module loading and Angular resolution, not a sleep or test-fixture loop. `app.routes.ts:89-122` names the real dynamic imports. The diagnostic routing suite passed **44/44 tests** in **61.007 s**; that whole-suite duration includes eager import/setup cost outside the timed navigation loop. The user's reported CI **40.981 s** is likewise a suite duration, not a measured duration of this one test. The final 30-second per-test ceiling provides headroom for a cold/contended CI runner and matches the existing lazy-component-resolution tests in this file.

### Force-exit investigation

The loop does not configure/reset TestBed, create a component fixture, add a subscription, or start a repeating timer per surface. `configure()` runs once in `beforeEach` (`webview-routing.spec.ts:94-141`), the router is injected once per test, and `afterEach` resets TestBed and restores spies (`:144-151`). The only explicit settle timer is a single awaited zero-delay timer in `libs/frontend/core/src/testing/surface-router-testing.ts:91-94`.

Cleanup is already owned by the injector: `SurfaceRouterService` uses `toSignal` without manual cleanup (`libs/frontend/core/src/lib/routing/surface-router.service.ts:75-81`); the installed Angular implementation registers unsubscribe with DestroyRef. Angular Router's `ngOnDestroy()` calls `dispose()` and completes/unsubscribes its navigation/event streams. `MessageRouterService` registers its teardown with DestroyRef (`libs/frontend/core/src/lib/services/message-router.service.ts:118`), removes the window listener, cancels its drain handle, and clears its queue (`:277-288`). The canvas-request timers in AppStateManager are not called by this spec.

The diagnostic process exited successfully with **no open handles reported** and no forced-exit warning. The final full-project run also exited successfully with **no forced-exit warning**. No leak in this spec was found, so no speculative teardown changes were made. A timed-out async test continuing into teardown could explain the CI warning, but that is an unconfirmed possibility; these runs do not establish its original CI cause or prove a leak elsewhere.

### Final full-project verification

Ran the requested `npx nx test ptah-extension-webview` with the final source: **10/10 suites, 196/196 tests passed**, reported Jest duration **13.136 s**, Nx duration **14.4 s**, **0/1 cache hits**, exit code **0**. The exact command and full output are included below alongside the diagnostic run.

## Verification commands and real output

All commands ran from the worktree root in PowerShell. Nx commands used `$env:NX_DAEMON='false'`. Output was captured with `*> tmp/pr564-review/<name>.log`, then printed with `Get-Content`; each wrapper retained `$LASTEXITCODE` and exited with it. The output below is complete for each recorded verification invocation, with terminal color escape codes removed for readability. PowerShell's native-stderr formatting is retained.

The first required test command actually ran both projects (0/2 cache hits). A later static-output invocation replayed those results from the local cache to expose the suite counts: core **30 suites / 767 tests**, harness-builder **5 suites / 119 tests**. The header explicitly says **Running target test for 2 projects**. Required lint passed for all three projects. The harness-builder typecheck target exists and passed with NG8107 warnings in two unchanged files. An additional Electron E2E typecheck passed. Both renderer helper unit tests passed in isolation.

### Required tests

```powershell
$env:NX_DAEMON='false'; npx nx run-many -t test -p harness-builder -p core *> tmp/pr564-review/test.log; $result = $LASTEXITCODE; Get-Content tmp/pr564-review/test.log; exit $result
```

Observed exit code: **0**.

```text

 NX   Running target test for 2 projects:

- @ptah-extension/harness-builder
- @ptah-extension/core


√  nx run @ptah-extension/core:test
√  nx run @ptah-extension/harness-builder:test



 NX   Successfully ran target test for 2 projects


Output of 2 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      19.6s
  Cache:             0/2 hit (0%)
  Critical path:     19.5s (1 task)
  Recoverable time:  <1ms
```

### Required lint

```powershell
$env:NX_DAEMON='false'; npx nx run-many -t lint -p harness-builder -p core -p ptah-electron-e2e *> tmp/pr564-review/lint.log; $result = $LASTEXITCODE; Get-Content tmp/pr564-review/lint.log; exit $result
```

Observed exit code: **0**.

```text

 NX   Running target lint for 3 projects:

- @ptah-extension/harness-builder
- @ptah-extension/core
- ptah-electron-e2e


√  nx run @ptah-extension/harness-builder:lint
√  nx run @ptah-extension/core:lint
√  nx run ptah-electron-e2e:lint



 NX   Successfully ran target lint for 3 projects


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      10.1s
  Cache:             0/3 hit (0%)
  Critical path:     7.0s (1 task)
  Recoverable time:  3.1s (30% of the run)
```

### Required typecheck

```powershell
$env:NX_DAEMON='false'; npx nx typecheck harness-builder *> tmp/pr564-review/typecheck.log; $result = $LASTEXITCODE; Get-Content tmp/pr564-review/typecheck.log; exit $result
```

Observed exit code: **0**.

```text

> nx run @ptah-extension/harness-builder:typecheck

> npx ngc --noEmit --project libs/frontend/harness-builder/tsconfig.lib.json

node.exe :
../chat-ui/src/lib/molecules/setup-plugins/mcp-directory-browser.component.ts:207:50 -
warning NG8107: NG8107: The left side of this optional chain operation does not include 'null' or
'undefined' in its type, therefore the '?.' operator can be replaced with the '.' operator. Find more at
https://v22.angular.dev/extended-diagnostics/NG8107
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (../chat-ui...gnostics/NG8107:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError


207                           >{{ server.repository?.id }}</span
                                                     ~~

../chat/src/lib/components/molecules/peer-session-send/peer-session-send-dialog.component.ts:181:[93
m46 - warning NG8107: NG8107: The left side of this optional chain operation does not include
'null' or 'undefined' in its type, therefore the '?.' operator can be replaced with the '.' operator. Find more at
https://v22.angular.dev/extended-diagnostics/NG8107

181                       Target: {{ res.target?.name }}
                                                 ~~~~





 NX   Successfully ran target typecheck for project @ptah-extension/harness-builder


  Run duration:      19.8s
  Cache:             0/1 hit (0%)
  Critical path:     19.8s (1 task)
  Recoverable time:  <1ms
```

### Cached test output with suite counts

```powershell
$env:NX_DAEMON='false'; npx nx run-many -t test -p harness-builder -p core --output-style=static *> tmp/pr564-review/test-static.log; $result = $LASTEXITCODE; Get-Content tmp/pr564-review/test-static.log -Tail 35; exit $result
```

Observed exit code: **0**.

```text

 NX   Running target test for 2 projects:

- @ptah-extension/harness-builder
- @ptah-extension/core



> nx run @ptah-extension/core:test  [local cache]

The `@nx/jest:jest` executor is deprecated and will be removed in Nx v24. Run `nx g @nx/jest:convert-to-inferred` to migrate to the `@nx/jest/plugin` inferred targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.
(node:4788) Warning: Failed to load the ES module: D:\projects\ptah-extension\.claude-worktrees\task-524-webview-routing\libs\frontend\core\jest.config.ts. Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.
(Use `node --trace-warnings ...` to show where the warning was created)

Test Suites: 30 passed, 30 total
Tests:       767 passed, 767 total
Snapshots:   0 total
Time:        13.953 s
Ran all test suites.

> nx run @ptah-extension/harness-builder:test  [local cache]

The `@nx/jest:jest` executor is deprecated and will be removed in Nx v24. Run `nx g @nx/jest:convert-to-inferred` to migrate to the `@nx/jest/plugin` inferred targets. See https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.

Test Suites: 5 passed, 5 total
Tests:       119 passed, 119 total
Snapshots:   0 total
Time:        18.038 s
Ran all test suites.



 NX   Successfully ran target test for 2 projects

Nx read the output from the cache instead of running the command for 2 out of 2 tasks.

  Run duration:      66ms
  Cache:             2/2 hit (100%)
  Critical path:     4ms (1 task)
  Recoverable time:  <1ms
```

### Renderer unit tests through Electron config (blocked before execution)

```powershell
npx playwright test --config=apps/ptah-electron-e2e/playwright.config.ts apps/ptah-electron-e2e/src/specs/support/renderer-console-errors.spec.ts *> tmp/pr564-review/renderer-unit.log; $result = $LASTEXITCODE; Get-Content tmp/pr564-review/renderer-unit.log; exit $result
```

Observed exit code: **1**.

```text
Error: [ptah-electron-e2e] Missing Electron build artifacts:
  - D:\projects\ptah-extension\.claude-worktrees\task-524-webview-routing\dist\apps\ptah-electron\preload.js
  - D:\projects\ptah-extension\.claude-worktrees\task-524-webview-routing\dist\apps\ptah-electron\renderer\index.html

Run the build first:
  npx nx build-dev ptah-electron && npx nx copy-renderer-dev ptah-electron

(The 'e2e' target normally chains these via dependsOn -- if you
see this error, the build step likely failed. Re-run with verbose
Nx output to inspect.)

   at ..\support\build-precheck.ts:36

  34 |   if (missing.length > 0) {
  35 |     const list = missing.map((p) => `  - ${p}`).join('\n');
> 36 |     throw new Error(
     |           ^
  37 |       `[ptah-electron-e2e] Missing Electron build artifacts:\n${list}\n\n` +
  38 |         `Run the build first:\n` +
  39 |         `  npx nx build-dev ptah-electron && npx nx copy-renderer-dev ptah-electron\n\n` +
    at globalSetup (D:\projects\ptah-extension\.claude-worktrees\task-524-webview-routing\apps\ptah-electron-e2e\src\support\build-precheck.ts:36:11)
```

### Renderer unit tests in isolation (no Electron setup needed)

```powershell
npx playwright test --config=apps/ptah-electron-e2e/src/specs/support --reporter=list *> tmp/pr564-review/renderer-unit-isolated.log; $result = $LASTEXITCODE; Get-Content tmp/pr564-review/renderer-unit-isolated.log; exit $result
```

Observed exit code: **0**.

```text

Running 2 tests using 1 worker

node.exe : (node:25544) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: ((node:25544) Wa... env being set.:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

(Use `node --trace-warnings ...` to show where the warning was created)
  ok 1 apps\ptah-electron-e2e\src\specs\support\renderer-console-errors.spec.ts:5:5 › captures navigation errors emitted during goto from the renderer console (32ms)
  ok 2 apps\ptah-electron-e2e\src\specs\support\renderer-console-errors.spec.ts:29:5 › ignores other console levels and stops capturing after disposal (6ms)

  2 passed (1.7s)
```

### Additional Electron E2E typecheck

```powershell
$env:NX_DAEMON='false'; npx nx typecheck ptah-electron-e2e *> tmp/pr564-review/e2e-typecheck.log; $result = $LASTEXITCODE; Get-Content tmp/pr564-review/e2e-typecheck.log; exit $result
```

Observed exit code: **0**.

```text

> nx run ptah-electron-e2e:typecheck

> tsc --noEmit --project apps/ptah-electron-e2e/tsconfig.spec.json




 NX   Successfully ran target typecheck for project ptah-electron-e2e


  Run duration:      6.4s
  Cache:             0/1 hit (0%)
  Critical path:     6.4s (1 task)
  Recoverable time:  <1ms
```

## Formatting

```powershell
npx prettier --write apps/ptah-electron-e2e/src/support/renderer-console-errors.ts apps/ptah-electron-e2e/src/support/fixtures.ts apps/ptah-electron-e2e/src/specs/support/renderer-console-errors.spec.ts apps/ptah-electron-e2e/src/specs/marketplace/marketplace.spec.ts apps/ptah-electron-e2e/src/specs/tribunal/tribunal.spec.ts libs/frontend/core/src/lib/services/app-state.service.ts libs/frontend/core/src/lib/services/app-state.service.spec.ts libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.spec.ts
```

Observed exit code: **0**.

```text
apps/ptah-electron-e2e/src/support/renderer-console-errors.ts 169ms (unchanged)
apps/ptah-electron-e2e/src/support/fixtures.ts 180ms (unchanged)
apps/ptah-electron-e2e/src/specs/support/renderer-console-errors.spec.ts 40ms
apps/ptah-electron-e2e/src/specs/marketplace/marketplace.spec.ts 18ms (unchanged)
apps/ptah-electron-e2e/src/specs/tribunal/tribunal.spec.ts 12ms (unchanged)
libs/frontend/core/src/lib/services/app-state.service.ts 370ms (unchanged)
libs/frontend/core/src/lib/services/app-state.service.spec.ts 522ms (unchanged)
libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts 71ms (unchanged)
libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.spec.ts 58ms
```

## Finding 3: cold routing measurement and open-handle diagnosis

```powershell
$env:NX_DAEMON='false'; npx jest --config=apps/ptah-extension-webview/jest.config.ts --runTestsByPath apps/ptah-extension-webview/src/app/webview-routing.spec.ts --runInBand --detectOpenHandles --no-cache --verbose *> tmp/pr564-review/routing-diagnostic.log; $result = $LASTEXITCODE; Get-Content tmp/pr564-review/routing-diagnostic.log; exit $result
```

Observed exit code: **0**.

```text
  console.log
    [routing timing] chat: 15.1 ms

      at src/app/webview-routing.spec.ts:167:17

  console.log
    [routing timing] setup-wizard: 4.6 ms

      at src/app/webview-routing.spec.ts:167:17

  console.log
    [routing timing] settings: 4.6 ms

      at src/app/webview-routing.spec.ts:167:17

  console.log
    [routing timing] analytics: 3.8 ms

      at src/app/webview-routing.spec.ts:167:17

  console.log
    [routing timing] harness-builder: 635.2 ms

      at src/app/webview-routing.spec.ts:167:17

  console.log
    [routing timing] setup-hub: 296.7 ms

      at src/app/webview-routing.spec.ts:167:17

  console.log
    [routing timing] thoth: 2921.3 ms

      at src/app/webview-routing.spec.ts:167:17

  console.log
    [routing timing] marketplace: 830.0 ms

      at src/app/webview-routing.spec.ts:167:17

  console.log
    [routing timing] tasks: 2016.2 ms

      at src/app/webview-routing.spec.ts:167:17

  console.log
    [routing timing] total: 6788.2 ms

      at src/app/webview-routing.spec.ts:170:15

node.exe : Test Suites: 1 passed, 1 total
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (Test Suites: 1 passed, 1 total:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

Tests:       44 passed, 44 total
Snapshots:   0 total
Time:        61.007 s
Ran all test suites within paths "apps/ptah-extension-webview/src/app/webview-routing.spec.ts".
```

## Finding 3: final formatting

```powershell
npx prettier --write apps/ptah-extension-webview/src/app/webview-routing.spec.ts *> tmp/pr564-review/routing-prettier.log; $result = $LASTEXITCODE; Get-Content tmp/pr564-review/routing-prettier.log; exit $result
```

Observed exit code: **0**.

```text
apps/ptah-extension-webview/src/app/webview-routing.spec.ts 260ms
```

## Finding 3: required full webview test target

```powershell
$env:NX_DAEMON='false'; $env:NX_TASKS_RUNNER_DYNAMIC_OUTPUT='false'; npx nx test ptah-extension-webview *> tmp/pr564-review/webview-test.log; $result = $LASTEXITCODE; Get-Content tmp/pr564-review/webview-test.log; exit $result
```

Observed exit code: **0**.

```text

> nx run ptah-extension-webview:test

node.exe : The `@nx/jest:jest` executor is deprecated and will be removed in Nx v24. Run `nx g
@nx/jest:convert-to-inferred` to migrate to the `@nx/jest/plugin` inferred targets. See
https://nx.dev/docs/guides/tasks--caching/convert-to-inferred for details.
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (The `@nx/jest:j...ed for details.:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

Test Suites: 10 passed, 10 total
Tests:       196 passed, 196 total
Snapshots:   0 total
Time:        13.136 s, estimated 57 s
Ran all test suites.



 NX   Successfully ran target test for project ptah-extension-webview


  Run duration:      14.4s
  Cache:             0/1 hit (0%)
  Critical path:     14.4s (1 task)
  Recoverable time:  <1ms
```

## Anything I could NOT do

- The normal Electron Playwright configuration could not start because this worktree lacks `dist/apps/ptah-electron/preload.js` and `dist/apps/ptah-electron/renderer/index.html`. The marketplace and tribunal Electron scenarios were not executed; no rendered Electron success is claimed. The new helper unit tests ran and passed independently of those artifacts.
- The Ptah LSP references tool returned unrelated references from the main checkout despite an absolute worktree path; its result was not used. References were checked with `rg` inside the requested worktree instead.
- The original CI force-exit warning could not be reproduced or attributed conclusively: the isolated cold routing run with open-handle detection and the final full webview suite both exited cleanly. No claim is made that a leak exists elsewhere.
- No required test (including the full webview target), lint, or harness-builder typecheck remains unrun or failing. No unrelated warning was changed.
