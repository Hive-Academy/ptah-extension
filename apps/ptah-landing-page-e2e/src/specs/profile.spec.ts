import { test, expect } from '../support/fixtures';

/**
 * Handoff §6 — Profile page (`/profile`, AuthGuard). `communityPage` clears the
 * guard (real `/api/auth/me`); `/api/v1/licenses/me` is stubbed to an active
 * Builder so the reveal-key / sync / manage affordances render (they gate on
 * `plan:'builders'` + non-null `subscription`). The SSE ticket is stubbed to 401
 * so no EventSource opens during the test.
 */
const BUILDER_LICENSE = {
  user: {
    email: 'e2e-profile@ptah.local',
    firstName: null,
    lastName: null,
    memberSince: '2026-01-01T00:00:00.000Z',
    emailVerified: true,
  },
  plan: 'builders',
  planName: 'Ptah Builders',
  planDescription: 'Founding member',
  status: 'active',
  expiresAt: null,
  features: ['Members area', 'Live sessions'],
  subscription: {
    status: 'active',
    currentPeriodEnd: '2026-12-31T00:00:00.000Z',
    canceledAt: null,
  },
  checkoutEnabled: false,
};

test.describe('Profile page @profile', () => {
  test.beforeEach(async ({ communityPage }) => {
    await communityPage.route('**/api/v1/licenses/me', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(BUILDER_LICENSE),
      }),
    );
    await communityPage.route('**/api/auth/stream/ticket', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: '{}',
      }),
    );
  });

  test('§6.1 account loads', async ({ communityPage }) => {
    await communityPage.goto('/profile');
    await expect(
      communityPage.getByRole('heading', { name: 'Account Details' }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('§6.5 reveal license key shows the ptah_lic_ key', async ({
    communityPage,
  }) => {
    const KEY = 'ptah_lic_e2e_1234567890abcdef';
    await communityPage.route('**/api/v1/licenses/me/reveal-key', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          licenseKey: KEY,
          plan: 'builders',
        }),
      }),
    );

    await communityPage.goto('/profile');
    await communityPage
      .getByRole('button', { name: 'Get License Key' })
      .click();
    // Key renders masked by default — reveal it.
    await communityPage
      .getByRole('button', { name: 'Show license key' })
      .click();
    await expect(communityPage.locator('code', { hasText: KEY })).toBeVisible();
  });

  test('§6.4 manage subscription opens the customer portal', async ({
    communityPage,
  }) => {
    const PORTAL_URL = 'https://portal.example.test/profile-session';
    await communityPage.addInitScript(() => {
      (window as unknown as { __opened: string[] }).__opened = [];
      window.open = (url?: string | URL) => {
        (window as unknown as { __opened: string[] }).__opened.push(
          String(url),
        );
        return null;
      };
    });
    await communityPage.route(
      '**/api/v1/subscriptions/portal-session',
      (route) =>
        route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            url: PORTAL_URL,
            expiresAt: '2026-12-31T00:00:00.000Z',
          }),
        }),
    );

    await communityPage.goto('/profile');
    await communityPage
      .getByRole('button', { name: 'Manage Subscription' })
      .click();
    await expect
      .poll(() =>
        communityPage.evaluate(
          () => (window as unknown as { __opened: string[] }).__opened,
        ),
      )
      .toContain(PORTAL_URL);
  });

  test('§6.3 sync with Paddle shows a success banner', async ({
    communityPage,
  }) => {
    await communityPage.route('**/api/v1/subscriptions/reconcile', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          changes: {
            subscriptionUpdated: false,
            licenseUpdated: false,
            statusBefore: 'active',
            statusAfter: 'active',
          },
        }),
      }),
    );

    await communityPage.goto('/profile');
    await communityPage
      .getByRole('button', { name: 'Sync with Paddle' })
      .click();
    await expect(
      communityPage.getByText('Subscription synced successfully'),
    ).toBeVisible();
  });

  test('§6.6 tabs switch and /sessions redirects to /profile', async ({
    communityPage,
  }) => {
    await communityPage.goto('/profile');
    const sessionsTab = communityPage.getByRole('tab', { name: 'Sessions' });
    await sessionsTab.click();
    await expect(sessionsTab).toHaveAttribute('aria-selected', 'true');

    // /sessions and /contact are redirect-only shims → /profile.
    await communityPage.goto('/sessions');
    await communityPage.waitForURL(/\/profile/);
    expect(new URL(communityPage.url()).pathname).toBe('/profile');
  });
});
