# Batch 6 report: host wiring and DI guard specs (TASK_2026_853_3401)

## Files

- MODIFIED `libs/backend/platform-vscode/src/registration.ts`: binds
  `PLATFORM_TOKENS.DISPLAY_WINDOW_HOST` to `new DesktopOnlyDisplayWindowHost()` (`useValue`, after
  `HTTP_SERVER_PROVIDER`).
- MODIFIED `libs/backend/platform-cli/src/registration.ts`: same binding.
- MODIFIED `apps/ptah-electron/src/di/phase-4-handlers.ts`: `container.registerSingleton(DisplayWindowRpcHandlers)`
  next to `ArtifactRpcHandlers`; both names added to the phase-4.1 log list.
- MODIFIED `apps/ptah-electron/src/di/expected-resolvable.ts`, `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`:
  `DisplayWindowRpcHandlers` added (checked by each `container.smoke.spec.ts`).
- MODIFIED `apps/ptah-electron/src/di/rpc-surface.spec.ts`, `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`,
  `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`: one new case each pinning that the six
  `displayWindow:*` methods are served (VS Code and CLI also assert none is excluded).

## Decisions

- **Handler registration sites.** `ArtifactRpcHandlers` is registered explicitly only in Electron phase 4;
  VS Code and CLI construct lib-owned manifest handlers through `register-rpc-surface.ts` (`entry.handler`)
  without an explicit registration. Mirrored that: only Electron gets `registerSingleton`. Reversible.
- **Surface specs use a literal method list**, not the manifest, so a dropped method fails the spec.
- `surface-composition.spec.ts` (3) and `manifest.spec.ts` needed no edit: they passed in the run below.

## Verification

Run once together with batch 7 (the lock was busy; one run covers both batches' projects):

`npm run verify -- -p @ptah-extension/platform-vscode,@ptah-extension/platform-cli,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode`

- `NX 53 tasks: 53 succeeded, 2 cached` (lint, test, typecheck of the five projects plus dependency tasks)
- `lock released after 1145.1s, exit code 0`
