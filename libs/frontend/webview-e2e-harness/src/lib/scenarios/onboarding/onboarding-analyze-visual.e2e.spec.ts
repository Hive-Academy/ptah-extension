/**
 * Analyze workspace (A1) and Choose agents (A2) visual gate
 * (TASK_2026_ONBOARDING B3a). Four themes, WIDE 1280×800 and NARROW 464×800
 * (400px content area, design-spec §12.8), axe report per capture.
 *
 * Route is asserted through page host testids (`analyze-workspace`,
 * `choose-agents`), never `page.url()` (`MemoryPlatformLocation`).
 *
 * Run (screenshot step, after a webview build):
 *   node scripts/verify.mjs --exec --task onboarding-analyze-captures -- \
 *     npx nx run @ptah-extension/webview-e2e-harness:e2e --skip-nx-cache -- onboarding-analyze-visual
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import {
  ANALYZE_SAVED_METADATA,
  COMPLETED_ANALYSIS,
  INTERRUPTED_ANALYSIS,
  NEVER_ANSWERED,
  bootOnboardingAnalyze,
  injectRunningStream,
  injectScanProgress,
  rpcError,
  type BootOnboardingAnalyzeOptions,
} from './onboarding-analyze.fixtures';
import {
  ONBOARDING_ANALYZE_CAPTURE_DIR,
  captureOnboarding,
  type OnboardingCaptureOptions,
} from './onboarding-ready-capture';
import {
  ONBOARDING_CAPTURE_THEMES,
  type OnboardingTheme,
} from './onboarding-ready.fixtures';
import type { PostMessageBridge } from '../../postmessage-bridge';

test.use({ useAppBuild: true });

const WIDE = { width: 1280, height: 800 } as const;
const NARROW = { width: 464, height: 800 } as const;

const ANALYZE = '[data-testid="analyze-workspace"]';
const AGENTS = '[data-testid="choose-agents"]';
const PHASE_HEADER = '[data-testid="phase-header"]';
const BUSY_EXEMPT = `${ANALYZE}, [data-testid="details-log"]`;

type Size = typeof WIDE | typeof NARROW;

async function shoot(
  page: Page,
  options: OnboardingCaptureOptions,
): Promise<void> {
  const result = await captureOnboarding(page, {
    ...options,
    outputDir: ONBOARDING_ANALYZE_CAPTURE_DIR,
    busyExempt: BUSY_EXEMPT,
  });
  test.info().annotations.push({
    type: 'axe',
    description: `${options.view} ${options.theme}: ${result.violations} violation(s) → ${result.axePath}`,
  });
}

async function boot(
  page: Page,
  url: string,
  theme: OnboardingTheme,
  extra: {
    readonly viewport?: Size;
    readonly rpc?: Record<string, unknown>;
  } = {},
): Promise<PostMessageBridge> {
  await page.setViewportSize(extra.viewport ?? WIDE);
  const options: BootOnboardingAnalyzeOptions = { theme, rpc: extra.rpc };
  return bootOnboardingAnalyze(page, url, options);
}

async function openAnalyze(page: Page): Promise<void> {
  await page.locator('[data-testid="onboarding-path-link-analyze"]').click();
  await expect(page.locator(ANALYZE)).toBeVisible();
}

async function openAgentsCatalog(page: Page): Promise<void> {
  await page.locator('[data-testid="onboarding-link-agents-only"]').click();
  await expect(page.locator(AGENTS)).toBeVisible();
}

async function expectSavedList(page: Page): Promise<void> {
  await expect(page.locator(ANALYZE)).toContainText('Saved analyses');
  await expect(page.locator(ANALYZE)).toContainText(
    ANALYZE_SAVED_METADATA.projectType,
  );
  await expect(page.getByRole('button', { name: 'Use' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Hide from list' }),
  ).toBeVisible();
}

async function expectRunningPhaseTwo(
  page: Page,
  bridge: PostMessageBridge,
): Promise<void> {
  await page.getByRole('button', { name: 'Start analysis' }).click();
  await expect(page.locator(ANALYZE)).toContainText('Analyzing workspace');
  await injectScanProgress(bridge);
  await injectRunningStream(bridge);
  await expect(page.locator(PHASE_HEADER)).toHaveText('Phase 2 of 4');
  await expect(
    page.locator('ol[aria-label="Analysis phases"] li[data-status="running"]'),
  ).toContainText('Architecture assessment');
  await expect(
    page.locator('[data-testid="details-log-counts"]'),
  ).toContainText('4 events');
}

async function expectInterrupted(page: Page): Promise<void> {
  await expect(page.locator(ANALYZE)).toContainText('Interrupted analysis');
  await expect(
    page.getByRole('button', { name: 'Continue previous run' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start fresh' })).toBeVisible();
}

async function expectFailed(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start analysis' }).click();
  await expect(page.locator(ANALYZE)).toContainText('Analysis failed');
}

async function expectCompleted(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Use' }).click();
  await expect(page.locator(ANALYZE)).toContainText('Analysis complete');
  await expect(
    page.getByRole('button', { name: 'Manual adjust' }),
  ).toBeVisible();
}

async function expectCatalogBanner(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="agent-only-banner"]')).toContainText(
    'No analysis is used; recommendations come from the workspace catalog',
  );
}

async function expectLoadedRecommendations(page: Page): Promise<void> {
  await expectCatalogBanner(page);
  // One badge per row (40% and 92%). Filter so strict mode does not see both.
  const match92 = page
    .locator('[data-testid="agent-recommendation-match"]')
    .filter({ hasText: '92% match' });
  await expect(match92).toHaveCount(1);
  await expect(
    page.locator('[data-testid="agent-recommendation-count"]'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-testid="agent-recommendation-count"]'),
  ).toContainText('1 selected');
}

async function expectOwnerConflict(page: Page): Promise<void> {
  await expectLoadedRecommendations(page);
  await expect(
    page.locator('[data-testid="choose-agents-preview-trigger"]'),
  ).toBeEnabled();
  await page.locator('[data-testid="choose-agents-preview-trigger"]').click();
  await expect(page.locator('[data-testid="preview-confirm"]')).toBeVisible();
  await page.locator('[data-testid="preview-confirm"]').click();
  await expect(
    page.locator('[data-testid="choose-agents-owner-banner"]'),
  ).toContainText('Another run is active.');
}

const SAVED_LIST_RPC = {
  'wizard:list-analyses': { analyses: [ANALYZE_SAVED_METADATA] },
} as const;

const COMPLETED_RPC = {
  'wizard:list-analyses': { analyses: [ANALYZE_SAVED_METADATA] },
  'wizard:load-analysis': COMPLETED_ANALYSIS,
} as const;

const INTERRUPTED_RPC = {
  'wizard:get-resumable-run': {
    analysis: INTERRUPTED_ANALYSIS,
    generation: null,
  },
} as const;

const RUNNING_RPC = {
  'wizard:deep-analyze': NEVER_ANSWERED,
} as const;

const FAILED_RPC = {
  'wizard:deep-analyze': () => rpcError('Deep analysis failed'),
} as const;

const SIZES: readonly {
  readonly name: string;
  readonly viewport: Size;
  readonly prefix: string;
}[] = [
  { name: 'wide', viewport: WIDE, prefix: '' },
  { name: 'narrow', viewport: NARROW, prefix: 'narrow-' },
];

for (const theme of ONBOARDING_CAPTURE_THEMES) {
  test.describe(`onboarding-analyze-visual (${theme})`, () => {
    for (const size of SIZES) {
      test(`${size.prefix}analyze-saved-list`, async ({
        page,
        fixtureServer,
      }) => {
        await boot(page, fixtureServer.url, theme, {
          viewport: size.viewport,
          rpc: SAVED_LIST_RPC,
        });
        await openAnalyze(page);
        await expectSavedList(page);
        await shoot(page, { view: `${size.prefix}analyze-saved-list`, theme });
      });

      test(`${size.prefix}analyze-running-phase-2`, async ({
        page,
        fixtureServer,
      }) => {
        const bridge = await boot(page, fixtureServer.url, theme, {
          viewport: size.viewport,
          rpc: RUNNING_RPC,
        });
        await openAnalyze(page);
        await expectRunningPhaseTwo(page, bridge);
        await shoot(page, {
          view: `${size.prefix}analyze-running-phase-2`,
          theme,
        });
      });

      test(`${size.prefix}analyze-interrupted`, async ({
        page,
        fixtureServer,
      }) => {
        await boot(page, fixtureServer.url, theme, {
          viewport: size.viewport,
          rpc: INTERRUPTED_RPC,
        });
        await openAnalyze(page);
        await expectInterrupted(page);
        await shoot(page, { view: `${size.prefix}analyze-interrupted`, theme });
      });

      test(`${size.prefix}analyze-failed`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, {
          viewport: size.viewport,
          rpc: FAILED_RPC,
        });
        await openAnalyze(page);
        await expectFailed(page);
        await shoot(page, { view: `${size.prefix}analyze-failed`, theme });
      });

      test(`${size.prefix}analyze-completed`, async ({
        page,
        fixtureServer,
      }) => {
        await boot(page, fixtureServer.url, theme, {
          viewport: size.viewport,
          rpc: COMPLETED_RPC,
        });
        await openAnalyze(page);
        await expectCompleted(page);
        await shoot(page, { view: `${size.prefix}analyze-completed`, theme });
      });

      test(`${size.prefix}agents-catalog-banner`, async ({
        page,
        fixtureServer,
      }) => {
        await boot(page, fixtureServer.url, theme, { viewport: size.viewport });
        await openAgentsCatalog(page);
        await expectCatalogBanner(page);
        await shoot(page, {
          view: `${size.prefix}agents-catalog-banner`,
          theme,
        });
      });

      test(`${size.prefix}agents-92-match`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, { viewport: size.viewport });
        await openAgentsCatalog(page);
        await expectLoadedRecommendations(page);
        await shoot(page, { view: `${size.prefix}agents-92-match`, theme });
      });

      test(`${size.prefix}agents-selection-count`, async ({
        page,
        fixtureServer,
      }) => {
        await boot(page, fixtureServer.url, theme, { viewport: size.viewport });
        await openAgentsCatalog(page);
        await expect(
          page.locator('[data-testid="agent-recommendation-count"]'),
        ).toContainText('1 selected');
        await shoot(page, {
          view: `${size.prefix}agents-selection-count`,
          theme,
        });
      });

      test(`${size.prefix}agents-owner-conflict`, async ({
        page,
        fixtureServer,
      }) => {
        await boot(page, fixtureServer.url, theme, { viewport: size.viewport });
        await openAgentsCatalog(page);
        await expectOwnerConflict(page);
        await shoot(page, {
          view: `${size.prefix}agents-owner-conflict`,
          theme,
        });
      });
    }
  });
}
