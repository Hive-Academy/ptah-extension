import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';
import { openConfigSurface } from './_harness/config-menu';

/**
 * P3.x — "One marketplace, every provider" (Marketplace surface tour).
 *
 * A confident browse across the desktop app's Marketplace hub: the three
 * sections (Connected, Apps, Skills), opening a live source to reveal its
 * browse/search surface, then panning the listings. This is a SCENE, not a
 * test — it asserts almost nothing and is tuned for how it looks on camera.
 *
 * AUDIO-FIRST: the voiceover script lives in `scripts/marketplace-tour.json`
 * and is narrated by `narrate.mjs` BEFORE capture. Each `director.say(i)`
 * speaks line i, holding for the REAL clip duration (durations.json) so
 * narration, captions and footage stay locked — no estimated holds, no silent
 * gaps. Element-targeted says + spotlight/hover auto-emit `shots.json`,
 * punching the camera onto each section and listing as the VO names it.
 *
 * Everything here is NON-DESTRUCTIVE: we open sources, scroll listings,
 * spotlight chips and hover into detail. We NEVER click Install, purchase, or
 * download anything, and we never check an install target.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored.
 * - No other Ptah instance is running (single-instance lock).
 *
 * Selector notes (no Settings-style spec exists for Marketplace — these were
 * discovered from `libs/frontend/marketplace` + `chat-ui` setup-plugins):
 * - The global configuration menu opens the Marketplace surface.
 * - Hub root: `ptah-marketplace-hub`. Since TASK_2026_524 the seven-tile
 *   provider grid is gone: the hub renders a `NativeTabGroupComponent` section
 *   strip (`role="tab"`, labels `Connected` / `Apps` / `Skills`) over a chip
 *   strip of plain buttons carrying `data-source-id`. Every section-scoped
 *   lookup below is therefore anchored to `ptah-marketplace-hub`, because the
 *   shell's own nav is a tablist too. There is no "Back to providers" button
 *   any more — switching sections is a single tab click.
 * - Live MCP/Skills surfaces (`ptah-mcp-directory-browser`,
 *   `ptah-skill-sh-browser`) expose a Browse/Installed tab pair and a search
 *   input ("Search MCP servers..." / "Search skills...").
 */

/** One stop on the tour: a section tab plus the chip to open inside it. */
interface TourStop {
  /** Visible label of the section tab in the hub's strip. */
  readonly section: string;
  /** `data-source-id` of the chip to open inside that section. */
  readonly sourceId: string;
}

/**
 * Sources to open in tour order. Script lines 3..4 in
 * `scripts/marketplace-tour.json` narrate them — one line per stop, same
 * order: line 3 is the official MCP registry, line 4 is community skills.
 */
const TOUR_STOPS: readonly TourStop[] = [
  { section: 'Apps', sourceId: 'mcp-registry' },
  { section: 'Skills', sourceId: 'community' },
];

/** Script index of the first source line in `scripts/marketplace-tour.json`. */
const SOURCE_SCRIPT_BASE = 3;

/** Script index of the closing line. */
const CLOSER_SCRIPT_INDEX = 7;

/** The hub root — every section/chip lookup hangs off this. */
function hub(page: Page): Locator {
  return page.locator('ptah-marketplace-hub');
}

/**
 * Enter Marketplace through the global configuration menu, then wait for the
 * hub root to mount so callers can inspect which surface (sections vs. gate) rendered.
 */
async function goToMarketplace(page: Page, director: Director): Promise<void> {
  await openConfigSurface(page, director, 'marketplace');
  await hub(page)
    .waitFor({ state: 'visible' })
    .catch(() => undefined);
}

/**
 * Tour the section strip: spotlight each of the three tabs so the eye lands on
 * the whole shelf before the tour drills into one source.
 */
async function tourSections(page: Page, director: Director): Promise<void> {
  await director.say(2);

  for (const section of ['Connected', 'Apps', 'Skills']) {
    const tab = hub(page).getByRole('tab', { name: section }).first();
    if (await tab.isVisible().catch(() => false)) {
      await director.spotlight(tab, 1200);
      await director.hover(tab, 500);
    }
  }
}

/**
 * Open one source: select its section tab, click its chip, reveal the browse
 * surface and pan the listings. Strictly NON-DESTRUCTIVE — no Install click.
 *
 * Unlike the old provider grid there is no way back out to an overview, and
 * none is needed: the next stop selects its own section tab.
 */
async function tourSource(
  page: Page,
  director: Director,
  stop: TourStop,
  scriptIndex: number,
): Promise<void> {
  const tab = hub(page).getByRole('tab', { name: stop.section }).first();
  if (!(await tab.isVisible().catch(() => false))) return;

  // The section click + chip click + populate hold + spotlight + scroll all run
  // inside `during`; say() keeps holding until the narration clip has finished.
  await director.say(scriptIndex, {
    target: tab,
    during: async () => {
      await director.click(tab);
      await director.hold(400);

      const chip = hub(page)
        .locator(`[data-source-id="${stop.sourceId}"]`)
        .first();
      if (await chip.isVisible().catch(() => false)) {
        await director.click(chip);
      }

      // The selected surface mounts inside the hub; give it a beat to populate
      // from the network, then pan its listings. The two live surfaces share a
      // Browse search box + a results list, so scrolling the hub reveals the
      // catalogue.
      await director.hold(1400);

      const search = page
        .locator(
          'input[placeholder="Search MCP servers..."], input[placeholder="Search skills..."]',
        )
        .first();
      if (await search.isVisible().catch(() => false)) {
        await director.spotlight(search, 1100);
      }

      // Reveal the listings — these run well past the viewport once loaded.
      await director.scrollThrough(hub(page), {
        steps: 5,
        dwellMs: 700,
        andBack: true,
      });
    },
  });

  // Hover the first listing row to draw attention to an item's detail, without
  // clicking the Install button next to it. Script line 5 is shared by every
  // stop — the same clip replays for each one.
  const firstRow = hub(page).locator('.rounded-lg.border').first();
  if (await firstRow.isVisible().catch(() => false)) {
    await director.say(5, {
      target: firstRow,
      during: async () => {
        await director.spotlight(firstRow, 1400);
        await director.hover(firstRow, 700);
      },
    });
  }

  await director.hold(700);
}

test('P3 — marketplace surface tour (sections, browse & detail)', async ({
  page,
  director,
}) => {
  // Navigate + clean up BEFORE the first beat: everything until the hook is
  // trimmed by render-all's lead-in trim, so this surface swap never airs — and
  // the hook lands on the Marketplace instead of the stale restored surface.
  // Entering the hub here forces its network-populated first-mount, so no
  // separate pre-warm is needed.
  await goToMarketplace(page, director);
  await director.hold();

  // HOOK — fire immediately so the video opens on a question, not dead air.
  await director.say(0);

  // WARMUP — one line of context before the tour starts.
  await director.say(1);

  // Full tour of the three sections.
  await tourSections(page, director);

  for (const [i, stop] of TOUR_STOPS.entries()) {
    await tourSource(page, director, stop, SOURCE_SCRIPT_BASE + i);
  }

  // The "and even more providers are landing soon" beat is gone with the
  // Composio coming-soon tile it pointed at (TASK_2026_524 D1). Its line was
  // dropped from the script rather than left narrating dead footage, so the
  // closer moved up one index — see the header note in
  // `scripts/marketplace-tour.json`.
  await director.say(CLOSER_SCRIPT_INDEX, { breathMs: 950 });
});
