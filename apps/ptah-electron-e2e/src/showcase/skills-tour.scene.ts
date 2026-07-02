import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * P1.3 — "Skills synthesis" (deep dive on the Thoth Skills tab).
 *
 * Where `thoth-tour` is the cockpit overview, this scene LINGERS on a single
 * tab: the Skills tab, where Ptah distills reusable skills from clusters of its
 * own successful sessions. The narration arc:
 *   1. land on the Skills tab + read the stats strip,
 *   2. pan the Recommended list (cluster-distilled, judge-gated suggestions),
 *   3. spotlight a single recommendation card and hover to draw the eye,
 *   4. open a recommendation's READ-ONLY review modal to reveal the SKILL.md,
 *   5. flip to the Sessions sub-view (the raw per-session capture log) and
 *      spotlight a candidate row + its detail modal,
 *   6. payoff caption.
 *
 * Purely UI-driven: NO agents, NO LLM inference, so no `waitForAgentTurn`.
 *
 * NON-DESTRUCTIVE by design. We only OPEN read-only surfaces:
 * - the Recommended "Review" button (`suggestions-view-btn`) fetches and renders
 *   the SKILL.md body but mutates nothing,
 * - clicking a Sessions candidate row opens a read-only detail modal.
 * We deliberately NEVER click Accept / Dismiss / Save / Promote / Reject /
 * Run Curator / any bulk action — all of those mutate skill state or kick a run.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored.
 * - Skill data (recommendations and/or session candidates) is ideal but NOT
 *   required — every beat guards for an empty surface and narrates gracefully
 *   while still panning/spotlighting the panel chrome.
 * - No other Ptah instance is running (single-instance lock).
 *
 * Selector note: the only shell-navigation touch point is the `Thoth` top-nav
 * tab and the `#thoth-tab-skills` inner tab (selected by id to avoid colliding
 * with the top-nav tablist). Everything inside the panel uses the verified
 * `data-testid`s from `libs/frontend/skill-synthesis-ui` (see the gold spec
 * `src/specs/thoth/skills.spec.ts`).
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
 * Enter the Thoth shell and open the Skills tab. Best-effort against the live
 * shell for the `Thoth` top-nav tab, then waits for the skills panel to mount.
 */
async function goToSkills(page: Page, director: Director): Promise<Locator> {
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
  await page.locator('#thoth-tab-skills').waitFor({ state: 'visible' });
  await director.dismissDialogs();

  await director.click(page.locator('#thoth-tab-skills'));
  const panel = page.locator('#thoth-panel-skills');
  await panel.waitFor({ state: 'visible' });
  await director.dismissDialogs();
  return panel;
}

test('P1.3 — Skills synthesis (deep dive)', async ({ page, director }) => {
  // The persistent authed profile ALWAYS shows the trial modal on boot.
  await director.dismissDialogs();

  await director.caption('Ptah learns from its own work.');
  await director.hold(1700);
  await director.caption();

  const panel = await goToSkills(page, director);

  // 1) Land + read the stats strip: candidates / promoted / active skills.
  await director.caption('Every successful session becomes a skill candidate.');
  const statsStrip = await firstVisible(panel, [
    '[aria-label="Skill synthesis statistics"]',
    '[data-testid="skills-stat-candidates"]',
  ]);
  if (statsStrip) {
    await director.spotlight(statsStrip, 1700);
  } else {
    await director.hold(1200);
  }
  await director.caption();

  // 2) Pan the Recommended list — the default sub-view (cluster-distilled,
  //    judge-gated skills awaiting review).
  await director.caption(
    'Thoth clusters similar wins into one reusable skill.',
  );
  await director.scrollThrough(panel, { steps: 5, dwellMs: 600 });
  await director.caption();

  // 3) Spotlight a single recommendation card (or gracefully narrate empty).
  const card = page.locator('[data-testid="suggestions-card"]').first();
  const hasRecommendation = await card.isVisible().catch(() => false);

  if (hasRecommendation) {
    await director.caption('Each one is a skill it proposes to itself.');
    await director.hover(card, 700);
    await director.spotlight(card, 1500);
    await director.caption();

    // 4) Open the READ-ONLY review modal to reveal the SKILL.md body. The
    //    "Review" button only fetches + renders — it mutates nothing.
    const reviewBtn = card
      .locator('[data-testid="suggestions-view-btn"]')
      .first();
    if (await reviewBtn.isVisible().catch(() => false)) {
      await director.caption('Open it to read the generated SKILL.md.');
      await director.click(reviewBtn);

      const modal = page.locator('[data-testid="suggestions-view-modal"]');
      await modal
        .waitFor({ state: 'visible', timeout: 8_000 })
        .catch(() => undefined);
      const body = page.locator('[data-testid="suggestions-view-body"]');
      if (await body.isVisible().catch(() => false)) {
        await director.scrollThrough(body, { steps: 4, dwellMs: 650 });
        await director.spotlight(body, 1500);
      } else {
        await director.spotlight(modal, 1500);
      }
      await director.caption();

      // Close the read-only modal without taking any action.
      const closeBtn = modal.getByRole('button', { name: 'Close' }).first();
      if (await closeBtn.isVisible().catch(() => false)) {
        await director.click(closeBtn);
      } else {
        await page.keyboard.press('Escape').catch(() => undefined);
      }
      await modal
        .waitFor({ state: 'hidden', timeout: 5_000 })
        .catch(() => undefined);
      await director.dismissDialogs();
    }
  } else {
    // Sparse profile: still narrate the value prop over the empty surface.
    const empty = await firstVisible(panel, [
      '[data-testid="suggestions-empty"]',
      '[data-testid="suggestions-view"]',
    ]);
    await director.caption(
      'Recommendations appear once enough sessions cluster together.',
    );
    if (empty) {
      await director.spotlight(empty, 1700);
    } else {
      await director.hold(1400);
    }
    await director.caption();
  }

  // 5) Flip to the raw Sessions log — the per-session captures that feed the
  //    clustering above.
  const sessionsTab = panel
    .locator('[data-testid="skills-subview-candidates"]')
    .first();
  if (await sessionsTab.isVisible().catch(() => false)) {
    await director.caption('Under the hood: every session it captured.');
    await director.click(sessionsTab);
    await director.hold(600);
    await director.scrollThrough(panel, { steps: 4, dwellMs: 580 });

    const row = page.locator('[data-testid="skills-candidate-row"]').first();
    if (await row.isVisible().catch(() => false)) {
      await director.hover(row, 600);
      await director.spotlight(row, 1400);
      await director.caption();

      // Clicking a row opens a READ-ONLY candidate detail modal.
      await director.caption('Click one to inspect what it learned.');
      await director.click(row);
      const detail = page.locator(
        '[data-testid="skills-candidate-detail-modal"]',
      );
      if (await detail.isVisible({ timeout: 6_000 }).catch(() => false)) {
        await director.spotlight(detail, 1600);
        const close = detail.getByRole('button', { name: 'Close' }).first();
        if (await close.isVisible().catch(() => false)) {
          await director.click(close);
        } else {
          await page.keyboard.press('Escape').catch(() => undefined);
        }
        await detail
          .waitFor({ state: 'hidden', timeout: 5_000 })
          .catch(() => undefined);
      }
      await director.caption();
    } else {
      const empty = await firstVisible(panel, [
        '[data-testid="skills-empty-state"]',
      ]);
      if (empty) await director.spotlight(empty, 1500);
      await director.caption();
    }
    await director.dismissDialogs();
  }

  // 6) Payoff.
  await director.caption('Ptah extracts reusable skills from its own work.');
  await director.hold(2600);
  await director.caption();
});
