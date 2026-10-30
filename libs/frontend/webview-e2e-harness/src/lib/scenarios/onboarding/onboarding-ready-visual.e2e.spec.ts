/**
 * Get ready visual gate (TASK_2026_ONBOARDING B1c, implementation-plan.addendum-prereqs.md component 12,
 * "Visual layer" and the B1c screenshot gate), plus the B1b Credentials-drawer captures (context.md,
 * orchestrator decision 2026-10-29: one webview build for both).
 *
 * Captures, all on the Electron host config through the real app build:
 * - the 80-capture four-theme matrix (stage 1 in seven readiness states, six stage-2 views, five Home
 *   views, two 400px views; each × `ptah-glass`, `ptah-glass-light`, `anubis`, `anubis-light`);
 * - 2 reduced-transparency captures (stage 2 Providers `missing`, both glass themes, A7);
 * - the 30-run contrast sweep (3 views × 2 glass themes × scenes `ember`/`tide`/`horizon` with
 *   `gold` and accents `rose`/`moonstone` on `aurora`, axe `color-contrast` only, A6);
 * - 4 B1b captures: Settings → Providers → Claude (Subscription) drawer → Credentials.
 *
 * Before each capture the spec asserts the route host and the visible state text (chip, banner
 * action or strip word), so a wrong state fails instead of being captured. The Router runs on
 * `MemoryPlatformLocation` (`app.config.ts` "THE ROUTER'S HOST SEAM"), so the route is asserted
 * through its page host testid, never `page.url()` (precedent `marketplace-routes.e2e.spec.ts`).
 * Home is reached through `switchView` or stage-2 actions, never by URL strings.
 *
 * Run (screenshot step, after a webview build; see the addendum's Verification matrix delta):
 *   node scripts/verify.mjs --exec --task onboarding-ready-captures -- \
 *     npx nx run @ptah-extension/webview-e2e-harness:e2e --skip-nx-cache -- onboarding-ready-visual
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { gotoSettingsTab } from '../settings/settings.fixtures';
import {
  FLAG_DONE,
  FLAG_SKIPPED,
  GLASS_THEMES,
  ONBOARDING_THEMES,
  STAGE_ONE_READINESS_IDS,
  bootOnboardingReady,
  type GlassAccent,
  type GlassScene,
  type OnboardingFlagSeed,
  type OnboardingTheme,
  type ReadinessFixtureId,
} from './onboarding-ready.fixtures';
import { captureOnboarding, type OnboardingCaptureOptions } from './onboarding-ready-capture';

test.use({ useAppBuild: true });

const WIDE = { width: 1280, height: 800 } as const;
// The design's narrow case is a 400px content area (design-spec §12.8). The Electron shell holds
// that area at min-w-[400px] between two 32px rail tabs, so the window is 464px wide.
const NARROW = { width: 464, height: 800 } as const;

const STAGE_ONE = '[data-testid="ready-claude-step"]';
const STAGE_TWO = '[data-testid="ready-settings-step"]';
const HOME = '[data-testid="onboarding-home"]';
const BANNER = '[data-testid="claude-readiness-banner"]';
const BANNER_ACTION = '[data-testid="claude-readiness-banner-action"]';
const DRAWER = '[data-testid="connection-detail-drawer"]';

type StageOneId = (typeof STAGE_ONE_READINESS_IDS)[number];

/** Stage-1 chip text and one state-specific sentence per readiness id (spec §12). */
const STAGE_ONE_TEXT: Record<StageOneId, { readonly chip: string; readonly line?: string }> = {
  checking: { chip: 'Checking', line: 'Checking your computer...' },
  ready: { chip: 'Ready' },
  missing: { chip: 'Not installed', line: 'No claude command was found.' },
  'signed-out': { chip: 'Not signed in' },
  'error-timeout': {
    chip: 'Could not check',
    line: 'Claude Code did not answer in time (30 s). Your sign-in could not be read.',
  },
  'error-unreadable': {
    chip: 'Could not check',
    line: 'Ptah could not read the Claude Code sign-in.',
  },
  'error-local': {
    chip: 'Could not check',
    line: 'Ptah could not ask this computer about Claude Code.',
  },
};

/** The derived state each fixture id produces (`data-state` on the panel and the banner). */
const DERIVED_STATE: Record<ReadinessFixtureId, string> = {
  checking: 'checking',
  'checking-ambient': 'checking',
  ready: 'ready',
  missing: 'missing',
  'signed-out': 'signed-out',
  'error-timeout': 'error',
  'error-unreadable': 'error',
  'error-local': 'error',
};

