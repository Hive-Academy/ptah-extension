import type { ElectronApplication } from '@playwright/test';
import { test, expect } from '../support/fixtures';

/**
 * IPC contract specs for `get-startup-config`.
 *
 * The preload script issues `ipcRenderer.sendSync('get-startup-config')` once
 * during page load to obtain license + workspace bootstrap state. The main
 * handler is registered in apps/ptah-electron/src/activation/post-window.ts
 * and synchronously returns:
 *
 *   {
 *     initialView:    string | null,
 *     isLicensed:     boolean,
 *     workspaceRoot:  string,    // '' when no workspace is set
 *     workspaceName:  string,    // basename(workspaceRoot) or ''
 *   }
 *
 * The handler dynamically queries the LicenseService on each call so that
 * webContents.reload() picks up post-launch license changes.
 */

interface StartupConfig {
  initialView: string | null;
  isLicensed: boolean;
  workspaceRoot: string;
  workspaceName: string;
}

async function readStartupConfig(
  electronApp: ElectronApplication,
): Promise<StartupConfig> {
  return electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    let captured: unknown = undefined;
    const fakeEvent = {
      sender: win?.webContents,
      get returnValue() {
        return captured;
      },
      set returnValue(v: unknown) {
        captured = v;
      },
    } as unknown as Electron.IpcMainEvent;
    ipcMain.emit('get-startup-config', fakeEvent);
    return captured as StartupConfig;
  });
}

test.describe('get-startup-config IPC', () => {
  test('returns an object with all four expected keys', async ({
    electronApp,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const cfg = await readStartupConfig(electronApp);

    expect(cfg).toBeTruthy();
    expect(typeof cfg).toBe('object');
    expect(cfg).toHaveProperty('initialView');
    expect(cfg).toHaveProperty('isLicensed');
    expect(cfg).toHaveProperty('workspaceRoot');
    expect(cfg).toHaveProperty('workspaceName');
  });

  test('isLicensed is a boolean even when no license file exists', async ({
    electronApp,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const cfg = await readStartupConfig(electronApp);
    expect(typeof cfg.isLicensed).toBe('boolean');
    // initialView can be either null (premium / licensed) or a string
    // (e.g. 'welcome' for unlicensed) -- both are valid envelope shapes.
    expect(['string', 'object']).toContain(typeof cfg.initialView);
    if (cfg.initialView !== null) {
      expect(typeof cfg.initialView).toBe('string');
    }
  });

  test('workspaceRoot/workspaceName are strings (empty when no workspace)', async ({
    electronApp,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const cfg = await readStartupConfig(electronApp);
    expect(typeof cfg.workspaceRoot).toBe('string');
    expect(typeof cfg.workspaceName).toBe('string');
    // E2E launches with no explicit workspace -- both are commonly ''.
    // We assert the *type* contract, not the value, because the user may
    // have a persisted workspace from the host's userData dir.
    if (cfg.workspaceRoot === '') {
      expect(cfg.workspaceName).toBe('');
    }
  });

  test('two consecutive get-startup-config calls return the same shape', async ({
    electronApp,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const a = await readStartupConfig(electronApp);
    const b = await readStartupConfig(electronApp);

    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    // The values should also be stable across calls in the absence of a
    // license event mid-test (the watcher only fires on verify/expire).
    expect(typeof a.isLicensed).toBe(typeof b.isLicensed);
    expect(typeof a.workspaceRoot).toBe(typeof b.workspaceRoot);
  });
});
