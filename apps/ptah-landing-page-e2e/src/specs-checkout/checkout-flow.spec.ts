import { test, expect } from '../support/fixtures';
import { getCheckoutOpenOptions, stubPaddle } from './_paddle';

const MONTHLY_PRICE_ID = 'pri_01kxx5bgmepb6w0y43sqk7szaz';
const CTA = { name: /Join Ptah Builders/i };

/**
 * Handoff §3.2 (checkout completes → /profile) and §3.3 (duplicate-subscription
 * block). Both use an authenticated community user (`communityPage`) so the real
 * backend resolves auth (`/api/auth/me`, `/licenses/me`) and the CTA renders as
 * the "join" checkout button. The Paddle SDK + the subscription endpoints are
 * stubbed (§8.4 — never drive the real cross-origin overlay).
 */
test.describe('Checkout mode — flow @checkout', () => {
  test('§3.2 logged-in checkout completes → validate/info called, overlay opens, navigates /profile', async ({
    communityPage,
  }) => {
    await stubPaddle(communityPage, { autoComplete: true });

    let validateCalled = false;
    let infoCalled = false;
    await communityPage.route(
      '**/api/v1/subscriptions/validate-checkout',
      (route) => {
        validateCalled = true;
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ canCheckout: true }),
        });
      },
    );
    await communityPage.route(
      '**/api/v1/subscriptions/checkout-info',
      (route) => {
        infoCalled = true;
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ email: 'e2e-checkout@ptah.local' }),
        });
      },
    );

    await communityPage.goto('/pricing');
    await communityPage.getByRole('button', CTA).click();

    // The pre-open chain ran and the (stubbed) overlay opened with the monthly price.
    await expect
      .poll(() => getCheckoutOpenOptions(communityPage))
      .not.toBeNull();
    const opts = await getCheckoutOpenOptions(communityPage);
    expect(opts?.items?.[0]?.priceId).toBe(MONTHLY_PRICE_ID);
    expect(validateCalled).toBe(true);
    expect(infoCalled).toBe(true);

    // checkout.completed (stub-fired) → navigate to /profile.
    await communityPage.waitForURL(/\/profile$/, { timeout: 15_000 });
  });

  test('§3.3 duplicate subscription → validation alert + portal link, overlay never opens', async ({
    communityPage,
  }) => {
    await stubPaddle(communityPage); // ready, but no auto-complete
    await communityPage.route(
      '**/api/v1/subscriptions/validate-checkout',
      (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            canCheckout: false,
            reason: 'existing_subscription',
            customerPortalUrl: 'https://portal.example.test/session',
            message: 'You already have an active Builders subscription.',
          }),
        }),
    );

    await communityPage.goto('/pricing');
    await communityPage.getByRole('button', CTA).click();

    const alert = communityPage.locator('.alert-error', {
      hasText: 'You already have an active Builders subscription.',
    });
    await expect(alert).toBeVisible();
    await expect(
      communityPage.getByRole('link', { name: /Manage your subscription/i }),
    ).toHaveAttribute('href', 'https://portal.example.test/session');

    // Overlay must never have opened.
    expect(await getCheckoutOpenOptions(communityPage)).toBeNull();
  });
});
