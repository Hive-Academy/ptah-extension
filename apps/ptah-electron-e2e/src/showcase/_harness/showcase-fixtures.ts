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

/** Repo-tracked narration scripts (`{ scene, lines }`), one per scene. */
const SCRIPTS_DIR = path.resolve(__dirname, '..', 'scripts');

/** Ordered VO lines for a scene, or [] when it has no script (legacy flow). */
function loadScript(slug: string): string[] {
  const p = path.join(SCRIPTS_DIR, `${slug}.json`);
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as {
      lines?: unknown[];
    };
    return (parsed.lines ?? []).map((l) => String(l));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[showcase] unreadable script for ${slug}: ${message}`);
    return [];
  }
}

/**
 * Real narration clip lengths from a pre-capture `narrate.mjs` run, indexed by
 * script line. Missing/partial durations degrade to nulls — the Director falls
 * back to its estimate for those lines.
 */
function loadClipDurations(
  sceneDir: string,
  lineCount: number,
): (number | null)[] {
  const p = path.join(sceneDir, 'durations.json');
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as {
      clips?: { index?: number; durationMs?: number }[];
    };
    const out: (number | null)[] = new Array(lineCount).fill(null);
    for (const clip of parsed.clips ?? []) {
      const i = (clip.index ?? 0) - 1; // clips are 1-based
      if (i >= 0 && i < lineCount && typeof clip.durationMs === 'number') {
        out[i] = clip.durationMs;
      }
    }
    return out;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[showcase] unreadable durations.json: ${message}`);
    return [];
  }
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
    // Audio-first pacing: the scene's script + the real clip lengths from the
    // pre-capture narrate run drive `say()`'s holds.
    const script = loadScript(slug);
    const clipDurationsMs = loadClipDurations(sceneDir, script.length);
    if (script.length > 0 && clipDurationsMs.every((d) => d === null)) {
      console.warn(
        `[showcase] ${slug}: no narration durations found — run ` +
          `narrate.mjs BEFORE capture for audio-locked pacing ` +
          `(falling back to estimated holds).`,
      );
    }
    const director = new Director(app, page, {
      scene: slug,
      title: testInfo.title,
      res,
      script,
      clipDurationsMs,
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
      // Also flush the auto-emitted virtual-camera track. `flushShots` is a
      // no-op when no targeted interaction was recorded, so hand-authored
      // shots.json for reverse-engineered scenes is never clobbered.
      await director
        .flushShots(path.join(sceneDir, 'shots.json'))
        .catch(() => undefined);
    }
  },
});

export const expect = base.expect;
