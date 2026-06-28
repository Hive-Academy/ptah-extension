import {
  test as base,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import * as path from 'path';
import { launchShowcase } from './showcase-launcher';
import { Director } from './director';

/**
 * Playwright fixtures for marketing showcase scenes.
 *
 * Unlike `src/support/fixtures.ts` (which mocks every RPC call for
 * deterministic e2e assertions), these fixtures boot the REAL authenticated
 * app and install NO mocks — agents and LLM inference run for real so they can
 * be filmed. The `director` fixture provides cinematic helpers.
 *
 * The recorded `.webm` lands under `dist/apps/ptah-electron-e2e/recordings/`;
 * `scripts/transcode.mjs` converts it to a marketing-ready `.mp4`.
 */

export interface ShowcaseFixtures {
  app: ElectronApplication;
  page: Page;
  director: Director;
}

const VIDEO_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'dist',
  'apps',
  'ptah-electron-e2e',
  'recordings',
);

export const test = base.extend<ShowcaseFixtures>({
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use) => {
    const { app } = await launchShowcase({ videoDir: VIDEO_DIR });
    try {
      await use(app);
    } finally {
      // Closing flushes the Playwright video file to disk.
      await app.close().catch(() => undefined);
    }
  },

  page: async ({ app }, use) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await use(win);
  },

  director: async ({ app, page }, use) => {
    const director = new Director(app, page);
    await director.installOverlays();
    await use(director);
  },
});

export const expect = base.expect;
