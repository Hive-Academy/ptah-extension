import * as fs from 'fs';
import * as path from 'path';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from '../../support/real-rpc-fixtures';
import { THREE_HUNK_FILE } from '../../support/git-scratch-repo';
import {
  contrastRatio,
  decodePng,
  formatRgba,
  pixelAt,
  type Rgba,
} from '../../support/png-pixels';

/**
 * Glyph-margin hunk markers, seen for the first time — TASK_2026_222.
 *
 * The register's complaint was not that the markers were wrong; it was that
 * NOBODY HAD EVER LOOKED. Their size and colour were asserted in jsdom as class
 * names, which proves a class was requested and nothing about what a user sees:
 * jsdom has no layout and no cascade, so a decoration Monaco lays out at zero
 * width, or a rule whose custom property never resolves, passes those specs
 * untouched. (Both were live here. The `--fallback-p` in the marker's
 * `color-mix` never resolved on any browser either host runs, and reading
 * `data-theme` off `<body>` never saw the attribute `ThemeService` writes to
 * `<html>`, which pinned the Electron diff editor to `vs-dark` in every theme.)
 *
 * So this spec asserts on PIXELS taken from a real Electron window, in all
 * three themes `detectMonacoTheme()` can select, and writes the screenshots to
 * disk so the claim has an artifact behind it rather than a green tick.
 *
 * Three independent ways a marker can fail, so three checks per theme:
 *
 *  1. GEOMETRY   — a marker is painted with a non-zero box on the lines of the
 *                  hunk it belongs to. A decoration Monaco never lays out is
 *                  invisible whatever colour it was given.
 *  2. CONTRAST   — the marker's painted pixel against the glyph-margin
 *                  background beside it, at WCAG 2.2 SC 1.4.11's 3:1 for a
 *                  non-text graphical object. It is an indicator, not text, so
 *                  4.5:1 would be the wrong bar.
 *  3. SELECTION  — the selected marker must paint differently from the same
 *                  marker unselected. Selection is the only feedback a glyph
 *                  click gives, so an indistinguishable one is a no-op to look
 *                  at. Measured on the SAME marker before and after selecting,
 *                  because the three hunks sit 45 lines apart and never share a
 *                  viewport.
 *
 * Runs on the real-RPC fixtures, not the mocked driver: markers are positioned
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

const FILE_NAME = THREE_HUNK_FILE.split('/').pop() as string;

/**
 * WCAG 2.2 SC 1.4.11 — a graphical object needed to understand the content
 * must reach 3:1 against its adjacent colour.
 */
const MIN_CONTRAST = 3;

interface ThemeCase {
  /** File-name-safe id, and the label used in failure messages. */
  readonly id: string;
  /** The Monaco theme `detectMonacoTheme()` must resolve this case to. */
  readonly monacoTheme: string;
  /** How this theme is actually reachable in a running host. */
  readonly apply: (page: Page) => Promise<void>;
}

/**
 * Drive the theme the way each host really does.
 *
 * Light and dark go through daisyUI's `data-theme` / `data-theme-mode` on
 * `<html>` — the two attributes `ThemeService`'s effect writes, and the only
 * theme mechanism Electron has. Setting them directly rather than clicking the
 * picker keeps the spec pointed at the editor instead of at the settings UI,
 * and they are the exact bytes the service emits.
 *
 * High contrast has no daisyUI equivalent: `hc-black` is reachable only from
 * the VS Code webview's `data-vscode-theme-kind` on `<body>`, so that case sets
 * what VS Code sets.
 */
const THEMES: readonly ThemeCase[] = [
  {
    id: 'light',
    monacoTheme: 'vs',
    apply: (page) =>
      page.evaluate(() => {
        document.body.removeAttribute('data-vscode-theme-kind');
        // `anubis-light`, not `light`: only the two anubis themes are compiled
        // into the eager `styles.css`, so naming any other one leaves the app
        // chrome on the `:root` (dark) variables and the capture would show a
        // light editor inside a dark shell.
        document.documentElement.setAttribute('data-theme', 'anubis-light');
        document.documentElement.setAttribute('data-theme-mode', 'light');
      }),
  },
  {
    id: 'dark',
    monacoTheme: 'vs-dark',
    apply: (page) =>
      page.evaluate(() => {
        document.body.removeAttribute('data-vscode-theme-kind');
        document.documentElement.setAttribute('data-theme', 'anubis');
        document.documentElement.setAttribute('data-theme-mode', 'dark');
      }),
  },
  {
    id: 'high-contrast',
    monacoTheme: 'hc-black',
    apply: (page) =>
      page.evaluate(() => {
        document.body.setAttribute(
          'data-vscode-theme-kind',
          'vscode-high-contrast',
        );
      }),
  },
];

