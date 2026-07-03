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
 * Captions double as the VOICEOVER SCRIPT (`narrate.mjs --source beats`), so
 * they are written as spoken prose and each beat holds long enough (`voHold`,
 * ~65ms/char) for the narration to finish before the next beat starts.
 * Element-targeted captions + spotlight/hover auto-emit `shots.json`, so the
 * rendered video punches the virtual camera onto each card as the VO names it.
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

/** Spoken form of the range chip label — captions double as the VO script. */
const RANGE_SPOKEN: Record<string, string> = {
  '24h': 'the last twenty-four hours',
  '7d': 'the last seven days',
  '30d': 'the last thirty days',
  All: 'all time',
};

/**
 * Hold long enough for the ElevenLabs narration of `text` to finish before the
 * next beat starts (~65ms per character + settle), minus time the scene will
 * spend inside interactions that already run between this beat and the next.
 */
function voHold(text: string, alreadySpentMs = 0): number {
  return Math.max(600, Math.round(text.length * 65) + 500 - alreadySpentMs);
}

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

  // HOOK — fire immediately so the video opens on a question, not dead air.
  const HOOK =
    'How much did your AI agents cost you this week? If you do not know, keep watching.';
  await director.caption(HOOK);
  await director.hold(voHold(HOOK));
  await director.caption();

  // WARMUP — one line of context before the tour starts.
  const WARMUP =
    'You are looking at the Ptah dashboard — home base for every agent you run. Let us take the tour.';
  await director.caption(WARMUP);
  await director.hold(voHold(WARMUP));
  await director.caption();

  await goToDashboard(page, director);
  await director.dismissDialogs();
  await director.hold();

  const grid = page.locator('[data-testid="dashboard-grid"]').first();

  const HOME =
    'Everything on this screen is live. Real cards, real data — not one mock number anywhere.';
  await director.caption(HOME);
  await director.hold(voHold(HOME));
  await director.caption();

  // Reveal the full page top→bottom so every card scrolls into frame. The
  // scroll itself (7 steps × 700ms × down-and-back) outlasts the narration.
  await director.caption(
    'First, get the lay of the land — the full page, top to bottom.',
  );
  await director.scrollThrough(grid, { steps: 7, dwellMs: 700, andBack: true });
  await director.caption();

  // Hero card #1 — the Tribunal convene affordance (spotlight + hover only,
  // never click: clicking would launch a multi-vendor panel). The targeted
  // caption punches the virtual camera onto the card as the VO names it.
  const tribunalCard = page
    .getByRole('button', { name: 'Convene a Tribunal' })
    .first();
  if (await isVisible(tribunalCard)) {
    const TRIBUNAL =
      'Need a second opinion? Convene a Tribunal — rival AI vendors debate your question, or race to build the answer.';
    await director.caption(TRIBUNAL, tribunalCard);
    await director.hover(tribunalCard, 700);
    await director.spotlight(tribunalCard, 1800);
    // hover(700) + spotlight(1800 + 180 settle) already spent ~2.7s of VO time.
    await director.hold(voHold(TRIBUNAL, 2680));
    await director.caption();
  }

  // Hero card #2 — the Session Analytics card (real costs from JSONL).
  const analyticsCard = page
    .locator('section[aria-label="Session analytics"]')
    .first();
  if (await isVisible(analyticsCard)) {
    const ANALYTICS =
      'Here is where the cost question gets answered. Session Analytics reads your real usage straight from disk.';
    await director.caption(ANALYTICS, analyticsCard);
    await director.hover(analyticsCard, 700);
    await director.spotlight(analyticsCard, 2000);
    await director.hold(voHold(ANALYTICS, 2880));
    await director.caption();

    // Hover into the aggregate metric cards if they rendered.
    const metricCard = page.locator('ptah-session-metrics-cards').first();
    if (await isVisible(metricCard)) {
      const METRICS =
        'Every token, every dollar, every turn — totaled across all of your sessions.';
      await director.caption(METRICS, metricCard);
      await director.hover(metricCard, 1400);
      await director.hold(voHold(METRICS, 1400));
      await director.caption();
    }

    // Non-destructive interaction: flip the date-range filter. This only
    // re-reads local session history — no agent, no spend.
    const rangeChip = analyticsCard
      .getByRole('group', { name: 'Filter sessions by date range' })
      .getByRole('button', { name: RANGE_LABEL })
      .first();
    if (await isVisible(rangeChip)) {
      const spokenRange = RANGE_SPOKEN[RANGE_LABEL] ?? RANGE_LABEL;
      const FILTER = `Want a tighter window? One click filters everything to ${spokenRange}.`;
      await director.caption(FILTER, rangeChip);
      await director.click(rangeChip);
      await director.hold(voHold(FILTER, 550));
      await director.caption();
    }

    // Hover into a per-session stats card if present.
    const sessionCard = page.locator('ptah-session-stats-card').first();
    if (await isVisible(sessionCard)) {
      const DRILL =
        'And when one session looks off, drill in and get the full story.';
      await director.caption(DRILL, sessionCard);
      await director.hover(sessionCard, 800);
      await director.spotlight(sessionCard, 1600);
      await director.hold(voHold(DRILL, 2580));
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

  const OUTRO =
    'So, what did your agents cost this week? Now you know, down to the dollar. That is Ptah.';
  await director.caption(OUTRO);
  await director.hold(voHold(OUTRO) + 600);
  await director.caption();
});
