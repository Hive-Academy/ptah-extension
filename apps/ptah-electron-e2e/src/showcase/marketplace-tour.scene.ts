import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';
import { openConfigSurface } from './_harness/config-menu';

/**
 * P3.x — "One marketplace, every provider" (Marketplace surface tour).
 *
 * A confident browse across the desktop app's routed Marketplace shell: the
 * persistent nav's "Marketplace" group (Overview, Connectors, MCP Servers,
 * Skills & Plugins), opening a live source directly from the nav's "Sources"
 * group to reveal its browse/search surface, then panning the listings. This
 * is a SCENE, not a test — it asserts almost nothing and is tuned for how it
 * looks on camera.
 *
 * AUDIO-FIRST: the voiceover script lives in `scripts/marketplace-tour.json`
 * and is narrated by `narrate.mjs` BEFORE capture. Each `director.say(i)`
 * speaks line i, holding for the REAL clip duration (durations.json) so
 * narration, captions and footage stay locked — no estimated holds, no silent
 * gaps. Element-targeted says + spotlight/hover auto-emit `shots.json`,
 * punching the camera onto each nav item and listing as the VO names it.
 *
 * Everything here is NON-DESTRUCTIVE: we open sources, scroll listings,
 * spotlight nav items and hover into detail. We NEVER click Install, purchase,
 * or download anything, and we never check an install target.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored.
 * - No other Ptah instance is running (single-instance lock).
 *
 * Selector notes (TASK_2026_533, implementation-plan.md C6/C9/C10 — the
 * tabbed hub and its "no Settings-style spec" era are gone; this scene now has
 * one to follow: `specs/config-menu/*.spec.ts` plus the marketplace shell's
 * own specs):
 * - TASK_2026_540 removed the top-nav "Marketplace" tab; the surface opens
 *   from the global configuration menu (`_harness/config-menu.ts`
 *   `openConfigSurface`), same as the Settings and Setup-hub tours.
 * - Shell root: `[data-testid="marketplace-shell"]` (element
 *   `ptah-marketplace-shell`). The header is one slim row (mark + a
 *   `Marketplace / <page>` breadcrumb, `[data-testid="marketplace-breadcrumb"]`)
 *   with NO back button in Electron and NO `<h1>` — each page renders its own.
 * - The persistent nav (`[data-testid="marketplace-nav"]`) replaces the old
 *   section-tab strip. Every item is a direct `routerLink` carrying
 *   `[data-nav-id]`: the "Marketplace" group (`overview`, `connectors`,
 *   `servers`, `skills`) lists what the user has, and the "Sources" group
 *   (`smithery`, `registry`, `custom-url`, `ptah-plugins`, `community`,
 *   `marketplaces`) opens a discovery surface in ONE click — there is no more
 *   tab-then-chip sequence.
 * - Live MCP/Skills surfaces (`ptah-mcp-directory-browser`,
 *   `ptah-skill-sh-browser`) still expose a search input ("Search MCP
 *   servers..." / "Search skills..."); their own restyle is a later batch
 *   (implementation-plan.md C13), so these selectors are unchanged for now.
 *   Both still carry a Browse/Installed tab strip in THIS base too — plan
 *   C11 removes it from each (Batch 22 for `ptah-mcp-directory-browser`,
 *   Batch 23 for `ptah-skill-sh-browser`: browse results become
 *   `ptah-catalog-card`s, and installed skills move to the Marketplace's own
 *   Installed skills page — `skills` nav item,
 *   `InstalledSkillsPageComponent` — not this browser). This scene never
 *   clicks either tab strip: it only opens a source's default (Browse) view
 *   through the nav link and scrolls/hovers the listings that are already
 *   showing, so nothing here needs to change when Batches 22/23 land.
 */

/** One stop on the tour: the `data-nav-id` of a Sources-group nav link. */
interface TourStop {
  /** `data-nav-id` of the nav link to open (see `marketplace-nav.component.ts`). */
  readonly navId: string;
}

/**
 * Sources to open in tour order. Script lines 3..4 in
 * `scripts/marketplace-tour.json` narrate them — one line per stop, same
 * order: line 3 is the official MCP registry, line 4 is community skills.
 */
const TOUR_STOPS: readonly TourStop[] = [
  { navId: 'registry' },
  { navId: 'community' },
];

/** Script index of the first source line in `scripts/marketplace-tour.json`. */
const SOURCE_SCRIPT_BASE = 3;

/** Script index of the closing line. */
const CLOSER_SCRIPT_INDEX = 7;

/** The shell root — every nav lookup hangs off this. */
function shell(page: Page): Locator {
  return page.locator('[data-testid="marketplace-shell"]');
}

