import { test, expect } from '../support/fixtures';
import { getCheckoutOpenOptions, stubPaddle } from './_paddle';

const MONTHLY_PRICE_ID = 'pri_01kxx5bgmepb6w0y43sqk7szaz';

/**
 * Handoff §3.4 — post-login auto-checkout via `?autoCheckout=<planKey>`.
 */
test.describe('Checkout mode — auto-checkout @checkout', () => {
  test('invalid plan key → error alert, no checkout', async ({ page }) => {
    await page.route(/cdn\.paddle\.com/, (route) => route.abort());
    await page.goto('/pricing?autoCheckout=not-a-plan');

    await expect(page.getByText(/Invalid checkout plan/i)).toBeVisible();
  });

  test('valid plan key (logged in) auto-opens the overlay with that price', async ({
    communityPage,
  }) => {
    await stubPaddle(communityPage);
    await communityPage.route(
      '**/api/v1/subscriptions/validate-checkout',
      (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ canCheckout: true }),
        }),
    );
    await communityPage.route(
      '**/api/v1/subscriptions/checkout-info',
      (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({}),
        }),
    );

    await communityPage.goto('/pricing?autoCheckout=builders-monthly');

    // Auto-checkout polls Paddle-ready then opens without a manual click.
    await expect
      .poll(() => getCheckoutOpenOptions(communityPage), { timeout: 15_000 })
      .not.toBeNull();
    const opts = await getCheckoutOpenOptions(communityPage);
    expect(opts?.items?.[0]?.priceId).toBe(MONTHLY_PRICE_ID);
  });
});
