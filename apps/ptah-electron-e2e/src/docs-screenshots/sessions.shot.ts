import { test, expect } from './_harness/docs-fixtures';
import { shoot, freezeMotion } from './_harness/shooter';

/**
 * Session-surface shots (TASK_2026_260).
 *
 * The session list, its search/date filter and the canvas tile strip all read
 * from the profile copy's real session metadata, so these frames show the real
 * sidebar rather than a mocked one.
 */
test.describe('docs screenshots — sessions', () => {
  test('sessions rail, history filters and the canvas tile strip', async ({
    ui,
    page,
  }) => {
    test.setTimeout(300_000);
    await ui.goto('canvas');

    const search = page.getByPlaceholder('Search sessions...');
    await expect(search).toBeVisible();

    // The session rail is app-shell's `<aside>` — the search box, the date
    // filter and the session rows. Cropping to the div that merely *contains*
    // the input gets the header strip and nothing else.
    const sessionsRail = page.locator('aside').filter({ has: search }).first();
    await shoot(page, 'sessions-overview', { crop: sessionsRail });

    // Same rail with the date-range filter open — the history view's controls.
    const dateFilter = page.locator(
      '[title="Toggle date filter"], [aria-label="Toggle date filter"]',
    );
    if (
      await dateFilter
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await dateFilter.first().click();
      await page.waitForTimeout(600);
    }
    await shoot(page, 'sessions-history', { crop: sessionsRail });

    // Two tiles side by side: the canvas is where multiple sessions are open at
    // once, so it is what "managing sessions" documents. The tile buttons sit
    // on animated surfaces, so freeze motion first — Playwright's stability
    // check otherwise waits out the whole timeout on a never-still element.
    await freezeMotion(page);
    for (let i = 0; i < 2; i++) {
      // First pass: the empty-state CTA. After a tile exists the CTA is gone
      // and the floating "+" is the only way to add another.
      const add =
        i === 0
          ? page.getByRole('button', { name: 'New Session' }).first()
          : page.locator('[title="Add new session tile"]').first();
      if (!(await add.isVisible().catch(() => false))) break;
      await add.click({ force: true });
      const create = page.getByRole('button', { name: 'Create', exact: true });
      if (
        await create
          .first()
          .isVisible()
          .catch(() => false)
      ) {
        await create.first().click({ force: true });
      }
      await page.waitForTimeout(2_500);
    }
    const tiles = page.locator('[data-testid="canvas-grid"] .grid-stack-item');
    console.log(`[docs-shot] canvas tiles: ${await tiles.count()}`);
    await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible();
    await page.waitForTimeout(1_500);
    await shoot(page, 'sessions-tabs');
  });

  test('session analytics dashboard', async ({ ui, page }) => {
    test.setTimeout(300_000);
    await ui.goto('dashboard');
    await expect(page.locator('ptah-dashboard-grid')).toBeVisible();
    await page.waitForTimeout(2_500);

    // The default range is a recent window; a project whose last session is
    // older than that reports "No sessions found". Widen it before shooting.
    const dateFilter = page.locator(
      '[title="Toggle date filter"], [aria-label="Toggle date filter"]',
    );
    if (
      await dateFilter
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await dateFilter.first().click();
      await page.waitForTimeout(500);
      for (const label of ['All time', 'Last 90 days', '90 days', 'All']) {
        const option = page.getByRole('button', { name: label, exact: true });
        if (
          await option
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          await option.first().click();
          break;
        }
      }
      await page.waitForTimeout(2_500);
    }
    await shoot(page, 'sessions-analytics');
  });
});
