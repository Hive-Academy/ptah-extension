/**
 * B3b Electron visual gate for onboarding A3, A4, and A5.
 * Mirrors B3a's four themes, 1280/464 px viewports, screenshot and axe capture.
 * Run after the coordinator builds the webview with grep: onboarding-generate-visual.
 */
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import type { PostMessageBridge } from '../../postmessage-bridge';
import {
  ONBOARDING_ANALYZE_CAPTURE_DIR,
  captureOnboarding,
  type OnboardingCaptureOptions,
} from './onboarding-ready-capture';
import { ONBOARDING_THEMES, type OnboardingTheme } from './onboarding-ready.fixtures';
import {
  AGENT_CHECKPOINT,
  AGENT_RUN_ID,
  AGENT_TAB,
  GUIDANCE_BINDING,
  GUIDANCE_CONTENT,
  GUIDANCE_RUN_ID,
  GUIDANCE_STATUS,
  GUIDANCE_TAB,
  agentRun,
  bootOnboardingGenerate,
  guidanceRun,
  rpcError,
} from './onboarding-generate.fixtures';

test.use({ useAppBuild: true });

const WIDE = { width: 1280, height: 800 } as const;
const NARROW = { width: 464, height: 800 } as const;
type Size = typeof WIDE | typeof NARROW;
const SIZES: readonly { viewport: Size; prefix: string }[] = [
  { viewport: WIDE, prefix: '' },
  { viewport: NARROW, prefix: 'narrow-' },
];
const CAPTURE_DIR = resolve(ONBOARDING_ANALYZE_CAPTURE_DIR, '../generate');
const GENERATE = '[data-testid="generate-agents-page"]';
const GUIDANCE = '[data-testid="project-guidance-page"]';
const DONE = '[data-testid="analyze-done-page"]';
const AGENT_ROUTE = `/onboarding/analyze/generate?tab=${AGENT_TAB}&run=${AGENT_RUN_ID}`;
const GUIDANCE_ROUTE = `/onboarding/analyze/guidance?tab=${GUIDANCE_TAB}&run=${GUIDANCE_RUN_ID}`;
const GUIDANCE_IDLE_ROUTE = `/onboarding/guidance?tab=${GUIDANCE_TAB}`;
const DONE_ROUTE = `/onboarding/analyze/done?gen=${AGENT_TAB}&tab=${GUIDANCE_TAB}`;

