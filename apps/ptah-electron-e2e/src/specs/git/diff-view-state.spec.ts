import type { Page } from '@playwright/test';
import { test, expect } from '../../support/fixtures';
import { gitDiffFileMock } from '../../support/git-diff-mock';
import type { UiDriver } from '../../support/ui-driver';

/**
 * Review canvas state across switches — TASK_2026_576 Batch 60, the successor
 * of the Monaco diff-editor lifecycle spec (TASK_2026_173, B1 AC1/AC3/AC4).
 *
 * The behaviour kept: the diff surface is not rebuilt when the user switches
 * away and back, and the reading position survives.
 *
 *   B1 AC1 (instance survives) - the Changes body stays mounted (hidden) while
 *          another review tab shows. Proved by branding the live Pierre
 *          section element (`ptah-file-diff-section`) and finding the same
 *          element, brand intact, after a Changes -> Task -> Changes round
 *          trip. The Pierre `<diffs-container>` inside is windowed (A9): the
 *          canvas disposes it while its body is hidden and the intersection
 *          observer reports nothing near, so its survival is logged, not
 *          asserted.
 *   B1 AC3 (scroll restored) - the list's scroll position survives both the
 *          tab round trip and a comparison round trip (Working tree -> Staged
 *          -> Working tree; the canvas restores scroll per comparison).
 *   B1 AC4 (collapsed regions) - has NO successor. That criterion recorded a
 *          Monaco shortfall (its diff editor disables folding); Pierre renders
 *          hunks with their context and has no folding state to preserve, so
 *          nothing is asserted about it here.
 */

const FILE_COUNT = 24;
const FILE_LINES = 40;
const CHANGED_LINE = 20;
const BRAND = 5760;

function filePath(index: number): string {
  return `src/state/file${String(index).padStart(2, '0')}.ts`;
}

function side(index: number, modified: boolean): string {
  const lines: string[] = [];
  for (let line = 1; line <= FILE_LINES; line++) {
    lines.push(
      line === CHANGED_LINE
        ? `export const f${index}v${line} = ${modified ? 'worktree' : 'index'};`
        : `export const f${index}v${line} = ${line};`,
    );
  }
  return lines.join('\n') + '\n';
}

async function openCanvas(ui: UiDriver): Promise<void> {
  const diffByPath: Record<string, unknown> = {};
  const files: {
    path: string;
    status: string;
    staged: boolean;
    isDirectory: boolean;
  }[] = [];
  for (let i = 0; i < FILE_COUNT; i++) {
    const path = filePath(i);
    files.push({ path, status: 'M', staged: false, isDirectory: false });
    diffByPath[path] = gitDiffFileMock({
      path,
      comparison: 'worktree',
      original: side(i, false),
      modified: side(i, true),
      snapshotToken: `state-${i}`,
    });
  }
  // A few files are also staged, so the Staged comparison is not empty (an
  // empty comparison has no section to anchor a scroll position to).
  for (let i = 0; i < 4; i++) {
    files.push({
      path: filePath(i),
      status: 'M',
      staged: true,
      isDirectory: false,
    });
  }
  await ui.mockRpc({
    'git:diffFile': `(params) => (${JSON.stringify(diffByPath)})[params.path]`,
  });
  await ui.goto('git');
  await ui.pushEvent({
    type: 'git:status-update',
    payload: {
      branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
      files,
      isGitRepo: true,
    },
  });
  await expect(ui.reviewTab(/^Changes, \d+ changed files/)).toBeVisible();
  await expect(
    ui.reviewFileSection(filePath(0)).getByText('f0v20 = worktree'),
  ).toBeVisible({ timeout: 60_000 });
}

/**
 * Scroll the canvas list, wait for the virtualised window to settle (section
 * heights are estimated until Pierre mounts and they are measured), then nudge
 * by a few pixels so the canvas records the settled position as its anchor.
 */
async function scrollListTo(page: Page, top: number): Promise<number> {
  const list = page.locator('[data-testid="review-canvas-list"]');
  await list.evaluate((el, value) => {
    el.scrollTop = value;
  }, top);
  let lastHeight = -1;
  await expect
    .poll(
      async () => {
        const height = await list.evaluate((el) => el.scrollHeight);
        const stable = height === lastHeight;
        lastHeight = height;
        return stable;
      },
      { intervals: [800] },
    )
    .toBe(true);
  await list.evaluate((el) => {
    el.scrollTop += 5;
  });
  await page.waitForTimeout(300);
  return list.evaluate((el) => el.scrollTop);
}

interface ReadingPosition {
  /** Header path of the first section still reaching into the viewport. */
  path: string;
  /** Pixels of that section already scrolled past the viewport top. */
  offset: number;
}

/**
 * Where the user is reading, as content rather than pixels: section heights
 * are estimated until measured, so a raw `scrollTop` does not name a place.
 */
