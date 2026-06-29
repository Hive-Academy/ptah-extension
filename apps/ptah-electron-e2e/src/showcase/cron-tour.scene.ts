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
  await director.dismissDialogs();

  await director.click(page.locator('#thoth-tab-cron'));
  const panel = page.locator('#thoth-panel-cron');
  await panel.waitFor({ state: 'visible' });
  await director.dismissDialogs();
  return panel;
}

test('P1.4 — nightly agents on a schedule (deep dive)', async ({
  page,
  director,
}) => {
  // The persistent authed profile ALWAYS shows the trial modal on boot.
  await director.dismissDialogs();

  await director.caption('Set it and forget it.');
  await director.hold(1600);
  await director.caption();

  const panel = await goToCron(page, director);

  // 1) Land + read the stats strip: jobs / enabled / disabled / next run.
  await director.caption('Schedules — agents that run on their own clock.');
  const statsStrip = await firstVisible(panel, [
    '[aria-label="Cron statistics"]',
    '[data-testid="cron-stat-total"]',
  ]);
  if (statsStrip) {
    await director.spotlight(statsStrip, 1700);
  } else {
    await director.hold(1200);
  }
  await director.caption();

  // 2) Pan the schedules table top→bottom so the camera reveals every job.
  await director.caption('Cron expressions drive headless Ptah sessions.');
  await director.scrollThrough(panel, { steps: 5, dwellMs: 600 });
  await director.caption();

  // 3) Spotlight a single schedule row (or gracefully narrate the empty state).
  const row = page.locator('[data-testid="cron-job-row"]').first();
  const hasJob = await row.isVisible().catch(() => false);

  if (hasJob) {
    await director.caption(
      'Each row is one recurring job — name, cron, status.',
    );
    await director.hover(row, 700);
    await director.spotlight(row, 1600);
    await director.caption();

    // 4) Click the row — selection only — to reveal the READ-ONLY run-history
    //    panel below the table. This mutates nothing.
    await director.caption('Open one to see its run history.');
    await director.click(row);
    await director.hold(600);

    const history = await firstVisible(panel, ['[aria-label="Run history"]']);
    if (history) {
      // `spotlight` scrolls the target into view before drawing the ring.
      await director.spotlight(history, 1700);
    } else {
      await director.hold(900);
    }
    await director.caption();
  } else {
    // No jobs yet: narrate the value prop over the empty state.
    const empty = await firstVisible(panel, [
      '[data-testid="cron-empty-state"]',
    ]);
    await director.caption(
      'Schedule a prompt — nightly builds, digests, maintenance — and walk away.',
    );
    if (empty) {
      await director.spotlight(empty, 1800);
    } else {
      await director.hold(1400);
    }
    await director.caption();
  }

  await director.dismissDialogs();

  // 5) Payoff.
  await director.caption(
    'Nightly agents on a schedule. No one at the keyboard.',
  );
  await director.hold(2600);
  await director.caption();
});
