import { test, expect } from '@playwright/test';

/**
 * Handoff §2.2 — Pricing page renders in waitlist mode (checkout OFF).
 *
 * Pure client render, gated on the COMPILE-TIME flag
 * `environment.buildersCheckoutEnabled` (default `false`). No backend needed.
 * Component: `ptah-pricing-grid` (pricing-grid.component.ts).
 *
 * In waitlist mode the Builders CTA is a plain <a> → `/#waitlist` (an <a>, not a
 * <button>, is the cleanest proof of mode), the promo-code option is absent, and
 * the Free CTA opens the VS Code marketplace in a new tab.
 *
 * NOTE: if these fail with the CTA rendered as a <button>, the dev server was
 * built with `buildersCheckoutEnabled: true` — flip it back to `false` (§1.1).
 */
test.describe('Pricing — waitlist mode @p0', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/pricing');
  });

  test('Builders CTA is a waitlist link to /#waitlist, not a checkout button', async ({
    page,
  }) => {
    const cta = page.getByRole('link', { name: /Join the Builders Waitlist/ });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', /#waitlist$/);
  });

  test('promo-code option is hidden while checkout is closed', async ({
    page,
  }) => {
    await expect(page.getByRole('button', { name: 'Promo code' })).toHaveCount(
      0,
    );
  });

  test('Free CTA opens the VS Code marketplace in a new tab', async ({
    page,
    context,
  }) => {
    const [popup] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: 'Free' }).click(),
    ]);
    await expect
      .poll(() => popup.url())
      .toContain('marketplace.visualstudio.com');
  });
});
