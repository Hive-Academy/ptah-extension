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
 * Captions double as the VOICEOVER SCRIPT (`narrate.mjs --source beats`), so
 * they are spoken prose and caption-only beats hold via `voHold` (~65ms/char)
 * so narration finishes before the next beat. Element-targeted captions +
 * spotlight/hover auto-emit `shots.json`, punching the camera onto each subject.
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

/**
 * Hold long enough for the narration of `text` to finish before the next beat
 * starts (~65ms/char + settle), minus time already spent in interactions that
 * run between this beat and the next. Captions double as the VO script
 * (`narrate.mjs --source beats`), so this prevents audio overlap.
 */
function voHold(text: string, alreadySpentMs = 0): number {
  return Math.max(600, Math.round(text.length * 65) + 500 - alreadySpentMs);
}

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
  // Targeted caption punches the camera onto the tile as the VO names the tier.
  await director.caption(caption, tile);
  await director.spotlight(tile, 2000);
  // spotlight(2000 + 180 settle) already spent ~2.2s of this beat's narration.
  await director.hold(voHold(caption, 2180));
  await director.caption();
}

test('P3.1 — Ptah remembers (persistent memory)', async ({
  page,
  director,
}) => {
  // Clear the persistent "Your Pro Trial Has Ended" startup modal before filming.
  await director.dismissDialogs();

  // HOOK — fire immediately so the video opens on a question, not dead air.
  const HOOK =
    'How many times have you explained the same codebase to an AI that forgot you by the next session?';
  await director.caption(HOOK);
  await director.hold(voHold(HOOK));
  await director.caption();

  // WARMUP — one line of context before the memory tour starts.
  const WARMUP =
    'Ptah is different — it ships with a persistent memory, and you are about to see inside it.';
  await director.caption(WARMUP);
  await director.hold(voHold(WARMUP));
  await director.caption();

  // Into the persistent brain.
  await goToMemory(page, director);
  await director.hold();

  // Orient on the live, populated memory list + tier stats.
  const BRAIN =
    'Everything it learns stays with you — facts and decisions, saved in a local brain and carried across every session.';
  await director.caption(BRAIN);
  await director.hold(voHold(BRAIN));
  await director.caption();

  // Tour the tier-count stat strip — three glowing spotlights, one per tier,
  // so the numbers and the memory hierarchy read clearly on camera.
  await spotlightStat(
    page,
    director,
    SEL.statCore,
    'Core is what it never forgets — the always-on facts about you and your project.',
  );
  await spotlightStat(
    page,
    director,
    SEL.statRecall,
    'Recall is its working memory — recent context it can pull back for you in an instant.',
  );
  await spotlightStat(
    page,
    director,
    SEL.statArchival,
    'And Archival is the deep, long-term store — nothing is lost, and all of it is searchable.',
  );

  // Slowly pan the populated entry list so the camera reveals everything
  // Thoth has curated, then settle back at the top.
  const seedEntry = await firstVisibleEntry(page);
  if (seedEntry) {
    // The scrollThrough (7 steps × 750ms × down-and-back) far outlasts the
    // narration, so the caption plays fully during it — no voHold needed.
    await director.caption(
      'Every lesson it has learned about your work, gathered in one place you can actually read.',
      seedEntry,
    );
    await director.scrollThrough(seedEntry, {
      steps: 7,
      dwellMs: 750,
      andBack: true,
    });
    await director.caption();

    // Hover the first row to surface its inline affordances (pin, tier badge).
    const HOVER =
      'And you stay in control — hover any memory to pin it, check its tier, and see why it stuck.';
    await director.caption(HOVER, seedEntry);
    await director.hover(seedEntry, 2200);
    // hover(2200 + 180 settle) already covered ~2.4s of the narration.
    await director.hold(voHold(HOVER, 2380));
    await director.caption();
  }

  // The payoff move: hybrid search against the local index. The type loop and
  // debounce wait that follow cover this caption's narration, so a short hold
  // is enough here — the interaction itself plays it out.
  const searchBox = page.locator(SEL.searchInput).first();
  await searchBox.waitFor({ state: 'visible' });
  await director.caption('So go ahead — ask it what it knows.', searchBox);
  await director.type(searchBox, MEMORY_QUERY);
  await director.hold(700);
  await director.caption();

  // Hold on the filtered, debounced results (search debounces at ~300ms).
  await director.hold(900);
  const HYBRID =
    'It finds the right memory even when your words do not match — keyword and meaning, searched together.';
  await director.caption(HYBRID);
  await director.hold(voHold(HYBRID));
  await director.caption();

  // Browse the matched results: scroll the filtered list, then dwell on the
  // top hit so the stored subject + content read on camera.
  const hit = await firstVisibleEntry(page);
  if (hit) {
    // The scrollThrough plus the moveTo + long hold that follow outlast the
    // narration, so the caption plays fully across them — no voHold needed.
    await director.caption(
      'And every hit gives you the fact itself, its tier, and exactly why it was worth keeping.',
      hit,
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
    const EMPTY =
      'Nothing stored for that just yet — but it learns more with every session you run.';
    await director.caption(EMPTY);
    await director.hold(voHold(EMPTY));
    await director.caption();
  }

  // Payoff beat.
  const OUTRO =
    'So explain your codebase once. Ptah remembers — this session, the next one, and every one after that.';
  await director.caption(OUTRO);
  await director.hold(voHold(OUTRO) + 600);
  await director.caption();
});
