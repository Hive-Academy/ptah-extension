import * as fs from 'fs';
import * as path from 'path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from '../../support/real-rpc-fixtures';
import { THREE_HUNK_FILE } from '../../support/git-scratch-repo';
import { setTheme, type AxeTheme } from '../../support/axe';
import {
  contrastRatio,
  decodePng,
  formatRgba,
  pixelAt,
  type DecodedPng,
  type Rgba,
} from '../../support/png-pixels';
import type { UiDriver } from '../../support/ui-driver';

/**
 * Hunk markers, seen for the first time — TASK_2026_222, retargeted to the
 * review canvas by TASK_2026_576 Batch 59.
 *
 * ── WHAT NO LONGER EXISTS, BY DESIGN ───────────────────────────────────────
 * The Monaco glyph margin (`.ptah-hunk-glyph`, the `ptah-hunk-glyph-selected`
 * state, the `hc-black` theme case) is gone with Monaco: the review canvas
 * renders diffs with Pierre (`@pierre/diffs`, shadow DOM), where each hunk is
 * marked by an Angular-owned row (`ptah-hunk-toolbar`) slotted at the hunk,
 * and there is no selection state to paint. This file therefore keeps the
 * successor of the original question, which was never about Monaco: "NOBODY
 * HAD EVER LOOKED" at what marks a hunk in a real window, in each theme the
 * app really ships, asserted on PIXELS rather than on class names jsdom can
 * not lay out.
 *
 * ── THE THREE CHECKS, PER THEME (dark, light) ──────────────────────────────
 *  1. GEOMETRY  : every hunk has a row with a non-zero painted box, in hunk
 *                 order, inside the section's diff body.
 *  2. CONTRAST  : the Accept and Reject buttons (the hunk's visible actions)
 *                 read at WCAG 1.4.3's 4.5:1 for their label text against
 *                 their own fill, measured from a screenshot of the button.
 *  3. THEME     : the theme really applied. Pierre reads the document theme
 *                 mode when a diff mounts, so each theme is measured on a
 *                 FRESH mount (the Git rail is closed and reopened), and the
 *                 diff body's own background must differ between the themes.
 *
 * Runs on the real-RPC fixtures, not the mocked driver: hunk rows are placed
 * from git's own `@@` offsets, so a hand-written diff fixture would be
 * measuring the fixture's arithmetic rather than git's.
 */

/** Where the human-reviewable artifacts land. Stable across runs, by design. */
const SCREENSHOT_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'dist',
  'apps',
  'ptah-electron-e2e',
  'glyph-margin',
);

/** WCAG 2.2 SC 1.4.3 — normal-size text. */
const MIN_TEXT_CONTRAST = 4.5;

const THEMES: readonly AxeTheme[] = ['dark', 'light'];

interface ButtonReading {
  readonly fill: Rgba;
  readonly text: Rgba;
  readonly contrast: number;
}

/**
 * Reduce a screenshot of one button to the two colours that matter: its fill
 * (the most frequent pixel) and its label (the pixel furthest in contrast from
 * the fill). Anti-aliasing blends toward the fill, so the furthest pixel is a
 * lower bound on the label's contrast, which is the safe direction.
 */
function readButton(png: DecodedPng): ButtonReading {
  const counts = new Map<number, number>();
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const [r, g, b] = pixelAt(png, x, y);
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let fillKey = 0;
  let fillCount = -1;
  for (const [key, count] of counts) {
    if (count > fillCount) {
      fillKey = key;
      fillCount = count;
    }
  }
  const fill: Rgba = [
    (fillKey >> 16) & 255,
    (fillKey >> 8) & 255,
    fillKey & 255,
    255,
  ];
  let text: Rgba = fill;
  let best = 1;
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const pixel = pixelAt(png, x, y);
      const ratio = contrastRatio(pixel, fill);
      if (ratio > best) {
        best = ratio;
        text = pixel;
      }
    }
  }
  return { fill, text, contrast: best };
}

async function readButtonLocator(button: Locator): Promise<ButtonReading> {
  return readButton(decodePng(await button.screenshot({ scale: 'css' })));
}

async function saveArtifact(
  testInfo: TestInfo,
  name: string,
  buffer: Buffer,
): Promise<string> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const file = path.join(SCREENSHOT_DIR, name);
  fs.writeFileSync(file, buffer);
  await testInfo.attach(name, { body: buffer, contentType: 'image/png' });
  return file;
}

/** The Git rail toggle in the Electron shell. */
function gitRailToggle(page: Page): Locator {
  return page.getByRole('button', { name: 'Toggle Git panel' }).first();
}

/** Open the dock on a fresh review canvas and wait for the three hunk rows. */
async function openCanvas(ui: UiDriver): Promise<Locator> {
  await ui.goto('git');
  const section = ui.reviewFileSection(THREE_HUNK_FILE);
  await expect(section.locator('[data-testid="pierre-hunk-host"]')).toHaveCount(
    3,
    { timeout: 30_000 },
  );
  return section;
}

