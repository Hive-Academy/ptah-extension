import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * P1.2 — "Ptah Desktop — the Thoth shell" (4-tab cockpit tour).
 *
 * A confident cockpit pan across the desktop app's Thoth shell: the four
 * Electron-only tabs — Memory, Skills, Schedules (cron) and Gateway. Unlike the
 * old quick-teaser cut, each tab now gets a real pan: enter the tab, dismiss any
 * re-asserting trial modal, slowly scroll THROUGH the panel so the camera
 * reveals the full surface, then spotlight that tab's hero element and narrate a
 * single confident line. This is still an OVERVIEW (the deep dives live in
 * `skills-tour` / `cron-tour`), but it lingers long enough to feel like a
 * cockpit, not a flashcard. This is a SCENE, not a test — it asserts almost
 * nothing and is tuned for how it looks on camera. See
 * `docs/video-content-plan.md` P1.2.
 *
 * Purely UI-driven: NO agents run and NO LLM inference happens, so there is no
 * `waitForAgentTurn` here.
 *
 * Captions double as the VOICEOVER SCRIPT (`narrate.mjs --source beats`), so they
 * are spoken prose; element-targeted captions + spotlight/hover auto-emit
 * `shots.json`, punching the camera onto each subject.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored.
 * - Seeded data so the tabs aren't empty is ideal but not required — each tab
 *   guards for an empty surface and still pans/spotlights the panel chrome.
 * - No other Ptah instance is running (single-instance lock).
 *
 * Selector note: the only shell-navigation touch point is the `Thoth` top-nav
 * tab in `goToThoth()`. The four inner tabs are addressed by their stable ids
 * (`#thoth-tab-<id>` / `#thoth-panel-<id>`) rendered by
 * `libs/frontend/thoth-shell`, so they survive label/chrome tweaks. Note the
 * inner tabs ALSO carry `role="tab"`, so we deliberately select them by id
 * rather than by role to avoid colliding with the top-nav tablist.
 */

/** One inner tab of the Thoth shell: its id, the line we narrate, and a list of
 * candidate hero selectors to spotlight (first visible wins). */
interface ThothBeat {
  /** Tab/panel id suffix — drives `#thoth-tab-<id>` and `#thoth-panel-<id>`. */
  readonly id: 'memory' | 'skills' | 'cron' | 'gateway';
  /** Single-line teaser caption for this tab. */
  readonly caption: string;
  /**
   * Ordered hero candidates to spotlight — the first visible one wins. Falls
   * back to the panel's own heading, then the panel root, if none match (these
   * tabs may be sparse on a fresh profile).
   */
  readonly hero: readonly string[];
}

/** The four tabs, in cockpit-pan order, each with its line + hero candidates. */
const BEATS: readonly ThothBeat[] = [
  {
    id: 'memory',
    caption:
      'First, Memory — a persistent brain that quietly remembers what matters, across every session you run.',
    hero: [
      '[data-testid="memory-stat-blocks"]',
      '[data-testid="memory-blocks-list"]',
      '[aria-label="Memory statistics"]',
    ],
  },
  {
    id: 'skills',
    caption:
      'Next, Skills — where your agents take what they have learned and turn it into reusable skills they can call on again.',
    hero: [
      '[data-testid="suggestions-card"]',
      '[data-testid="skills-stat-candidates"]',
      '[aria-label="Skill synthesis statistics"]',
    ],
  },
  {
    id: 'cron',
    caption:
      'Then Schedules — cron-driven agents that wake up on their own, overnight, and get the work done while you sleep.',
    hero: [
      '[data-testid="cron-job-row"]',
      '[data-testid="cron-stat-total"]',
      '[aria-label="Cron statistics"]',
    ],
  },
  {
    id: 'gateway',
    caption:
      'And finally the Gateway — so you can drive Ptah from Telegram, Discord, or Slack, right from your phone.',
    hero: [
      '[data-testid="gateway-channel-card"]',
      '[data-testid="gateway-stat-total"]',
      '[aria-label="Gateway statistics"]',
    ],
  },
];

/**
 * Hold long enough for the narration of `text` to finish before the next beat
 * starts (~65ms/char + settle), minus time already spent in interactions that
 * run between this beat and the next. Captions double as the VO script
 * (`narrate.mjs --source beats`), so this prevents audio overlap.
 */