/** Strip item 1 word per derived state (`ready-strip.component.ts`). */
const STRIP_WORD: Readonly<Record<string, string>> = {
  checking: 'Checking',
  ready: 'Ready',
  missing: 'Needs install',
  'signed-out': 'Needs sign-in',
  error: 'Could not check',
};

async function shoot(page: Page, options: OnboardingCaptureOptions): Promise<void> {
  const result = await captureOnboarding(page, options);
  test.info().annotations.push({
    type: 'axe',
    description: `${options.view} ${options.theme}: ${result.violations} violation(s) → ${result.axePath}`,
  });
}

async function boot(
  page: Page,
  url: string,
  theme: OnboardingTheme,
  readiness: ReadinessFixtureId,
  extra: {
    readonly flag?: OnboardingFlagSeed;
    readonly viewport?: { readonly width: number; readonly height: number };
    readonly scene?: GlassScene;
    readonly accent?: GlassAccent;
  } = {},
): ReturnType<typeof bootOnboardingReady> {
  await page.setViewportSize(extra.viewport ?? WIDE);
  return bootOnboardingReady(page, url, {
    theme,
    readiness,
    flag: extra.flag,
    scene: extra.scene,
    accent: extra.accent,
  });
}

/** Strip item `step` (1-3) shows `word`. */
async function expectStripWord(page: Page, step: 1 | 2 | 3, word: string): Promise<void> {
  await expect(
    page.locator(`[data-testid="ready-strip"] li[data-step="${step}"]`),
  ).toContainText(word);
}

async function expectStageOne(page: Page, id: StageOneId): Promise<void> {
  await expect(page.locator(STAGE_ONE)).toBeVisible();
  const panel = page.locator('[data-testid="ready-claude-panel"]');
  await expect(panel).toHaveAttribute('data-state', DERIVED_STATE[id]);
  await expect(page.locator('[data-testid="ready-claude-chip"]')).toHaveText(STAGE_ONE_TEXT[id].chip);
  const line = STAGE_ONE_TEXT[id].line;
  if (line) await expect(page.locator(STAGE_ONE)).toContainText(line);
}

/** Stage 1 → stage 2 through the visible action for the state (Continue or Continue anyway). */
async function enterStageTwo(page: Page, readiness: ReadinessFixtureId): Promise<void> {
  await expect(page.locator(STAGE_ONE)).toBeVisible();
  await page
    .locator(readiness === 'ready' ? '[data-testid="ready-continue"]' : '[data-testid="ready-continue-anyway"]')
    .click();
  await expect(page.locator(STAGE_TWO)).toBeVisible();
  await expect(page.locator('[data-testid="ready-area-panel-providers"]')).toBeVisible();
}

async function expectSettingsBanner(page: Page, state: string): Promise<void> {
  await expect(page.locator(BANNER)).toHaveAttribute('data-state', state);
  await expect(page.locator(BANNER_ACTION)).toHaveText('Fix Claude Code');
}

/** Waits for the drawer's own entry keyframes, as `settings-visual.e2e.spec.ts` does. */
async function waitForDrawerOpened(page: Page): Promise<void> {
  await expect(page.locator(DRAWER)).toBeVisible();
  await page.locator('[data-testid="native-drawer-root"]').evaluate((element) =>
    Promise.all(
      element
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation instanceof CSSAnimation && animation.animationName.includes('ptah-drawer-'),
        )
        .map((animation) => animation.finished),
    ),
  );
}

/** Home banner rows (flag: pre-steps skipped). */
const HOME_BANNERS: readonly {
  readonly readiness: ReadinessFixtureId;
  readonly action: string;
  readonly word: string;
}[] = [
  { readiness: 'missing', action: 'Install Claude Code', word: 'Needs install' },
  { readiness: 'signed-out', action: 'Sign in', word: 'Needs sign-in' },
  { readiness: 'error-timeout', action: 'Check again', word: 'Could not check' },
];

// ---------------------------------------------------------------------------
// The 80-capture four-theme matrix
// ---------------------------------------------------------------------------

