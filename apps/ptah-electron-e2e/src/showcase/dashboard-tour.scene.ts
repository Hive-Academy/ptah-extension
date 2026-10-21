import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * SHOWCASE — "Your card-driven home" (Dashboard tour).
 *
 * A calm, social-media-ready walkthrough of Ptah's Dashboard: the card-driven
 * home that aggregates usage from local sources and the
 * Tribunal navigation tab. This is a SCENE, not a test — it asserts almost
 * nothing, runs NO agents, and is tuned for how it looks on camera: smooth
 * pointer travel, lower-third captions, generous dwell, and spotlight beats on
 * the hero cards.
 *
 * AUDIO-FIRST: the voiceover script lives in `scripts/dashboard-tour.json` and
 * is narrated by `narrate.mjs` BEFORE capture. Each `director.say(i)` speaks
 * line i, holding for the REAL clip duration (durations.json) so narration,
 * captions and footage stay locked — no estimated holds, no silent gaps.
 * Element-targeted says + spotlight/hover auto-emit `shots.json`, punching the
 * camera onto each card as the VO names it.
 *
 * Strictly NON-DESTRUCTIVE: it navigates, scrolls, hovers, and spotlights. It
 * never clicks Tribunal or any control that would start a paid run.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace with session history is restored.
 * - No other Ptah instance is running (single-instance lock).
 *
 * Selector note: shell navigation is the only spot that touches chrome outside
 * the dashboard surface. If the global navbar changes, adjust `goToDashboard()`.
 */

async function isVisible(loc: Locator): Promise<boolean> {
  return loc
    .first()
    .isVisible()
    .catch(() => false);
}

/** Navigate to the Dashboard via the global Electron navbar tab. */
async function goToDashboard(page: Page, director: Director): Promise<void> {
  const candidates: Locator[] = [
    page.getByRole('tab', { name: 'Analytics' }),
    page.getByRole('button', { name: 'Analytics' }),
    page.locator('[aria-label="Analytics"]'),
    page.locator('[title="Analytics"]'),
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
  // Keep the new open-source Builders card out of frame so the dashboard cards
  // read in the order the script expects.
  await page.evaluate(() => {
    localStorage.setItem('ptah.builders-card.dismissed', '1');
  });

  // Navigate + clean up BEFORE the first beat: everything until the hook is
  // trimmed by render-all's lead-in trim, so this surface swap never airs — and
  // the hook lands on the Dashboard instead of the stale restored surface. This
  // navigation also forces the grid's first-mount (real session costs from
  // JSONL), so no separate pre-warm is needed.
  await goToDashboard(page, director);
  await director.hold();

  // HOOK — fire immediately so the video opens on a question, not dead air.
  await director.say(0);

  // WARMUP — one line of context before the tour starts.
  await director.say(1);

  const grid = page.locator('[data-testid="dashboard-grid"]').first();

  await director.say(2);

  // Reveal the full page top→bottom so every card scrolls into frame while the
  // narration plays over the scroll.
  await director.say(3, {
    during: async () => {
      await director.scrollThrough(grid, {
        steps: 7,
        dwellMs: 700,
        andBack: true,
      });
    },
  });

  // Show the Tribunal navigation tab without entering a paid run.
  const tribunalTab = page.getByRole('tab', { name: 'Tribunal' }).first();
  if (await isVisible(tribunalTab)) {
    await director.say(4, {
      target: tribunalTab,
      during: async () => {
        await director.hover(tribunalTab, 700);
        await director.spotlight(tribunalTab, 1800);
      },
    });
  }
  // Hero card #2 — the Usage card.
  const analyticsCard = page
    .locator('section[aria-label="Usage"]')
    .first();
  if (await isVisible(analyticsCard)) {
    await director.say(5, {
      target: analyticsCard,
      during: async () => {
        await director.hover(analyticsCard, 700);
        await director.spotlight(analyticsCard, 2000);
      },
    });
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

  await director.say(6, { breathMs: 950 });
});
