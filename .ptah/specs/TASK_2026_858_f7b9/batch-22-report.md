## Task 22.1 — Files changed

- `apps/ptah-electron/src/rpc-host-profile.ts`: enabled `remoteMachines` and mapped `host.remoteMachines` to `MachinesRpcHandlers` (lines 57, 61).
- `apps/ptah-electron/src/di/phase-4-handlers.ts`: registered a cached `MachinesService` factory using the default `MachineRegistry`, `MachineTokenStore` over `PLATFORM_TOKENS.SECRET_STORAGE`, `TOKENS.WEBVIEW_MANAGER`, and `app.getVersion()`; registered `MachinesRpcHandlers` (lines 222–237).
- `apps/ptah-electron/src/activation/wire-runtime.ts`: captured the service after RPC registration and asynchronously loaded saved machines and requested connections; startup failures warn (line 343 onward).
- `apps/ptah-electron/src/activation/boot-coordinator.ts` and `apps/ptah-electron/src/activation/shutdown.ts`: added a nullable captured service handle and disposed it in the existing quit chain (lines 121, 221; line 253). Quit does not resolve DI.
- `apps/ptah-electron/src/di/rpc-surface.spec.ts`: restored the empty exclusion assertion and complete manifest expectation (lines 39, 80).

## Task 22.2 — ws declaration

Electron main imports `@ptah-extension/remote-machines` at runtime (`apps/ptah-electron/src/activation/wire-runtime.ts:45`); the library imports `machine-connection.ts` (`libs/backend/remote-machines/src/lib/machines-service.ts:7`), which imports `ws` (`libs/backend/remote-machines/src/lib/machine-connection.ts:2`). `apps/ptah-electron/package.json:55` declares `"ws": "^8.21.0"`. No file changed for Task 22.2.

## Decisions

- **Service registration:** class token with `instanceCachingFactory`; alternatives were a new token or lifecycle registration. The service has no decorator and neighboring Electron DI uses cached factories (`codex-login-composition.ts`). Reversible.
- **Startup:** call `list()` then `retry()` for each saved machine; alternatives were `list()` only or no startup call. The service has no `start`/`load` method, `list()` creates connections, and `retry()` initiates connection. Reversible.
- **Shutdown:** extend `BootRefs` and the existing `shutdown.ts` chain; alternative was a separate `will-quit` listener. Existing quit flow disposes captured handles in order and avoids lazy resolution. Reversible.

## Verification

- Ran `npx prettier --write` on all six changed TypeScript files.
- `ptah_get_diagnostics` was unavailable after a 45-second TypeScript timeout; scoped diagnostics did not complete.
- Ran the mandated command twice, with the second run after the DI factory fix: `npm run verify -- -p ptah-electron -- --output-style=static > /tmp/p-e-b22-lane.log 2>&1; echo exit=$?`; filtered the same log with the mandated `grep` expression.
- Second run: Electron lint and typecheck **succeeded**; lint reported 27 warnings and 0 errors. Tests did not run because their `build-main` dependency could not resolve `@ptah-extension/remote-machines` at three import sites. Output contained `Failed tasks:`; command printed `exit=130`.

## Known limits

- Verification is incomplete. This worktree has no `node_modules/@ptah-extension/remote-machines` link, so the existing Electron `build-main` resolver cannot load the new library alias. The TypeScript path alias exists in `tsconfig.base.json:122–123`, which is why typecheck succeeds. The task scope excludes package/workspace configuration changes and forbids a direct build target, so this was not changed here.
- The Electron surface spec could not execute because its test target depends on the failing build.

## Orchestrator verification (2026-11-06)

- Lane blocker resolved: `ptah-electron:build-main` (a dependency of the `test` target) failed
  with `Could not resolve "@ptah-extension/remote-machines"`. The Electron main bundle uses the
  explicit `paths` list in `apps/ptah-electron/tsconfig.build.json`. The orchestrator added
  `@ptah-extension/remote-machines` and `@ptah-extension/worker-protocol` (same fix pattern as
  60de981ed).
- `npm run verify -- -p ptah-electron`: lint and typecheck pass (27 warnings, 0 errors, all in
  untouched files). Tests: 1661 passed, 8 skipped, 1 failed.
- The one failure, `src/di/phase-2-libraries.config-home.spec.ts` (harness root resolved to
  `/tmp`), is environmental: a stray `/tmp/.ptah` folder (created 05:43, before this task,
  not owned by it) is found by the walk-up from the spec's `mkdtemp` folder. With
  `TMPDIR=/home/amun/.cache/ptah-phase-e-tmp` the spec passes (1/1). The spec's dependence on
  the real temp parent is recorded as a follow-up, not fixed here.
- Task 22.2 confirmed: `ws` is external (`build-main` `thirdParty: false`) and declared at
  `apps/ptah-electron/package.json:55`. No change needed.
