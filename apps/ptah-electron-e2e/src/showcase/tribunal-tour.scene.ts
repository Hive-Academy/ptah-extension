import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * Tribunal Tour — "a panel of rival models" (multi-vendor peer panel).
 *
 * A marketing SCENE, not a test. It pans the Tribunal surface — the place where
 * different AI vendors (Claude, Codex, Copilot, Kimi, GLM, …) sit on ONE panel
 * and either debate (COUNCIL), build competing implementations (FORGE), or race
 * (RACE). We reveal the convene flow, the move picker, and the panel-assembly
 * step, then dwell on the affordances. See `docs/video-content-plan.md`.
 *
 * STRICTLY NON-DESTRUCTIVE: this tour NEVER launches a tribunal run. Convening a
 * panel spins up real, paid multi-vendor agents, so we walk up to the edge —
 * picking a move, previewing the panel — and stop before "Open Tribunal".
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored.
 * - No other Ptah instance is running (single-instance lock).
 *
 * Selector note: discovered from `libs/frontend/tribunal-panel`. The surface
 * uses `data-testid` hooks throughout (tribunal-grid, tribunal-wizard,
 * tribunal-step-pick-move, tribunal-step-panel-preview, …) plus stable
 * aria-labels on the convene CTA and move cards.
 */

/** Pick the first visible locator from a list, or null if none are on screen. */
async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const c of candidates) {
    const loc = c.first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return null;
}

async function goToTribunal(page: Page, director: Director): Promise<void> {
  // Tribunal lives in the global navbar as a top-level tab in Electron.
  const tab = await firstVisible([
    page.getByRole('tab', { name: 'Tribunal' }),
    page.getByRole('button', { name: 'Tribunal' }),
    page.locator('[aria-label="Tribunal"]'),
    page.locator('[title*="Tribunal" i]'),
  ]);
  if (tab) await director.click(tab);

  // The surface root is always present once the view mounts (empty state,
  // wizard, or a live run all live inside this container).
  await page
    .locator('[data-testid="tribunal-grid"]')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => undefined);
}

test('Tribunal — a panel of rival models', async ({ page, director }) => {
  // Clear any blocking startup modal (license / trial dialog) before filming.
  await director.dismissDialogs();

  await director.caption('What if your AI models disagreed — on purpose?');
  await director.hold(1800);
  await director.caption();

  await goToTribunal(page, director);
  await director.dismissDialogs();
  await director.hold();

  const grid = page.locator('[data-testid="tribunal-grid"]').first();

  // --- Establish the surface ---------------------------------------------
  await director.caption('The Tribunal — one panel, many vendors.');
  await director.scrollThrough(grid, { steps: 4, dwellMs: 650, andBack: true });
  await director.caption();

  // If a previous run left tiles on screen, narrate the live panel layout
  // (conductor + panelist lanes) instead of the convene flow, and exit.
  const liveTopBar = page.locator('[data-testid="tribunal-top-bar"]').first();
  if (await liveTopBar.isVisible().catch(() => false)) {
    await director.caption('A conductor, and a row of rival panelists.');
    const conductor = page
      .locator('[data-testid="tribunal-conductor-pane"]')
      .first();
    if (await conductor.isVisible().catch(() => false)) {
      await director.spotlight(conductor, 1700);
    }
    const tiles = page.locator('[data-testid="tribunal-tile"]');
    const tileCount = await tiles.count();
    for (let i = 0; i < Math.min(tileCount, 3); i++) {
      await director.hover(tiles.nth(i), 700);
    }
    await director.caption();

    const lockToggle = page
      .locator('[data-testid="tribunal-lock-toggle"]')
      .first();
    if (await lockToggle.isVisible().catch(() => false)) {
      await director.caption('Lock the layout, or rearrange the bench.');
      await director.spotlight(lockToggle, 1500);
      await director.caption();
    }

    await director.caption('Debate. Forge. Race. Pick your weapon.');
    await director.hold(2400);
    await director.caption();
    return;
  }

  // --- Empty state: the convene pitch ------------------------------------
  await director.caption('Council for a verdict. Forge for code. Race to win.');
  await director.hold(1600);

  const conveneCta = await firstVisible([
    page.getByRole('button', { name: 'Convene a Tribunal' }),
    page.locator('[aria-label="Convene a Tribunal"]'),
  ]);
  if (!conveneCta) {
    // Surface is gated or unexpectedly empty — pan what's visible and bow out.
    await director.caption('Put your rival models on one bench.');
    await director.scrollThrough(grid, { steps: 3, dwellMs: 700 });
    await director.caption();
    await director.hold(1500);
    return;
  }

  await director.caption('Convene the panel.');
  await director.spotlight(conveneCta, 1400);
  await director.click(conveneCta);
  await director.dismissDialogs();
  await director.hold();

  // --- Step 0: pick a move -----------------------------------------------
  const wizard = page.locator('[data-testid="tribunal-wizard"]').first();
  await wizard
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => undefined);

  await director.caption('Three moves. Three ways to settle it.');
  const pickMove = page
    .locator('[data-testid="tribunal-step-pick-move"]')
    .first();
  if (await pickMove.isVisible().catch(() => false)) {
    await director.spotlight(pickMove, 1500);
  }
  await director.caption();

  // Hover each move card so the viewer reads the descriptions, then pick FORGE
  // for a punchier story (competing implementations across worktrees).
  const moveCards: Array<{ label: string; line: string }> = [
    {
      label: 'Council',
      line: 'Council — every vendor weighs in, one cited verdict.',
    },
    { label: 'Forge', line: 'Forge — each model codes in its own worktree.' },
    { label: 'Race', line: 'Race — they compete; a rubric crowns the winner.' },
  ];
  for (const { label, line } of moveCards) {
    const card = page.getByRole('button', { name: label }).first();
    if (await card.isVisible().catch(() => false)) {
      await director.caption(line);
      await director.hover(card, 850);
    }
  }
  await director.caption();

  const forgeCard = page.getByRole('button', { name: 'Forge' }).first();
  if (await forgeCard.isVisible().catch(() => false)) {
    await director.caption('Send them to the Forge.');
    await director.click(forgeCard);
    await director.hold();
    await director.caption();
  }

  // Advance to the panel-assembly step.
  const nextBtn = page.getByRole('button', { name: 'Next step' }).first();
  if (await nextBtn.isVisible().catch(() => false)) {
    await director.click(nextBtn);
    await director.dismissDialogs();
    await director.hold();
  }

  // --- Step 1: assemble the panel ----------------------------------------
  const panelStep = page
    .locator('[data-testid="tribunal-step-panel-preview"]')
    .first();
  if (await panelStep.isVisible().catch(() => false)) {
    await director.caption('Assemble the bench — a model per lane.');
    await director.spotlight(panelStep, 1600);

    // Hover a couple of discovered vendor lanes (the "Add" buttons), without
    // committing the panel — purely a reveal of who can sit on the panel.
    const addButtons = page.locator(
      '[data-testid="tribunal-step-panel-preview"] button[aria-label^="Add "]',
    );
    const addCount = await addButtons.count();
    for (let i = 0; i < Math.min(addCount, 3); i++) {
      await director.hover(addButtons.nth(i), 750);
    }
    await director.caption();

    await director.caption('Effort, model, turn estimate — all up front.');
    await director.scrollThrough(panelStep, { steps: 3, dwellMs: 650 });
    await director.caption();
  }

  // STOP before "Open Tribunal" — convening would launch real paid vendors.
  await director.caption(
    'A panel of rival models. Disagreement is the signal.',
  );
  await director.hold(2600);
  await director.caption();
});