async function shoot(page: Page, options: OnboardingCaptureOptions): Promise<void> {
  const result = await captureOnboarding(page, {
    ...options,
    outputDir: CAPTURE_DIR,
    busyExempt: `${GENERATE}, ${GUIDANCE}, [data-testid="details-log"]`,
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
  viewport: Size,
  route: string,
  rpc: Record<string, unknown> = {},
): Promise<PostMessageBridge> {
  await page.setViewportSize(viewport);
  return bootOnboardingGenerate(page, url, { theme, route, rpc });
}

async function expectState(page: Page, area: 'generate' | 'guidance', state: string): Promise<void> {
  await expect(page.locator(`[data-testid="${area}-state-chip"]`)).toHaveAttribute('data-state', state);
}

for (const theme of ONBOARDING_THEMES) {
  test.describe(`onboarding-generate-visual (${theme})`, () => {
    for (const size of SIZES) {
      test(`${size.prefix}generate-running`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, size.viewport, AGENT_ROUTE, {
          'wizard:get-generation-run-state': { run: agentRun('running') },
          'wizard:get-resumable-run': { analysis: null, generation: AGENT_CHECKPOINT },
        });
        await expect(page.locator(GENERATE)).toBeVisible();
        await expectState(page, 'generate', 'running');
        await expect(page.locator('[data-testid="generate-agent-cards"]')).toBeVisible();
        await expect(page.getByRole('progressbar', { name: 'Agent generation progress' })).toBeVisible();
        await shoot(page, { view: `${size.prefix}generate-running`, theme });
      });

      test(`${size.prefix}generate-completed`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, size.viewport, AGENT_ROUTE, {
          'wizard:get-generation-run-state': { run: agentRun('completed') },
        });
        await expect(page.locator(GENERATE)).toBeVisible();
        await expectState(page, 'generate', 'completed');
        await expect(page.locator('[data-testid="generate-agent-card"]')).toHaveCount(3);
        await expect(page.locator('[data-testid="generate-agent-file"]')).toHaveCount(3);
        await expect(page.locator('[data-testid="generate-facts"]')).toContainText('1 written');
        await shoot(page, { view: `${size.prefix}generate-completed`, theme });
      });

      test(`${size.prefix}generate-failed`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, size.viewport, AGENT_ROUTE, {
          'wizard:get-generation-run-state': { run: agentRun('failed') },
        });
        await expect(page.locator(GENERATE)).toBeVisible();
        await expectState(page, 'generate', 'failed');
        await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
        await shoot(page, { view: `${size.prefix}generate-failed`, theme });
      });

      test(`${size.prefix}generate-mismatch`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, size.viewport,
          `/onboarding/analyze/generate?tab=${AGENT_TAB}&run=stale-agent-run`, {
            'wizard:get-generation-run-state': { run: agentRun('running') },
          });
        await expect(page.locator(GENERATE)).toBeVisible();
        await expect(page.locator('[data-testid="generate-recovery-panel"]')).toBeVisible();
        await shoot(page, { view: `${size.prefix}generate-mismatch`, theme });
      });

      test(`${size.prefix}generate-lookup-exhausted`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, size.viewport, AGENT_ROUTE, {
          'wizard:get-generation-run-state': () => rpcError('Generation state unavailable'),
        });
        await expect(page.locator(GENERATE)).toBeVisible();
        await expect(page.locator('[data-testid="generate-lookup-exhausted"]')).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('[data-testid="generate-lookup-exhausted"]')
          .getByRole('button', { name: 'Retry' })).toBeVisible();
        await shoot(page, { view: `${size.prefix}generate-lookup-exhausted`, theme });
      });

      test(`${size.prefix}guidance-idle`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, size.viewport, GUIDANCE_IDLE_ROUTE);
        await expect(page.locator(GUIDANCE)).toBeVisible();
        await expectState(page, 'guidance', 'idle');
        await expect(page.locator('[data-testid="guidance-start"]')).toBeVisible();
        await shoot(page, { view: `${size.prefix}guidance-idle`, theme });
      });

      test(`${size.prefix}guidance-running`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, size.viewport, GUIDANCE_ROUTE, {
          'enhancedPrompts:getRunState': { run: guidanceRun('running') },
          'enhancedPrompts:getStatus': GUIDANCE_STATUS,
        });
        await expect(page.locator(GUIDANCE)).toBeVisible();
        await expectState(page, 'guidance', 'running');
        await expect(page.locator('[data-testid="guidance-detected-stack"]')).toContainText('NestJS API');
        await shoot(page, { view: `${size.prefix}guidance-running`, theme });
      });

      test(`${size.prefix}guidance-completed`, async ({ page, fixtureServer }) => {
        let completed = false;
        const bridge = await boot(page, fixtureServer.url, theme, size.viewport, GUIDANCE_ROUTE, {
          'enhancedPrompts:getRunState': () => ({ run: guidanceRun(completed ? 'completed' : 'running') }),
          'enhancedPrompts:getStatus': GUIDANCE_STATUS,
          'enhancedPrompts:getPromptContent': { content: GUIDANCE_CONTENT },
        });
        await expect(page.locator(GUIDANCE)).toBeVisible();
        await expectState(page, 'guidance', 'running');
        completed = true;
        await bridge.inject({ type: 'setup-wizard:generation-complete', payload: {
          tabBinding: GUIDANCE_BINDING, terminalStatus: 'completed',
        } });
        await expectState(page, 'guidance', 'completed');
        await expect(page.locator('[data-testid="guidance-summary-card"]')).toBeVisible();
        await expect(page.locator('[data-testid="guidance-summary-row"]')).toHaveCount(4);
        await shoot(page, { view: `${size.prefix}guidance-completed`, theme });
        await page.screenshot({
          path: resolve(CAPTURE_DIR, `${size.prefix}guidance-completed-${theme}-${size.viewport.width}x${size.viewport.height}.png`),
          fullPage: true,
          animations: 'disabled',
        });
      });

      test(`${size.prefix}guidance-lookup-error`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, size.viewport, GUIDANCE_IDLE_ROUTE, {
          'enhancedPrompts:getRunState': () => rpcError('Guidance state unavailable'),
        });
        await expect(page.locator(GUIDANCE)).toBeVisible();
        await expect(page.locator('[data-testid="guidance-lookup-error"]')).toBeVisible();
        await expect(page.locator('[data-testid="guidance-lookup-error"]')
          .getByRole('button', { name: 'Retry' })).toBeVisible();
        await shoot(page, { view: `${size.prefix}guidance-lookup-error`, theme });
      });

      test(`${size.prefix}guidance-owner-conflict`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, size.viewport, GUIDANCE_IDLE_ROUTE, {
          'enhancedPrompts:runWizard': {
            success: false, rejection: { reason: 'blocked', ownerTabId: 'other-guidance-tab' },
          },
        });
        await expect(page.locator(GUIDANCE)).toBeVisible();
        await expect(page.locator('[data-testid="guidance-start"]')).toBeVisible();
        await page.locator('[data-testid="guidance-start"]').click();
        await expect(page.locator('[data-testid="guidance-owner-conflict"]')).toBeVisible();
        await shoot(page, { view: `${size.prefix}guidance-owner-conflict`, theme });
      });

      test(`${size.prefix}done-facts`, async ({ page, fixtureServer }) => {
        await boot(page, fixtureServer.url, theme, size.viewport, DONE_ROUTE, {
          'wizard:get-generation-run-state': { run: agentRun('completed') },
          'enhancedPrompts:getRunState': { run: guidanceRun('completed') },
          'enhancedPrompts:getStatus': GUIDANCE_STATUS,
        });
        await expect(page.locator(DONE)).toBeVisible();
        await expect(page.locator('[data-testid="analyze-done-facts"]')).toContainText('1 written');
        await expect(page.locator('[data-testid="analyze-done-facts"]')).toContainText('Project guidance: on');
        for (const id of ['done-open-chat', 'done-command-center', 'done-tribunal', 'done-run-again']) {
          await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
        }
        await shoot(page, { view: `${size.prefix}done-facts`, theme });
      });
    }
  });
}
