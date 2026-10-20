import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '@playwright/test';
import { resolveElectronEntry } from '../support/electron-launcher';

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
 * A missing icon prevents the tray from appearing. This spec guards the
 * relative path resolved by `main.ts` against packaging regressions.
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
});
