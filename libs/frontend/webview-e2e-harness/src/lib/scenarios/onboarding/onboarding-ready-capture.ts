/**
 * The Get ready capture path (TASK_2026_ONBOARDING B1c, addendum component 12), modelled on
 * `settings-capture.ts`. Before each capture it:
 * - waits for the theme (and, in the contrast sweep, the scene and accent) to be applied to `<html>`;
 * - settles every region except the readiness panel and the strip, so `checking` (which is
 *   `aria-busy` by design) can still be captured;
 * - parks the pointer in the page corner, so no hover state is captured;
 * - screenshots with animations disabled.
 *
 * It then runs `@axe-core/playwright` on the same page and writes the violations next to the image
 * (`<name>.axe.json`). Violations are findings for the visual gate, not a capture failure.
 *
 * Files: `.ptah/specs/TASK_2026_ONBOARDING/screenshots/ready/<view>-<theme>-<w>x<h>.png`, resolved
 * from this file's location so the run is independent of `cwd`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import type { GlassAccent, GlassScene, OnboardingTheme } from './onboarding-ready.fixtures';

export const ONBOARDING_CAPTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../.ptah/specs/TASK_2026_ONBOARDING/screenshots/ready',
);

/** Regions whose in-progress state is the thing being captured, so they are never waited on. */
const READINESS_REGIONS = '[data-testid="ready-claude-panel"], [data-testid="ready-strip"]';
const BUSY = '[aria-busy="true"], .loading-spinner, [data-read-loading]';

export interface OnboardingCaptureOptions {
  /** View name, the first part of the file name (e.g. `stage1-missing`). */
  readonly view: string;
  readonly theme: OnboardingTheme;
  /** Contrast sweep only; the defaults (`aurora`, `gold`) leave `data-scene`/`data-accent` unset. */
  readonly scene?: GlassScene;
  readonly accent?: GlassAccent;
  /** Restrict axe to these rules (the contrast sweep runs `color-contrast` only). */
  readonly axeRules?: readonly string[];
}

export interface OnboardingCaptureResult {
  readonly imagePath: string;
  readonly axePath: string;
  readonly violations: number;
}

/** Asserts the theme, glass mode, scene and accent are on `<html>` (assumptions A5, A6). */
export async function waitForOnboardingTheme(
  page: Page,
  theme: OnboardingTheme,
  scene?: GlassScene,
  accent?: GlassAccent,
): Promise<void> {
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', theme);
  if (theme === 'ptah-glass' || theme === 'ptah-glass-light') {
    await expect(root).toHaveAttribute('data-glass', 'on');
    await expect(root).toHaveAttribute(
      'data-glass-mode',
      theme === 'ptah-glass' ? 'dark' : 'light',
    );
  } else {
    await expect(root).not.toHaveAttribute('data-glass');
  }
  if (scene && scene !== 'aurora') await expect(root).toHaveAttribute('data-scene', scene);
  if (accent && accent !== 'gold') await expect(root).toHaveAttribute('data-accent', accent);
}

/** Waits until no loading region is left outside the readiness panel and the strip. */
export async function waitForSettledOutsideReadiness(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page
        .locator(BUSY)
        .evaluateAll(
          (nodes, exempt) => nodes.filter((node) => !node.closest(exempt)).length,
          READINESS_REGIONS,
        ),
    )
    .toBe(0);
}

export function onboardingCapturePath(view: string, theme: string, width: number, height: number): string {
  return join(ONBOARDING_CAPTURE_DIR, `${view}-${theme}-${width}x${height}.png`);
}

export async function captureOnboarding(
  page: Page,
  options: OnboardingCaptureOptions,
): Promise<OnboardingCaptureResult> {
  mkdirSync(ONBOARDING_CAPTURE_DIR, { recursive: true });
  const viewport = page.viewportSize();
  expect(viewport, 'the page has a fixed viewport').not.toBeNull();
  const width = viewport?.width ?? 0;
  const height = viewport?.height ?? 0;
  await waitForOnboardingTheme(page, options.theme, options.scene, options.accent);
  await waitForSettledOutsideReadiness(page);
  await page.mouse.move(0, 0);
  const imagePath = onboardingCapturePath(options.view, options.theme, width, height);
  await page.screenshot({ path: imagePath, animations: 'disabled' });

  let axe = new AxeBuilder({ page });
  if (options.axeRules) axe = axe.withRules([...options.axeRules]);
  const results = await axe.analyze();
  const axePath = imagePath.replace(/\.png$/, '.axe.json');
  writeFileSync(
    axePath,
    JSON.stringify(
      {
        view: options.view,
        theme: options.theme,
        scene: options.scene ?? 'aurora',
        accent: options.accent ?? 'gold',
        viewport: { width, height },
        rules: options.axeRules ?? 'all',
        violations: results.violations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.map((node) => ({
            target: node.target,
            summary: node.failureSummary,
          })),
        })),
      },
      null,
      2,
    ),
  );
  return { imagePath, axePath, violations: results.violations.length };
}
