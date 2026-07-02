import { test } from './_harness/showcase-fixtures';
import type { Director } from './_harness/director';
import type { Locator, Page } from '@playwright/test';

/**
 * Setup Wizard Tour — "personalize Ptah in minutes" (P7.1, 7-step onboarding).
 *
 * A marketing SCENE, not a test. It opens the premium-gated setup wizard and
 * pans the welcome experience: the value-prop hero, the four feature cards, the
 * analysis-model picker, and the 7-step progress rail (Welcome → Scan →
 * Analysis → Selection → Enhance → Generation → Completion). See
 * `docs/video-content-plan.md` P7.1.
 *
 * STRICTLY NON-DESTRUCTIVE: clicking "Start New Analysis" launches a real,
 * paid 4-phase AI codebase scan and would commit wizard state against the
 * authenticated workspace. So this tour DELIBERATELY STOPS on the welcome step.
 * It spotlights the forward progress rail (clicking ahead is a safe no-op while
 * prerequisites are unmet) but never fires the analysis CTA and never advances
 * past welcome. If the surface is premium-gated to the upsell, we narrate that
 * cleanly and exit.
 *
 * Prereqs (the launcher assumes these):
 * - `nx serve ptah-electron` has been run once so the default profile is
 *   authenticated and a real workspace is restored.
 * - No other Ptah instance is running (single-instance lock).
 *
 * Selector note: verified against `apps/ptah-electron-e2e/src/specs/setup-
 * wizard/wizard-dom.spec.ts` and `libs/frontend/setup-wizard`. Stable hooks:
 * `[data-testid="wizard-step"]` carries a `data-step` attribute; the welcome
 * CTA is `[data-testid="wizard-next-btn"]` (DO NOT click — it starts a scan).
 */

/** Pick the first visible locator from a list, or null if none are on screen. */
async function firstVisible(candidates: Locator[]): Promise<Locator | null> {
  for (const c of candidates) {
    const loc = c.first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return null;
}

async function goToSetup(page: Page, director: Director): Promise<void> {
  const tab = await firstVisible([
    page.getByRole('tab', { name: 'Setup' }),
    page.getByRole('button', { name: 'Setup' }),
    page.locator('[aria-label="Setup"]'),
    page.locator('[title*="Setup" i]'),
  ]);
  if (tab) await director.click(tab);

  // The wizard view mounts either the step container (premium) or the upsell.
  await page
    .locator('[data-testid="wizard-step"], ptah-premium-upsell')
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })
    .catch(() => undefined);
}

test('Setup Wizard — personalize Ptah in minutes', async ({
  page,
  director,
}) => {
  // Clear any blocking startup modal (license / trial dialog) before filming.
  await director.dismissDialogs();

  await director.caption('Make Ptah yours — agents tuned to your codebase.');
  await director.hold(1800);
  await director.caption();

  await goToSetup(page, director);
  await director.dismissDialogs();
  await director.hold();

  // --- Premium-gate fallback ---------------------------------------------
  const upsell = page.locator('ptah-premium-upsell').first();
  if (await upsell.isVisible().catch(() => false)) {
    await director.caption('Deep analysis & tailored agents — a Pro feature.');
    await director.spotlight(upsell, 1700);
    await director.scrollThrough(upsell, { steps: 3, dwellMs: 700 });
    await director.caption();
    await director.hold(1600);
    return;
  }

  const step = page.locator('[data-testid="wizard-step"]').first();
  await step
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => undefined);

  // --- The 7-step progress rail ------------------------------------------
  await director.caption('Seven steps. Scan, analyze, generate, done.');
  const progressRail = await firstVisible([
    page.locator('.wizard-progress'),
    page.locator('ul.steps').first(),
  ]);
  if (progressRail) {
    await director.spotlight(progressRail, 1800);
  }
  await director.caption();

  // --- Welcome hero ------------------------------------------------------
  await director.caption('It starts with a four-phase AI scan.');
  const welcome = page.locator('ptah-welcome').first();
  if (await welcome.isVisible().catch(() => false)) {
    await director.scrollThrough(welcome, {
      steps: 4,
      dwellMs: 650,
      andBack: true,
    });
  }
  await director.caption();

  // Spotlight the four value-prop feature cards by their headings.
  const featureHeadings = [
    {
      name: 'Deep Analysis',
      line: 'Deep analysis of your real project structure.',
    },
    {
      name: 'Smart Agents',
      line: 'Thirteen agent templates, matched to your stack.',
    },
    { name: 'Quick Setup', line: 'Set up in under five minutes.' },
    { name: 'Project-Specific', line: 'Every rule, specific to your code.' },
  ];
  for (const { name, line } of featureHeadings) {
    const card = page.getByRole('heading', { name }).first();
    if (await card.isVisible().catch(() => false)) {
      await director.caption(line);
      await director.hover(card, 800);
    }
  }
  await director.caption();

  // Analysis-model picker — hover only; switching the model is harmless but we
  // keep the tour read-only to avoid touching the authed config.
  const modelSelect = page.locator('#wizard-model-select').first();
  if (await modelSelect.isVisible().catch(() => false)) {
    await director.caption('Choose the model that runs your analysis.');
    await director.spotlight(modelSelect, 1500);
    await director.caption();
  }

  // The analysis CTA — spotlight it as the hero call-to-action, but DO NOT
  // click: pressing it launches a real, paid 4-phase scan against the
  // workspace, which this non-destructive tour must never trigger.
  const startCta = page.locator('[data-testid="wizard-next-btn"]').first();
  if (await startCta.isVisible().catch(() => false)) {
    await director.caption('One click kicks off the whole pipeline.');
    await director.spotlight(startCta, 1700);
    await director.hover(startCta, 900);
    await director.caption();
  }

  // --- Forward step rail preview (safe no-op) ----------------------------
  // The progress rail lets you click ahead; the wizard guards forward jumps
  // until prerequisites are met, so this stays on the welcome step.
  const stepItems = page.locator('ul.steps > li.step');
  const stepCount = await stepItems.count();
  if (stepCount > 1) {
    await director.caption('Follow the rail: scan, analyze, select, generate.');
    for (let i = 1; i < Math.min(stepCount, 4); i++) {
      await director.hover(stepItems.nth(i), 650);
    }
    await director.caption();
  }

  // STOP on welcome — never advance, never commit the authed config.
  await director.caption('Personalized agents, born from your own codebase.');
  await director.hold(2600);
  await director.caption();
});
