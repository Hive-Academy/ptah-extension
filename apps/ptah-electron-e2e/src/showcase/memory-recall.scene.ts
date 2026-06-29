import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * P3.1 — "Ptah remembers (persistent memory)".
 *
 * A DEEP dive on the Memory tab — Ptah's persistent SQLite brain inside the
 * Thoth shell. Unlike the Path-1 teasers, this scene lingers: it tours a real,
 * populated memory list, runs a hybrid (BM25 + vector) search against the local
 * index, browses a filtered result, and lets each beat breathe so a viewer can
 * actually read what's stored. This is a SCENE, not a test — it asserts almost
 * nothing and is tuned for how it looks on camera. See `docs/video-content-plan.md` P3.1.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored.
 * - The persistent profile already holds real curated memories, so the Memory
 *   list and tier-count stats are populated on camera (we still guard for empty).
 * - No other Ptah instance is running (single-instance lock).
 *
 * Selector note: every selector below is verified against the live app —
 * `memory-curator-ui` component templates (search input, entry rows, stat
 * tiles) and the Thoth shell's `#thoth-tab-*` / `#thoth-panel-*` ids. If the
 * Memory tab chrome changes, the helpers `goToMemory()` and the testid
 * constants below are the only spots to adjust.
 */

/**
 * The search query typed into the Memory hybrid-search box. Chosen to match the
 * kind of architectural facts Ptah curates about this monorepo; override via env
 * to film a different recall against a different seeded profile.
 */
const MEMORY_QUERY: string =
  process.env['PTAH_SHOWCASE_MEMORY_QUERY'] ?? 'architecture';

/** Live, verified selectors from `libs/frontend/memory-curator-ui`. */
const SEL = {
  /** `<input data-testid="memory-search-input">` in memory-search-bar.component. */
  searchInput: '[data-testid="memory-search-input"]',
  /** `<li data-testid="memory-entry-row">` in memory-entry-list.component. */
  entryRow: '[data-testid="memory-entry-row"]',
  /** Tier-count stat tiles in memory-stats-strip.component. */
  statCore: '[data-testid="memory-stat-core"]',
  statRecall: '[data-testid="memory-stat-recall"]',
  statArchival: '[data-testid="memory-stat-archival"]',
} as const;

/**
 * Navigate from wherever the shell opens into the Thoth → Memory tab and wait
 * for its panel to render. Dismisses the persistent "trial ended" startup modal
 * both on the way in and again once inside, since it can re-assert after a
 * navigation. Best-effort selectors so the scene survives minor chrome changes.
 */
async function goToMemory(page: Page, director: Director): Promise<void> {
  // Enter the desktop "cockpit" (Thoth shell) via the top nav tab.
  const thothTab = page.getByRole('tab', { name: 'Thoth' });
  if (
    await thothTab
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    await director.click(thothTab.first());
  }
  // The trial modal frequently re-appears after entering Thoth — clear it.
  await director.dismissDialogs();

  // Open the Memory inner tab and wait for its panel.
  const memoryTab = page.locator('#thoth-tab-memory');
  await memoryTab.waitFor({ state: 'visible' });
  await director.click(memoryTab);
  await page.locator('#thoth-panel-memory').waitFor({ state: 'visible' });
  await director.dismissDialogs();
}

/**
 * Return the first visible memory entry row, or `null` if the (real) profile
 * happens to be empty. Lets the scene degrade gracefully instead of throwing.
 */
async function firstVisibleEntry(page: Page): Promise<Locator | null> {
  const rows = page.locator(SEL.entryRow);
  const first = rows.first();
  const visible = await first.isVisible().catch(() => false);
  return visible ? first : null;
}

/**
 * Spotlight one tier-count stat tile with a caption, if it is on screen. The
 * stat strip lives in `memory-stats-strip.component`; each tile is a testid'd
 * element so we draw the glowing ring straight onto it. Best-effort: a missing
 * tile (older chrome / empty profile) is skipped, never thrown.
 */
async function spotlightStat(
  page: Page,
  director: Director,
  selector: string,
  caption: string,
): Promise<void> {
  const tile = page.locator(selector).first();
  if (!(await tile.isVisible().catch(() => false))) return;
  await director.caption(caption);
  await director.spotlight(tile, 2000);
  await director.caption();
}

test('P3.1 — Ptah remembers (persistent memory)', async ({
  page,
  director,
}) => {
  // Clear the persistent "Your Pro Trial Has Ended" startup modal before filming.
  await director.dismissDialogs();

  // Hook beat.
  await director.caption('Teach it once. It remembers.');
  await director.hold(1800);
  await director.caption();

  // Into the persistent brain.
  await goToMemory(page, director);
  await director.hold();

  // Orient on the live, populated memory list + tier stats.
  await director.caption(
    'A persistent local brain — facts and decisions, saved across every session.',
  );
  await director.hold(2200);
  await director.caption();

  // Tour the tier-count stat strip — three glowing spotlights, one per tier,
  // so the numbers and the memory hierarchy read clearly on camera.
  await spotlightStat(
    page,
    director,
    SEL.statCore,
    'Core — the always-on facts it never forgets.',
  );
  await spotlightStat(
    page,
    director,
    SEL.statRecall,
    'Recall — recent, working memory it can pull back fast.',
  );
  await spotlightStat(
    page,
    director,
    SEL.statArchival,
    'Archival — the deep, long-term store, searchable on demand.',
  );

  // Slowly pan the populated entry list so the camera reveals everything
  // Thoth has curated, then settle back at the top.
  const seedEntry = await firstVisibleEntry(page);
  if (seedEntry) {
    await director.caption('Everything Thoth has learned, in one place.');
    await director.scrollThrough(seedEntry, {
      steps: 7,
      dwellMs: 750,
      andBack: true,
    });
    await director.caption();

    // Hover the first row to surface its inline affordances (pin, tier badge).
    await director.caption(
      'Hover any memory — pin it, see its tier, why it stuck.',
    );
    await director.hover(seedEntry, 2200);
    await director.caption();
  }

  // The payoff move: hybrid search against the local index.
  await director.caption('Ask it what it knows…');
  const searchBox = page.locator(SEL.searchInput).first();
  await searchBox.waitFor({ state: 'visible' });
  await director.type(searchBox, MEMORY_QUERY);
  await director.hold(700);
  await director.caption();

  // Hold on the filtered, debounced results (search debounces at ~300ms).
  await director.hold(900);
  await director.caption(
    'Hybrid search — BM25 + vector — over its own memory.',
  );
  await director.hold(2400);
  await director.caption();

  // Browse the matched results: scroll the filtered list, then dwell on the
  // top hit so the stored subject + content read on camera.
  const hit = await firstVisibleEntry(page);
  if (hit) {
    await director.caption(
      'Open any memory — the fact, its tier, why it stuck.',
    );
    await director.scrollThrough(hit, {
      steps: 4,
      dwellMs: 700,
      andBack: true,
    });
    await director.moveTo(hit);
    await director.hold(2600);
    await director.caption();
  } else {
    // Real-profile guard: if the query matched nothing, narrate the empty state
    // rather than reaching for a row that isn't there.
    await director.caption(
      'Nothing stored for that yet — it learns as you work.',
    );
    await director.hold(2000);
    await director.caption();
  }

  // Payoff beat.
  await director.caption('One brain, remembered across every session.');
  await director.hold(2800);
  await director.caption();
});
