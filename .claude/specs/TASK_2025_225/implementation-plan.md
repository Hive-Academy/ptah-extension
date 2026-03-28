# Implementation Plan - TASK_2025_225

## Issue 1 & 3: `ptah.openFullPanel` silent no-op / Hide pop-out in Electron

**Decision**: Already fixed. The template at `app-shell.component.html:311` already has `@if (!isElectron)` guarding the pop-out button. The `openInEditor()` method is only invoked from that button's click handler -- no keyboard shortcuts or programmatic calls exist. Issues 1 and 3 require no frontend changes.

**Backend hardening**: Change `electron-command-rpc.handlers.ts:98-103` to return `{ success: false }` for `ptah.openFullPanel` instead of silently succeeding. This prevents future regressions if the command is ever called programmatically.

### File Changes

**MODIFY**: `apps/ptah-electron/src/services/rpc/handlers/electron-command-rpc.handlers.ts`

- In `handlePtahCommand()`, add explicit case for `ptah.openFullPanel` returning `{ success: false, error: 'Pop-out not available in Electron' }` before the default no-op case.
- Change the default case (line 103) from `return { success: true }` to `return { success: false, error: \`Command not supported in Electron: ${command}\` }` so unknown ptah.\* commands don't silently succeed.

## Issue 2: `reloadWindow()` UX improvement

**Decision**: Use `BrowserWindow.webContents.reload()` instead of `app.relaunch() + app.exit(0)`. This gives instant reload (~1s) instead of cold restart (~3-5s). The backend DI container does NOT need teardown because all reload triggers (license set/clear, settings import) already update backend state before scheduling the reload -- only the frontend needs to re-read the current state.

**Key insight**: The `get-startup-config` IPC handler in `main.ts:587` returns a frozen `startupConfig` object. When `webContents.reload()` runs, the preload script re-queries this handler but gets stale data. Fix: make the handler dynamically resolve the current license status from `LicenseService.getCachedStatus()` (synchronous, no network call).

### File Changes

**MODIFY**: `apps/ptah-electron/src/main.ts`

- Change `get-startup-config` handler (line 587-589) to dynamically resolve license status:
  ```ts
  ipcMain.on('get-startup-config', (event) => {
    // Dynamic license resolution so webContents.reload() gets fresh state
    let isLicensed = startupIsLicensed;
    let initialView = startupInitialView;
    try {
      const licenseService = container.resolve(TOKENS.LICENSE_SERVICE);
      const cached = licenseService.getCachedStatus();
      if (cached) {
        isLicensed = cached.valid;
        initialView = cached.valid ? null : 'welcome';
      }
    } catch {
      /* fallback to startup values */
    }
    event.returnValue = {
      initialView,
      isLicensed,
      workspaceRoot: startupWorkspaceRoot || '',
      workspaceName: startupWorkspaceRoot ? path.basename(startupWorkspaceRoot) : '',
    };
  });
  ```

**MODIFY**: `apps/ptah-electron/src/services/platform/electron-platform-commands.ts`

- Change `reloadWindow()` to use `BrowserWindow.getFocusedWindow()?.webContents.reload()` with fallback to `BrowserWindow.getAllWindows()[0]`:
  ```ts
  async reloadWindow(): Promise<void> {
    const { BrowserWindow } = await import('electron');
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.reload();
    } else {
      // Fallback: full relaunch if no window found
      const { app } = await import('electron');
      app.relaunch();
      app.exit(0);
    }
  }
  ```

## Risks / Gotchas

1. **Preload re-execution**: `webContents.reload()` re-runs the preload script and re-creates `contextBridge` bindings. This is expected and correct -- Electron handles it natively.
2. **In-flight RPC calls**: Any pending RPC promises in the Angular app will be lost on reload. This is the same behavior as the current cold restart, so no regression.
3. **Angular state**: All Angular state (ChatStore, signals) resets on reload. This is intentional -- the reload is specifically to pick up new license/config state from scratch.
4. **LicenseService cache**: `getCachedStatus()` returns the in-memory cached value. After `setLicenseKey()` or `clearLicenseKey()`, the cache is updated synchronously before `reloadWindow()` is scheduled (1500ms delay), so the IPC handler will always see fresh data.
