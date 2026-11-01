/**
 * B4b Electron proposal captures. The coordinator runs these after building the webview.
 * Each state is captured in four themes at 1280 and 464 px, except the narrow-only sheet.
 */
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import {
  ONBOARDING_ANALYZE_CAPTURE_DIR,
  captureOnboarding,
  type OnboardingCaptureOptions,
} from './onboarding-ready-capture';
import {
  ONBOARDING_CAPTURE_THEMES,
  type OnboardingTheme,
} from './onboarding-ready.fixtures';
import {
  FIRST_REVISION,
  SECOND_REVISION,
  TAB,
  bootOnboardingProposal,
  type ProposalScene,
} from './onboarding-proposal.fixtures';

test.use({ useAppBuild: true });

const WIDE = { width: 1280, height: 800 } as const;
const NARROW = { width: 464, height: 800 } as const;
type Size = typeof WIDE | typeof NARROW;
const SIZES: readonly { viewport: Size; prefix: string }[] = [
  { viewport: WIDE, prefix: '' },
  { viewport: NARROW, prefix: 'narrow-' },
];
const CAPTURE_DIR = resolve(ONBOARDING_ANALYZE_CAPTURE_DIR, '../proposal');
const INTAKE_ROUTE = '/onboarding/new-project';
const TEAM_ROUTE = '/onboarding/team-builder';
const WORKSPACE_ROUTE = `/onboarding/new-project/workspace?tab=${TAB}`;
const reviewRoute = (revision: string) =>
  `/onboarding/new-project/review?tab=${TAB}&rev=${revision}`;

