import { test, expect } from '../support/fixtures';

/**
 * Wave B.B2 -- IPC contract specs for `get-state` (sync) + `set-state` (async).
 *
 * The preload script exposes:
 *   - `ipcRenderer.sendSync('get-state')`     -> returns the cached state object
 *   - `ipcRenderer.send('set-state', state)` -> persists state via IStateStorage
 *
 * Note: the main-process `get-state` handler returns the *whole* cached state
 * object under the storage key 'webview-state' -- it does not index by key.
 * Callers must read the returned object and pluck the field they want.
 *
 * Reference: apps/ptah-electron/src/ipc/ipc-bridge.ts setupStateHandlers().
 */

test.describe('webview state IPC', () => {
  test('initial get-state returns an object (possibly empty)', async ({
    rpcBridge,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const initial = await rpcBridge.getState();
    // The handler always returns at least `{}` even when storage is empty.
    expect(initial).not.toBeNull();
    expect(typeof initial).toBe('object');
  });

  test('setState then getState reflects the written key', async ({
    rpcBridge,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const marker = `e2e-${Date.now()}`;
    await rpcBridge.setState({ 'chat.lastSession': marker });
    // Async persist -- give the storage layer a beat to settle.
    await mainWindow.waitForTimeout(150);

    const after = (await rpcBridge.getState()) as Record<
      string,
      unknown
    > | null;
    expect(after).not.toBeNull();
    expect(typeof after).toBe('object');
    // The cached state object should contain our marker somewhere -- we don't
    // pin the exact wrapping because storage adapters may envelope it.
    expect(JSON.stringify(after ?? {})).toContain(marker);
  });

  test('multiple sequential set-state calls -- last write wins', async ({
    rpcBridge,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    await rpcBridge.setState({ counter: 'first' });
    await mainWindow.waitForTimeout(50);
    await rpcBridge.setState({ counter: 'second' });
    await mainWindow.waitForTimeout(50);
    await rpcBridge.setState({ counter: 'third-final' });
    await mainWindow.waitForTimeout(150);

    const after = (await rpcBridge.getState()) as Record<
      string,
      unknown
    > | null;
    const json = JSON.stringify(after ?? {});
    expect(json).toContain('third-final');
    // The earlier values should have been overwritten -- the IStateStorage
    // adapter replaces the 'webview-state' record on each update.
    expect(json).not.toContain('"counter":"first"');
    expect(json).not.toContain('"counter":"second"');
  });

  test('state survives a renderer reload (storage layer is main-process owned)', async ({
    rpcBridge,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const marker = `reload-${Date.now()}`;
    await rpcBridge.setState({ persisted: marker });
    await mainWindow.waitForTimeout(200);

    await mainWindow.reload();
    await mainWindow.waitForLoadState('domcontentloaded');

    const after = (await rpcBridge.getState()) as Record<
      string,
      unknown
    > | null;
    expect(JSON.stringify(after ?? {})).toContain(marker);
  });

  test('non-serializable value (function) is handled gracefully', async ({
    rpcBridge,
    electronApp,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');

    // We can't pass a function across the Playwright -> main-process boundary,
    // but we can synthesize the equivalent inside main-process land. Emit
    // 'set-state' directly with a value that includes a non-cloneable field.
    // The handler wraps the await update() in try/catch and logs -- it must
    // NOT throw out into the IPC layer (which would crash the renderer).
    const result = await electronApp.evaluate(({ ipcMain, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      try {
        // A function on the state object isn't structured-cloneable; the
        // storage adapter typically JSON-stringifies, dropping or erroring.
        const naughty: any = { ok: 'value', fn: () => 42 };
        ipcMain.emit(
          'set-state',
          { sender: win?.webContents } as Electron.IpcMainEvent,
          naughty,
        );
        return { threw: false };
      } catch (err) {
        return { threw: true, message: (err as Error).message };
      }
    });

    expect(result.threw).toBe(false);
    // Subsequent reads must still succeed -- the bad write didn't poison state.
    const after = await rpcBridge.getState();
    expect(typeof after).toBe('object');
  });

  test('get-state remains valid after a set-state with empty object', async ({
    rpcBridge,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    await rpcBridge.setState({});
    await mainWindow.waitForTimeout(100);

    const after = await rpcBridge.getState();
    // Empty object is a valid value; handler should still return an object.
    expect(after).not.toBeNull();
    expect(typeof after).toBe('object');
  });
});
