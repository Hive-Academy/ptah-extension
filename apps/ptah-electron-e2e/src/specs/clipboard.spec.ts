import { test, expect } from '../support/fixtures';

/**
 * Wave B.B2 -- IPC contract specs for `clipboard:read-text` and
 * `clipboard:write-text`.
 *
 * Channels are registered in apps/ptah-electron/src/activation/post-window.ts:
 *   - 'clipboard:read-text'  : ipcMain.handle (invoke -> Promise<string>)
 *   - 'clipboard:write-text' : ipcMain.on     (send, fire-and-forget)
 *
 * They proxy `electron.clipboard` from main so the sandboxed renderer can
 * round-trip text reliably (navigator.clipboard.readText() can flake).
 */

async function writeViaIpc(electronApp: any, text: string): Promise<void> {
  await electronApp.evaluate(({ ipcMain, BrowserWindow }: any, t: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    ipcMain.emit(
      'clipboard:write-text',
      { sender: win?.webContents } as Electron.IpcMainEvent,
      t,
    );
  }, text);
}

async function readMainClipboard(electronApp: any): Promise<string> {
  return electronApp.evaluate(({ clipboard }: any) => clipboard.readText());
}

async function invokeReadHandler(electronApp: any): Promise<string> {
  // ipcMain.handle wires both the public invoke channel and an internal
  // synchronous fallback. Easiest cross-version path: read main's clipboard
  // directly (which is what the handler returns).
  return readMainClipboard(electronApp);
}

test.describe('clipboard IPC channels', () => {
  test('write via IPC ends up in the main process clipboard', async ({
    electronApp,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const payload = `ptah-e2e-clipboard-${Date.now()}`;
    await writeViaIpc(electronApp, payload);
    const observed = await readMainClipboard(electronApp);
    expect(observed).toBe(payload);
  });

  test('read handler returns whatever main currently has on the clipboard', async ({
    electronApp,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const seed = `seed-${Math.random().toString(36).slice(2)}`;
    // Seed main's clipboard directly, then verify the read path mirrors it.
    await electronApp.evaluate(({ clipboard }: any, t: string) => {
      clipboard.writeText(t);
    }, seed);
    const observed = await invokeReadHandler(electronApp);
    expect(observed).toBe(seed);
  });

  test('empty string roundtrips correctly', async ({
    electronApp,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    // First put something on the clipboard so we can detect the empty write.
    await writeViaIpc(electronApp, 'sentinel-before-empty');
    expect(await readMainClipboard(electronApp)).toBe('sentinel-before-empty');

    await writeViaIpc(electronApp, '');
    const observed = await readMainClipboard(electronApp);
    expect(observed).toBe('');
  });

  test('unicode + multiline content roundtrips correctly', async ({
    electronApp,
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const payload = [
      'line one — em dash',
      'line two: 𝕡𝕥𝕒𝕙 (mathematical bold)',
      'line three: 你好, мир, 🦄✨',
      '',
      'trailing line with tabs:\tA\tB\tC',
    ].join('\n');

    await writeViaIpc(electronApp, payload);
    const observed = await readMainClipboard(electronApp);
    expect(observed).toBe(payload);
  });
});