async function shoot(
  page: Page,
  options: OnboardingCaptureOptions,
): Promise<void> {
  const result = await captureOnboarding(page, {
    ...options,
    outputDir: CAPTURE_DIR,
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
  scene: ProposalScene,
): Promise<void> {
  await page.setViewportSize(viewport);
  await bootOnboardingProposal(page, url, { theme, route, scene });
}

for (const theme of ONBOARDING_CAPTURE_THEMES) {
  test.describe(`onboarding-proposal-visual (${theme})`, () => {
    for (const size of SIZES) {
      test(`${size.prefix}new-project-intake`, async ({
        page,
        fixtureServer,
      }) => {
        await boot(
          page,
          fixtureServer.url,
          theme,
          size.viewport,
          INTAKE_ROUTE,
          'empty',
        );
        await expect(page.getByTestId('new-project-intake')).toBeVisible();
        await expect(
          page.getByRole('textbox', { name: 'What are you building?' }),
        ).toBeVisible();
        await shoot(page, { view: `${size.prefix}new-project-intake`, theme });
      });

      test(`${size.prefix}new-project-intake-errors`, async ({
        page,
        fixtureServer,
      }) => {
        await boot(
          page,
          fixtureServer.url,
          theme,
          size.viewport,
          INTAKE_ROUTE,
          'empty',
        );
        await page
          .getByRole('button', { name: 'Continue', exact: true })
          .click();
        await expect(
          page.getByRole('alert').filter({ hasText: 'Check your answers:' }),
        ).toBeVisible();
        await expect(page.locator('#project-what-error')).toBeVisible();
        await shoot(page, {
          view: `${size.prefix}new-project-intake-errors`,
          theme,
        });
      });

      test(`${size.prefix}team-builder-start`, async ({
        page,
        fixtureServer,
      }) => {
        await boot(
          page,
          fixtureServer.url,
          theme,
          size.viewport,
          TEAM_ROUTE,
          'empty',
        );
        await expect(page.getByTestId('team-builder-start')).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Start team builder' }),
        ).toBeVisible();
        await shoot(page, { view: `${size.prefix}team-builder-start`, theme });
      });

      test(`${size.prefix}workspace-first-revision`, async ({
        page,
        fixtureServer,
      }) => {
        await boot(
          page,
          fixtureServer.url,
          theme,
          size.viewport,
          WORKSPACE_ROUTE,
          'first',
        );
        await expect(page.getByTestId('proposal-panel')).toBeVisible();
        await expect(
          page.getByText('Revision 1', { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('heading', { name: 'From your intake' }),
        ).toBeVisible();
        await expect(page.getByText('ptah-nx-saas')).toBeVisible();
        await shoot(page, {
          view: `${size.prefix}workspace-first-revision`,
          theme,
        });
      });

      test(`${size.prefix}workspace-second-revision`, async ({
        page,
        fixtureServer,
      }) => {
        await boot(
          page,
          fixtureServer.url,
          theme,
          size.viewport,
          WORKSPACE_ROUTE,
          'second',
        );
        await expect(page.getByTestId('proposal-panel')).toBeVisible();
        await expect(
          page.getByText('Revision 2', { exact: true }),
        ).toBeVisible();
        await expect(page.getByText('New', { exact: true })).toBeVisible();
        await expect(page.getByText('Changed', { exact: true })).toBeVisible();
        await page.getByText('Revision history · 2').click();
        await expect(page.getByText('Revision 1 · In progress')).toBeVisible();
        await shoot(page, {
          view: `${size.prefix}workspace-second-revision`,
          theme,
        });
      });

      test(`${size.prefix}workspace-unavailable`, async ({
        page,
        fixtureServer,
      }) => {
        await boot(
          page,
          fixtureServer.url,
          theme,
          size.viewport,
          WORKSPACE_ROUTE,
          'unavailable',
        );
        await expect(
          page.getByRole('heading', { name: 'Proposal unavailable' }),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Start over' }),
        ).toBeVisible();
        await shoot(page, {
          view: `${size.prefix}workspace-unavailable`,
          theme,
        });
      });

      test(`${size.prefix}review-pinned`, async ({ page, fixtureServer }) => {
        await boot(
          page,
          fixtureServer.url,
          theme,
          size.viewport,
          reviewRoute(FIRST_REVISION),
          'second',
        );
        await expect(page.getByTestId('review-apply')).toBeVisible();
        await expect(page.getByTestId('newer-revision-banner')).toBeVisible();
        await expect(page.getByTestId('newer-revision-banner')).toContainText(
          'Revision 2 is available',
        );
        await page
          .getByTestId('newer-revision-banner')
          .scrollIntoViewIfNeeded();
        await shoot(page, { view: `${size.prefix}review-pinned`, theme });
      });

      test(`${size.prefix}review-current`, async ({ page, fixtureServer }) => {
        await boot(
          page,
          fixtureServer.url,
          theme,
          size.viewport,
          reviewRoute(SECOND_REVISION),
          'second',
        );
        await expect(page.getByTestId('review-apply')).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Apply to Workspace' }),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Apply to Workspace' }),
        ).toBeEnabled();
        await page
          .getByRole('button', { name: 'Apply to Workspace' })
          .scrollIntoViewIfNeeded();
        await shoot(page, { view: `${size.prefix}review-current`, theme });
      });

      test(`${size.prefix}apply-result`, async ({ page, fixtureServer }) => {
        await boot(
          page,
          fixtureServer.url,
          theme,
          size.viewport,
          reviewRoute(SECOND_REVISION),
          'second',
        );
        await expect(
          page.getByRole('button', { name: 'Apply to Workspace' }),
        ).toBeEnabled();
        await page.getByRole('button', { name: 'Apply to Workspace' }).click();
        await expect(
          page.getByRole('heading', { name: 'Next steps' }),
        ).toBeVisible();
        // Re-enter review: the receipt is persisted, and the result opens with full details.
        await page.getByRole('button', { name: 'Back to proposal' }).click();
        await expect(page.getByTestId('proposal-panel')).toBeVisible();
        await page.getByRole('button', { name: 'Review', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'Applied revision' }),
        ).toBeVisible();
        await expect(
          page.getByRole('list', { name: 'Applied paths' }),
        ).toContainText('CLAUDE.md');
        await expect(
          page.getByRole('heading', { name: 'Warnings' }),
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Done', exact: true }),
        ).toBeVisible();
        await page
          .getByRole('heading', { name: 'Applied revision' })
          .scrollIntoViewIfNeeded();
        await page
          .getByRole('button', { name: 'Done', exact: true })
          .scrollIntoViewIfNeeded();
        await shoot(page, { view: `${size.prefix}apply-result`, theme });
      });
    }

    test('narrow-workspace-answer-sheet', async ({ page, fixtureServer }) => {
      await boot(
        page,
        fixtureServer.url,
        theme,
        NARROW,
        WORKSPACE_ROUTE,
        'second',
      );
      await expect(page.getByTestId('proposal-panel')).toBeVisible();
      await page.locator('button[aria-controls="answer-dock-sheet"]').click();
      const sheet = page.getByRole('dialog', { name: 'Reply to the agent' });
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAttribute('aria-modal', 'true');
      await expect(
        sheet.getByRole('textbox', { name: 'Reply to the agent' }),
      ).toBeFocused();
      await shoot(page, { view: 'narrow-workspace-answer-sheet', theme });
    });
  });
}