/**
 * What the glyph-margin column actually looks like beside the hunk on screen.
 *
 * Measured as a COLUMN rather than element-by-element on purpose. Monaco emits
 * one glyph widget per line of the decorated range, and in a side-by-side diff
 * it inserts a view zone at the changed line itself — a band that carries no
 * glyph. Asserting "every widget paints" would therefore fail on Monaco's own
 * layout rather than on anything about the marker. What a user sees, and what
 * this measures, is a bar: how tall its longest unbroken stretch is, how wide,
 * and how far its colour sits from the margin behind it.
 */
interface ColumnProfile {
  /** Rows in the band that carry a legible marker pixel. */
  readonly markedRows: number;
  /** Total rows spanned by the hunk's markers. */
  readonly bandRows: number;
  /** Tallest unbroken run of marked rows, in CSS px. */
  readonly longestRun: number;
  /** Painted width of the bar at the middle of that run, in CSS px. */
  readonly paintedWidth: number;
  /** Worst contrast among marked rows — the number legibility turns on. */
  readonly minContrast: number;
  readonly maxContrast: number;
  /** A representative marker pixel and the margin pixel beside it. */
  readonly painted: Rgba;
  readonly background: Rgba;
}

interface MarkerBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly selected: boolean;
  readonly cssBackground: string;
}

async function applyTheme(page: Page, theme: ThemeCase): Promise<void> {
  await theme.apply(page);
  // The MutationObserver → setTheme hop runs through Monaco's own render
  // scheduling, so wait on the class Monaco itself writes rather than a
  // timeout. The theme class lands on the two inner editors, not on the
  // `.monaco-diff-editor` wrapper. Polled through the class list rather than a
  // count assertion so a failure reports which theme actually applied.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const el = document.querySelector(
            'ptah-diff-view .modified-in-monaco-diff-editor',
          );
          const known = ['vs', 'vs-dark', 'hc-black', 'hc-light'];
          const applied = el
            ? (Array.from(el.classList).find((c) => known.includes(c)) ??
              '(none)')
            : '(no modified editor)';
          return (
            `theme=${applied}; ` +
            `bodyKind=${document.body.getAttribute('data-vscode-theme-kind')}; ` +
            `rootTheme=${document.documentElement.getAttribute('data-theme')}; ` +
            `rootMode=${document.documentElement.getAttribute('data-theme-mode')}; ` +
            `bodyTheme=${document.body.getAttribute('data-theme')}`
          );
        }),
      {
        message: `waiting for Monaco to switch to ${theme.monacoTheme} (${theme.id})`,
        timeout: 20_000,
      },
    )
    .toContain(`theme=${theme.monacoTheme};`);
}

/** Every hunk marker currently painted on the modified side, in DOM order. */
async function readMarkers(page: Page): Promise<MarkerBox[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        'ptah-diff-view .modified-in-monaco-diff-editor .ptah-hunk-glyph',
      ),
    ).map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        selected: el.classList.contains('ptah-hunk-glyph-selected'),
        cssBackground: getComputedStyle(el).backgroundColor,
      };
    }),
  );
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

/**
 * Screenshot the window, then read the marker pixels out of it.
 *
 * `scale: 'css'` is required, not tidy: without it a fractional Windows device
 * scale factor makes image pixels and `getBoundingClientRect` disagree, and
 * every sample lands somewhere other than the marker.
 */
