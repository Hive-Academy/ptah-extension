import { test, expect } from '../support/fixtures';

/**
 * R6.2, R6.5, R9.1 — the member panel renders for an entitled Builder.
 *
 * ⚠️ REWRITTEN BY TASK_2026_177 P1b. This spec used to drive the old
 * `@ptah-web/account` members surface: it stubbed `GET /api/v1/members/sessions`
 * and asserted a Meet link, a founding badge, and an "Open the Builders
 * community" link whose href came from a `communityUrl` field the server echoed
 * out of the forum's base URL. Batch 4 deleted that surface and Batch 5 deleted
 * `communityUrl` from the response (RISK-C), so the spec has been red on purpose
 * since `cdc1a1ef5` — a known, owned failure, not a regression.
 *
 * WHAT REPLACED IT. `/members` now lazy-loads `MEMBER_ROUTES` behind
 * `MemberGuard` and redirects to `/members/hub`, which issues exactly ONE
 * request — `GET /api/v1/members/hub` — for every section on the page (R6.2).
 * The community entry point is an in-product route, `/members/community`, not
 * an outbound link to another host (MG-2.7).
 *
 * The `builderPage` fixture (seeded active subscription + injected auth) clears
 * the entitlement probe for real. The HUB PAYLOAD is stubbed for the same reason
 * the sessions payload used to be: its `sessions` section reads live Google
 * Calendar data and would be nondeterministic. The live data path is covered by
 * `scripts/google-sessions-smoke.mjs`.
 */
const HUB_RESPONSE = {
  member: {
    firstName: 'Ada',
    cohorts: [{ key: 'founding', name: 'Founding Cohort' }],
  },
  sections: {
    learning: { status: 'empty', data: null },
    community: { status: 'empty', data: [] },
    sessions: { status: 'empty', data: null },
    packs: { status: 'empty', data: [] },
    notifications: { status: 'empty', data: { unreadCount: 0 } },
  },
};

test.describe('Member panel — entitled Builder @p0', () => {
  test('/members resolves to the hub inside the panel shell and shows the cohort', async ({
    builderPage,
  }) => {
    let hubRequests = 0;
    await builderPage.route('**/api/v1/members/hub', (route) => {
      hubRequests += 1;
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(HUB_RESPONSE),
      });
    });

    await builderPage.goto('/members');

    // The guard allows, and the empty child path redirects to the hub.
    await expect(builderPage).toHaveURL(/\/members\/hub(\?|#|$)/, {
      timeout: 15_000,
    });

    // R9.1 — every member surface renders inside the shared panel shell.
    await expect(builderPage.locator('ptah-member-layout')).toBeVisible();

    // The greeting uses the first name the hub returned.
    await expect(
      builderPage.getByRole('heading', { level: 1, name: /Ada/ }),
    ).toBeVisible();

    // Cohort badge, from `member.cohorts`.
    await expect(builderPage.getByText('Founding Cohort')).toBeVisible();

    // R6.2 — ONE request composes the whole page. Asserted as an exact count so
    // a future section that fetches for itself fails here rather than in review.
    expect(hubRequests).toBe(1);
  });

  test('the community entry point is an in-product route, not an outbound link', async ({
    builderPage,
  }, testInfo) => {
    await builderPage.route('**/api/v1/members/hub', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(HUB_RESPONSE),
      }),
    );

    await builderPage.goto('/members/community');

    // MG-2.7 — the destination is THIS app, rendered in the member shell. The
    // origin is asserted against the harness baseURL rather than against the
    // page's own URL, so a regression that restored an outbound forum link
    // fails here instead of comparing a value to itself.
    await expect(builderPage.locator('ptah-member-layout')).toBeVisible({
      timeout: 15_000,
    });
    await expect(builderPage).toHaveURL(/\/members\/community(\?|#|$)/);

    const baseURL = testInfo.project.use.baseURL;
    expect(baseURL).toBeTruthy();
    expect(new URL(builderPage.url()).origin).toBe(
      new URL(baseURL as string).origin,
    );
  });
});
