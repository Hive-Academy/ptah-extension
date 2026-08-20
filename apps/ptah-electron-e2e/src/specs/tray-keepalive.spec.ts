import * as fs from 'fs';
import * as path from 'path';
import type { ElectronApplication } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { launchPtah, resolveElectronEntry } from '../support/electron-launcher';
import {
  createIsolatedPtahHome,
  seedTrayKeepalive,
} from '../support/tray-home';
import {
  closeAllWindows,
  forceKillIfAlive,
  simulateTrayQuit,
  waitForProcessExit,
} from '../support/tray-process';

/**
 * Tray keep-alive quit-path specs (TASK_2026_180 B5.2.1 / B5.2.2).
 *
 * B5.1 shipped `skillSynthesis.trayKeepalive`, which lets the app survive
 * `window-all-closed` with no windows open so background skill synthesis can
 * keep draining, PROVIDED a tray with a working "Quit Ptah" item actually
 * constructed (R10 — see `apps/ptah-electron/src/services/tray/tray.service.ts`
 * header comment). These specs prove the two ends of that contract at the real
 * OS-process level, not just at the unit level:
 *
 *   1. Shipped default (`trayKeepalive: false`, or no key at all): closing all
 *      windows quits the app exactly as it did before C5 -- the "byte-identical
 *      default path" R10 requires.
 *   2. Explicit `trayKeepalive: true`: closing all windows leaves the process
 *      alive, and the mechanism the tray's "Quit Ptah" item is wired to
 *      (`app.quit()`) terminates it cleanly.
 *
 * Both specs drive `window-all-closed` by closing the real BrowserWindow from
 * inside the main process (`closeAllWindows`) rather than via
 * `ElectronApplication.close()`, which itself calls `app.quit()` and would
 * make "does closing windows quit the app" untestable -- see
 * `../support/tray-process.ts`.
 *
 * These specs assert on PROCESS BEHAVIOUR (quit vs. survive), not on the
 * "Tray keep-alive active" / "Tray unavailable" log lines `tray.service.ts`
 * emits. Those go through `vscode-core`'s `Logger`, which routes `info`/`warn`
 * to `console` only when `logToConsole` is true -- which
 * `PtahProdDefaults`/`PtahDevDefaults` (`libs/shared/.../environment.constants.ts`)
 * gate on `NODE_ENV === 'development'`. Forcing that mode here would also flip
 * `main.ts`'s `isDev` branch, which repoints `app.getPath('userData')` at the
 * developer's real `<appData>/Ptah Dev` folder -- clobbering the isolated
 * `--user-data-dir` this harness relies on for every other spec. Asserting on
 * the actual quit/survive behaviour instead is both more robust (no log-string
 * coupling) and exactly what B5.2's acceptance criteria describe.
 *
 * Neither spec passes a workspace-root argv, so `wire-runtime.ts` never awaits
 * `bootHeavyServices` (no SQLite/migrations boot) -- keeping these on the
 * same launch/close budgets as `lifecycle.spec.ts`, not the 120s budgets
 * `real-rpc-fixtures.ts` needs for a real workspace boot.
 */

/** Hard ceiling for a clean quit -- mirrors `lifecycle.spec.ts`. */
const CLEAN_CLOSE_BUDGET_MS = 25_000;

/**
 * How long to wait, after closing all windows with keep-alive ON, before
 * concluding the process is still alive. Long enough that a slow-but-real
 * quit wouldn't be mistaken for keep-alive; short enough not to pad the run.
 * `CLEAN_CLOSE_BUDGET_MS` (25s) is the ceiling a real quit must beat, so 10s
 * of continued liveness is well past noise.
 */
const KEEP_ALIVE_HOLD_MS = 10_000;

/** Collect main-process stdout+stderr, for context in failure messages only. */
function captureOutput(app: ElectronApplication): { lines: string[] } {
  const lines: string[] = [];
  const onData = (chunk: Buffer) =>
    lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
  app.process().stdout?.on('data', onData);
  app.process().stderr?.on('data', onData);
  return { lines };
}

