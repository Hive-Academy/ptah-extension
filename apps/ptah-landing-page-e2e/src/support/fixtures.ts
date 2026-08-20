import { test as base, type Page } from '@playwright/test';
import { injectAuth } from './auth';
import {
  cleanupUser,
  findUserIdByEmail,
  seedUser,
  type SeededUser,
} from './db';
import { env } from './env';

/**
 * Role-scoped page fixtures (handoff §8.2). Each mints a fresh isolated browser
 * context, seeds a matching DB row, injects the `ptah_auth` cookie +
 * `ptah_auth_hint` flag (§1.2), yields a `Page`, then tears the user down.
 *
 * - `communityPage` — authenticated, no subscription → members gate shows the pitch.
 * - `builderPage`   — authenticated + active subscription → full members content.
 * - `adminPage`     — authenticated with an ADMIN_EMAILS-allowlisted email.
 *   Requires `E2E_ADMIN_EMAIL` (that email must also be in the server's
 *   ADMIN_EMAILS allowlist — the guard is server-side, fail-closed §7).
 *
 * `guestPage` is just the built-in `page` (no auth) — use the default `page`.
 */
interface RoleFixtures {
  builderPage: Page;
  builderUser: SeededUser;
  communityPage: Page;
  communityUser: SeededUser;
  adminPage: Page;
}

const ts = () => Date.now();

/**
 * A manually-created `browser.newContext()` does NOT inherit the config
 * `use.baseURL`, so relative `page.goto('/…')` would throw "invalid URL". Pass
 * it explicitly to every role context.
 */
const BASE_URL = process.env['E2E_BASE_URL'] || 'http://localhost:4200';

export const test = base.extend<RoleFixtures>({
  builderUser: async ({ browser }, use) => {
    void browser; // fixture depends on nothing; browser keyed only to satisfy the signature
    const user = seedUser(`e2e-builder-${ts()}@ptah.local`, { builder: true });
    await use(user);
    cleanupUser(user.id);
  },

  builderPage: async ({ browser, builderUser }, use) => {
    const context = await browser.newContext({ baseURL: BASE_URL });
    await injectAuth(context, { ...builderUser, tier: 'builders' });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  communityUser: async ({ browser }, use) => {
    void browser; // fixture depends on nothing; browser keyed only to satisfy the signature
    const user = seedUser(`e2e-community-${ts()}@ptah.local`, {
      builder: false,
    });
    await use(user);
    cleanupUser(user.id);
  },

  communityPage: async ({ browser, communityUser }, use) => {
    const context = await browser.newContext({ baseURL: BASE_URL });
    await injectAuth(context, { ...communityUser, tier: 'community' });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  adminPage: async ({ browser }, use) => {
    const adminEmail = process.env['E2E_ADMIN_EMAIL'];
    if (!adminEmail) {
      throw new Error(
        'E2E_ADMIN_EMAIL not set. Admin specs need a user whose email is in the ' +
          "server's ADMIN_EMAILS allowlist (§7). Set E2E_ADMIN_EMAIL and add it to .env ADMIN_EMAILS.",
      );
    }
    if (
      !(env['ADMIN_EMAILS'] || '')
        .split(',')
        .map((e) => e.trim())
        .includes(adminEmail)
    ) {
      // Warn but proceed — the source of truth is the running server's env, which
      // may differ from the .env on disk (e.g. after --force-recreate).
      console.warn(
        `[adminPage] E2E_ADMIN_EMAIL=${adminEmail} not found in .env ADMIN_EMAILS; ` +
          'relying on the running server allowlist.',
      );
    }
    // The admin email is a REAL registered account (it must be in ADMIN_EMAILS),
    // so reuse the existing row — don't re-INSERT it (unique email) and don't
    // delete it on teardown. Only seed+clean if it somehow isn't present yet.
    const existingId = findUserIdByEmail(adminEmail);
    const user = existingId
      ? { id: existingId, email: adminEmail, builder: false }
      : seedUser(adminEmail, { builder: false });
    const context = await browser.newContext({ baseURL: BASE_URL });
    await injectAuth(context, { ...user, tier: 'community' });
    const page = await context.newPage();
    await use(page);
    await context.close();
    if (!existingId) cleanupUser(user.id);
  },
});

export const expect = test.expect;