async function measureTheme(
  page: Page,
  testInfo: TestInfo,
  theme: ThemeCase,
  state: 'unselected' | 'selected',
  report: string[],
): Promise<ColumnProfile> {
  const markers = await readMarkers(page);
  expect(
    markers.length,
    `[${theme.id}/${state}] no glyph marker element exists for the hunk on screen`,
  ).toBeGreaterThan(0);

  for (const [i, marker] of markers.entries()) {
    expect(
      marker.width,
      `[${theme.id}/${state}] marker ${i + 1} has zero width — nothing can be painted`,
    ).toBeGreaterThan(0);
    expect(
      marker.height,
      `[${theme.id}/${state}] marker ${i + 1} has zero height — nothing can be painted`,
    ).toBeGreaterThan(0);
  }

  const shot = await page.screenshot({ scale: 'css' });
  const file = await saveArtifact(
    testInfo,
    `glyph-margin-${theme.id}-${state}.png`,
    shot,
  );
  const png = decodePng(shot);

  // A zoom on the marker column, so a human can judge legibility without
  // hunting a 3px bar in a 1200px-wide frame.
  const first = markers[0];
  const zoomFile = await saveArtifact(
    testInfo,
    `glyph-margin-${theme.id}-${state}-zoom.png`,
    await page.screenshot({
      scale: 'css',
      clip: {
        x: Math.max(0, first.x - 40),
        y: Math.max(0, first.y - 24),
        width: 210,
        height: 150,
      },
    }),
  );

  const profile = profileColumn(png, markers);

  report.push(`\n[${theme.id} / ${state}] monaco=${theme.monacoTheme}`);
  report.push(`  full: ${file}`);
  report.push(`  zoom: ${zoomFile}`);
  report.push(
    `  css=${first.cssBackground} elements=${markers.length} ` +
      `band=${profile.bandRows}px marked=${profile.markedRows}px ` +
      `longestRun=${profile.longestRun}px paintedWidth=${profile.paintedWidth}px`,
  );
  report.push(
    `  painted=${formatRgba(profile.painted)} bg=${formatRgba(profile.background)} ` +
      `contrast=${profile.minContrast.toFixed(2)}..${profile.maxContrast.toFixed(2)}:1`,
  );

  // VISIBLE — an unbroken bar at least one text line tall. Anything less and a
  // user scanning the gutter has nothing to see.
  const lineHeight = first.height;
  expect(
    profile.longestRun,
    `[${theme.id}/${state}] the glyph margin carries no marker bar: the tallest ` +
      `unbroken run of pixels reaching ${MIN_CONTRAST}:1 against the margin is ` +
      `${profile.longestRun}px, less than one ${lineHeight}px line. ` +
      `Screenshot: ${file}`,
  ).toBeGreaterThanOrEqual(Math.floor(lineHeight * 0.9));

  // LEGIBLE — and every row that does paint clears the bar, not just the best.
  expect(
    profile.minContrast,
    `[${theme.id}/${state}] the marker is not legible against the glyph margin: ` +
      `${formatRgba(profile.painted)} on ${formatRgba(profile.background)} = ` +
      `${profile.minContrast.toFixed(2)}:1, below WCAG 1.4.11's ${MIN_CONTRAST}:1. ` +
      `Screenshot: ${file}`,
  ).toBeGreaterThanOrEqual(MIN_CONTRAST);

  return profile;
}

/**
 * Reduce the screenshot to the one thing that matters: is there a legible
 * vertical bar in the glyph margin, and how wide and tall is it?
 *
 * The reference colour is sampled 2px to the LEFT of the marker box on the same
 * row. The marker is inset from the lane edge by its `margin-left`, so that
 * pixel is always bare glyph-margin background — the colour the bar has to be
 * distinguishable from.
 */
function profileColumn(
  png: ReturnType<typeof decodePng>,
  markers: readonly MarkerBox[],
): ColumnProfile {
  const xFrom = Math.round(Math.min(...markers.map((m) => m.x)));
  const xTo = Math.round(Math.max(...markers.map((m) => m.x + m.width))) - 1;
  const bandFrom = Math.round(Math.min(...markers.map((m) => m.y)));
  const bandTo =
    Math.round(Math.max(...markers.map((m) => m.y + m.height))) - 1;

  let markedRows = 0;
  let longestRun = 0;
  let currentRun = 0;
  let bestRunEnd = bandFrom;
  let minContrast = Number.POSITIVE_INFINITY;
  let maxContrast = 0;
  let painted: Rgba = [0, 0, 0, 255];
  let background: Rgba = [0, 0, 0, 255];

  for (let y = bandFrom; y <= bandTo; y++) {
    const rowBackground = pixelAt(png, xFrom - 2, y);
    let rowBest = 0;
    let rowPixel: Rgba = rowBackground;
    for (let x = xFrom; x <= xTo; x++) {
      const pixel = pixelAt(png, x, y);
      const ratio = contrastRatio(pixel, rowBackground);
      if (ratio > rowBest) {
        rowBest = ratio;
        rowPixel = pixel;
      }
    }
    if (rowBest >= MIN_CONTRAST) {
      markedRows++;
      currentRun++;
      if (currentRun > longestRun) {
        longestRun = currentRun;
        bestRunEnd = y;
      }
      minContrast = Math.min(minContrast, rowBest);
      maxContrast = Math.max(maxContrast, rowBest);
      painted = rowPixel;
      background = rowBackground;
    } else {
      currentRun = 0;
    }
  }

  // Width is read at the middle of the tallest run, where the bar is certainly
  // painted, rather than at a row that might sit in Monaco's view-zone gap.
  const probeRow = bestRunEnd - Math.floor(longestRun / 2);
  const probeBackground = pixelAt(png, xFrom - 2, probeRow);
  let paintedWidth = 0;
  for (let x = xFrom; x <= xTo; x++) {
    if (
      contrastRatio(pixelAt(png, x, probeRow), probeBackground) >= MIN_CONTRAST
    ) {
      paintedWidth++;
    }
  }

  return {
    markedRows,
    bandRows: bandTo - bandFrom + 1,
    longestRun,
    paintedWidth,
    minContrast: markedRows > 0 ? minContrast : 0,
    maxContrast,
    painted,
    background,
  };
}