function voHold(text: string, alreadySpentMs = 0): number {
  return Math.max(600, Math.round(text.length * 65) + 500 - alreadySpentMs);
}

/**
 * Enter the Thoth shell from the top nav. Best-effort against the live shell:
 * tries a small list of resilient selectors for the `Thoth` tab, then waits for
 * the shell's first panel to materialise so callers can drive inner tabs.
 */
async function goToThoth(page: Page, director: Director): Promise<void> {
  const candidates: Locator[] = [
    page.getByRole('tab', { name: 'Thoth' }),
    page.getByRole('button', { name: 'Thoth' }),
    page.locator('[title="Thoth"]'),
    page.locator('[aria-label="Thoth"]'),
  ];
  for (const c of candidates) {
    if (
      await c
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await director.click(c.first());
      break;
    }
  }
  // The shell renders one tablist + one active panel; wait for the tab buttons
  // (any inner tab id) so we know the shell mounted before we start panning.
  await page.locator('#thoth-tab-memory').waitFor({ state: 'visible' });
}

/**
 * Resolve the first visible hero locator from a beat's candidate list, falling
 * back to the panel heading, then the panel root. Always returns something to
 * spotlight so a sparse tab still gets a confident framing.
 */
async function resolveHero(
  page: Page,
  beat: ThothBeat,
  panel: Locator,
): Promise<Locator> {
  for (const sel of beat.hero) {
    const loc = panel.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  const heading = panel.locator('h1').first();
  if (await heading.isVisible().catch(() => false)) return heading;
  return panel;
}

/**
 * Pan one inner tab: click `#thoth-tab-<id>`, wait for its panel, dismiss any
 * re-asserting trial modal, narrate, slowly scroll THROUGH the panel, then
 * spotlight the hero. A confident cockpit pan, not a flashcard.
 */
async function tourTab(
  page: Page,
  director: Director,
  beat: ThothBeat,
): Promise<void> {
  await director.click(page.locator(`#thoth-tab-${beat.id}`));
  const panel = page.locator(`#thoth-panel-${beat.id}`);
  await panel.waitFor({ state: 'visible' });
  // The trial modal can re-assert after a tab switch — keep it out of frame.
  await director.dismissDialogs();

  // Target the panel so the camera frames this tab's surface as the VO names it.
  await director.caption(beat.caption, panel);
  // scrollThrough + hero spotlight below outlast the VO — keep a short hold.
  await director.hold(900);

  // Reveal the full surface with a slow top→bottom→top pan.
  await director.scrollThrough(panel, { steps: 5, dwellMs: 620 });

  // Draw the eye to this tab's hero element (or the panel chrome if sparse).
  const hero = await resolveHero(page, beat, panel);
  await director.spotlight(hero, 1700);

  await director.hold(500);
  await director.caption();
}

test('P1.2 — desktop Thoth shell (4-tab cockpit tour)', async ({
  page,
  director,
}) => {
  // The persistent authed profile ALWAYS shows the "Pro Trial Has Ended"
  // startup modal — clear it before filming so it stays out of frame.
  await director.dismissDialogs();

  const OPENING =
    'The VS Code extension is just the tip. The desktop app is the whole iceberg.';
  await director.caption(OPENING);
  await director.hold(voHold(OPENING));
  await director.caption();

  // Enter the cockpit; the trial modal can re-assert after navigation, so
  // dismiss again before we start panning the tabs.
  await goToThoth(page, director);
  await director.dismissDialogs();
  await director.hold();

  // The four-tab pan below runs for far longer than this line — interaction-
  // covered — so a short hold is enough before the loop takes over.
  await director.caption('Here are four tabs the extension could never have.');
  await director.hold(1400);
  await director.caption();

  // One confident pan across the four Electron-only tabs — scroll + spotlight.
  for (const beat of BEATS) {
    await tourTab(page, director, beat);
  }

  // Payoff — desktop runs a local SQLite brain + embedder worker, which is why
  // these four are desktop-only by design.
  const PAYOFF =
    'On the desktop, you get the full brain — memory, skills, schedules, and the gateway, all in one place.';
  await director.caption(PAYOFF);
  await director.hold(voHold(PAYOFF));
  await director.caption();
});
