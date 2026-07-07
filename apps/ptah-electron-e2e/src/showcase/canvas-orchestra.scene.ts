import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * P2.1 — "Run 3 agents at once" (Canvas multi-tile orchestra).
 *
 * The flagship marketing shot: three real agents working concurrently in the
 * Orchestra Canvas, each on its own task, against the real authenticated
 * workspace. This is a SCENE, not a test — it asserts almost nothing and is
 * tuned for how it looks on camera. See `docs/video-content-plan.md` P2.1.
 *
 * AUDIO-FIRST: the voiceover script lives in `scripts/canvas-orchestra.json`
 * and is narrated by `narrate.mjs` BEFORE capture. Each `director.say(i)`
 * speaks line i, holding for the REAL clip duration (durations.json) so
 * narration, captions and footage stay locked — no estimated holds, no silent
 * gaps. Element-targeted says + spotlight/hover auto-emit `shots.json`,
 * punching the camera onto each subject as the VO names it.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored.
 * - No other Ptah instance is running (single-instance lock).
 *
 * Selector note: a few navigation selectors below are best-effort against the
 * live shell. If the Canvas nav chrome changes, adjust `goToCanvas()` — these
 * are the only spots that touch shell navigation rather than the canvas itself.
 */

/** The three tasks the agents run, in tile order. Override via env (`|`-joined). */
const PROMPTS: string[] = (
  process.env['PTAH_SHOWCASE_PROMPTS'] ??
  [
    'Add a concise JSDoc comment to the most complex exported function you can find, then show me the diff.',
    'Find a function missing a unit test and write one focused test for it.',
    'Scan the repo for a TODO or FIXME comment and propose a minimal fix for it.',
  ].join('|')
).split('|');