test.describe('Tray keep-alive — default-off quit parity (B5.2.1)', () => {
  test('no trayKeepalive key at all: closing all windows quits the app on non-darwin', async () => {
    const isolated = createIsolatedPtahHome();
    // Deliberately do NOT call seedTrayKeepalive -- no ~/.ptah/settings.json
    // at all, proving the FILE_BASED_SETTINGS_DEFAULTS fallback (false).
    let app: ElectronApplication | undefined;
    try {
      app = await launchPtah({ env: isolated.env });
      const out = captureOutput(app);
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await win.waitForTimeout(500);

      await closeAllWindows(app);
      const exited = await waitForProcessExit(app, CLEAN_CLOSE_BUDGET_MS);

      expect(
        exited,
        `app did not quit within ${CLEAN_CLOSE_BUDGET_MS}ms after closing all ` +
          `windows with no trayKeepalive key set. Last 20 lines:\n` +
          `${out.lines.slice(-20).join('\n')}`,
      ).toBe(true);
    } finally {
      if (app) await forceKillIfAlive(app);
      isolated.cleanup();
    }
  });

  test('explicit trayKeepalive: false: closing all windows quits the app on non-darwin', async () => {
    const isolated = createIsolatedPtahHome();
    seedTrayKeepalive(isolated.home, false);
    let app: ElectronApplication | undefined;
    try {
      app = await launchPtah({ env: isolated.env });
      const out = captureOutput(app);
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await win.waitForTimeout(500);

      await closeAllWindows(app);
      const exited = await waitForProcessExit(app, CLEAN_CLOSE_BUDGET_MS);

      expect(
        exited,
        `app did not quit within ${CLEAN_CLOSE_BUDGET_MS}ms after closing all ` +
          `windows with trayKeepalive explicitly false. Last 20 lines:\n` +
          `${out.lines.slice(-20).join('\n')}`,
      ).toBe(true);
    } finally {
      if (app) await forceKillIfAlive(app);
      isolated.cleanup();
    }
  });
});

test.describe('Tray keep-alive — flag-on survival + tray quit (B5.2.2)', () => {
  test('trayKeepalive: true survives window-all-closed, and the tray quit handler terminates it', async () => {
    const isolated = createIsolatedPtahHome();
    seedTrayKeepalive(isolated.home, true);
    let app: ElectronApplication | undefined;
    try {
      app = await launchPtah({ env: isolated.env });
      const out = captureOutput(app);
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      // Give the whenReady().then(...) tail (where the tray is constructed,
      // AFTER registerPostWindow) a moment to finish -- domcontentloaded fires
      // well before that tail completes.
      await win.waitForTimeout(1_500);

      await closeAllWindows(app);

      // 1. The process must NOT exit promptly -- this is the keep-alive.
      const exitedEarly = await waitForProcessExit(app, KEEP_ALIVE_HOLD_MS);
      expect(
        exitedEarly,
        `app quit within ${KEEP_ALIVE_HOLD_MS}ms of closing all windows despite ` +
          `trayKeepalive: true -- keep-alive did not hold. Last 20 lines:\n` +
          `${out.lines.slice(-20).join('\n')}`,
      ).toBe(false);

      // 2. The event loop must still be genuinely alive, not a hung zombie --
      // a trivial main-process call must still resolve.
      const version = await app.evaluate(({ app: electronApp }) =>
        electronApp.getVersion(),
      );
      expect(typeof version).toBe('string');

      // 3. The mechanism the tray's "Quit Ptah" item is wired to
      // (`app.quit()` -- see ../support/tray-process.ts header) must still
      // cleanly terminate the process.
      await simulateTrayQuit(app);
      const exited = await waitForProcessExit(app, CLEAN_CLOSE_BUDGET_MS);
      expect(
        exited,
        `app did not quit within ${CLEAN_CLOSE_BUDGET_MS}ms of the tray-quit ` +
          `handler being invoked. Last 20 lines:\n${out.lines.slice(-20).join('\n')}`,
      ).toBe(true);
    } finally {
      if (app) await forceKillIfAlive(app);
      isolated.cleanup();
    }
  });
});

// Fails fast with an actionable message instead of a confusing timeout if the
// dist icon B5.2.2 depends on to actually construct a live tray is missing --
// see tray-icon-packaging.spec.ts for the dedicated packaging assertion.
test.beforeAll(() => {
  const iconPath = path.join(
    path.dirname(resolveElectronEntry()),
    'assets',
    'icons',
    'png',
    '32x32.png',
  );
  if (!fs.existsSync(iconPath)) {
    throw new Error(
      `[tray-keepalive.spec] Expected tray icon not found at:\n  ${iconPath}\n\n` +
        `Run \`npx nx build-dev ptah-electron\` (this file's icon comes from ` +
        `apps/ptah-electron/src/assets via the build-main assets glob).`,
    );
  }
});
