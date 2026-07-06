import {
  test as base,
  chromium,
  type Browser,
  type BrowserContext,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { Director } from './director';

/**
 * Playwright fixtures for BROWSER-based marketing showcase scenes.
 *
 * This is the web sibling of `showcase-fixtures.ts`. Where that file boots the
 * real Electron app to film the desktop product, these fixtures launch a fresh
 * headless Chromium context and film a public web page (e.g. the live landing
 * page at https://ptah.live). Everything downstream is IDENTICAL to the Electron
 * flow so the exact same pipeline (`narrate.mjs` → capture → `render-all.mjs`)
 * consumes the output with zero changes:
 *
 * - Records video into `dist/apps/ptah-electron-e2e/recordings/<scene>/`, then
 *   renames Playwright's randomly-named `.webm` → `raw.webm` on close.
 * - Wires the SAME `Director` (script + real narration clip durations from a
 *   pre-capture `narrate` run) for audio-first pacing, and flushes `beats.json`
 *   + `shots.json` in the director teardown while the page is still alive.
 *
 * Why a browser context can drive the Electron-typed `Director`: the Director
 * only ever touches its `page` — its `app: ElectronApplication` constructor
 * param is stored but never referenced (no `this.app` anywhere in director.ts).
 * We therefore pass a typed placeholder for `app` and hand it the real browser
 * `Page`, leaving `director.ts` completely untouched.
 *
 * Capture resolution: a browser context can set the CSS viewport AND the
 * recorded video size to the same value at deviceScaleFactor 1, so the frame is
 * a clean 1:1 capture with no scaled-display letterbox and no gray padding band
 * (the page background is near-black, so `render-all`'s band-crop never trips).
 * Default 2560x1440 — sharp desktop capture; `render-all --out-res 1080p`
 * supersamples it down so headlines stay crisp and the virtual camera can punch
 * into the centered content without softening. Override with PTAH_SHOWCASE_RES.
 */

export interface BrowserShowcaseFixtures {
  page: Page;
  director: Director;
}

/** Root all per-scene recording subdirectories live under (same as Electron). */
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

/** Repo-tracked narration scripts (`{ scene, lines }`), one per scene. */
const SCRIPTS_DIR = path.resolve(__dirname, '..', 'scripts');

/** 16:9 capture presets, mirroring the Electron launcher's RES_TABLE. */
const RES_TABLE: Record<string, { width: number; height: number }> = {
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 },
};

/**
 * Capture resolution for browser scenes. Defaults to 1440p (2560x1440) — the
 * landing page reads as a premium full-bleed dark canvas that far wide, and the
 * extra pixels keep camera punch-ins crisp after the 1080p supersample. Override
 * via PTAH_SHOWCASE_RES (1080p | 1440p | 4k).
 */
const CAPTURE =
  RES_TABLE[process.env['PTAH_SHOWCASE_RES'] ?? '1440p'] ?? RES_TABLE['1440p'];

/** Derive the scene slug from the test file basename (strip `.scene.ts`). */
function sceneSlug(testInfo: TestInfo): string {
  return path.basename(testInfo.file).replace(/\.scene\.ts$/, '');
}

/** Ordered VO lines for a scene, or [] when it has no script. */
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
    console.warn(`[showcase-web] unreadable script for ${slug}: ${message}`);
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
    console.warn(`[showcase-web] unreadable durations.json: ${message}`);
    return [];
  }
}

/** Rename the single produced `*.webm` in a scene dir → `raw.webm`. */
function renameRawWebm(sceneDir: string): void {
  try {
    const webms = fs
      .readdirSync(sceneDir)
      .filter((f) => f.toLowerCase().endsWith('.webm') && f !== 'raw.webm');
    if (webms.length === 0) return;
    const newest = webms
      .map((f) => ({ f, mtime: fs.statSync(path.join(sceneDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0].f;
    fs.renameSync(path.join(sceneDir, newest), path.join(sceneDir, 'raw.webm'));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[showcase-web] raw.webm rename skipped: ${message}`);
  }
}

export const test = base.extend<BrowserShowcaseFixtures>({
  // Own the browser lifecycle here (not Playwright's built-in `browser`/`context`
  // fixtures) so the recorded video size and viewport are locked to CAPTURE and
  // the raw.webm rename happens deterministically on close.
  // eslint-disable-next-line no-empty-pattern
  page: async ({}, use, testInfo) => {
    const slug = sceneSlug(testInfo);
    const sceneDir = path.join(RECORDINGS_ROOT, slug);
    fs.mkdirSync(sceneDir, { recursive: true });

    const browser: Browser = await chromium.launch();
    const context: BrowserContext = await browser.newContext({
      viewport: { width: CAPTURE.width, height: CAPTURE.height },
      deviceScaleFactor: 1,
      // Keep the site's entrance/scroll animations on camera.
      reducedMotion: 'no-preference',
      recordVideo: {
        dir: sceneDir,
        size: { width: CAPTURE.width, height: CAPTURE.height },
      },
    });
    const page = await context.newPage();

    try {
      await use(page);
    } finally {
      // Closing the context finalizes and flushes the .webm to disk.
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
      renameRawWebm(sceneDir);
    }
  },

  director: async ({ page }, use, testInfo) => {
    const slug = sceneSlug(testInfo);
    const sceneDir = path.join(RECORDINGS_ROOT, slug);
    // Audio-first pacing: the scene's script + the real clip lengths from the
    // pre-capture narrate run drive `say()`'s holds.
    const script = loadScript(slug);
    const clipDurationsMs = loadClipDurations(sceneDir, script.length);
    if (script.length > 0 && clipDurationsMs.every((d) => d === null)) {
      console.warn(
        `[showcase-web] ${slug}: no narration durations found — run ` +
          `narrate.mjs BEFORE capture for audio-locked pacing ` +
          `(falling back to estimated holds).`,
      );
    }
    // The Director never dereferences its `app` param (no `this.app` in
    // director.ts) — it drives everything through `page`. Pass a typed
    // placeholder so director.ts stays untouched.
    const director = new Director(
      null as unknown as ElectronApplication,
      page,
      {
        scene: slug,
        title: testInfo.title,
        res: { width: CAPTURE.width, height: CAPTURE.height },
        script,
        clipDurationsMs,
      },
    );
    // Overlays are (re)installed by the scene AFTER its first navigation — a
    // full page load wipes them. This pre-install keeps parity with the Electron
    // fixture and is harmless on the initial about:blank document.
    await director.installOverlays().catch(() => undefined);
    try {
      await use(director);
    } finally {
      // Runs BEFORE the `page` fixture's teardown (reverse order), so the page
      // is still alive when we flush the manifest + camera track.
      await director
        .flushBeats(path.join(sceneDir, 'beats.json'))
        .catch(() => undefined);
      await director
        .flushShots(path.join(sceneDir, 'shots.json'))
        .catch(() => undefined);
    }
  },
});

export const expect = base.expect;
