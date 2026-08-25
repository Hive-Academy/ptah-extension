import { test, expect } from '../support/fixtures';
import { launchPtah } from '../support/electron-launcher';
import type { ElectronApplication } from '@playwright/test';

/**
 * App lifecycle / shutdown-hygiene specs.
 *
 * These guard a bug class that previously had NO coverage and shipped two
 * regressions:
 *   1. `will-quit` lazily resolved the Ptah CLI registry for the first time
 *      mid-teardown, racing with DI shutdown → the app hung on quit (60s) when
 *      the registry had never been built during the app's life (blocked
 *      network). Fixed by resolving it eagerly at startup (wire-runtime) and
 *      disposing the captured ref.
 *   2. A late RPC arriving during teardown hit a destroyed `event.sender`,
 *      logging `Object has been destroyed` + `Failed to send error response`.
 *      Fixed by guarding the sends with `webContents.isDestroyed()`.
 *
 * The assertions here are behavioural: the app must shut down promptly and
 * without teardown-error markers across launch modes.
 */

/**
 * Substrings that indicate a broken shutdown path. These are emitted by the
 * IpcBridge only when a send races a destroyed renderer — a clean teardown
 * never produces them.
 */
const TEARDOWN_ERROR_MARKERS = [
  '[IpcBridge] Unexpected error handling RPC message: Object has been destroyed',
  '[IpcBridge] Failed to send error response to renderer',
] as const;

/** Hard ceiling for a clean quit. A regression of bug #1 blows past this (60s). */
const CLEAN_CLOSE_BUDGET_MS = 25_000;

/** Collect main-process stdout+stderr for post-hoc marker assertions. */
function captureOutput(app: ElectronApplication): { lines: string[] } {
  const lines: string[] = [];
  const onData = (chunk: Buffer) =>
    lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
  app.process().stdout?.on('data', onData);
  app.process().stderr?.on('data', onData);
  return { lines };
}

/** Close the app, returning whether it closed within the budget and how long it took. */
async function timedClose(
  app: ElectronApplication,
): Promise<{ closed: boolean; elapsedMs: number }> {
  const start = Date.now();
  const closed = await Promise.race([
    app
      .close()
      .then(() => true)
      .catch(() => false),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), CLEAN_CLOSE_BUDGET_MS),
    ),
  ]);
  return { closed, elapsedMs: Date.now() - start };
}

function assertNoTeardownErrors(lines: string[]): void {
  for (const marker of TEARDOWN_ERROR_MARKERS) {
    const hit = lines.some((l) => l.includes(marker));
    expect(
      hit,
      `Teardown-error marker found: "${marker}"\n` +
        `Last 15 captured lines:\n${lines.slice(-15).join('\n')}`,
    ).toBe(false);
  }
}

test.describe('App lifecycle', () => {
  test('default-mode launch shuts down promptly and without teardown errors', async () => {
    const app = await launchPtah();
    const out = captureOutput(app);
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1_000);

    const { closed, elapsedMs } = await timedClose(app);
    expect(closed, `app did not close within ${CLEAN_CLOSE_BUDGET_MS}ms`).toBe(
      true,
    );
    expect(elapsedMs).toBeLessThan(CLEAN_CLOSE_BUDGET_MS);
    assertNoTeardownErrors(out.lines);
  });

  test('production-mode launch with blocked network shuts down promptly and cleanly', async () => {
    // This is the exact scenario that used to hang for 60s at teardown.
    const app = await launchPtah({ env: { NODE_ENV: 'production' } });
    const out = captureOutput(app);
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    // Best-effort network block (see auto-updater.spec.ts for the rationale on
    // tolerating an early evaluate race).
    await app
      .evaluate(({ session }) => {
        session.defaultSession.webRequest.onBeforeRequest(
          { urls: ['*://*/*'] },
          (_details, cb) => cb({ cancel: true }),
        );
      })
      .catch(() => undefined);
    await win.waitForTimeout(1_500);

    const { closed, elapsedMs } = await timedClose(app);
    expect(closed, `app did not close within ${CLEAN_CLOSE_BUDGET_MS}ms`).toBe(
      true,
    );
    expect(elapsedMs).toBeLessThan(CLEAN_CLOSE_BUDGET_MS);
    assertNoTeardownErrors(out.lines);
  });

  test('quit before the renderer settles does not hang or crash (guards eager CLI-registry capture)', async () => {
    // Regression guard for bug #1. Closing before the renderer fires its first
    // agent RPC means the CLI registry is NOT built on demand during the app's
    // life. Under the old code will-quit force-constructed it here — racing DI
    // teardown and hanging/throwing. With the fix it was built eagerly at
    // startup, so this quit stays prompt and clean.
    const app = await launchPtah({ env: { NODE_ENV: 'production' } });
    const out = captureOutput(app);
    // Do NOT wait for domcontentloaded — close as early as possible.
    await app.firstWindow();
    const { closed, elapsedMs } = await timedClose(app);
    expect(closed, `app did not close within ${CLEAN_CLOSE_BUDGET_MS}ms`).toBe(
      true,
    );
    expect(elapsedMs).toBeLessThan(CLEAN_CLOSE_BUDGET_MS);
    assertNoTeardownErrors(out.lines);
  });
});
