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
 * Captions double as the VOICEOVER SCRIPT (`narrate.mjs --source beats`), so
 * they are written as spoken prose and caption-only beats hold via `voHold`
 * (~65ms/char) so narration finishes before the next beat. Element-targeted
 * captions + spotlight/hover auto-emit `shots.json`, punching the camera onto
 * each subject.
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

/**
 * Hold long enough for the narration of `text` to finish before the next beat
 * starts (~65ms/char + settle), minus time already spent in interactions that
 * run between this beat and the next. Captions double as the VO script
 * (`narrate.mjs --source beats`), so this prevents audio overlap.
 */
function voHold(text: string, alreadySpentMs = 0): number {
  return Math.max(600, Math.round(text.length * 65) + 500 - alreadySpentMs);
}

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

  // HOOK — fire immediately so the video opens on a question, not dead air.
  const HOOK =
    'Set it once, and forget it. What if your agents kept working long after you logged off?';
  await director.caption(HOOK);
  await director.hold(voHold(HOOK));
  await director.caption();

  // WARMUP — one line of context before the tour starts.
  const WARMUP =
    'This is Ptah Desktop, on the Schedules tab — where you put agents on a clock. Let us take a look.';
  await director.caption(WARMUP);
  await director.hold(voHold(WARMUP));
  await director.caption();

  const panel = await goToCron(page, director);

  // 1) Land + read the stats strip: jobs / enabled / disabled / next run.
  // Caption is element-targeted onto the stats strip; spotlight(1700) covers
  // most of the VO, so subtract it via alreadySpentMs.
  const SCHEDULES =
    'At a glance, you know exactly what is automated — how many jobs, and when the next one fires.';
  const statsStrip = await firstVisible(panel, [
    '[aria-label="Cron statistics"]',
    '[data-testid="cron-stat-total"]',
  ]);
  if (statsStrip) {
    await director.caption(SCHEDULES, statsStrip);
    await director.spotlight(statsStrip, 1700);
    await director.hold(voHold(SCHEDULES, 1880));
  } else {
    await director.caption(SCHEDULES);
    await director.hold(voHold(SCHEDULES));
  }
  await director.caption();

  // 2) Pan the schedules table top→bottom so the camera reveals every job. The
  // scrollThrough (5 steps × 600ms) outlasts the VO.
  await director.caption(
    'You write one line of cron, and Ptah does the rest — a full headless agent session, on repeat.',
    panel,
  );
  await director.scrollThrough(panel, { steps: 5, dwellMs: 600 });
  await director.caption();

  // 3) Spotlight a single schedule row (or gracefully narrate the empty state).
  const row = page.locator('[data-testid="cron-job-row"]').first();
  const hasJob = await row.isVisible().catch(() => false);

  if (hasJob) {
    // Element-targeted onto the row; hover(700) + spotlight(1600) cover the VO.
    const ROW =
      'Every row is a task you never have to remember again — its name, its schedule, its status.';
    await director.caption(ROW, row);
    await director.hover(row, 700);
    await director.spotlight(row, 1600);
    await director.hold(voHold(ROW, 2480));
    await director.caption();

    // 4) Click the row — selection only — to reveal the READ-ONLY run-history
    //    panel below the table. This mutates nothing. The click + reveal +
    //    spotlight loop outlasts this lead-in caption.
    const HISTORY =
      'And you never have to wonder if it ran — open any job, and its full run history is right there.';
    await director.caption(HISTORY, row);
    await director.click(row);
    await director.hold(600);

    const history = await firstVisible(panel, ['[aria-label="Run history"]']);
    if (history) {
      // `spotlight` scrolls the target into view before drawing the ring.
      await director.spotlight(history, 1700);
    } else {
      await director.hold(voHold(HISTORY, 600));
    }
    await director.caption();
  } else {
    // No jobs yet: narrate the value prop over the empty state.
    const empty = await firstVisible(panel, [
      '[data-testid="cron-empty-state"]',
    ]);
    const EMPTY =
      'Type a prompt, pick a schedule — nightly builds, daily digests, routine cleanup — then walk away.';
    if (empty) {
      await director.caption(EMPTY, empty);
      await director.spotlight(empty, 1800);
      await director.hold(voHold(EMPTY, 1980));
    } else {
      await director.caption(EMPTY);
      await director.hold(voHold(EMPTY));
    }
    await director.caption();
  }

  await director.dismissDialogs();

  // 5) Payoff.
  const PAYOFF =
    'So set it once, and forget it. Your agents work the night shift now — with no one at the keyboard.';
  await director.caption(PAYOFF);
  await director.hold(voHold(PAYOFF));
  await director.caption();
});
