import type { Locator, Page } from '@playwright/test';

/**
 * The canvas New session trigger that is on screen: the empty-board hero's
 * button while the board has no session (the Rail is hidden behind its
 * Sessions tab then), otherwise the Rail footer's. The hero loads in a
 * `@defer` chunk, so this waits for one of them to become visible instead of
 * checking once. Only the visible (active-workspace) canvas copy counts.
 */
export async function visibleNewSessionTrigger(
  page: Page,
  timeout = 30_000,
): Promise<Locator> {
  const hero = page
    .locator('[data-testid="canvas-hero-new-session"]')
    .locator('visible=true');
  const footer = page
    .locator('[data-testid="canvas-footer-new-session"]')
    .locator('visible=true');
  const trigger = hero.or(footer).first();
  await trigger.waitFor({ state: 'visible', timeout });
  return trigger;
}
