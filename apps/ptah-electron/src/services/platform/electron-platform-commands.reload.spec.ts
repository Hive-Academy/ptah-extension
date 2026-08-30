/**
 * `ElectronPlatformCommands.reloadWindow` — the no-window fallback must not
 * skip the teardown chain (TASK_2026_326).
 *
 * `app.exit()` emits neither `before-quit` nor `will-quit`, so the LIFO
 * cleanup in `main.ts` — CLI agent subprocesses, provider proxy leases, the
 * SQLite handle, the settings flush — never runs. The fallback fires exactly
 * when the app is already in a degraded state (no window to reload), which is
 * the worst moment to strand a subprocess. `app.quit()` reaches the same
 * relaunch through the handlers that clean up first.
 */
jest.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: jest.fn(),
    getAllWindows: jest.fn(() => []),
  },
  app: {
    relaunch: jest.fn(),
    quit: jest.fn(),
    exit: jest.fn(),
  },
}));

import { BrowserWindow, app } from 'electron';
import { ElectronPlatformCommands } from './electron-platform-commands';
import type { Logger } from '@ptah-extension/vscode-core';

const getFocusedWindow = BrowserWindow.getFocusedWindow as unknown as jest.Mock;
const getAllWindows = BrowserWindow.getAllWindows as unknown as jest.Mock;
const relaunch = app.relaunch as unknown as jest.Mock;
const quit = app.quit as unknown as jest.Mock;
const exit = app.exit as unknown as jest.Mock;

function makeCommands(): ElectronPlatformCommands {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  } as unknown as Logger;
  const webviewManager = {
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };
  return new ElectronPlatformCommands(logger, webviewManager);
}

describe('ElectronPlatformCommands.reloadWindow', () => {
  beforeEach(() => {
    getFocusedWindow.mockReset().mockReturnValue(null);
    getAllWindows.mockReset().mockReturnValue([]);
    relaunch.mockReset();
    quit.mockReset();
    exit.mockReset();
  });

  it('reloads the focused window and never touches app lifecycle', async () => {
    const reload = jest.fn();
    getFocusedWindow.mockReturnValue({ webContents: { reload } });

    await makeCommands().reloadWindow();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(relaunch).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('quits rather than exits when no window is left to reload', async () => {
    await makeCommands().reloadWindow();

    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
    // The whole point: `exit` bypasses `before-quit` and `will-quit`.
    expect(exit).not.toHaveBeenCalled();
  });

  it('relaunches before it quits, so the restart is registered', async () => {
    await makeCommands().reloadWindow();

    expect(relaunch.mock.invocationCallOrder[0]).toBeLessThan(
      quit.mock.invocationCallOrder[0],
    );
  });
});
