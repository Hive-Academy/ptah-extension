# TASK_2025_225: Fix Electron Reload & Platform-Coupled Commands

## Task Type: BUGFIX + REFACTORING

## Strategy: Partial (Architect → Team-Leader → Developers → QA)

## Created: 2026-03-27

## User Request

Fix three Electron-specific issues found during reload investigation:

1. **BUG (Critical)**: `ptah.openFullPanel` command silently no-ops on Electron, then force-closes the user's tab — causing data loss
2. **REFACTORING (UX)**: `ElectronPlatformCommands.reloadWindow()` uses `app.relaunch() + app.exit(0)` — full cold restart. Improve to use `BrowserWindow.webContents.reload()` for smoother UX
3. **BUG (Minor)**: Pop-out button visible in Electron despite command not working — needs `isElectron` guard

## Investigation Findings

### Current Reload Architecture

- `IPlatformCommands.reloadWindow()` interface in `rpc-handlers/platform-abstractions.ts`
- VS Code impl: `vscode.commands.executeCommand('workbench.action.reloadWindow')` — quick in-process reload
- Electron impl: `app.relaunch() + app.exit(0)` — kills process, cold restart
- Frontend triggers reload via RPC `command:execute` with `workbench.action.reloadWindow`
- Electron intercepts in `electron-command-rpc.handlers.ts` → routes to `platformCommands.reloadWindow()`

### Files Involved

- `apps/ptah-electron/src/services/platform/electron-platform-commands.ts` — reloadWindow impl
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` — pop-out button
- `apps/ptah-electron/src/services/rpc/handlers/electron-command-rpc.handlers.ts` — command routing
- `apps/ptah-electron/src/main.ts` — BrowserWindow access

### Reload Triggers (all use `platformCommands.reloadWindow()`)

- License key set/clear (`license-rpc.handlers.ts`)
- Setup wizard completion (`setup-wizard.service.ts`)
- Settings import with license key (`electron-settings-rpc.handlers.ts`)
- Auth config reload button (`auth-config.component.ts` via RPC)