for (const theme of ONBOARDING_THEMES) {
  test.describe(`Get ready captures (${theme})`, () => {
    // Stage 1 in each of the seven stage-1 readiness ids: 7 × 4 = 28.
    for (const id of STAGE_ONE_READINESS_IDS) {
      test(`stage 1 — ${id}`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, id);
        await expectStageOne(page, id);
        await expectStripWord(page, 1, STRIP_WORD[DERIVED_STATE[id]] ?? '');
        await shoot(page, { view: `stage1-${id}`, theme });
      });
    }

    test('stage 2 — Providers with banner (missing)', async ({ page, fixtureServer }) => {
      await boot(page, fixtureServer.url, theme, 'missing');
      await enterStageTwo(page, 'missing');
      await expectSettingsBanner(page, 'missing');
      await shoot(page, { view: 'stage2-providers-missing', theme });
    });

    test('stage 2 — Providers, no banner (ready)', async ({ page, fixtureServer }) => {
      await boot(page, fixtureServer.url, theme, 'ready');
      await enterStageTwo(page, 'ready');
      await expectStripWord(page, 1, 'Ready');
      await expect(page.locator(BANNER)).toHaveCount(0);
      await shoot(page, { view: 'stage2-providers-ready', theme });
    });

    test('stage 2 — CLI tools with banner (signed-out)', async ({ page, fixtureServer }) => {
      await boot(page, fixtureServer.url, theme, 'signed-out');
      await enterStageTwo(page, 'signed-out');
      await page
        .locator('[data-testid="ready-area-tablist"]')
        .getByRole('tab', { name: 'CLI tools', exact: true })
        .click();
      await expect(page.locator('[data-testid="ready-area-panel-cli"]')).toBeVisible();
      await expectSettingsBanner(page, 'signed-out');
      await shoot(page, { view: 'stage2-cli-signed-out', theme });
    });

    test('stage 2 — Claude drawer on Accounts (signed-out)', async ({ page, fixtureServer }) => {
      await boot(page, fixtureServer.url, theme, 'signed-out');
      await expectStageOne(page, 'signed-out');
      await page.locator('[data-testid="ready-named-account-link"]').click();
      await expect(page.locator(STAGE_TWO)).toBeVisible();
      await waitForDrawerOpened(page);
      await expect(
        page.getByRole('dialog', { name: 'Claude (Subscription) connection details' })
          .getByRole('tab', { name: 'Accounts', exact: true }),
      ).toHaveAttribute('aria-selected', 'true');
      await shoot(page, { view: 'stage2-claude-accounts-drawer', theme });
    });

    test('stage 2 — Providers, checking: strip "Checking", no banner', async ({ page, fixtureServer }) => {
      await boot(page, fixtureServer.url, theme, 'checking-ambient');
      await enterStageTwo(page, 'checking-ambient');
      await expectStripWord(page, 1, 'Checking');
      await expect(page.locator(BANNER)).toHaveCount(0);
      await shoot(page, { view: 'stage2-providers-checking', theme });
    });

    test('stage 2 — Providers, error banner (error-timeout)', async ({ page, fixtureServer }) => {
      await boot(page, fixtureServer.url, theme, 'error-timeout');
      await enterStageTwo(page, 'error-timeout');
      await expectSettingsBanner(page, 'error');
      await shoot(page, { view: 'stage2-providers-error', theme });
    });

    // Home banner states, pre-steps skipped: 3 × 4 = 12.
    for (const row of HOME_BANNERS) {
      test(`Home — banner ${row.readiness}, strip "${row.word}" + "Skipped"`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, row.readiness, { flag: FLAG_SKIPPED });
        await expect(page.locator(HOME)).toBeVisible();
        await expect(page.locator(BANNER)).toHaveAttribute('data-state', DERIVED_STATE[row.readiness]);
        await expect(page.locator(BANNER_ACTION)).toHaveText(row.action);
        await expectStripWord(page, 1, row.word);
        await expectStripWord(page, 2, 'Skipped');
        await shoot(page, { view: `home-${row.readiness}`, theme });
      });
    }

    test('Home — ready, strip "Ready" + "Done", no banner', async ({ page, fixtureServer }) => {
      await boot(page, fixtureServer.url, theme, 'ready', { flag: FLAG_DONE });
      await expect(page.locator(HOME)).toBeVisible();
      await expectStripWord(page, 1, 'Ready');
      await expectStripWord(page, 2, 'Done');
      await expect(page.locator(BANNER)).toHaveCount(0);
      await shoot(page, { view: 'home-ready', theme });
    });

    test('Home — checking, banner hidden', async ({ page, fixtureServer }) => {
      await boot(page, fixtureServer.url, theme, 'checking', { flag: FLAG_DONE });
      await expect(page.locator(HOME)).toBeVisible();
      await expectStripWord(page, 1, 'Checking');
      await expect(page.locator(BANNER)).toHaveCount(0);
      await shoot(page, { view: 'home-checking', theme });
    });

    // Narrow 400px (A4): 2 × 4 = 8.
    test('narrow 400px — stage 1 missing', async ({ page, fixtureServer }) => {
      await boot(page, fixtureServer.url, theme, 'missing', { viewport: NARROW });
      await expectStageOne(page, 'missing');
      await shoot(page, { view: 'narrow-stage1-missing', theme });
    });

    test('narrow 400px — stage 2 Providers (missing)', async ({ page, fixtureServer }) => {
      await boot(page, fixtureServer.url, theme, 'missing', { viewport: NARROW });
      await enterStageTwo(page, 'missing');
      await expectSettingsBanner(page, 'missing');
      await shoot(page, { view: 'narrow-stage2-providers-missing', theme });
    });

    // B1b (context.md 2026-10-29): Settings → Providers → Claude (Subscription) → Credentials: 4.
    test('B1b — Claude (Subscription) drawer, Credentials', async ({ page, fixtureServer }) => {
      const bridge = await boot(page, fixtureServer.url, theme, 'ready', { flag: FLAG_DONE });
      await bridge.inject({ type: 'switchView', payload: { view: 'settings' } });
      await expect(page.locator('[data-testid="settings-back"]')).toBeVisible();
      await gotoSettingsTab(page, 'Providers');
      await page
        .locator('[data-testid="provider-connection-card"]')
        .filter({ hasText: 'Claude (Subscription)' })
        .locator('[data-testid="provider-card-details-trigger"]')
        .click({ position: { x: 12, y: 12 } });
      await waitForDrawerOpened(page);
      await page.getByRole('tab', { name: 'Credentials', exact: true }).click();
      const commands = page.locator('[data-testid="credentials-cli"] > div > code');
      await expect(commands).toHaveText(['claude', 'npm install -g @anthropic-ai/claude-code']);
      await shoot(page, { view: 'b1b-drawer-claude-credentials', theme });
    });
  });
}