function readingPosition(page: Page): Promise<ReadingPosition> {
  return page.evaluate(() => {
    const list = document.querySelector(
      '[data-testid="review-canvas-list"]',
    ) as HTMLElement;
    const top = list.getBoundingClientRect().top;
    for (const section of Array.from(
      list.querySelectorAll('ptah-file-diff-section'),
    )) {
      const rect = section.getBoundingClientRect();
      if (rect.bottom > top + 1) {
        return {
          path:
            section
              .querySelector('[data-testid="file-section-path"]')
              ?.textContent?.trim() ?? '',
          offset: top - rect.top,
        };
      }
    }
    return { path: '', offset: 0 };
  });
}

test.describe('review canvas state across switches (B1 AC1/AC3)', () => {
  test.setTimeout(120_000);

  test('keeps the same Pierre instance and scroll position through a tab round trip', async ({
    ui,
  }) => {
    await openCanvas(ui);
    const page = ui.page;

    const scrolled = await scrollListTo(page, 700);
    expect(scrolled).toBeGreaterThan(300);
    const before = await readingPosition(page);
    expect(before.path).not.toContain('file00');

    // Brand the first section (and its Pierre container) that is on screen.
    const branded = await page.evaluate((brand) => {
      const list = document.querySelector(
        '[data-testid="review-canvas-list"]',
      ) as HTMLElement;
      const box = list.getBoundingClientRect();
      for (const section of Array.from(
        list.querySelectorAll('ptah-file-diff-section'),
      )) {
        const rect = section.getBoundingClientRect();
        if (rect.bottom > box.top + 20 && rect.top < box.bottom - 20) {
          (section as unknown as { __ptahBrand?: number }).__ptahBrand = brand;
          const container = section.querySelector('diffs-container');
          if (container) {
            (container as unknown as { __ptahBrand?: number }).__ptahBrand =
              brand;
          }
          return true;
        }
      }
      return false;
    }, BRAND);
    expect(branded).toBe(true);

    // Away: the Task tab hides the Changes body (it must not unmount it).
    await ui.reviewTab('Task').click();
    await expect(ui.reviewTab('Task')).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.locator('[data-testid="review-canvas-list"]'),
    ).toBeHidden();
    await expect(
      page.locator('[data-testid="review-canvas-list"]'),
    ).toHaveCount(1);

    // Back.
    await ui.reviewTab(/^Changes/).click();
    await expect(
      page.locator('[data-testid="review-canvas-list"]'),
    ).toBeVisible();

    // B1 AC1: the same section element, brand intact. A rebuilt list loses it.
    const survivors = (): Promise<{ section: number; container: number }> =>
      page.evaluate((brand) => {
        const has = (el: Element): boolean =>
          (el as unknown as { __ptahBrand?: number }).__ptahBrand === brand;
        return {
          section: Array.from(
            document.querySelectorAll('ptah-file-diff-section'),
          ).filter(has).length,
          container: Array.from(
            document.querySelectorAll('diffs-container'),
          ).filter(has).length,
        };
      }, BRAND);
    await expect.poll(async () => (await survivors()).section).toBe(1);

    // The diff text of the visible section is on screen again, not blank.
    await expect(
      page
        .locator('ptah-file-diff-section')
        .filter({ has: page.locator('diffs-container') })
        .first()
        .locator('diffs-container')
        .first(),
    ).toBeVisible();

    // B1 AC3: the reading position came back - same file at the top.
    await expect
      .poll(async () => (await readingPosition(page)).path)
      .toBe(before.path);
    const after = await readingPosition(page);
    expect(Math.abs(after.offset - before.offset)).toBeLessThan(150);

    console.log(
      `[diff-view-state] tab round trip: before=${JSON.stringify(before)} after=${JSON.stringify(after)} containerSurvived=${(await survivors()).container}`,
    );
  });

  test('restores the scroll position when the comparison is switched and switched back', async ({
    ui,
  }) => {
    await openCanvas(ui);
    const page = ui.page;
    const scrolled = await scrollListTo(page, 900);
    expect(scrolled).toBeGreaterThan(400);
    const before = await readingPosition(page);
    expect(before.path).not.toContain('file00');

    const trigger = page.locator('[data-testid="comparison-trigger"]');
    await trigger.click();
    await page.locator('[data-testid="comparison-option-staged"]').click();
    await expect(trigger).toHaveText(/Staged/);

    await trigger.click();
    await page.locator('[data-testid="comparison-option-worktree"]').click();
    await expect(trigger).toHaveText(/Working tree/);

    await expect
      .poll(async () => (await readingPosition(page)).path)
      .toBe(before.path);
    const after = await readingPosition(page);
    expect(Math.abs(after.offset - before.offset)).toBeLessThan(150);

    console.log(
      `[diff-view-state] comparison round trip: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
    );
  });
});
