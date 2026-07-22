import { test, expect } from '@playwright/test';

/**
 * Handoff §9 — legal pages render (not swallowed by the `**` → `/` catch-all).
 * Asserting the path is preserved confirms the route exists and rendered
 * content; a missing route would bounce to `/`.
 */
const LEGAL_ROUTES = ['/terms-and-conditions', '/privacy', '/refund'];

test.describe('Legal pages @legal', () => {
  for (const path of LEGAL_ROUTES) {
    test(`${path} renders`, async ({ page }) => {
      await page.goto(path);
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page.locator('h1').first()).toBeVisible();
    });
  }
});
