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
 * AUDIO-FIRST: the voiceover script lives in `scripts/tribunal-tour.json`
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
  // Navigate + clean up BEFORE the first beat: everything until the opening is
  // trimmed by render-all's lead-in trim, so this surface swap never airs — and
  // the opening lands on the Tribunal grid instead of the stale restored
  // surface. Entering the grid here also forces its first-mount; strictly
  // navigation-only — it NEVER convenes a panel (no paid agents) — so no
  // separate pre-warm is needed.
  await goToTribunal(page, director);
  await director.hold();

  // OPENING — fire immediately so the video opens on a question, not dead air.
  await director.say(0);

  // WARMUP — one line of context before the tour starts.
  await director.say(1);

  const grid = page.locator('[data-testid="tribunal-grid"]').first();

  // --- Establish the surface ---------------------------------------------
  // scrollThrough runs under the VO — interaction-covered.
  await director.say(2, {
    target: grid,
    during: async () => {
      await director.scrollThrough(grid, {
        steps: 4,
        dwellMs: 650,
        andBack: true,
      });
    },
  });

  // If a previous run left tiles on screen, narrate the live panel layout
  // (conductor + panelist lanes) instead of the convene flow, and exit.
  const liveTopBar = page.locator('[data-testid="tribunal-top-bar"]').first();
  if (await liveTopBar.isVisible().catch(() => false)) {
    // Spotlight + hover loop run under the VO — interaction-covered.
    await director.say(3, {
      target: liveTopBar,
      during: async () => {
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
      },
    });

    const lockToggle = page
      .locator('[data-testid="tribunal-lock-toggle"]')
      .first();
    if (await lockToggle.isVisible().catch(() => false)) {
      // spotlight runs under the VO — interaction-covered.
      await director.say(4, {
        target: lockToggle,
        during: async () => {
          await director.spotlight(lockToggle, 1500);
        },
      });
    }

    await director.say(5);
    return;
  }

  // --- Empty state: the convene pitch ------------------------------------
  // A narration-only pitch — say() holds for the full clip before we convene.
  await director.say(6);

  const conveneCta = await firstVisible([
    page.getByRole('button', { name: 'Convene a Tribunal' }),
    page.locator('[aria-label="Convene a Tribunal"]'),
  ]);
  if (!conveneCta) {
    // Surface is gated or unexpectedly empty — pan what's visible and bow out.
    // scrollThrough runs under the VO — interaction-covered.
    await director.say(7, {
      target: grid,
      during: async () => {
        await director.scrollThrough(grid, { steps: 3, dwellMs: 700 });
      },
    });
    await director.hold(1500);
    return;
  }

  // spotlight + click + convene run under the VO — interaction-covered.
  await director.say(8, {
    target: conveneCta,
    during: async () => {
      await director.spotlight(conveneCta, 1400);
      await director.click(conveneCta);
      await director.hold();
    },
  });

  // --- Step 0: pick a move -----------------------------------------------
  const wizard = page.locator('[data-testid="tribunal-wizard"]').first();
  await wizard
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => undefined);

  // spotlight runs under the VO — interaction-covered.
  await director.say(9, {
    target: wizard,
    during: async () => {
      const pickMove = page
        .locator('[data-testid="tribunal-step-pick-move"]')
        .first();
      if (await pickMove.isVisible().catch(() => false)) {
        await director.spotlight(pickMove, 1500);
      }
    },
  });

  // Hover each move card so the viewer reads the descriptions, then pick FORGE
  // for a punchier story (competing implementations across worktrees). The
  // per-card narration lines are script indices 10..12, in this array order.
  const moveCards: string[] = ['Council', 'Forge', 'Race'];
  for (let i = 0; i < moveCards.length; i++) {
    const card = page.getByRole('button', { name: moveCards[i] }).first();
    if (await card.isVisible().catch(() => false)) {
      // hover runs under each line — interaction-covered; target the card.
      await director.say(10 + i, {
        target: card,
        during: async () => {
          await director.hover(card, 850);
        },
      });
    }
  }

  const forgeCard = page.getByRole('button', { name: 'Forge' }).first();
  if (await forgeCard.isVisible().catch(() => false)) {
    // click + convene run under the VO — interaction-covered.
    await director.say(13, {
      target: forgeCard,
      during: async () => {
        await director.click(forgeCard);
        await director.hold();
      },
    });
  }

  // Advance to the panel-assembly step.
  const nextBtn = page.getByRole('button', { name: 'Next step' }).first();
  if (await nextBtn.isVisible().catch(() => false)) {
    await director.click(nextBtn);
    await director.hold();
  }

  // --- Step 1: assemble the panel ----------------------------------------
  const panelStep = page
    .locator('[data-testid="tribunal-step-panel-preview"]')
    .first();
  if (await panelStep.isVisible().catch(() => false)) {
    // spotlight + hover loop run under the VO — interaction-covered.
    await director.say(14, {
      target: panelStep,
      during: async () => {
        await director.spotlight(panelStep, 1600);

        // Hover a couple of discovered vendor lanes (the "Add" buttons),
        // without committing the panel — purely a reveal of who can sit on
        // the panel.
        const addButtons = page.locator(
          '[data-testid="tribunal-step-panel-preview"] button[aria-label^="Add "]',
        );
        const addCount = await addButtons.count();
        for (let i = 0; i < Math.min(addCount, 3); i++) {
          await director.hover(addButtons.nth(i), 750);
        }
      },
    });

    // scrollThrough runs under the VO — interaction-covered.
    await director.say(15, {
      target: panelStep,
      during: async () => {
        await director.scrollThrough(panelStep, { steps: 3, dwellMs: 650 });
      },
    });
  }

  // STOP before "Open Tribunal" — convening would launch real paid vendors.
  await director.say(16);
});
