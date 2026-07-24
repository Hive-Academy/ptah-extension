import { test, expect } from '../support/fixtures';

/**
 * Handoff §7 — Admin dashboard CRUD (`/admin/**`, AdminAuthGuard). Runs against
 * the real admin backend (read-only reads), so gated on `E2E_ADMIN_EMAIL` (that
 * address must be in the server ADMIN_EMAILS allowlist).
 */
test.describe('Admin dashboard @admin', () => {
  test.beforeEach(() => {
    test.skip(
      !process.env['E2E_ADMIN_EMAIL'],
      'Set E2E_ADMIN_EMAIL (also in server ADMIN_EMAILS) to run admin specs.',
    );
  });

  test('§7.1 /admin redirects to overview and renders stat tiles', async ({
    adminPage,
  }) => {
    await adminPage.goto('/admin');
    await adminPage.waitForURL(/\/admin\/overview/);

    await expect(
      adminPage.getByRole('heading', { name: 'Overview' }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      adminPage.getByRole('heading', { name: 'Builders Waitlist' }),
    ).toBeVisible();
    await expect(adminPage.getByText('Total Signups')).toBeVisible();
    await expect(
      adminPage.getByRole('heading', { name: 'Members' }),
    ).toBeVisible();
  });

  test('§7.2 model list renders the model heading; read-only models are badged', async ({
    adminPage,
  }) => {
    await adminPage.goto('/admin/users');
    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible(
      {
        timeout: 15_000,
      },
    );

    await adminPage.goto('/admin/subscriptions');
    await expect(
      adminPage.getByRole('heading', { name: 'Subscriptions' }),
    ).toBeVisible();
    await expect(adminPage.getByText('read-only')).toBeVisible();
  });

  test('§7.2 unknown model slug → client-side warning, no crash', async ({
    adminPage,
  }) => {
    await adminPage.goto('/admin/not-a-model');
    await expect(
      adminPage.getByText(
        'Unknown admin model. Pick a model from the sidebar.',
      ),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('§7.3 row click opens the record detail view', async ({ adminPage }) => {
    await adminPage.goto('/admin/users');
    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible(
      {
        timeout: 15_000,
      },
    );

    // Click the first data cell (not the checkbox column) → navigate to detail.
    const firstDataCell = adminPage
      .locator('tbody tr')
      .first()
      .locator('td')
      .nth(1);
    await firstDataCell.waitFor({ state: 'visible' });
    await firstDataCell.click();

    await adminPage.waitForURL(/\/admin\/users\/[^/]+$/);
    await expect(
      adminPage.getByRole('button', { name: '← Back' }),
    ).toBeVisible();
  });
});