async function goToCanvas(page: Page, director: Director): Promise<void> {
  // The Canvas (grid) layout is reached from the chat surface's layout toggle.
  // Try a few resilient selectors so the scene survives minor chrome changes.
  const candidates: Locator[] = [
    page.getByRole('tab', { name: 'Canvas' }),
    page.getByRole('button', { name: 'Canvas' }),
    page.locator('[title="Canvas"]'),
    page.locator('[aria-label="Canvas"]'),
    page.locator('[data-testid="layout-toggle-grid"]'),
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
  await page
    .locator('[data-testid="canvas-grid"]')
    .waitFor({ state: 'visible' });
}

async function createTile(
  page: Page,
  director: Director,
  name: string,
): Promise<void> {
  // The "add tile" affordance depends on whether the canvas is empty: the FAB
  // ("Add new session tile") when tiles exist, the empty-state CTA otherwise.
  const fab = page.locator('[title="Add new session tile"]').first();
  if (await fab.isVisible().catch(() => false)) {
    await director.click(fab);
  } else {
    await director.click(
      page.getByRole('button', { name: 'Create new session' }).first(),
    );
  }

  const nameInput = page.locator('input[placeholder*="session name" i]').last();
  await director.type(nameInput, name);
  await director.click(
    page.getByRole('button', { name: 'Create', exact: true }),
  );
}

async function sendPromptToTile(
  director: Director,
  tile: Locator,
  prompt: string,
): Promise<void> {
  const textarea = tile.locator('ptah-chat-input textarea[role="combobox"]');
  await director.type(textarea, prompt);
  await director.click(tile.locator('[data-testid="chat-send-btn"]'));
}

/** True if a locator is present and visible (never throws). */
async function visible(loc: Locator): Promise<boolean> {
  return loc
    .first()
    .isVisible()
    .catch(() => false);
}

/**
 * Close tiles left behind by previous captures. Canvas state persists in the
 * profile, so each run's `agent-N` tiles survive into the next — cluttering the
 * frame and eventually hitting the 9-tile cap, which makes createTile fail.
 * Closes ONLY tiles whose header label matches `agent-<n>` (our own artifacts);
 * anything else on the canvas is left alone. Runs before the hook beat, so the
 * lead-in trim keeps the cleanup out of the final cut.
 */
async function closeStaleAgentTiles(
  page: Page,
  director: Director,
): Promise<void> {
  for (let i = 0; i < 9; i++) {
    const stale = page
      .locator('[data-testid="canvas-tile"]')
      .filter({
        has: page.locator('.tile-header span', { hasText: /^agent-\d+$/ }),
      })
      .first();
    if (!(await visible(stale))) return;
    const close = stale.locator('[title="Close tile"]').first();
    if (!(await visible(close))) return;
    await close.click({ timeout: 5_000 }).catch(() => undefined);
    await director.hold(400);
  }
}

/**
 * Exploration coda for a single tile: pan its conversation, spotlight the
 * stats strip, hover its agent indicator, and toggle compact/full view. Every
 * beat is guarded on visibility so a tile that finished sparse never stalls the
 * scene. Strictly non-destructive — we never touch "Close tile".
 */
async function exploreTile(director: Director, tile: Locator): Promise<void> {
  // Pan the tile's own conversation transcript so the camera reveals the full
  // turn: text, tool calls, and the rendered result.
  const transcript = tile.locator('[data-testid="chat-tool-output"]').first();
  if (await visible(transcript)) {
    await director.scrollThrough(transcript, {
      steps: 5,
      dwellMs: 650,
      andBack: true,
    });
  }

  // Spotlight the live stats strip (Ctx / Tokens / Cost / Time) — proof that
  // every agent's cost is on-screen, not hidden.
  const stats = tile.locator('ptah-session-stats-summary').first();
  if (await visible(stats)) {
    await director.say(0, {
      target: stats,
      during: async () => {
        await director.spotlight(stats, 1800);
      },
    });
  }

  // Hover the per-tile agent indicator (the pulsing status pill) to draw the
  // eye to the live agent state.
  const indicator = tile.locator('ptah-tile-agent-indicator button').first();
  if (await visible(indicator)) {
    await director.hover(indicator, 900);
  }

  // Toggle the tile between full and compact view, then back — a quick,
  // satisfying layout flourish that shows the tiles are real, resizable panes.
  const viewToggle = tile.locator(
    'button[title="Switch to compact view"], button[title="Switch to full view"]',
  );
  if (await visible(viewToggle)) {
    await director.click(viewToggle.first());
    await director.hold(900);
    if (await visible(viewToggle)) {
      await director.click(viewToggle.first());
      await director.hold(700);
    }
  }
}

test('P2.1 — three agents at once (Canvas orchestra)', async ({
  page,
  director,
}) => {
  // Clear any blocking startup modal (license / trial dialog) before filming.
  await director.dismissDialogs();

  // Navigate + clean up BEFORE the first beat: everything until the hook is
  // trimmed by render-all's lead-in trim, so stale-tile closing never airs.
  await goToCanvas(page, director);
  await director.dismissDialogs();
  await closeStaleAgentTiles(page, director);
  await director.hold();

  // HOOK — fire immediately so the video opens on a question, not dead air.
  await director.say(1);

  // WARMUP — one line of context before the orchestra starts.
  await director.say(2);

  const tiles = page.locator('[data-testid="canvas-tile"]');
  // The canvas may restore prior tiles from the profile — drive only the ones
  // we create here so pre-existing tiles don't shift our selectors.
  const startCount = await tiles.count();

  // Spin up three session tiles. The create loop far outlasts the narration,
  // so the line plays fully while the tiles appear.
  await director.say(3, {
    during: async () => {
      for (let i = 0; i < PROMPTS.length; i++) {
        await createTile(page, director, `agent-${i + 1}`);
        await tiles.nth(startCount + i).waitFor({ state: 'visible' });
        await director.hold(500);
      }
    },
  });

  // Hand each tile its own task and fire it off — concurrently.
  await director.say(4, {
    during: async () => {
      for (let i = 0; i < PROMPTS.length; i++) {
        await sendPromptToTile(director, tiles.nth(startCount + i), PROMPTS[i]);
        await director.hold(600);
      }
    },
  });

  // Let the orchestra play. The agent turns take far longer than the VO, so
  // narration covers them while they run.
  await director.say(5, {
    during: async () => {
      await Promise.all(
        PROMPTS.map((_, i) =>
          director.waitForAgentTurn(tiles.nth(startCount + i)),
        ),
      );
    },
  });

  await director.say(6);

  // ── Exploration coda ──────────────────────────────────────────────────────
  // The orchestra has finished. Now give the camera a tour of what just
  // happened: dive into a tile's transcript, surface the per-agent telemetry,
  // flex the layout, and pan the whole grid. Everything here is read-only.

  await director.say(7);

  // Tour each tile we created: scroll its conversation, spotlight its stats,
  // hover its agent indicator, flex compact/full. The targeted say punches the
  // camera onto the tile. Per-agent lines are script indices 10..12 (one per
  // tile position) so each stays a fixed, pre-narrated line instead of an
  // interpolated string.
  for (let i = 0; i < PROMPTS.length; i++) {
    const tile = tiles.nth(startCount + i);
    if (!(await visible(tile))) continue;
    await director.say(10 + i, { target: tile });
    await exploreTile(director, tile);
  }

  // Spotlight the "Lock tiles" control — the layout-freeze affordance that keeps
  // a curated orchestra arrangement put. Non-destructive: spotlight only, no
  // click, so we don't change the grid behaviour mid-shot.
  const lockBtn = page.getByRole('button', { name: 'Lock tiles' }).first();
  if (await visible(lockBtn)) {
    await director.say(8, {
      target: lockBtn,
      during: async () => {
        await director.spotlight(lockBtn, 1800);
      },
    });
  }

  // Final wide pan across the whole grid so the closing frame is the full
  // multi-agent canvas, alive with three concurrent conversations. The pan
  // outlasts the narration.
  await director.say(9, {
    during: async () => {
      await director.scrollThrough(
        page.locator('[data-testid="canvas-grid"]'),
        {
          steps: 6,
          dwellMs: 700,
          andBack: true,
        },
      );
      await director.hold(2200);
    },
  });
});
