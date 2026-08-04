import { test, expect } from '../support/fixtures';

/**
 * R7.7 — `/members` gates an authenticated NON-member by routing, not by error.
 *
 * ⚠️ REWRITTEN BY TASK_2026_177 P1b, AND THE ASSERTION CHANGED SHAPE ON PURPOSE.
 * This spec used to drive the old `@ptah-web/account` members surface, which
 * rendered a "Builders pitch" component in place when
 * `GET /api/v1/members/sessions` answered `403 { reason: 'membership_required' }`.
 * That surface was deleted in Batch 4 and the pitch component with it, so the
 * spec has been red on purpose ever since — a known, owned failure, not a
 * regression.
 *
 * The replacement is `MemberGuard`, which resolves `GET
 * /api/v1/members/entitlement` BEFORE the member chunk loads and redirects:
 *
 *   401                      -> /login?returnUrl=/members
 *   200 { entitled: false }  -> /pricing
 *   200 { entitled: true }   -> the panel
 *
 * So the observable behaviour is now a NAVIGATION, and that is what is asserted.
 * The invariant it protects is unchanged and is the reason this spec exists: a
 * paying-capable visitor is shown how to buy. Never a raw 403, never an empty
 * panel, and — the distinction the second assertion pins — never `/login`, which
 * would tell someone who is already signed in to sign in again.
 *
 * Runs fully against the real backend, no external dependency: the
 * `communityPage` fixture seeds a subscription-less user and injects auth, so
 * the entitlement probe answers `{ entitled: false }` for real.
 */
test('authenticated non-member is routed to /pricing, not to an error @p0', async ({
  communityPage,
}) => {
  await communityPage.goto('/members');

  await expect(communityPage).toHaveURL(/\/pricing(\?|#|$)/, {
    timeout: 15_000,
  });

  // Signed in already — being sent to sign in again would be the wrong bounce.
  expect(communityPage.url()).not.toContain('/login');

  // The member panel must not have rendered even briefly: the probe resolves
  // before `loadChildren`, so no member surface should exist in the DOM.
  await expect(communityPage.locator('ptah-member-layout')).toHaveCount(0);
});
