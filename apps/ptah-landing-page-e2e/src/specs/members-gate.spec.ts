import { test, expect } from '../support/fixtures';

/**
 * Handoff §2.4 — Members area gates a non-member gracefully.
 *
 * An authenticated community user (no active Builders sub/license) hitting
 * `/members` gets a real backend `403 { reason: 'membership_required' }` from
 * `GET /api/v1/members/sessions`, which the page turns into the Builders pitch
 * (`ptah-builders-pitch`) — never a raw error or dead-end.
 *
 * Runs fully against the real backend (deterministic, no external deps): the
 * `communityPage` fixture seeds a subscription-less user + injects auth.
 */
test('community user sees the Builders pitch, not an error @p0', async ({
  communityPage,
}) => {
  await communityPage.goto('/members');

  await expect(
    communityPage.getByRole('heading', {
      name: /The Members' Area Is a Builders Perk/,
    }),
  ).toBeVisible({ timeout: 15_000 });

  // Both pitch CTAs resolve to the waitlist / builders anchors (§2.4).
  await expect(
    communityPage.getByRole('link', {
      name: 'Join the Ptah Builders waitlist',
    }),
  ).toBeVisible();
  await expect(
    communityPage.getByRole('link', {
      name: 'See full Ptah Builders membership details',
    }),
  ).toBeVisible();

  // Never a dead-end error state.
  await expect(
    communityPage.getByRole('heading', { name: /Couldn't Load Members Area/ }),
  ).toHaveCount(0);
});
