import { test, expect } from '@playwright/test';

/**
 * Checkout-mode smoke + §3.1 login bounce. These paths don't need Paddle to be
 * "ready" (the logged-out CTA bails at the auth check before any checkout call),
 * so they validate the checkout-mode build/serve infra on their own.
 *
 * The real Paddle CDN is blocked to keep runs fast/offline — the grid renders the
 * button regardless of whether Paddle finished initializing.
 */
test.describe('Checkout mode — basics @checkout', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/cdn\.paddle\.com/, (route) => route.abort());
    await page.goto('/pricing');
  });

  test('Builders CTA renders as a checkout BUTTON (proves checkout mode)', async ({
    page,
  }) => {
    // In checkout mode the Builders CTA is a <button> "Join Ptah Builders",
    // NOT the waitlist <a>. This is the definitive proof the flag build is live.
    const cta = page.getByRole('button', { name: /Join Ptah Builders/i });
    await expect(cta).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Join the Builders Waitlist/i }),
    ).toHaveCount(0);
  });

  test('promo-code affordance is present in checkout mode', async ({
    page,
  }) => {
    await expect(
      page.getByRole('button', { name: 'Promo code' }),
    ).toBeVisible();
  });

  test('§3.1 logged-out checkout click → login bounce with returnUrl + plan', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /Join Ptah Builders/i }).click();
    await page.waitForURL(/\/login\?/);
    const url = new URL(page.url());
    expect(url.pathname).toBe('/login');
    expect(url.searchParams.get('returnUrl')).toBe('/pricing');
    expect(url.searchParams.get('plan')).toBe('builders-monthly');
  });
});
