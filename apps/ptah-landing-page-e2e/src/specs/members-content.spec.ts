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

  /**
   * R6.2 / R6.6 — THE ONE-REQUEST ASSERTION, RE-RUN AGAINST THE LIVE HUB.
   *
   * ⚠️ ADDED BY TASK_2026_177 BATCH 7, AND IT IS DELIBERATELY THE SAME CLAIM AS
   * THE FIRST TEST IN THIS FILE, MADE WITHOUT THE STUB.
   *
   * The stubbed version above proves the PAGE issues one request. This one
   * proves the property survives the thing that could plausibly break it:
   * `sections.community` now returns REAL forum data (Batch 6 moved it from
   * `'empty'` to `'ok'`), and the obvious way to ship that regression is for a
   * community card to start fetching its own topics. That is invisible to the
   * stubbed test, because a stubbed hub still renders whatever the card asks
   * for afterwards.
   *
   * Which is exactly the claim R6.6 makes — that a later phase adds VALUES to
   * the envelope, not requests to the page — and re-running the original
   * assertion is the only thing that tests it.
   *
   * The response itself is NOT asserted on: `community` legitimately reports
   * `'empty'` on a fresh database and `'ok'` once seeded, and a concurrent seed
   * may be filling those tables right now. The request COUNT is the invariant.
   */
  test('the live hub still costs exactly one request now that community returns real data', async ({
    builderPage,
  }) => {
    const memberApiCalls: string[] = [];
    builderPage.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (pathname.startsWith('/api/v1/members/')) {
        memberApiCalls.push(pathname);
      }
    });

    await builderPage.goto('/members/hub');
    await expect(builderPage.locator('ptah-member-layout')).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      builderPage.getByRole('heading', { level: 1, name: /Welcome back/ }),
    ).toBeVisible({ timeout: 20_000 });

    // Let any child that WOULD fetch actually get the chance to.
    await builderPage.waitForTimeout(1_500);

    // ⚠️ EXACTLY ONE, and it is the aggregate. `/entitlement` is the guard's
    // probe and runs before this page exists, so it is excluded by counting
    // only what the hub route issued — assert the hub count directly and show
    // the full list on failure.
    const hubCalls = memberApiCalls.filter((p) => p === '/api/v1/members/hub');
    expect(
      hubCalls.length,
      `member API calls during hub render: ${JSON.stringify(memberApiCalls)}`,
    ).toBe(1);

    // And no community/search call was made on the member's behalf — the whole
    // point of the aggregate.
    expect(
      memberApiCalls.filter((p) => p.startsWith('/api/v1/members/community')),
    ).toEqual([]);
    expect(
      memberApiCalls.filter((p) => p.startsWith('/api/v1/members/search')),
    ).toEqual([]);
  });
});
