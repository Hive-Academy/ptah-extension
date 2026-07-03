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
 * Captions double as the VOICEOVER SCRIPT (`narrate.mjs --source beats`), so
 * they are spoken prose and caption-only beats hold via `voHold` (~65ms/char)
 * so narration finishes before the next beat. Element-targeted captions +
 * spotlight/hover auto-emit `shots.json`, punching the camera onto each subject.
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

  const OPENING =
    'Generic AI agents give generic answers. What if yours actually knew your codebase?';
  await director.caption(OPENING);
  await director.hold(voHold(OPENING));
  await director.caption();

  // WARMUP — one line of context before the tour starts.
  const WARMUP =
    'Welcome to Ptah. This is the Setup Wizard — it reads your project and builds a team of agents around it.';
  await director.caption(WARMUP);
  await director.hold(voHold(WARMUP));
  await director.caption();

  await goToSetup(page, director);
  await director.dismissDialogs();
  await director.hold();

  // --- Premium-gate fallback ---------------------------------------------
  const upsell = page.locator('ptah-premium-upsell').first();
  if (await upsell.isVisible().catch(() => false)) {
    // spotlight + scrollThrough that follow outlast the narration, so the
    // caption plays fully across them — no explicit voHold needed here.
    const UPSELL =
      'Tailored agents and deep analysis come with Ptah Pro — one upgrade, and this whole pipeline is yours.';
    await director.caption(UPSELL, upsell);
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
  const SEVEN_STEPS =
    'You do not configure anything by hand. Seven guided steps — scan, analyze, generate — and you are done.';
  const progressRail = await firstVisible([
    page.locator('.wizard-progress'),
    page.locator('ul.steps').first(),
  ]);
  if (progressRail) {
    await director.caption(SEVEN_STEPS, progressRail);
    await director.spotlight(progressRail, 1800);
    // spotlight(1800 + 180 settle) already spent ~2s of this beat's narration.
    await director.hold(voHold(SEVEN_STEPS, 1980));
  } else {
    await director.caption(SEVEN_STEPS);
    await director.hold(voHold(SEVEN_STEPS));
  }
  await director.caption();

  // --- Welcome hero ------------------------------------------------------
  // The scrollThrough that follows outlasts the narration, so the caption plays
  // fully during it — no explicit voHold needed here.
  const FOUR_PHASE =
    'It starts by actually reading your code — a four-phase AI scan of your whole project.';
  const welcome = page.locator('ptah-welcome').first();
  if (await welcome.isVisible().catch(() => false)) {
    await director.caption(FOUR_PHASE, welcome);
    await director.scrollThrough(welcome, {
      steps: 4,
      dwellMs: 650,
      andBack: true,
    });
  } else {
    await director.caption(FOUR_PHASE);
  }
  await director.caption();

  // Spotlight the four value-prop feature cards by their headings. Each caption
  // is targeted at its card so the camera punches onto it as the VO names it.
  const featureHeadings = [
    {
      name: 'Deep Analysis',
      line: 'Your agents learn your real structure first — a deep analysis, not a guess.',
    },
    {
      name: 'Smart Agents',
      line: 'Then you get thirteen agent templates, each one matched to your exact stack.',
    },
    {
      name: 'Quick Setup',
      line: 'And you are not signing up for an afternoon — the whole thing takes under five minutes.',
    },
    {
      name: 'Project-Specific',
      line: 'Every rule the wizard writes is specific to your code. Nothing generic survives.',
    },
  ];
  for (const { name, line } of featureHeadings) {
    const card = page.getByRole('heading', { name }).first();
    if (await card.isVisible().catch(() => false)) {
      await director.caption(line, card);
      await director.hover(card, 800);
      // hover(800 + 180 settle) covers ~1s; hold the rest so this card's
      // narration finishes before the next card's caption starts.
      await director.hold(voHold(line, 980));
      await director.caption();
    }
  }

  // Analysis-model picker — hover only; switching the model is harmless but we
  // keep the tour read-only to avoid touching the authed config.
  const modelSelect = page.locator('#wizard-model-select').first();
  if (await modelSelect.isVisible().catch(() => false)) {
    const PICK_MODEL =
      'You stay in charge of cost and power — you choose which model runs your analysis.';
    await director.caption(PICK_MODEL, modelSelect);
    await director.spotlight(modelSelect, 1500);
    // spotlight(1500 + 180 settle) already covered ~1.7s of the narration.
    await director.hold(voHold(PICK_MODEL, 1680));
    await director.caption();
  }

  // The analysis CTA — spotlight it as the hero call-to-action, but DO NOT
  // click: pressing it launches a real, paid 4-phase scan against the
  // workspace, which this non-destructive tour must never trigger.
  const startCta = page.locator('[data-testid="wizard-next-btn"]').first();
  if (await startCta.isVisible().catch(() => false)) {
    const ONE_CLICK =
      'And when you are ready, one click kicks off the entire pipeline.';
    await director.caption(ONE_CLICK, startCta);
    await director.spotlight(startCta, 1700);
    await director.hover(startCta, 900);
    // spotlight(1700) + hover(900) + settle already spent ~2.9s of the VO.
    await director.hold(voHold(ONE_CLICK, 2860));
    await director.caption();
  }

  // --- Forward step rail preview (safe no-op) ----------------------------
  // The progress rail lets you click ahead; the wizard guards forward jumps
  // until prerequisites are met, so this stays on the welcome step.
  const stepItems = page.locator('ul.steps > li.step');
  const stepCount = await stepItems.count();
  if (stepCount > 1) {
    // The hover loop across the step rail outlasts the narration, so the caption
    // plays fully during it — no explicit voHold needed here.
    await director.caption(
      'From there you just follow the rail: scan, analyze, select, and generate.',
    );
    for (let i = 1; i < Math.min(stepCount, 4); i++) {
      await director.hover(stepItems.nth(i), 650);
    }
    await director.caption();
  }

  // STOP on welcome — never advance, never commit the authed config.
  const OUTRO =
    'The payoff: agents that are not generic at all, because they were born from your own codebase.';
  await director.caption(OUTRO);
  await director.hold(voHold(OUTRO) + 600);
  await director.caption();
});
