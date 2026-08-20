import type { Request } from '@playwright/test';
/**
 * TYPE-ONLY, AND DELIBERATE. The route stub must be shaped by the server's own
 * `WaitlistApprovalResponse`, otherwise this spec can stay green against a
 * payload the server stopped sending — which is precisely how the file it
 * replaces went hollow (it stubbed an endpoint that no longer existed).
 *
 * `@ptah-api/admin` is `scope:api` and this project is `scope:landing` /
 * `scope:e2e`, so the tag constraint rejects the edge. The constraint exists to
 * stop server code being pulled into a browser-side bundle; `import type` is
 * fully erased at compile time, so no NestJS module is loaded, nothing is
 * bundled, and the only thing crossing the line is a compile-time shape.
 * A VALUE import here would be a real violation — keep this `import type`.
 */
// eslint-disable-next-line @nx/enforce-module-boundaries -- see the docblock above.
import type { WaitlistApprovalResponse } from '@ptah-api/admin';
import { test, expect } from '../support/fixtures';
import { cleanupWaitlistEntry, seedWaitlistEntry } from '../support/db';

/**
 * Handoff §7.4 — Approve to Founding Cohort (`/admin/waitlist` → modal).
 *
 * REPLACES `admin-founding-invites.spec.ts`, deleted with the paid invite flow
 * it guarded (TASK_2026_201 R9). Same p0 tag, same shape, same admin surface —
 * only the action changed, from "mail a discounted checkout link" to "grant
 * free Builders access".
 *
 * Reaches the real admin surface (the `adminPage` fixture's email must be in
 * the server ADMIN_EMAILS allowlist — the guard probes `GET /admin/users` for
 * real), and the waitlist list loads real rows. Only the side-effecting call,
 * `POST /api/v1/admin/waitlist/approve`, is intercepted: we assert the request
 * SHAPE (`{ ids }`) and stub a `WaitlistApprovalResponse`, so the test NEVER
 * issues a real licence, assigns a real cohort or sends a real welcome email.
 *
 * The stub is typed as the server's own response contract, so a change to
 * `requested` / `tally` / `results` breaks this file at compile time rather
 * than leaving it green against a shape the server no longer returns.
 *
 * Skipped unless `E2E_ADMIN_EMAIL` is set (admin config is env-specific, §7).
 */
test.describe('Admin — Approve to Founding Cohort @p0', () => {
  test.beforeEach(() => {
    test.skip(
      !process.env['E2E_ADMIN_EMAIL'],
      'Set E2E_ADMIN_EMAIL (also in server ADMIN_EMAILS) to run admin specs.',
    );
  });

  const APPROVE_ROUTE = '**/api/v1/admin/waitlist/approve';
  const bulkButton = { name: /Approve to Founding Cohort/ };
  const rowButton = { name: /^Approve$/ };

  /**
   * A full five-outcome response. Every key is present with a real number,
   * including the zeros — that is the server's documented contract and the
   * thing the UI must render without null-checking.
   */
  const stubResponse = (): WaitlistApprovalResponse => ({
    requested: 1,
    tally: {
      approved: 1,
      already_approved: 0,
      already_paid: 0,
      not_found: 0,
      failed: 0,
    },
    results: [
      {
        id: 'stub-id',
        email: 'stub@ptah.local',
        outcome: 'approved',
        licenseId: 'stub-license-id',
        wasNotified: false,
      },
    ],
  });

  test('per-row approve posts { ids } with exactly that row', async ({
    adminPage,
  }) => {
    const seededId = seedWaitlistEntry(`e2e-approve-${Date.now()}@ptah.local`);
    let approve: Request | undefined;
    await adminPage.route(APPROVE_ROUTE, (route) => {
      approve = route.request();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(stubResponse()),
      });
    });

    try {
      await adminPage.goto('/admin/waitlist');

      // The New tab carries a per-row Approve — R6.4: a row does NOT have to
      // be mailed anything before it can be granted free access.
      const approveRow = adminPage.getByRole('button', rowButton).first();
      await approveRow.waitFor({ state: 'visible' });
      await approveRow.click();

      // The confirmation states the grant plainly (R9.2).
      await expect(
        adminPage.getByText(/free Builders access for 1\s*year/i),
      ).toBeVisible();
      await expect(adminPage.getByText(/Founding Members/)).toBeVisible();
      await expect(adminPage.getByText(/one email each/i)).toBeVisible();

      await adminPage.getByRole('button', { name: /^Approve 1$/ }).click();

      await expect(adminPage.getByText(/1 row processed/)).toBeVisible({
        timeout: 15_000,
      });

      const body = approve?.postDataJSON() as { ids?: string[] };
      expect(Array.isArray(body.ids)).toBe(true);
      expect(body.ids).toHaveLength(1);
    } finally {
      cleanupWaitlistEntry(seededId);
    }
  });

  test('bulk approve posts the selection and shows every outcome in the tally', async ({
    adminPage,
  }) => {
    const seededId = seedWaitlistEntry(
      `e2e-approve-bulk-${Date.now()}@ptah.local`,
    );
    let approve: Request | undefined;

    // A mixed result — the skips are exactly what the summary must not hide.
    const mixed: WaitlistApprovalResponse = {
      requested: 3,
      tally: {
        approved: 1,
        already_approved: 1,
        already_paid: 1,
        not_found: 0,
        failed: 0,
      },
      results: [
        {
          id: 'i1',
          email: 'a@ptah.local',
          outcome: 'approved',
          licenseId: 'l',
        },
        { id: 'i2', email: 'b@ptah.local', outcome: 'already_approved' },
        { id: 'i3', email: 'c@ptah.local', outcome: 'already_paid' },
      ],
    };

    await adminPage.route(APPROVE_ROUTE, (route) => {
      approve = route.request();
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(mixed),
      });
    });

    try {
      await adminPage.goto('/admin/waitlist');

      // Select the first row so ≥1 id flows to the modal. Wait for the row to
      // render first (selecting before rows load selects nothing).
      const firstRow = adminPage
        .getByRole('checkbox', { name: /^Select / })
        .first();
      await firstRow.waitFor({ state: 'visible' });
      await firstRow.check();

      // The selection toolbar only appears once ≥1 row is selected.
      const bulk = adminPage.getByRole('button', bulkButton);
      await expect(bulk).toBeVisible();
      await bulk.click();

      await adminPage.getByRole('button', { name: /^Approve \d+$/ }).click();

      await expect(adminPage.getByText(/3 rows processed/)).toBeVisible({
        timeout: 15_000,
      });

      // ALL FIVE outcomes are rendered, zeros included — a summary that showed
      // only successes would hide the already_paid skip.
      const modal = adminPage.locator('.modal-box');
      for (const label of [
        'Approved',
        'Already approved',
        'Already paid',
        'Not found',
        'Failed',
      ]) {
        await expect(modal.getByText(label, { exact: true })).toBeVisible();
      }

      const body = approve?.postDataJSON() as { ids?: string[] };
      expect(Array.isArray(body.ids)).toBe(true);
      expect(body.ids?.length).toBeGreaterThan(0);
    } finally {
      cleanupWaitlistEntry(seededId);
    }
  });
});
