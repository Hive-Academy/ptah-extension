import { test, expect } from '@playwright/test';
import {
  cleanupWaitlistByEmail,
  seedWaitlistEntry,
  cleanupWaitlistEntry,
} from '../support/db';

/**
 * Handoff §2.1 — Join the Builders waitlist.
 *
 * The form is public and lives ONLY on `/` (contrary to the handoff, it is not
 * on /pricing or /profile — those render `/#waitlist` links). It always posts
 * `source: 'landing'`. Component: `ptah-waitlist-form` (waitlist-form.component.ts).
 *
 * Happy paths run against the REAL backend (`POST /api/v1/waitlist`, no external
 * deps); the throttle/error branch is driven deterministically via route
 * interception since a real 429 needs >5 rapid submits.
 */
test.describe('Builders waitlist join @p0', () => {
  const emailInput = '#waitlist-email';
  const submit = /Join the Waitlist/;

  test('new email joins → "founding member" confirmation (real backend)', async ({
    page,
  }) => {
    const email = `e2e-join-${Date.now()}@ptah.local`;
    try {
      await page.goto('/');
      await page.locator(emailInput).fill(email);
      await page.getByRole('button', { name: submit }).click();

      const status = page.getByRole('status');
      await expect(status).toContainText("You're a founding member", {
        timeout: 15_000,
      });
    } finally {
      cleanupWaitlistByEmail(email);
    }
  });

  test('already-registered email → "already a founding member"', async ({
    page,
  }) => {
    const email = `e2e-dupe-${Date.now()}@ptah.local`;
    const rowId = seedWaitlistEntry(email, 'landing');
    try {
      await page.goto('/');
      await page.locator(emailInput).fill(email);
      await page.getByRole('button', { name: submit }).click();

      await expect(page.getByRole('status')).toContainText(
        "You're already a founding member",
        {
          timeout: 15_000,
        },
      );
    } finally {
      cleanupWaitlistEntry(rowId);
    }
  });

  test('server error surfaces the returned message (429 stubbed)', async ({
    page,
  }) => {
    await page.route('**/api/v1/waitlist', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Too many requests — slow down.' }),
      }),
    );

    await page.goto('/');
    await page.locator(emailInput).fill(`e2e-429-${Date.now()}@ptah.local`);
    await page.getByRole('button', { name: submit }).click();

    await expect(page.getByRole('alert')).toContainText(
      'Too many requests — slow down.',
    );
  });
});