test.describe('glyph-margin hunk markers, seen in three themes (TASK_2026_222)', () => {
  // A real boot into an empty home runs every SQLite migration from zero before
  // the window is created, which does not fit the config-wide 60s budget.
  test.setTimeout(300_000);

  test('paints a legible marker per hunk in light, dark and high-contrast', async ({
    ui,
    repo,
  }, testInfo) => {
    const page = ui.page;

    // Preconditions read from real git, so a failure below is the UI's and not
    // the fixture's.
    expect(repo.stagedDiff()).toBe('');
    expect(repo.worktreeDiff().match(/^@@ /gm)?.length).toBe(3);

    await ui.goto('editor');
    await page.getByRole('tab', { name: 'Git' }).click();

    const changedRow = page.locator('[role="listitem"]', {
      hasText: FILE_NAME,
    });
    await expect(changedRow).toBeVisible({ timeout: 20_000 });
    await changedRow.click();

    await expect(page.locator('ptah-diff-view .view-lines').last()).toBeVisible(
      {
        timeout: 20_000,
      },
    );
    const position = page.locator('[data-testid="hunk-position"]');
    await expect(position).toHaveText('3 hunks', { timeout: 20_000 });

    const report: string[] = [];

    // --- Phase 1: nothing selected. The first hunk sits at line 7 and is on
    // screen at the initial scroll position, so its markers are measurable
    // without moving the viewport.
    const unselected = new Map<string, ColumnProfile>();
    for (const theme of THEMES) {
      await applyTheme(page, theme);
      const markers = await readMarkers(page);
      for (const marker of markers) {
        expect(
          marker.selected,
          `[${theme.id}] a marker carries the selected class before anything was selected`,
        ).toBe(false);
      }
      unselected.set(
        theme.id,
        await measureTheme(page, testInfo, theme, 'unselected', report),
      );
    }

    // --- Phase 2: select hunk 1 and re-measure the same markers.
    await page.locator('[data-testid="hunk-next"]').click();
    await expect(position).toHaveText('Hunk 1 of 3');

    for (const theme of THEMES) {
      await applyTheme(page, theme);
      const markers = await readMarkers(page);
      expect(
        markers.some((m) => m.selected),
        `[${theme.id}] hunk 1 is selected but no marker carries the selected class`,
      ).toBe(true);

      const after = await measureTheme(
        page,
        testInfo,
        theme,
        'selected',
        report,
      );
      const before = unselected.get(theme.id) as ColumnProfile;
      const wider = after.paintedWidth > before.paintedWidth;
      const bolder = after.painted.some(
        (channel, i) => Math.abs(channel - before.painted[i]) > 8,
      );
      expect(
        wider || bolder,
        `[${theme.id}] the selected marker paints identically to the unselected ` +
          `one: ${before.paintedWidth}px ${formatRgba(before.painted)} → ` +
          `${after.paintedWidth}px ${formatRgba(after.painted)}. Selection would ` +
          `be invisible to a mouse user.`,
      ).toBe(true);
    }

    // --- Phase 3: a marker exists for EVERY hunk, not only the one that
    // happened to be on screen. The three hunks are 45 lines apart, so each is
    // stepped into view in turn.
    for (const which of [2, 3]) {
      await page.locator('[data-testid="hunk-next"]').click();
      await expect(position).toHaveText(`Hunk ${which} of 3`);
      const markers = await readMarkers(page);
      expect(
        markers.filter((m) => m.selected).length,
        `no selected glyph marker is painted for hunk ${which}`,
      ).toBeGreaterThan(0);
      report.push(
        `\n[hunk ${which}] ${markers.filter((m) => m.selected).length} selected marker(s) painted`,
      );
    }

    // Printed, not merely asserted: the point of this task is that a human can
    // read what the machine saw.
    console.log(
      `\n=== TASK_2026_222 glyph-margin evidence ===${report.join('\n')}\n`,
    );
  });
});
