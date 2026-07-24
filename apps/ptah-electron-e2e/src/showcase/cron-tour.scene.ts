import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * P1.4 — "Nightly agents on a schedule" (deep dive on the Thoth Schedules tab).
 *
 * Where `thoth-tour` is the cockpit overview, this scene LINGERS on the
 * Schedules (cron) tab, where Ptah runs headless agent sessions on a recurring
 * cron schedule. The narration arc:
 *   1. land on the Schedules tab + read the stats strip (jobs / enabled /
 *      disabled / next run),
 *   2. pan the schedules table so the camera reveals every job,
 *   3. spotlight a single schedule row and hover to draw the eye,
 *   4. click the row to reveal its READ-ONLY run-history panel and spotlight it,
 *   5. payoff caption.
 *
 * Purely UI-driven: NO agents, NO LLM inference, so no `waitForAgentTurn`.
 *
 * AUDIO-FIRST: the voiceover script lives in `scripts/cron-tour.json` and is
 * narrated by `narrate.mjs` BEFORE capture. Each `director.say(i)` speaks line
 * i, holding for the REAL clip duration (durations.json) so narration, captions
 * and footage stay locked — no estimated holds, no silent gaps. Element-
 * targeted says + spotlight/hover auto-emit `shots.json`, punching the camera
 * onto each subject as the VO names it.
 *
 * NON-DESTRUCTIVE by design. Clicking a job ROW only selects it and reveals the
 * run-history panel — it mutates nothing. We deliberately NEVER click the
 * per-row Run / Edit / Enable-Disable / Delete buttons, nor "New job", nor the
 * form submit — all of those create, mutate, or trigger a job.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored.
 * - One or more scheduled jobs is ideal but NOT required — the empty-state path
 *   narrates the value prop and spotlights the empty surface instead.
 * - No other Ptah instance is running (single-instance lock).
 *
 * Selector note: the only shell-navigation touch point is the `Thoth` top-nav
 * tab and the `#thoth-tab-cron` inner tab (selected by id to avoid colliding
 * with the top-nav tablist). Everything inside the panel uses the verified
 * `data-testid`s from `libs/frontend/cron-scheduler-ui` (see the gold spec
 * `src/specs/thoth/cron.spec.ts`).
 */

/** First visible locator from an ordered candidate list, scoped to `root`. */
async function firstVisible(
  root: Locator,
  selectors: readonly string[],
): Promise<Locator | null> {
  for (const sel of selectors) {
    const loc = root.locator(sel).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return null;
}

/**
 * Enter the Thoth shell and open the Schedules (cron) tab. Best-effort against
 * the live shell for the `Thoth` top-nav tab, then waits for the cron panel.
 */
async function goToCron(page: Page, director: Director): Promise<Locator> {
  const navCandidates: Locator[] = [
    page.getByRole('tab', { name: 'Thoth' }),
    page.getByRole('button', { name: 'Thoth' }),
    page.locator('[title="Thoth"]'),
    page.locator('[aria-label="Thoth"]'),
  ];
  for (const c of navCandidates) {
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
  await page.locator('#thoth-tab-cron').waitFor({ state: 'visible' });

  await director.click(page.locator('#thoth-tab-cron'));
  const panel = page.locator('#thoth-panel-cron');
  await panel.waitFor({ state: 'visible' });
  return panel;
}

test('P1.4 — nightly agents on a schedule (deep dive)', async ({
  page,
  director,
}) => {
  // Navigate + settle BEFORE the first beat: enter the Schedules (cron) tab (the
  // subject surface) so the hook lands on it instead of the stale restored
  // surface. Everything until the hook is trimmed by render-all's lead-in trim,
  // so the surface swap never airs. Entering the tab here also forces its
  // SQLite-backed first-mount, so no separate pre-warm is needed.
  const panel = await goToCron(page, director);

  // HOOK — fire immediately so the video opens on a question, not dead air.
  await director.say(0);

  // WARMUP — one line of context before the tour starts.
  await director.say(1);

  // 1) Land + read the stats strip: jobs / enabled / disabled / next run.
  const statsStrip = await firstVisible(panel, [
    '[aria-label="Cron statistics"]',
    '[data-testid="cron-stat-total"]',
  ]);
  if (statsStrip) {
    await director.say(2, {
      target: statsStrip,
      during: async () => {
        await director.spotlight(statsStrip, 1700);
      },
    });
  } else {
    await director.say(2);
  }

  // 2) Pan the schedules table top→bottom so the camera reveals every job
  // while the narration plays over the scroll.
  await director.say(3, {
    target: panel,
    during: async () => {
      await director.scrollThrough(panel, { steps: 5, dwellMs: 600 });
    },
  });

  // 3) Spotlight a single schedule row (or gracefully narrate the empty state).
  const row = page.locator('[data-testid="cron-job-row"]').first();
  const hasJob = await row.isVisible().catch(() => false);

  if (hasJob) {
    await director.say(4, {
      target: row,
      during: async () => {
        await director.hover(row, 700);
        await director.spotlight(row, 1600);
      },
    });

    // 4) Click the row — selection only — to reveal the READ-ONLY run-history
    //    panel below the table. This mutates nothing.
    await director.say(5, {
      target: row,
      during: async () => {
        await director.click(row);
        await director.hold(600);

        const history = await firstVisible(panel, [
          '[aria-label="Run history"]',
        ]);
        if (history) {
          // `spotlight` scrolls the target into view before drawing the ring.
          await director.spotlight(history, 1700);
        }
      },
    });
  } else {
    // No jobs yet: narrate the value prop over the empty state.
    const empty = await firstVisible(panel, [
      '[data-testid="cron-empty-state"]',
    ]);
    if (empty) {
      await director.say(6, {
        target: empty,
        during: async () => {
          await director.spotlight(empty, 1800);
        },
      });
    } else {
      await director.say(6);
    }
  }

  // 5) Payoff.
  await director.say(7);
});