// ---------------------------------------------------------------------------
// Visual layer extras: reduced transparency (2) and the contrast sweep (30)
// ---------------------------------------------------------------------------

for (const theme of GLASS_THEMES) {
  test(`reduced transparency — stage 2 Providers missing (${theme})`, async ({ page, fixtureServer }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
    });
    await boot(page, fixtureServer.url, theme, 'missing');
    expect(
      await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches),
    ).toBe(true);
    await enterStageTwo(page, 'missing');
    await expectSettingsBanner(page, 'missing');
    await shoot(page, { view: 'stage2-providers-missing-reduced-transparency', theme });
  });
}

const SWEEP: readonly { readonly scene: GlassScene; readonly accent: GlassAccent }[] = [
  { scene: 'ember', accent: 'gold' },
  { scene: 'tide', accent: 'gold' },
  { scene: 'horizon', accent: 'gold' },
  { scene: 'aurora', accent: 'rose' },
  { scene: 'aurora', accent: 'moonstone' },
];

const SWEEP_VIEWS: readonly {
  readonly view: string;
  readonly flag?: OnboardingFlagSeed;
  readonly reach: (page: Page) => Promise<void>;
}[] = [
  { view: 'stage1-missing', reach: (page) => expectStageOne(page, 'missing') },
  {
    view: 'stage2-providers-missing',
    reach: async (page) => {
      await enterStageTwo(page, 'missing');
      await expectSettingsBanner(page, 'missing');
    },
  },
  {
    view: 'home-missing',
    flag: FLAG_SKIPPED,
    reach: async (page) => {
      await expect(page.locator(HOME)).toBeVisible();
      await expect(page.locator(BANNER_ACTION)).toHaveText('Install Claude Code');
    },
  },
];

for (const theme of GLASS_THEMES) {
  for (const { scene, accent } of SWEEP) {
    for (const entry of SWEEP_VIEWS) {
      test(`contrast sweep — ${entry.view}, ${scene}/${accent} (${theme})`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, 'missing', { flag: entry.flag, scene, accent });
        await entry.reach(page);
        await shoot(page, {
          view: `contrast-${entry.view}-${scene}-${accent}`,
          theme,
          scene,
          accent,
          axeRules: ['color-contrast'],
        });
      });
    }
  }
}
