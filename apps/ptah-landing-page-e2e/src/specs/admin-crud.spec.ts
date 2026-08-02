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

    // `subscriptions` no longer resolves through the generic table — it merged
    // into the user surface — so the read-only badge is asserted on the audit
    // log, which is still a generic read-only model.
    await adminPage.goto('/admin/admin-audit-log');
    await expect(
      adminPage.getByRole('heading', { name: 'Audit Log' }),
    ).toBeVisible();
    await expect(adminPage.getByText('read-only')).toBeVisible();
  });

  test('licenses + subscriptions slugs redirect into the merged user surface', async ({
    adminPage,
  }) => {
    // Both standalone tabs were merged into Users. The redirects exist so old
    // bookmarks land on the merged view instead of falling through to the
    // generic table, which would silently restore the split.
    for (const slug of ['/admin/licenses', '/admin/subscriptions']) {
      await adminPage.goto(slug);
      await expect(
        adminPage.getByRole('heading', { name: 'Users' }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(adminPage).toHaveURL(/\/admin\/users/);
    }
  });

  test('the merged user surface shows license + subscription per row', async ({
    adminPage,
  }) => {
    await adminPage.goto('/admin/users');
    await expect(adminPage.getByRole('heading', { name: 'Users' })).toBeVisible(
      {
        timeout: 15_000,
      },
    );
    await expect(
      adminPage.getByRole('columnheader', { name: 'License' }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole('columnheader', { name: 'Paddle Subscription' }),
    ).toBeVisible();
    // The entitlement lenses replace the removed Revenue & Licensing nav group.
    await expect(
      adminPage.getByRole('tab', { name: 'Paddle subscriber' }),
    ).toBeVisible();
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
    // `users` resolves to the bespoke UserProfile, not the generic AdminDetail —
    // its back affordance is labelled with the list it returns to.
    await expect(
      adminPage.getByRole('button', { name: 'Users' }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole('heading', { name: 'Billing & Entitlement' }),
    ).toBeVisible();
  });
});
