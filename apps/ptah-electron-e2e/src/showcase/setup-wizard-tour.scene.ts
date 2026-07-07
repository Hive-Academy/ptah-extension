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
 * AUDIO-FIRST: the voiceover script lives in `scripts/setup-wizard-tour.json`
 * and is narrated by `narrate.mjs` BEFORE capture. Each `director.say(i)`
 * speaks line i, holding for the REAL clip duration (durations.json) so
 * narration, captions and footage stay locked — no estimated holds, no silent
 * gaps. Element-targeted says + spotlight/hover auto-emit `shots.json`,
 * punching the camera onto each subject as the VO names it.
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

  // Navigate + clean up BEFORE the first beat: everything until the hook is
  // trimmed by render-all's lead-in trim, so this surface swap never airs — and
  // the hook lands on the setup wizard instead of the stale restored surface.
  // Entering the wizard here also forces its first-mount (step container OR
  // premium upsell); navigation-only, it never clicks the analysis CTA, so no
  // separate pre-warm is needed.
  await goToSetup(page, director);
  await director.dismissDialogs();
  await director.hold();

  // HOOK — fire immediately so the video opens on a question, not dead air.
  await director.say(0);

  // WARMUP — one line of context before the tour starts.
  await director.say(1);

  // --- Premium-gate fallback ---------------------------------------------
  const upsell = page.locator('ptah-premium-upsell').first();
  if (await upsell.isVisible().catch(() => false)) {
    await director.say(2, {
      target: upsell,
      during: async () => {
        await director.spotlight(upsell, 1700);
        await director.scrollThrough(upsell, { steps: 3, dwellMs: 700 });
      },
    });
    await director.hold(1600);
    return;
  }

  const step = page.locator('[data-testid="wizard-step"]').first();
  await step
    .waitFor({ state: 'visible', timeout: 8_000 })
    .catch(() => undefined);

  // --- The 7-step progress rail ------------------------------------------
  const progressRail = await firstVisible([
    page.locator('.wizard-progress'),
    page.locator('ul.steps').first(),
  ]);
  if (progressRail) {
    await director.say(3, {
      target: progressRail,
      during: async () => {
        await director.spotlight(progressRail, 1800);
      },
    });
  } else {
    await director.say(3);
  }

  // --- Welcome hero ------------------------------------------------------
  // The scrollThrough runs during the narration so the camera pans the hero
  // while the four-phase-scan line plays.
  const welcome = page.locator('ptah-welcome').first();
  if (await welcome.isVisible().catch(() => false)) {
    await director.say(4, {
      target: welcome,
      during: async () => {
        await director.scrollThrough(welcome, {
          steps: 4,
          dwellMs: 650,
          andBack: true,
        });
      },
    });
  } else {
    await director.say(4);
  }

  // Spotlight the four value-prop feature cards by their headings. Each say is
  // targeted at its card so the camera punches onto it as the VO names it.
  // Script lines 5–8 map to these headings in order.
  const featureHeadings = [
    'Deep Analysis',
    'Smart Agents',
    'Quick Setup',
    'Project-Specific',
  ];
  for (let i = 0; i < featureHeadings.length; i++) {
    const card = page
      .getByRole('heading', { name: featureHeadings[i] })
      .first();
    if (await card.isVisible().catch(() => false)) {
      await director.say(5 + i, {
        target: card,
        during: async () => {
          await director.hover(card, 800);
        },
      });
    }
  }

  // Analysis-model picker — hover only; switching the model is harmless but we
  // keep the tour read-only to avoid touching the authed config.
  const modelSelect = page.locator('#wizard-model-select').first();
  if (await modelSelect.isVisible().catch(() => false)) {
    await director.say(9, {
      target: modelSelect,
      during: async () => {
        await director.spotlight(modelSelect, 1500);
      },
    });
  }

  // The analysis CTA — spotlight it as the hero call-to-action, but DO NOT
  // click: pressing it launches a real, paid 4-phase scan against the
  // workspace, which this non-destructive tour must never trigger.
  const startCta = page.locator('[data-testid="wizard-next-btn"]').first();
  if (await startCta.isVisible().catch(() => false)) {
    await director.say(10, {
      target: startCta,
      during: async () => {
        await director.spotlight(startCta, 1700);
        await director.hover(startCta, 900);
      },
    });
  }

  // --- Forward step rail preview (safe no-op) ----------------------------
  // The progress rail lets you click ahead; the wizard guards forward jumps
  // until prerequisites are met, so this stays on the welcome step.
  const stepItems = page.locator('ul.steps > li.step');
  const stepCount = await stepItems.count();
  if (stepCount > 1) {
    await director.say(11, {
      during: async () => {
        for (let i = 1; i < Math.min(stepCount, 4); i++) {
          await director.hover(stepItems.nth(i), 650);
        }
      },
    });
  }

  // STOP on welcome — never advance, never commit the authed config.
  await director.say(12, { breathMs: 350 + 600 });
});
