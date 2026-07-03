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
 * Captions double as the VOICEOVER SCRIPT (`narrate.mjs --source beats`), so they
 * are spoken prose; element-targeted captions + spotlight/hover auto-emit
 * `shots.json`, punching the camera onto each subject.
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

/**
 * Hold long enough for the narration of `text` to finish before the next beat
 * starts (~65ms/char + settle), minus time already spent in interactions that
 * run between this beat and the next. Captions double as the VO script
 * (`narrate.mjs --source beats`), so this prevents audio overlap.
 */
function voHold(text: string, alreadySpentMs = 0): number {
  return Math.max(600, Math.round(text.length * 65) + 500 - alreadySpentMs);
}

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

  const OPENING = 'What if your AI models disagreed — on purpose?';
  await director.caption(OPENING);
  await director.hold(voHold(OPENING));
  await director.caption();

  // WARMUP — one line of context before the tour starts.
  const WARMUP =
    'Inside Ptah, there is a room built for exactly that. It is called the Tribunal. Let me show you how it works.';
  await director.caption(WARMUP);
  await director.hold(voHold(WARMUP));
  await director.caption();

  await goToTribunal(page, director);
  await director.dismissDialogs();
  await director.hold();

  const grid = page.locator('[data-testid="tribunal-grid"]').first();

  // --- Establish the surface ---------------------------------------------
  // scrollThrough below runs longer than the VO — interaction-covered.
  const SURFACE =
    'Here they sit — rival vendors on one bench, ready to check each other, so you do not have to.';
  await director.caption(SURFACE, grid);
  await director.scrollThrough(grid, { steps: 4, dwellMs: 650, andBack: true });
  await director.caption();

  // If a previous run left tiles on screen, narrate the live panel layout
  // (conductor + panelist lanes) instead of the convene flow, and exit.
  const liveTopBar = page.locator('[data-testid="tribunal-top-bar"]').first();
  if (await liveTopBar.isVisible().catch(() => false)) {
    // Spotlight + hover loop below outlast the VO — interaction-covered.
    await director.caption(
      'You get one conductor keeping order, and a whole row of rival panelists lined up beside it.',
      liveTopBar,
    );
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
      // spotlight below outlasts the VO — interaction-covered.
      await director.caption(
        'The bench is yours to arrange — lock the layout in place, or shuffle it however you like.',
        lockToggle,
      );
      await director.spotlight(lockToggle, 1500);
      await director.caption();
    }

    const WEAPON = 'Debate. Forge. Race. You pick the weapon.';
    await director.caption(WEAPON);
    await director.hold(voHold(WEAPON));
    await director.caption();
    return;
  }

  // --- Empty state: the convene pitch ------------------------------------
  // A caption-only pitch — hold for the full narration before we convene.
  const PITCH =
    'Need a verdict? Council. Need working code? Forge. Need a winner? Race.';
  await director.caption(PITCH);
  await director.hold(voHold(PITCH));

  const conveneCta = await firstVisible([
    page.getByRole('button', { name: 'Convene a Tribunal' }),
    page.locator('[aria-label="Convene a Tribunal"]'),
  ]);
  if (!conveneCta) {
    // Surface is gated or unexpectedly empty — pan what's visible and bow out.
    // scrollThrough outlasts the VO — interaction-covered.
    await director.caption(
      'The idea is simple — put your rival models on one bench, and let the friction find the truth.',
      grid,
    );
    await director.scrollThrough(grid, { steps: 3, dwellMs: 700 });
    await director.caption();
    await director.hold(1500);
    return;
  }

  // spotlight + click + convene below outlast the VO — interaction-covered.
  await director.caption('So let us convene the panel.', conveneCta);
  await director.spotlight(conveneCta, 1400);
  await director.click(conveneCta);
  await director.dismissDialogs();
  await director.hold();

  // --- Step 0: pick a move -----------------------------------------------
  const wizard = page.locator('[data-testid="tribunal-wizard"]').first();
  await wizard
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => undefined);

  // spotlight below outlasts the VO — interaction-covered.
  await director.caption(
    'You get three moves — three different ways to settle an argument.',
    wizard,
  );
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
      line: 'Council gets you a straight answer — every vendor weighs in, and you get one cited verdict.',
    },
    {
      label: 'Forge',
      line: 'Forge gets you real code — each model builds in its own isolated worktree, and the best diff wins.',
    },
    {
      label: 'Race',
      line: 'And Race gets you a champion — every model competes, and a rubric crowns the winner.',
    },
  ];
  for (const { label, line } of moveCards) {
    const card = page.getByRole('button', { name: label }).first();
    if (await card.isVisible().catch(() => false)) {
      // hover follows each line — interaction-covered; target the card.
      await director.caption(line, card);
      await director.hover(card, 850);
    }
  }
  await director.caption();

  const forgeCard = page.getByRole('button', { name: 'Forge' }).first();
  if (await forgeCard.isVisible().catch(() => false)) {
    // click + convene below outlast the VO — interaction-covered.
    await director.caption('Let us send them to the Forge.', forgeCard);
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
    // spotlight + hover loop below outlast the VO — interaction-covered.
    await director.caption(
      'Now you pick your fighters — one model to each lane on the bench.',
      panelStep,
    );
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

    // scrollThrough below outlasts the VO — interaction-covered.
    await director.caption(
      'And there are no surprise bills — effort, model, and turn estimate, every cost shown up front.',
      panelStep,
    );
    await director.scrollThrough(panelStep, { steps: 3, dwellMs: 650 });
    await director.caption();
  }

  // STOP before "Open Tribunal" — convening would launch real paid vendors.
  const CLOSER =
    'So yes — your models disagree on purpose. Because that disagreement is exactly the signal you need.';
  await director.caption(CLOSER);
  await director.hold(voHold(CLOSER));
  await director.caption();
});