/**
 * The diff body's own background, read from the section: the surface the hunk
 * rows sit on, and the one thing that must change when the theme does.
 */
async function bodyBackground(section: Locator): Promise<Rgba> {
  const body = section.locator('[data-testid="file-diff-body"]');
  await body.scrollIntoViewIfNeeded();
  const shot = decodePng(await body.screenshot({ scale: 'css' }));
  return readButton(shot).fill;
}

test.describe('hunk rows, seen in two themes (TASK_2026_222 / 576 Batch 59)', () => {
  // A real boot into an empty home runs every SQLite migration from zero before
  // the window is created, which does not fit the config-wide 60s budget.
  test.setTimeout(300_000);

  test('paints a legible row per hunk in dark and light', async ({
    ui,
    repo,
  }, testInfo) => {
    const page = ui.page;

    // Preconditions read from real git, so a failure below is the UI's and not
    // the fixture's.
    expect(repo.stagedDiff()).toBe('');
    expect(repo.worktreeDiff().match(/^@@ /gm)?.length).toBe(3);

    const report: string[] = [];
    const backgrounds = new Map<AxeTheme, Rgba>();

    for (const [round, theme] of THEMES.entries()) {
      await setTheme(page, theme);

      // A fresh mount per theme: close the rail from the second round on.
      if (round > 0) {
        await gitRailToggle(page).click();
        await expect(ui.reviewShell()).toHaveCount(0);
      }
      const section = await openCanvas(ui);

      // The attributes the diff host reads on mount really are this theme's.
      expect(
        await page.evaluate(() =>
          document.documentElement.getAttribute('data-theme-mode'),
        ),
      ).toBe(theme);

      // 1. GEOMETRY — one painted row per hunk, in hunk order, in the diff body.
      let previousTop = Number.NEGATIVE_INFINITY;
      for (const index of [0, 1, 2]) {
        const row = ui.hunkHost(index, section);
        await row.scrollIntoViewIfNeeded();
        const box = await row.boundingBox();
        expect(
          box,
          `[${theme}] hunk ${index + 1} has no painted row`,
        ).not.toBeNull();
        expect(
          box?.width ?? 0,
          `[${theme}] hunk ${index + 1}'s row has zero width`,
        ).toBeGreaterThan(0);
        expect(
          box?.height ?? 0,
          `[${theme}] hunk ${index + 1}'s row has zero height`,
        ).toBeGreaterThan(0);
        // Body-relative top: unchanged by scrolling, so it orders the rows.
        const documentTop = await row.evaluate((el) => {
          const body = el.closest('[data-testid="file-diff-body"]');
          return (
            el.getBoundingClientRect().top -
            (body?.getBoundingClientRect().top ?? 0)
          );
        });
        expect(
          documentTop,
          `[${theme}] hunk ${index + 1} is not below hunk ${index}`,
        ).toBeGreaterThan(previousTop);
        previousTop = documentTop;
      }

      // 2. CONTRAST — the visible actions of the first hunk read legibly.
      await ui.hunkHost(0, section).scrollIntoViewIfNeeded();
      for (const action of ['stage', 'revert'] as const) {
        const button = ui.hunkAction(0, action, section);
        await expect(button).toBeVisible();
        const reading = await readButtonLocator(button);
        report.push(
          `[${theme}] ${action}: text=${formatRgba(reading.text)} fill=${formatRgba(
            reading.fill,
          )} contrast=${reading.contrast.toFixed(2)}:1`,
        );
        expect(
          reading.contrast,
          `[${theme}] the ${action} button label is not legible: ` +
            `${formatRgba(reading.text)} on ${formatRgba(reading.fill)} = ` +
            `${reading.contrast.toFixed(2)}:1, below WCAG 1.4.3's ${MIN_TEXT_CONTRAST}:1`,
        ).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      }

      const file = await saveArtifact(
        testInfo,
        `hunk-rows-${theme}.png`,
        await page.screenshot({ scale: 'css' }),
      );
      report.push(`[${theme}] screenshot: ${file}`);

      backgrounds.set(theme, await bodyBackground(section));
    }

    // 3. THEME — the diff surface really repainted between the two mounts.
    const dark = backgrounds.get('dark') as Rgba;
    const light = backgrounds.get('light') as Rgba;
    expect(
      contrastRatio(dark, light),
      `the diff body paints the same in both themes (${formatRgba(dark)} vs ` +
        `${formatRgba(light)}), so one of the two measurements did not see its theme`,
    ).toBeGreaterThan(3);

    // Printed, not merely asserted: the point of this task is that a human can
    // read what the machine saw.
    console.log(
      `\n=== TASK_2026_222 hunk-row evidence ===\n${report.join('\n')}\n`,
    );
  });
});
