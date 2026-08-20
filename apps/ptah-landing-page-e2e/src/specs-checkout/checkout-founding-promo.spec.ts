import { test, expect } from '../support/fixtures';

/**
 * Handoff §3.5 (founding invite deep-link) and §3.6 (manual promo code). Both are
 * pure client behavior in checkout mode — no auth or Paddle needed, so the real
 * Paddle CDN is just blocked.
 */
test.describe('Checkout mode — founding + promo @checkout', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/cdn\.paddle\.com/, (route) => route.abort());
  });

  test('§3.5 founding deep-link shows the discount callout and selects yearly', async ({
    page,
  }) => {
    await page.goto('/pricing?promo=founding&cycle=yearly&d=dsc_e2e_test');

    // Checkout-mode wording (flag on).
    await expect(page.getByText(/Founding invite applied/i)).toBeVisible();

    // cycle=yearly flows through to the login-bounce plan key.
    await page.getByRole('button', { name: /Join Ptah Builders/i }).click();
    await page.waitForURL(/\/login\?/);
    expect(new URL(page.url()).searchParams.get('plan')).toBe(
      'builders-yearly',
    );
  });

  test('§3.6 manual promo code is uppercased and shown as applied', async ({
    page,
  }) => {
    await page.goto('/pricing');

    await page.getByRole('button', { name: 'Promo code' }).click();
    await page.getByRole('textbox', { name: 'Promo code' }).fill('save20');

    await expect(page.getByText(/SAVE20/)).toBeVisible();
    await expect(page.getByText(/applied at checkout/i)).toBeVisible();
  });
});
