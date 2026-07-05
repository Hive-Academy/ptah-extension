import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';
import { prewarmThoth } from './_harness/prewarm';

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
 * AUDIO-FIRST: the voiceover script lives in `scripts/thoth-tour.json` and is
 * narrated by `narrate.mjs` BEFORE capture. Each `director.say(i)` speaks line
 * i, holding for the REAL clip duration (durations.json) so narration, captions
 * and footage stay locked — no estimated holds, no silent gaps. Element-
 * targeted says + spotlight/hover auto-emit `shots.json`, punching the camera
 * onto each subject as the VO names it.
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

/** One inner tab of the Thoth shell: its id and a list of candidate hero
 * selectors to spotlight (first visible wins). Its narration line lives in
 * `scripts/thoth-tour.json` at index `TAB_SCRIPT_BASE + position`. */
interface ThothBeat {
  /** Tab/panel id suffix — drives `#thoth-tab-<id>` and `#thoth-panel-<id>`. */
  readonly id: 'memory' | 'skills' | 'cron' | 'gateway';
  /**
   * Ordered hero candidates to spotlight — the first visible one wins. Falls
   * back to the panel's own heading, then the panel root, if none match (these
   * tabs may be sparse on a fresh profile).
   */
  readonly hero: readonly string[];
}

/** The four tabs, in cockpit-pan order, each with its hero candidates. */
const BEATS: readonly ThothBeat[] = [
  {
    id: 'memory',
    hero: [
      '[data-testid="memory-stat-blocks"]',
      '[data-testid="memory-blocks-list"]',
      '[aria-label="Memory statistics"]',
    ],
  },
  {
    id: 'skills',
    hero: [
      '[data-testid="suggestions-card"]',
      '[data-testid="skills-stat-candidates"]',
      '[aria-label="Skill synthesis statistics"]',
    ],
  },
  {
    id: 'cron',
    hero: [
      '[data-testid="cron-job-row"]',
      '[data-testid="cron-stat-total"]',
      '[aria-label="Cron statistics"]',
    ],
  },
  {
    id: 'gateway',
    hero: [
      '[data-testid="gateway-channel-card"]',
      '[data-testid="gateway-stat-total"]',
      '[aria-label="Gateway statistics"]',
    ],
  },
];

/**
 * Script index of the FIRST tab line in `scripts/thoth-tour.json` — the four
 * `BEATS` narrate lines `TAB_SCRIPT_BASE + position` in array order.
 */
const TAB_SCRIPT_BASE = 3;

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
  scriptIndex: number,
): Promise<void> {
  await director.click(page.locator(`#thoth-tab-${beat.id}`));
  const panel = page.locator(`#thoth-panel-${beat.id}`);
  await panel.waitFor({ state: 'visible' });
  // The trial modal can re-assert after a tab switch — keep it out of frame.
  await director.dismissDialogs();

  // Target the panel so the camera frames this tab's surface as the VO names it.
  await director.say(scriptIndex, {
    target: panel,
    during: async () => {
      await director.hold(900);

      // Reveal the full surface with a slow top→bottom→top pan.
      await director.scrollThrough(panel, { steps: 5, dwellMs: 620 });

      // Draw the eye to this tab's hero element (or the panel chrome if sparse).
      const hero = await resolveHero(page, beat, panel);
      await director.spotlight(hero, 1700);

      await director.hold(500);
    },
  });
}

test('P1.2 — desktop Thoth shell (4-tab cockpit tour)', async ({
  page,
  director,
}) => {
  // The persistent authed profile ALWAYS shows the "Pro Trial Has Ended"
  // startup modal — clear it before filming so it stays out of frame.
  await director.dismissDialogs();

  // PRE-WARM (trimmed lead-in, before the first beat): this cockpit pan visits
  // all four Electron-only tabs, each of which pays a SQLite/embedder-backed
  // first-mount cost. Force those mounts now so the per-tab switches in the
  // `tourTab` loop stay snappy between beats instead of stalling on camera.
  // Silent + fully guarded (see prewarm.ts); returns to the starting surface.
  await prewarmThoth(page, ['memory', 'skills', 'cron', 'gateway']).catch(
    () => undefined,
  );

  // HOOK — fire immediately so the video opens on a claim, not dead air.
  await director.say(0);

  // WARMUP — one line of context before the tour starts.
  await director.say(1);

  // Enter the cockpit; the trial modal can re-assert after navigation, so
  // dismiss again before we start panning the tabs.
  await goToThoth(page, director);
  await director.dismissDialogs();
  await director.hold();

  await director.say(2);

  // One confident pan across the four Electron-only tabs — scroll + spotlight.
  for (const [position, beat] of BEATS.entries()) {
    await tourTab(page, director, beat, TAB_SCRIPT_BASE + position);
  }

  // Payoff — desktop runs a local SQLite brain + embedder worker, which is why
  // these four are desktop-only by design.
  await director.say(7);
});
