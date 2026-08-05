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

  /* ---------------------------------------------------------------------- */
  /* Community moderation — TASK_2026_177 Batch 7, R8.2 / R8.5              */
  /* ---------------------------------------------------------------------- */

  /**
   * ⚠️ A §8.2 EXIT-GATE ITEM, AND IT LIVES HERE RATHER THAN IN
   * `members-community.spec.ts` BECAUSE IT IS AN ADMIN SURFACE. Batch 5 deleted
   * the old `/admin/builders/community` screen together with the two endpoints
   * behind it; the gate is that the REPLACEMENT is reachable from the sidebar
   * and can write. A screen nobody can navigate to is not a delivered screen,
   * and a unit spec asserting the nav config proves the config, not the chrome.
   */
  test('Community is in the sidebar under Builders Content and its page loads', async ({
    adminPage,
  }) => {
    await adminPage.goto('/admin/overview');
    await expect(
      adminPage.getByRole('heading', { name: 'Overview' }),
    ).toBeVisible({ timeout: 15_000 });

    const communityLink = adminPage
      .getByRole('link', { name: 'Community', exact: true })
      .first();
    await expect(communityLink).toBeVisible();
    await expect(communityLink).toHaveAttribute(
      'href',
      '/admin/builders/community',
    );

    await communityLink.click();
    await expect(adminPage).toHaveURL(/\/admin\/builders\/community/);
    await expect(
      adminPage.getByRole('heading', { name: 'Community moderation' }),
    ).toBeVisible({ timeout: 15_000 });

    // The queue resolved — either rows or the empty state, never a raw error.
    await expect(
      adminPage.locator('ptah-thread-row, ptah-empty-state').first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  /**
   * The capability the deleted read-only surface did not have (R8.2).
   *
   * ⚠️ IT MODERATES A THREAD IT CREATED AND PUTS IT BACK. The seed from another
   * batch may be filling `community_*` right now, so this never touches a row it
   * did not make: it creates a topic through the MEMBER API as the admin's own
   * account (which holds Builders and is in ADMIN_EMAILS, so it is both), pins
   * it, unpins it, and deletes it. The audit rows those writes produce are
   * deliberately left in place — deleting audit rows to tidy a verification run
   * is exactly the instinct an audit log exists to defeat.
   */
  test('a pin round-trips against the live server, then is undone', async ({
    adminPage,
  }) => {
    await adminPage.goto('/admin/builders/community');
    await expect(
      adminPage.getByRole('heading', { name: 'Community moderation' }),
    ).toBeVisible({ timeout: 15_000 });

    // Create a topic through the member API, in the first category the admin
    // surface itself reports — so the fixture cannot reference a category that
    // does not exist on this database.
    const title = `E2E moderation probe ${Date.now()}`;
    const created = await adminPage.evaluate(async (topicTitle) => {
      const categories = await (
        await fetch('/api/v1/admin/community/categories', {
          credentials: 'include',
        })
      ).json();
      const categoryId = categories?.categories?.[0]?.id;
      if (!categoryId) return { skipped: true as const };

      const response = await fetch('/api/v1/members/community/topics', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          categoryId,
          title: topicTitle,
          bodyMarkdown: 'Created by the admin moderation e2e probe.',
        }),
      });
      return { skipped: false as const, status: response.status };
    }, title);

    test.skip(
      created.skipped,
      'No community category exists on this database yet — nothing to moderate.',
    );
    expect(created.status).toBe(201);

    await adminPage.reload();
    const row = adminPage.locator('li').filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // PIN — the write.
    await row.getByRole('button', { name: 'Pin', exact: true }).click();
    await expect(
      adminPage
        .locator('li')
        .filter({ hasText: title })
        .getByRole('button', { name: 'Unpin' }),
    ).toBeVisible({ timeout: 15_000 });

    // The pin is REAL: it survives a full reload, so it was persisted rather
    // than toggled locally.
    await adminPage.reload();
    await expect(
      adminPage
        .locator('li')
        .filter({ hasText: title })
        .getByRole('button', { name: 'Unpin' }),
    ).toBeVisible({ timeout: 15_000 });

    // Undo, then remove the probe topic (soft delete — the row survives as a
    // tombstone, which is the design, and the admin surface can still see it
    // behind "Show deleted").
    await adminPage
      .locator('li')
      .filter({ hasText: title })
      .getByRole('button', { name: 'Unpin' })
      .click();
    await expect(
      adminPage
        .locator('li')
        .filter({ hasText: title })
        .getByRole('button', { name: 'Pin', exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    await adminPage
      .locator('li')
      .filter({ hasText: title })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(
      adminPage.locator('li').filter({ hasText: title }),
    ).toHaveCount(0, { timeout: 15_000 });
  });
});
