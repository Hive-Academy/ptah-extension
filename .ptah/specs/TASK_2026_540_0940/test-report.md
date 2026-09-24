# Test Report - TASK_2026_540_0940

Gate 3 QA (user choice: tester). The senior-tester wrote the specs and started the Electron suite, then stopped at the
Claude session limit before it wrote this report. The orchestrator finished the runs and wrote this report (2026-09-24).

## Verdict

PASS for the task-540 scope. All new Electron and webview-harness specs pass. The Electron suite failures are start-up
hangs in main-process code that task 540 does not change (see "Full Electron suite").

## New specs

| File | Flow | Tests | Result |
| --- | --- | --- | --- |
| `apps/ptah-electron-e2e/src/specs/config-menu/config-menu-keyboard.spec.ts` | Menu keyboard: Enter/Space open, arrows wrap, Escape returns focus, Enter activates + `aria-current` | 4 | 4 passed |
| `apps/ptah-electron-e2e/src/specs/config-menu/config-menu-welcome-gate.spec.ts` | No folder: menu -> Settings -> Back to welcome (with and without auth); close last workspace on Settings; open first folder while on a surface | 4 | 4 passed |
| `apps/ptah-electron-e2e/src/specs/config-menu/config-menu-remount.spec.ts` | Workspace switch on Thoth, Setup hub, Marketplace, Settings: surface stays AND its component is re-created; Chat negative control | 5 | 5 passed |
| `libs/frontend/webview-e2e-harness/src/lib/scenarios/vscode-shell/config-menu-absent.e2e.spec.ts` | VS Code shell has no configuration menu; SWITCH_VIEW navigation still works | 1 | passed (harness 72/72) |

`typecheck` and `lint` pass for `ptah-electron-e2e` and `@ptah-extension/webview-e2e-harness`.

### Defect found in the test, fixed

`config-menu-remount.spec.ts` `proveRecreated` read `document.contains(oldElement)` right after the click. The switch is
debounced (`electron-layout.service.ts:50`, 100 ms) and then awaits the `workspace:switch` RPC, so the old element was
still attached and the Settings case failed with `Received: true`. The check now polls (`expect.poll`) until the old
element is detached. After the fix, all 5 remount tests pass in a live renderer. No product change was needed.

## Full Electron suite

The senior-tester's full `ptah-electron-e2e:e2e` run (local, Windows, 1 worker) ended with 44 failed tests:

| Cause | Count |
| --- | --- |
| Electron did not reach `renderer/index.html` (`waitForURL` / `electronApp` fixture / `beforeEach` timeout) | 35 |
| Suite-specific waits after a slow start (git changed-files list, tasks visuals, one RPC count) | 9 |

A single re-run showed the cause: the main window stays on `assets/preparing-workspace.html` and the main-process log
stops after `[IpcBridge] IPC listeners initialized`, inside `wireRuntimePreWindow` / `registerPostWindow`
(`apps/ptah-electron/src/main.ts:235-253`). Task 540 changes no file under `apps/ptah-electron` or `libs/backend`
(`git diff --name-only origin/main...HEAD`: only `libs/frontend/chat`, `libs/frontend/core`, `apps/ptah-electron-e2e/src`
and this folder). The hang is intermittent: the same spec passes on another launch.

The full suite is not re-run locally: `.github/workflows/electron-e2e.yml` runs `ptah-electron-e2e:e2e` on CI for the PR.

## Follow-ups (not in scope)

- The `electronApp` fixture (`apps/ptah-electron-e2e/src/support/fixtures.ts:57`) is test-scoped, so every test launches
  and boots a new Electron app. A worker-scoped app with a per-test reset would cut the suite time a lot, but needs an
  isolation review of every spec.
- The intermittent local start-up hang after `IpcBridge IPC listeners initialized` needs its own bugfix task.

## Remaining manual checks (user)

1. macOS: the configuration menu trigger sits in the no-drag cluster of the title bar. Check that it is clickable, that
   the window still drags from the empty title-bar area, and that the dropdown backdrop covers the traffic lights.
2. Per-surface data after a workspace switch (risk RD): the remount re-creates each component, but some surfaces keep a
   service-level cache (for example `providers-settings-state.service.ts:1060-1065`). Open Settings, Setup hub,
   Marketplace and Thoth on workspace A, switch to B, and check that each shows B's data.
3. VS Code: open the extension and check that the tab row and views are unchanged (no configuration menu).
