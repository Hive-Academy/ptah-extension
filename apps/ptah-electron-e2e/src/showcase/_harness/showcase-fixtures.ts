import {
  test as base,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { launchShowcase, type ShowcaseRes } from './showcase-launcher';
import { Director } from './director';

/**
 * Playwright fixtures for marketing showcase scenes.
 *
 * Unlike `src/support/fixtures.ts` (which mocks every RPC call for
 * deterministic e2e assertions), these fixtures boot the REAL authenticated
 * app and install NO mocks — agents and LLM inference run for real so they can
 * be filmed. The `director` fixture provides cinematic helpers.
 *
 * Each scene gets its own subdirectory under the recordings root, e.g.
 * `dist/apps/ptah-electron-e2e/recordings/editor-tour/`, holding `raw.webm`
 * (Playwright's randomly-named `.webm`, renamed deterministically after close)
 * and `beats.json` (the Director manifest). `scripts/transcode.mjs` /
 * the Remotion video-studio pipeline consume these.
 */

export interface ShowcaseFixtures {
  app: ElectronApplication;
  page: Page;
  director: Director;
}

/** Root all per-scene recording subdirectories live under. */
const RECORDINGS_ROOT = path.resolve(
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

/** Derive the scene slug from the test file basename (strip `.scene.ts`). */
function sceneSlug(testInfo: TestInfo): string {
  return path.basename(testInfo.file).replace(/\.scene\.ts$/, '');
}

export const test = base.extend<ShowcaseFixtures>({
  // eslint-disable-next-line no-empty-pattern
  app: async ({}, use, testInfo) => {
    const slug = sceneSlug(testInfo);
    const sceneDir = path.join(RECORDINGS_ROOT, slug);
    const { app, res } = await launchShowcase({ videoDir: sceneDir });
    // Stash the capture resolution on the app instance so the `director`
    // fixture can read it without re-launching (single worker → safe).
    (app as unknown as { __showcaseRes: ShowcaseRes }).__showcaseRes = res;
    try {
      await use(app);
    } finally {
      // Closing flushes the Playwright video file to disk.
      await app.close().catch(() => undefined);
      // Rename the single produced `*.webm` in this scene dir → `raw.webm`.
      // workers:1 + one scene per dir makes the newest `.webm` deterministic.
      try {
        const webms = fs
          .readdirSync(sceneDir)
          .filter((f) => f.toLowerCase().endsWith('.webm') && f !== 'raw.webm');
        if (webms.length > 0) {
          const newest = webms
            .map((f) => ({
              f,
              mtime: fs.statSync(path.join(sceneDir, f)).mtimeMs,
            }))
            .sort((a, b) => b.mtime - a.mtime)[0].f;
          fs.renameSync(
            path.join(sceneDir, newest),
            path.join(sceneDir, 'raw.webm'),
          );
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[showcase] raw.webm rename skipped: ${message}`);
      }
    }
  },

  page: async ({ app }, use) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await use(win);
  },

  director: async ({ app, page }, use, testInfo) => {
    const slug = sceneSlug(testInfo);
    const sceneDir = path.join(RECORDINGS_ROOT, slug);
    const res = (app as unknown as { __showcaseRes: ShowcaseRes })
      .__showcaseRes;
    const director = new Director(app, page, {
      scene: slug,
      title: testInfo.title,
      res,
    });
    await director.installOverlays();
    try {
      await use(director);
    } finally {
      // Runs BEFORE the `app` fixture's close (reverse teardown order), so the
      // page is still alive when we flush the manifest.
      await director
        .flushBeats(path.join(sceneDir, 'beats.json'))
        .catch(() => undefined);
    }
  },
});

export const expect = base.expect;
