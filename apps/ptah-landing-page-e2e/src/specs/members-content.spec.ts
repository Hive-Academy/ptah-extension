import { test, expect } from '../support/fixtures';

/**
 * Handoff §4.1–§4.4 — Members area content for an authenticated Builder.
 *
 * The `builderPage` fixture (seeded active subscription + injected auth) clears
 * the §2.4 gate for real. The sessions PAYLOAD, however, is stubbed: the live
 * response depends on Google Calendar + Discourse config and would be
 * nondeterministic. We intercept `GET /api/v1/members/sessions` (shape per
 * `membersSessionsResponseSchema`) so the RENDERING assertions — Meet link,
 * community link, founding badge, empty state — are stable. The live data path
 * itself is proven by `scripts/google-sessions-smoke.mjs`.
 */
const MEET_LINK = 'https://meet.google.com/e2e-abc-defg';
const COMMUNITY_URL = 'https://community.ptah.local';

test.describe('Members content — Builder @p0', () => {
  test('renders sessions, Meet link, community link, and founding badge', async ({
    builderPage,
  }) => {
    await builderPage.route('**/api/v1/members/sessions', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [
            {
              id: 'evt_e2e_1',
              title: 'Ptah Builders — Weekly Live Session',
              startsAt: '2026-08-01T17:00:00.000Z',
              endsAt: '2026-08-01T19:00:00.000Z',
              meetLink: MEET_LINK,
              recurring: true,
            },
          ],
          communityUrl: COMMUNITY_URL,
          memberGroups: [{ key: 'founding', name: 'Founding Cohort' }],
        }),
      }),
    );

    await builderPage.goto('/members');

    await expect(
      builderPage.getByRole('heading', { name: /Members' Area/ }),
    ).toBeVisible({
      timeout: 15_000,
    });

    // Session card Join → the Meet link, new tab (§4.2).
    const join = builderPage.getByRole('link', {
      name: /Join .* via Google Meet/,
    });
    await expect(join).toHaveAttribute('href', MEET_LINK);
    await expect(join).toHaveAttribute('target', '_blank');

    // Community link (§4.3).
    await expect(
      builderPage.getByRole('link', { name: 'Open the Builders community' }),
    ).toHaveAttribute('href', COMMUNITY_URL);

    // Founding cohort → amber "Founding Member" chip (§4.4).
    const badge = builderPage.locator('.badge-warning', {
      hasText: 'Founding Member',
    });
    await expect(badge).toBeVisible();
  });

  test('empty sessions + no Meet link → empty state, no Join button', async ({
    builderPage,
  }) => {
    await builderPage.route('**/api/v1/members/sessions', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [],
          communityUrl: null,
          memberGroups: [],
        }),
      }),
    );

    await builderPage.goto('/members');

    await expect(
      builderPage.getByText(/No sessions scheduled in the next 60 days/),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      builderPage.getByRole('link', { name: /Join .* via Google Meet/ }),
    ).toHaveCount(0);
  });
});
