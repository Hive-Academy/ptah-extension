## Root cause

Most likely injector: `apps/ptah-electron-e2e/src/support/rpc-bridge.ts:142-182`, `waitForRendererMessage` uses `app.evaluate` and a timeout that assigned `patchable.send = originalSend` after a window could be destroyed. This matches the `eval at evaluate` timeout stack and destroyed webContents. `sendRpc` in the same file (`:61-100`) also patched `webContents.send` without window-close cleanup. Other candidates reviewed: `apps/ptah-electron-e2e/src/support/ui-driver.ts:82,185,201,222,246,263,298,349` and `tray-process.ts:16,69` evaluate in main but the observed timers touching webContents are in RpcBridge; `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs:179,231` installs a main-process interval probe, but it records RPC timing and does not touch a window. `apps/ptah-electron/src/services/electron-browser-capabilities.ts:233` evaluates in a renderer CDP context, not Electron main.

Ptah timers audit: `boot-progress-publisher.ts:178` calls `flush`, which checks both window and webContents destruction through `liveContents`; `electron-browser-capabilities.ts:144` has a page-load timeout that rejects only; its lifetime and inactivity timers close a managed window through guarded lifecycle methods. `ipc-bridge.ts:789` and `electron-platform-commands.ts:100` defer `reloadWindow`; `electron-platform-commands.ts:35` now checks both destruction flags before reload. Other main timers in boot coordinator, workspace restore, shutdown, and main control service state, not a captured webContents.

## Changes

- `apps/ptah-electron/src/activation/main-process-error-guard.ts`: log and capture post-boot process errors, with stderr fallback if reporting fails.
- `apps/ptah-electron/src/activation/main-process-error-guard.spec.ts`: cover exception, rejection, Sentry, and disposal.
- `apps/ptah-electron/src/activation/boot-trace.ts`: hand off after boot guards are disarmed at renderer-ready.
- `apps/ptah-electron/src/activation/boot-trace.spec.ts`: verify handoff ordering.
- `apps/ptah-electron/src/main.ts`: install post-boot guard using injected Logger and existing SentryService.
- `apps/ptah-electron/src/services/platform/electron-platform-commands.ts`: check window and webContents before deferred reload.
- `apps/ptah-electron/src/services/platform/electron-platform-commands.reload.spec.ts`: give the live-window fixture destruction APIs used by the guarded reload.
- `apps/ptah-electron-e2e/src/support/rpc-bridge.ts`: clear timers and restore patched send on close, timeout, or response, only while live.

## Decisions

- Fatal during boot; non-fatal after renderer load. Options: retain Electron modal/exit for every exception or report and continue. Evidence: the captured error is a late automation callback against a destroyed object; boot-trace already exits on boot exceptions. Reversible: yes.
- Reuse the existing SentryService and Logger from the boot DI container. Options: direct Sentry SDK or existing service. Evidence: `main.ts` and `bootstrap.ts` already resolve/initialize SentryService. Reversible: yes.
- Handoff from `bootStep(goal)` after disarming guards. Options: add an independent boot status listener or use the existing step. Evidence: `post-window.ts` records renderer `did-finish-load` as the end of boot. Reversible: yes.

## Verify results

- `npm run verify -- -p ptah-electron-e2e`: exit 0; lint and typecheck passed; project has no `test` target.
- `npm run verify -- -p ptah-electron`: first run failed on two new spec/mock problems, fixed; rerun lint and typecheck passed, Jest 59 suites passed and 37 failed. Remaining failures came from missing worktree-local `node_modules/marked` and `node_modules/electron` fixtures; no changed specs failed. Concurrent edits in `cli-agent-runtime` surfaced two type errors on the first run and cleared on rerun.
- `ptah_get_diagnostics` scoped to changed files was unavailable twice due a 45-second TypeScript check timeout.

## Open questions

Exact outside automation/inspector that injected the recorded callback cannot be proven from the stack alone. RpcBridge is the strongest in-repo match.
