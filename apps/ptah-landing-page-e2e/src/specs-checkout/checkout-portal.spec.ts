import { test, expect } from '../support/fixtures';

/**
 * Handoff §3.7 — Manage subscription / customer portal.
 *
 * The CTA only becomes a portal action ("Manage Subscription") when the pricing
 * grid's subscription state is an active Builder. That state comes from
 * `GET /api/v1/licenses/me` (SubscriptionStateService needs
 * `plan: 'builders'` + `subscription.status: 'active'`), so we stub it directly
 * on an authenticated page rather than depend on server-side entitlement mapping
 * of a seeded row. The portal-session endpoint is stubbed; clicking opens the
 * returned URL in a new tab. Paddle CDN is blocked (grid still inits Paddle).
 */
test('§3.7 manage subscription opens the customer portal in a new tab @checkout', async ({
  communityPage,
}) => {
  const PORTAL_URL = 'https://portal.example.test/session';

  // The portal opens via window.open AFTER an async POST, which Chromium's popup
  // blocker suppresses (no user-gesture). Capture window.open calls directly.
  await communityPage.addInitScript(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = (url?: string | URL) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    };
  });
  await communityPage.route(/cdn\.paddle\.com/, (route) => route.abort());
  await communityPage.route('**/api/v1/licenses/me', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        plan: 'builders',
        subscription: {
          status: 'active',
          currentPeriodEnd: '2026-12-31T00:00:00.000Z',
        },
      }),
    }),
  );
  await communityPage.route('**/api/v1/subscriptions/portal-session', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        url: PORTAL_URL,
        expiresAt: '2026-12-31T00:00:00.000Z',
      }),
    }),
  );

  await communityPage.goto('/pricing');

  const manage = communityPage.getByRole('button', {
    name: /Manage Subscription/i,
  });
  await expect(manage).toBeVisible({ timeout: 15_000 });
  await manage.click();

  await expect
    .poll(() =>
      communityPage.evaluate(
        () => (window as unknown as { __opened: string[] }).__opened,
      ),
    )
    .toContain(PORTAL_URL);
});