/** The shell's own nav, scoped so a future stray `[data-nav-id]` elsewhere never matches. */
function nav(page: Page): Locator {
  return shell(page).locator('[data-testid="marketplace-nav"]');
}

/**
 * Enter the Marketplace surface through the global configuration menu, then
 * wait for the shell root to mount so callers can drive its nav.
 */
async function goToMarketplace(page: Page, director: Director): Promise<void> {
  await openConfigSurface(page, director, 'marketplace');
  await shell(page)
    .waitFor({ state: 'visible' })
    .catch(() => undefined);
}

/**
 * Tour the nav's "Marketplace" group: spotlight each item so the eye lands on
 * the whole shelf before the tour drills into one source.
 */
async function tourSections(page: Page, director: Director): Promise<void> {
  await director.say(2);

  for (const navId of ['overview', 'connectors', 'servers', 'skills']) {
    const item = nav(page).locator(`[data-nav-id="${navId}"]`).first();
    if (await item.isVisible().catch(() => false)) {
      await director.spotlight(item, 1200);
      await director.hover(item, 500);
    }
  }
}

/**
 * Open one source: click its nav link directly, reveal the browse surface and
 * pan the listings. Strictly NON-DESTRUCTIVE — no Install click.
 *
 * Unlike the old tab-then-chip sequence, the Sources group's nav links go
 * straight to the source page — one click, no intermediate section switch.
 */
async function tourSource(
  page: Page,
  director: Director,
  stop: TourStop,
  scriptIndex: number,
): Promise<void> {
  const link = nav(page).locator(`[data-nav-id="${stop.navId}"]`).first();
  if (!(await link.isVisible().catch(() => false))) return;

  // The nav click + populate hold + spotlight + scroll all run inside
  // `during`; say() keeps holding until the narration clip has finished.
  await director.say(scriptIndex, {
    target: link,
    during: async () => {
      await director.click(link);

      // The selected surface mounts as the source page's one reused surface;
      // give it a beat to populate from the network, then pan its listings.
      // The two live surfaces share a Browse search box + a results list, so
      // scrolling the content area reveals the catalogue.
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
      // `<main data-testid="marketplace-content">` is the shell's scroll
      // owner (plan C6), the direct equivalent of the old hub root scroll.
      await director.scrollThrough(
        shell(page).locator('[data-testid="marketplace-content"]'),
        { steps: 5, dwellMs: 700, andBack: true },
      );
    },
  });

  // Hover the first listing row to draw attention to an item's detail, without
  // clicking the Install button next to it. Script line 5 is shared by every
  // stop — the same clip replays for each one.
  //
  // Selector note (code-style-review-batch-19.md minor #1): `.rounded-lg.
  // border` is a CSS-class selector, not a stable attribute, and the Batch
  // 20-23 restyle this file already calls out (line ~53 above) as upcoming
  // WILL change it. Checked both live source components for something more
  // stable before keeping this: neither `mcp-directory-browser.component.ts`
  // (browse row, :138-139) nor `skill-sh-browser.component.ts` (browse row,
  // :130,229) carries a `data-testid` or `role="listitem"` on this row today
  // — the only existing testid near it, `installed-row`
  // (`mcp-directory-browser.component.ts:314`), belongs to the INSTALLED
  // tab/view, not Browse (wrong list), and plan C11 (Batch 22) deletes that
  // view outright, so anchoring to it would be both wrong now and gone soon.
  // Adding one would mean editing those two product files, out of scope for
  // this batch ("test and showcase code only"; explicit "do not change
  // product code" on this revision round). Left as `.rounded-lg.border`,
  // scoped to the shell as before — it already degrades safely
  // (`isVisible().catch(() => false)` below skips this beat, never throws),
  // so the worst case of the restyle landing is a silently skipped hover
  // beat, not a broken scene. Batches 20-23 introduce `ptah-catalog-card`
  // (plan C13) for exactly this row; that component already needs a stable
  // hook for ITS OWN specs, so picking up a `data-testid` there — and
  // pointing this line at it — is the natural fix, not a new addition made
  // solely for this scene.
  const firstRow = shell(page).locator('.rounded-lg.border').first();
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
  // Entering the shell here forces its network-populated first-mount, so no
  // separate pre-warm is needed.
  await goToMarketplace(page, director);
  await director.hold();

  // HOOK — fire immediately so the video opens on a question, not dead air.
  await director.say(0);

  // WARMUP — one line of context before the tour starts.
  await director.say(1);

  // Full tour of the nav's "Marketplace" group.
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
