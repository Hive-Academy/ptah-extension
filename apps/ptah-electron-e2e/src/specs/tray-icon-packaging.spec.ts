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
  waitForProcessExit,
} from '../support/tray-process';

/**
 * Packaged-build tray icon resolution (TASK_2026_180 B5.2.3, added by the
 * orchestrator).
 *
 * `PtahTrayService.create()` builds a real `Tray` from `options.iconPath`
 * (`apps/ptah-electron/src/services/tray/tray.service.ts:181`), and
 * `main.ts:181` resolves that path as
 * `path.join(__dirname, 'assets', 'icons', 'png', '32x32.png')` -- i.e.
 * relative to wherever `main.mjs` itself ends up on disk, which for a real
 * packaged build is inside the asar/resources tree electron-builder produces.
 *
 * `create()` degrades to "no keep-alive" on ANY construction failure,
 * including a missing icon file -- silently, by design (R10 fail-safe: never
 * risk a tray that suppresses quit without one, see the file header). That
 * silence is exactly the risk: a packaging regression that stops shipping the
 * icon (e.g. a change to the `assets` glob in
 * `apps/ptah-electron/project.json`) turns the whole keep-alive feature off
 * with NO error surfaced anywhere the user or CI would normally look --
 * `trayKeepalive: true` in settings, but the tray silently never appears.
 *
 * This file does not run `nx package` (electron-builder) -- that pulls in
 * native rebuilds and code-signing inputs far outside this batch's scope.
 * Instead it uses the dev-configured dist tree the rest of this e2e suite
 * already launches from (`dist/apps/ptah-electron/main.mjs`), which has the
 * SAME relative layout electron-builder ships (main.mjs alongside
 * assets/icons/png/32x32.png) -- `__dirname`-relative resolution behaves
 * identically whether that directory sits at the repo root or inside
 * `resources/app`. What this suite does NOT prove is anything specific to
 * asar packing (e.g. whether a path lookup behaves differently once the tree
 * is packed into an archive) -- only the plain relative-path resolution
 * `main.ts` performs.
 */

function resolveTrayIconPath(): string {
  return path.join(
    path.dirname(resolveElectronEntry()),
    'assets',
    'icons',
    'png',
    '32x32.png',
  );
}

const CLEAN_CLOSE_BUDGET_MS = 25_000;

/**
 * Collect main-process stdout+stderr, for context in failure messages only.
 *
 * Not used to assert the "Tray unavailable" / "Tray keep-alive active" log
 * lines: those route through `vscode-core`'s `Logger`, which only echoes to
 * `console` when `NODE_ENV === 'development'` -- and that mode repoints
 * `app.getPath('userData')` at the developer's real `Ptah Dev` folder in
 * `main.ts`'s `isDev` branch, defeating this harness's `--user-data-dir`
 * isolation. See `tray-keepalive.spec.ts`'s header for the full rationale.
 * The behavioural assertion (quit vs. survive) below is the load-bearing one.
 */
function captureOutput(app: ElectronApplication): { lines: string[] } {
  const lines: string[] = [];
  const onData = (chunk: Buffer) =>
    lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
  app.process().stdout?.on('data', onData);
  app.process().stderr?.on('data', onData);
  return { lines };
}

test.describe('Tray icon — packaged-build resolution (B5.2.3)', () => {
  test('the dist tree ships the icon at the exact path main.ts resolves', () => {
    const iconPath = resolveTrayIconPath();
    expect(
      fs.existsSync(iconPath),
      `main.ts resolves the tray icon to:\n  ${iconPath}\n` +
        `but that file does not exist in the built dist tree. This is the ` +
        `packaging regression class this spec guards: the assets glob in ` +
        `apps/ptah-electron/project.json (build-main -> assets: ` +
        `apps/ptah-electron/src/assets -> "assets") stopped shipping ` +
        `assets/icons/png/32x32.png.`,
    ).toBe(true);
  });

  test('a missing icon degrades to quit-on-close even with trayKeepalive: true (R10 fail-safe)', async () => {
    const iconPath = resolveTrayIconPath();
    if (!fs.existsSync(iconPath)) {
      throw new Error(
        `[tray-icon-packaging.spec] Precondition failed: ${iconPath} does not ` +
          `exist before this test even starts mutating it. Run ` +
          `\`npx nx build-dev ptah-electron\` first.`,
      );
    }
    const backup = fs.readFileSync(iconPath);
    fs.rmSync(iconPath);

    const isolated = createIsolatedPtahHome();
    seedTrayKeepalive(isolated.home, true);
    let app: ElectronApplication | undefined;
    try {
      app = await launchPtah({ env: isolated.env });
      const out = captureOutput(app);
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await win.waitForTimeout(1_500);

      await closeAllWindows(app);
      const exited = await waitForProcessExit(app, CLEAN_CLOSE_BUDGET_MS);
      expect(
        exited,
        `app did not quit within ${CLEAN_CLOSE_BUDGET_MS}ms after closing all ` +
          `windows with trayKeepalive: true but a missing icon -- the R10 ` +
          `fail-safe (degrade to "no keep-alive") did not hold. Last 20 lines:\n` +
          `${out.lines.slice(-20).join('\n')}`,
      ).toBe(true);
    } finally {
      if (app) await forceKillIfAlive(app);
      isolated.cleanup();
      // Restore the real icon regardless of pass/fail, so no other spec in
      // this suite (or a developer's next run) sees it missing.
      fs.writeFileSync(iconPath, backup);
    }
  });
});
