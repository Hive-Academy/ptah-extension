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
 * Smoke specs for the Playwright-Electron harness.
 *
 * These verify the harness itself works end-to-end:
 *   1. Electron launches and presents a window with a non-empty title.
 *   2. The window loads the renderer SPA from a file:// URL.
 *   3. The RpcBridge can round-trip state via 'get-state' / 'set-state'.
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

    // 'set-state' replaces the whole 'webview-state' object and commits
    // asynchronously. During start-up the renderer's services (ThemeService,
    // ElectronLayoutService, ...) read-modify-write that same object; a write
    // that read the state before ours committed lands after it and drops the
    // marker. Re-write until a read-back holds it, so the round-trip is proven
    // without racing those start-up writes.
    // Unique per run, so a marker left in storage by an earlier run cannot
    // satisfy the read-back.
    const marker = `wave-b1-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await expect(async () => {
      await rpcBridge.setState({ e2eMarker: marker });
      await expect
        .poll(async () => JSON.stringify((await rpcBridge.getState()) ?? {}), {
          timeout: 2_000,
        })
        .toContain(marker);
    }).toPass({ timeout: 15_000 });
  });
});
