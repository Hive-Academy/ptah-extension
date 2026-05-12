import { test, expect } from '../support/fixtures';

/**
 * Error strings that indicate a fatal Electron startup regression.
 *
 * These exact substrings appeared in main-process stdout when the vscode shim
 * diverged from the real VS Code API:
 *   - '[ERROR] [SdkAgentAdapter]'  → ConfigWatcher.dispose() crashed because
 *     Disposable had no .dispose() method.
 *   - 'RpcHandler: Method "ptahCli:list" failed' → PtahCliConfigPersistence
 *     crashed because workspace.getConfiguration().get() returned undefined
 *     instead of the supplied defaultValue.
 *
 * If either string appears during a clean startup, a shim regression has shipped.
 */
const FATAL_STARTUP_ERROR_MARKERS = [
  '[ERROR] [SdkAgentAdapter]',
  'RpcHandler: Method "ptahCli:list" failed',
] as const;

/**
 * Smoke specs for the Playwright-Electron harness (Wave B.B1).
 *
 * These verify the harness itself works end-to-end:
 *   1. Electron launches and presents a window with a non-empty title.
 *   2. The window loads the renderer SPA from a file:// URL.
 *   3. The RpcBridge can round-trip state via 'get-state' / 'set-state'.
 *
 * Subsequent waves (B.B2-B.B4) will write feature-level specs against
 * this same fixture set.
 */
test.describe('Ptah Electron harness smoke', () => {
  test('no fatal startup error markers appear in main-process output', async ({
    mainWindow,
    mainProcessOutput,
  }) => {
    // Wait for the app to complete its activation sequence before checking
    // the captured output — some log lines arrive after the window is ready.
    await mainWindow.waitForLoadState('domcontentloaded');
    // Give the SDK adapter and RPC handler a beat to log any startup errors.
    await mainWindow.waitForTimeout(2000);

    for (const marker of FATAL_STARTUP_ERROR_MARKERS) {
      expect(
        mainProcessOutput.hasLine(marker),
        `Fatal startup error detected in main-process output: "${marker}"\n` +
          `Captured lines:\n${mainProcessOutput.lines.slice(0, 20).join('\n')}`,
      ).toBe(false);
    }
  });

  test('launches and exposes a non-empty window title', async ({
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const title = await mainWindow.title();
    expect(title).toBeTruthy();
    expect(typeof title).toBe('string');
    expect(title.length).toBeGreaterThan(0);
  });

  test('renderer is loaded from a file:// URL pointing at the renderer dir', async ({
    mainWindow,
  }) => {
    await mainWindow.waitForLoadState('domcontentloaded');
    const url = mainWindow.url();
    expect(url.startsWith('file://')).toBe(true);
    // Path should land inside the bundled renderer directory.
    expect(url.toLowerCase()).toContain('/renderer/');
    expect(url.toLowerCase()).toContain('index.html');
  });

  test('rpcBridge can round-trip state via get-state / set-state', async ({
    rpcBridge,
    mainWindow,
  }) => {
    // Wait for the main window to finish loading so the IPC bridge has
    // initialized and the state storage is wired up.
    await mainWindow.waitForLoadState('domcontentloaded');

    // The Electron 'get-state' handler returns the cached state object;
    // it may be an object, null, or undefined on a fresh launch.
    const initial = await rpcBridge.getState();
    // No assertion on initial value -- only that the call resolves.
    expect(['object', 'undefined']).toContain(typeof initial);

    const value = { e2eMarker: 'wave-b1', ts: Date.now() };
    await rpcBridge.setState(value);

    // 'set-state' is async on the main side -- give the persistence layer
    // a beat, then read back. We tolerate any shape because the cache may
    // wrap the object (e.g. inside a `value` property).
    await mainWindow.waitForTimeout(150);
    const after = await rpcBridge.getState();
    // Either the raw object or a wrapper containing our marker is acceptable.
    const json = JSON.stringify(after ?? {});
    expect(json).toContain('wave-b1');
  });
});
