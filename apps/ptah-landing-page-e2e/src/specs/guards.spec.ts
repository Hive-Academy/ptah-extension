import { test, expect } from '../support/fixtures';

/**
 * Handoff §9 — route guards (redirect behavior). Pure URL assertions against the
 * real backend: the guest `page` has no auth; `communityPage` is an
 * authenticated non-admin user.
 *
 * - AuthGuard (/profile, /members): guest → /login
 * - GuestGuard (/login, /signup): authenticated → /profile
 * - AdminAuthGuard (/admin): guest → /login?returnUrl=/admin ; non-admin → /profile
 */
test.describe('Route guards @guards', () => {
  test('guest → /profile bounces to /login', async ({ page }) => {
    await page.goto('/profile');
    await page.waitForURL(/\/login/);
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('guest → /members bounces to /login', async ({ page }) => {
    await page.goto('/members');
    await page.waitForURL(/\/login/);
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('guest → /admin bounces to /login with returnUrl=/admin', async ({
    page,
  }) => {
    await page.goto('/admin');
    await page.waitForURL(/\/login/);
    expect(new URL(page.url()).searchParams.get('returnUrl')).toBe('/admin');
  });

  test('authenticated user → /login bounces to /profile (GuestGuard)', async ({
    communityPage,
  }) => {
    await communityPage.goto('/login');
    await communityPage.waitForURL(/\/profile/);
    expect(new URL(communityPage.url()).pathname).toBe('/profile');
  });

  test('non-admin → /admin bounces to /profile (AdminAuthGuard 403)', async ({
    communityPage,
  }) => {
    await communityPage.goto('/admin');
    await communityPage.waitForURL(/\/profile/);
    expect(new URL(communityPage.url()).pathname).toBe('/profile');
  });
});
