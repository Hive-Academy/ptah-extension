import { test, expect } from '../support/fixtures';

/**
 * Handoff §5 — auth. The §5.5 open-redirect guard is a SECURITY regression check
 * and is driven deterministically by stubbing the login endpoint (the guard runs
 * in `navigateAfterAuth` after a successful login, so no real WorkOS is needed).
 * §5.6 logout uses the real backend. The full real-WorkOS sign-in (§5.1) is
 * scaffolded behind a tag and skipped unless E2E_REALAUTH=1.
 */
const OWN_ORIGIN = 'http://localhost:4200';

async function stubLoginSuccess(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.route('**/api/auth/login/email', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    }),
  );
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        authenticated: true,
        user: { email: 'e2e-auth@ptah.local' },
      }),
    }),
  );
}

async function submitLogin(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.locator('#email').fill('e2e-auth@ptah.local');
  await page.locator('#password').fill('password1234');
  // Two "Sign In" controls exist (a mode-toggle tab + the form submit); the
  // submit is last in DOM order.
  await page.getByRole('button', { name: 'Sign In' }).last().click();
}

test.describe('Auth — return-URL guard & logout @auth', () => {
  test('§5.5 disallowed absolute returnUrl → /profile, never off-origin', async ({
    page,
  }) => {
    await stubLoginSuccess(page);
    await page.goto('/login?returnUrl=https://evil.example.com/attack');
    await submitLogin(page);

    await page.waitForURL(/\/profile/);
    const url = new URL(page.url());
    expect(url.origin).toBe(OWN_ORIGIN); // never navigated to evil.example.com
    expect(url.pathname).toBe('/profile');
  });

  test('§5.5 own-origin absolute returnUrl is honored', async ({ page }) => {
    await stubLoginSuccess(page);
    await page.goto(`/login?returnUrl=${OWN_ORIGIN}/pricing`);
    await submitLogin(page);

    await page.waitForURL(/\/pricing/);
    expect(new URL(page.url()).pathname).toBe('/pricing');
  });

  test('§5.6 logout calls the logout endpoint and returns home', async ({
    communityPage,
  }) => {
    let logoutCalled = false;
    await communityPage.route('**/api/auth/logout', (route) => {
      logoutCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      });
    });
    await communityPage.goto('/profile');

    await communityPage
      .getByRole('button', { name: 'Sign out of your account' })
      .first()
      .click();

    // handleLogout hard-navigates to '/' after POST /api/auth/logout.
    // (The hint isn't asserted: the fixture re-injects it via addInitScript on
    // every navigation, so it's not a meaningful post-logout signal here.)
    await communityPage.waitForURL(new RegExp(`${OWN_ORIGIN}/?$`));
    expect(logoutCalled).toBe(true);
  });

  test('§5.1 email/password sign-in (real WorkOS)', async ({ page }) => {
    test.skip(
      process.env['E2E_REALAUTH'] !== '1',
      'Real WorkOS flow — set E2E_REALAUTH=1 (+ E2E_AUTH_EMAIL/E2E_AUTH_PASSWORD) to run.',
    );
    await page.goto('/login');
    await page.locator('#email').fill(process.env['E2E_AUTH_EMAIL'] ?? '');
    await page
      .locator('#password')
      .fill(process.env['E2E_AUTH_PASSWORD'] ?? '');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.waitForURL(/\/profile/);
  });
});
