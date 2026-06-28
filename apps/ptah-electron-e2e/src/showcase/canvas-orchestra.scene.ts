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
  isFirst: boolean,
): Promise<void> {
  if (isFirst) {
    // Empty-state path: the empty state surfaces a "create session" affordance.
    const emptyCreate = page
      .locator('ptah-canvas-empty-state')
      .getByRole('button')
      .first();
    await director.click(emptyCreate);
  } else {
    // FAB path: floating "Add new session tile" button.
    await director.click(page.locator('[title="Add new session tile"]'));
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

test('P2.1 — three agents at once (Canvas orchestra)', async ({
  page,
  director,
}) => {
  await director.caption('One workspace. Three agents. At once.');
  await director.hold(1600);
  await director.caption();

  await goToCanvas(page, director);
  await director.hold();

  const tiles = page.locator('[data-testid="canvas-tile"]');

  // Spin up three session tiles.
  await director.caption('Spin up three sessions…');
  for (let i = 0; i < PROMPTS.length; i++) {
    await createTile(page, director, `agent-${i + 1}`, i === 0);
    await tiles.nth(i).waitFor({ state: 'visible' });
    await director.hold(500);
  }
  await director.caption();

  // Hand each tile its own task and fire it off — concurrently.
  await director.caption('Give each one a different job…');
  for (let i = 0; i < PROMPTS.length; i++) {
    await sendPromptToTile(director, tiles.nth(i), PROMPTS[i]);
    await director.hold(600);
  }
  await director.caption();

  // Let the orchestra play. Hold on the live multi-agent view while they run.
  await director.caption('…and watch them work in parallel.');
  await Promise.all(
    PROMPTS.map((_, i) => director.waitForAgentTurn(tiles.nth(i))),
  );
  await director.caption();

  await director.caption('Three tasks. One screen. No waiting in line.');
  await director.hold(2600);
  await director.caption();
});
