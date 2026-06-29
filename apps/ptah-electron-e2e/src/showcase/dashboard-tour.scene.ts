import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * SHOWCASE — "Your card-driven home" (Dashboard tour).
 *
 * A calm, social-media-ready walkthrough of Ptah's Dashboard: the card-driven
 * home that aggregates session analytics (real costs read from JSONL) and the
 * Tribunal convene affordance. This is a SCENE, not a test — it asserts almost
 * nothing, runs NO agents, and is tuned for how it looks on camera: smooth
 * pointer travel, lower-third captions, generous dwell, and spotlight beats on
 * the hero cards.
 *
 * Strictly NON-DESTRUCTIVE: it navigates, scrolls, hovers, and spotlights. It
 * never clicks "Convene a Tribunal" or any control that would start a paid run.
 * The one click it makes is the analytics date-range filter (`24h`/`7d`/`30d`),
 * which only re-reads local session history.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace with session history is restored.
 * - No other Ptah instance is running (single-instance lock).
 *
 * Selector note: shell navigation is the only spot that touches chrome outside
 * the dashboard surface. If the global navbar changes, adjust `goToDashboard()`.
 */

/**
 * Which analytics date-range chip to click for the filter beat. Override via
 * `PTAH_SHOWCASE_DASHBOARD_RANGE` (e.g. "24h", "7d", "30d", "All"). Matched
 * loosely against the chip label; falls back gracefully if not present.
 */
const RANGE_LABEL = process.env['PTAH_SHOWCASE_DASHBOARD_RANGE'] ?? '7d';

async function isVisible(loc: Locator): Promise<boolean> {
  return loc
    .first()
    .isVisible()
    .catch(() => false);
}

/** Navigate to the Dashboard via the global Electron navbar tab. */
async function goToDashboard(page: Page, director: Director): Promise<void> {
  const candidates: Locator[] = [
    page.getByRole('tab', { name: 'Dashboard' }),
    page.getByRole('button', { name: 'Dashboard' }),
    page.locator('[aria-label="Dashboard"]'),
    page.locator('[title="Dashboard"]'),
  ];
  for (const c of candidates) {
    if (await isVisible(c)) {
      await director.click(c.first());
      break;
    }
  }
  // The dashboard grid is the page root for this surface.
  await page
    .locator('[data-testid="dashboard-grid"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => undefined);
}

test('SHOWCASE — dashboard tour (card-driven home)', async ({
  page,
  director,
}) => {
  // Clear any blocking startup modal (license / trial-ended dialog) before we
  // film, then again after we switch surfaces.
  await director.dismissDialogs();

  await director.caption('Every session, at a glance.');
  await director.hold(1600);
  await director.caption();

  await goToDashboard(page, director);
  await director.dismissDialogs();
  await director.hold();

  const grid = page.locator('[data-testid="dashboard-grid"]').first();

  await director.caption('This is your card-driven home.');
  await director.hold(1400);
  await director.caption();

  // Reveal the full page top→bottom so every card scrolls into frame.
  await director.caption('Scroll the whole surface…');
  await director.scrollThrough(grid, { steps: 7, dwellMs: 700, andBack: true });
  await director.caption();

  // Hero card #1 — the Tribunal convene affordance (spotlight + hover only,
  // never click: clicking would launch a multi-vendor panel).
  const tribunalCard = page
    .getByRole('button', { name: 'Convene a Tribunal' })
    .first();
  if (await isVisible(tribunalCard)) {
    await director.caption('Convene a Tribunal — Council, Forge, or Race.');
    await director.hover(tribunalCard, 700);
    await director.spotlight(tribunalCard, 1800);
    await director.caption();
  }

  // Hero card #2 — the Session Analytics card (real costs from JSONL).
  const analyticsCard = page
    .locator('section[aria-label="Session analytics"]')
    .first();
  if (await isVisible(analyticsCard)) {
    await director.caption('Session Analytics — real costs from JSONL.');
    await director.hover(analyticsCard, 700);
    await director.spotlight(analyticsCard, 2000);
    await director.caption();

    // Hover into the aggregate metric cards if they rendered.
    const metricCard = page.locator('ptah-session-metrics-cards').first();
    if (await isVisible(metricCard)) {
      await director.caption('Tokens, cost, and turns — aggregated.');
      await director.hover(metricCard, 1400);
      await director.caption();
    }

    // Non-destructive interaction: flip the date-range filter. This only
    // re-reads local session history — no agent, no spend.
    const rangeChip = analyticsCard
      .getByRole('group', { name: 'Filter sessions by date range' })
      .getByRole('button', { name: RANGE_LABEL })
      .first();
    if (await isVisible(rangeChip)) {
      await director.caption('Filter by range — last ' + RANGE_LABEL + '.');
      await director.click(rangeChip);
      await director.hold(1200);
      await director.caption();
    }

    // Hover into a per-session stats card if present.
    const sessionCard = page.locator('ptah-session-stats-card').first();
    if (await isVisible(sessionCard)) {
      await director.caption('Drill into any single session.');
      await director.hover(sessionCard, 800);
      await director.spotlight(sessionCard, 1600);
      await director.caption();
    }
  }

  // Final settle: glide back to the top so the home reads as one composed view.
  await director.scrollThrough(grid, {
    steps: 4,
    dwellMs: 600,
    andBack: false,
  });
  await page
    .evaluate(() => {
      const el = document.querySelector(
        '[data-testid="dashboard-grid"]',
      ) as HTMLElement | null;
      el?.scrollTo({ top: 0, behavior: 'smooth' });
    })
    .catch(() => undefined);
  await director.hold(900);

  await director.caption('One home. Every session. Real numbers.');
  await director.hold(2600);
  await director.caption();
});
