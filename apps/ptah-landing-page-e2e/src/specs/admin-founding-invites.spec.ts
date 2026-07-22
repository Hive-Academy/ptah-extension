import type { Request } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { cleanupWaitlistEntry, seedWaitlistEntry } from '../support/db';

/**
 * Handoff §7.4 — Send Founding Invites (`/admin/waitlist` → modal).
 *
 * Reaches the real admin surface (the `adminPage` fixture's email must be in the
 * server ADMIN_EMAILS allowlist — the guard probes `GET /admin/users` for real),
 * and the waitlist list loads real rows. Only the side-effecting send,
 * `POST /api/v1/admin/waitlist/invite`, is intercepted — we assert the request
 * SHAPE (`ids` vs `batchSize`) and stub `{ invited, skipped }`, so the test never
 * emails real founding invites via Resend.
 *
 * Skipped unless `E2E_ADMIN_EMAIL` is set (admin config is env-specific, §7).
 */
test.describe('Admin — Send Founding Invites @p0', () => {
  test.beforeEach(() => {
    test.skip(
      !process.env['E2E_ADMIN_EMAIL'],
      'Set E2E_ADMIN_EMAIL (also in server ADMIN_EMAILS) to run admin specs.',
    );
  });

  const openModal = { name: /Send Founding Invites/ };
  const sendBtn = { name: 'Send Invites' };

  test('oldest-N mode posts { batchSize } and shows the result', async ({
    adminPage,
  }) => {
    const seededId = seedWaitlistEntry(`e2e-invite-${Date.now()}@ptah.local`);
    let invite: Request | undefined;
    await adminPage.route('**/api/v1/admin/waitlist/invite', (route) => {
      invite = route.request();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ invited: 3, skipped: 1 }),
      });
    });

    try {
      await adminPage.goto('/admin/waitlist');
      await adminPage.getByRole('button', openModal).click();

      // No rows selected → modal defaults to "Invite oldest N".
      await adminPage.getByRole('radio', { name: 'Invite oldest N' }).check();
      await adminPage.locator('.modal input[type="number"]').fill('5');
      await adminPage.getByRole('button', sendBtn).click();

      await expect(adminPage.getByText(/Invited 3, skipped 1/)).toBeVisible({
        timeout: 15_000,
      });

      const body = invite?.postDataJSON() as {
        ids?: string[];
        batchSize?: number;
      };
      expect(body.batchSize).toBe(5);
      expect(body.ids).toBeUndefined();
    } finally {
      cleanupWaitlistEntry(seededId);
    }
  });

  test('selected-rows mode posts { ids }', async ({ adminPage }) => {
    const seededId = seedWaitlistEntry(
      `e2e-invite-sel-${Date.now()}@ptah.local`,
    );
    let invite: Request | undefined;
    await adminPage.route('**/api/v1/admin/waitlist/invite', (route) => {
      invite = route.request();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ invited: 1, skipped: 0 }),
      });
    });

    try {
      await adminPage.goto('/admin/waitlist');

      // Select the first row so ≥1 id flows to the modal. Wait for the row to
      // render first (selecting before rows load selects nothing).
      const firstRow = adminPage
        .getByRole('checkbox', { name: /^Select row/ })
        .first();
      await firstRow.waitFor({ state: 'visible' });
      await firstRow.check();

      // The selection must register (invite button shows a count badge) before
      // opening the modal, else it opens in "oldest" mode with the "Selected
      // rows" radio disabled.
      const inviteBtn = adminPage.getByRole('button', openModal);
      await expect(inviteBtn).toContainText(/[1-9]/);
      await inviteBtn.click();

      // With ids present the modal opens in "Selected rows" mode.
      await expect(
        adminPage.getByRole('radio', { name: /Selected rows/ }),
      ).toBeChecked();
      await adminPage.getByRole('button', sendBtn).click();

      await expect(adminPage.getByText(/Invited 1, skipped 0/)).toBeVisible({
        timeout: 15_000,
      });

      const body = invite?.postDataJSON() as {
        ids?: string[];
        batchSize?: number;
      };
      expect(Array.isArray(body.ids)).toBe(true);
      expect(body.ids?.length).toBeGreaterThan(0);
    } finally {
      cleanupWaitlistEntry(seededId);
    }
  });
});
