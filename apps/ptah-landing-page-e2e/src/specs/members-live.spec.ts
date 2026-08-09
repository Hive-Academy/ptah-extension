import type { Page } from '@playwright/test';

import {
  cleanupLiveSessions,
  cleanupSessionRequests,
  seedLiveNowSession,
  seedReplaySession,
  seedUpcomingLiveSession,
  type SeededLiveSession,
} from '../support/db';
import { expect, test } from '../support/fixtures';

/**
 * TASK_2026_177 §8.2 P4 — THE MEMBER LIVE / REPLAYS / REQUEST SURFACES.
 *
 * Everything below drives the REAL stack: the Angular dev server on :4200
 * proxying `/api` to the license server on :3000, against Postgres. The one
 * exception is exit-gate clause 2, which stubs the RESPONSE (not the server) and
 * says so where it does it.
 *
 * ── 🔴 THE FEED IS POPULATED WITH THE FOUNDER'S REAL CALENDAR ─────────────
 * `ASSUMPTION-10` is dead: `GOOGLE_OAUTH_*` IS configured here (B12's F-1).
 * Measured 2026-08-09, `GET /v1/members/live` returned **50 upcoming items,
 * every one calendar-sourced, across 44 distinct days but only TWO distinct
 * titles** — 44 of them expanded instances of one recurring master. So this
 * spec never asserts a list LENGTH and never asserts "the first card is mine":
 * every locator is scoped to the timestamped title this run seeded.
 *
 * ── 🔴 NOTHING HERE WRITES TO GOOGLE CALENDAR ─────────────────────────────
 * Batch 12's gate created and deleted real events on a real calendar. This
 * batch is read-only against Google. The seeded `live_sessions` rows leave
 * `calendar_event_id` NULL (see `db.ts`), and the admin accept / reschedule /
 * decline routes are never called. The one write this spec performs is
 * `POST /v1/members/session-requests`, which touches the database only.
 *
 * ── FIXTURE HYGIENE ───────────────────────────────────────────────────────
 * Every row is created with a minted id and deleted by that id, one statement
 * per row with a loud warning on failure — the shape `cleanupCourse` was
 * repaired into after B10's first run orphaned nine courses. Nothing here counts
 * rows, asserts a table is empty, or truncates anything.
 */

/** A stamp so two runs cannot collide and so every locator is unambiguous. */
const STAMP = Date.now();

const UPCOMING_TITLE = `B13 upcoming session ${STAMP}`;
const LIVE_NOW_TITLE = `B13 live-now session ${STAMP}`;
const REPLAY_TITLE = `B13 replay session ${STAMP}`;

test.describe('Member live surfaces (§8.2 P4, frontend half)', () => {
  const seeded: SeededLiveSession[] = [];

  test.beforeAll(() => {
    seeded.push(
      seedUpcomingLiveSession(UPCOMING_TITLE),
      seedLiveNowSession(LIVE_NOW_TITLE),
      seedReplaySession(REPLAY_TITLE),
    );
  });

  test.afterAll(() => {
    cleanupLiveSessions(seeded.map((session) => session.id));
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 Clause 1 — one view, distinguished by STATE                          */
  /* ---------------------------------------------------------------------- */

  test('🔴 clause 1 — the Live surface renders a populated feed, live-now first', async ({
    builderPage,
  }) => {
    await builderPage.goto('/members/live');
    await expect(
      builderPage.getByRole('heading', { name: 'Sessions', level: 1 }),
    ).toBeVisible();

    // ANTI-VACUITY, FIRST. Without this the assertions below could all pass
    // against an empty page. The feed is genuinely populated by the founder's
    // real calendar plus this run's two seeded rows.
    const cards = builderPage.locator('[data-session-state]');
    await expect(cards.first()).toBeVisible();
    const total = await cards.count();
    expect(total).toBeGreaterThan(1);

    // The two rows THIS run seeded, located by title rather than by position —
    // 44 of the real items share one title and any index would be meaningless.
    const liveCard = builderPage
      .locator('[data-session-state]')
      .filter({ hasText: LIVE_NOW_TITLE });
    const upcomingCard = builderPage
      .locator('[data-session-state]')
      .filter({ hasText: UPCOMING_TITLE });

    await expect(liveCard).toHaveAttribute('data-session-state', 'live');
    await expect(upcomingCard).toHaveAttribute(
      'data-session-state',
      'upcoming',
    );

    // R3.5 — the live indicator, and it carries TEXT rather than colour alone.
    await expect(liveCard.getByText('Live now')).toBeVisible();
    await expect(builderPage.getByText('Happening now')).toBeVisible();

    // 🔴 R3.3 / ASSUMPTION-15 — no provenance badge anywhere on the surface.
    // Scoped to the card chrome, since a session TITLE may legitimately contain
    // any of these words (the real calendar has one reading "Ptah Builders —
    // Weekly Live Session").
    const liveChrome = (await liveCard.innerText()).replace(LIVE_NOW_TITLE, '');
    expect(liveChrome.toLowerCase()).not.toContain('google');
    expect(liveChrome.toLowerCase()).not.toContain('calendar');

    // A replay never appears on the sessions page — it has its own route.
    await expect(
      builderPage.locator('[data-session-state="replay"]'),
    ).toHaveCount(0);
  });

  test('the upcoming schedule is grouped by day, not a flat wall of rows', async ({
    builderPage,
  }) => {
    // RISK-AB, against the real data: 44 of the 50 real upcoming items read
    // `PRO ESTATE MEETING` across 44 distinct days. A flat list is unreadable.
    await builderPage.goto('/members/live');
    await expect(
      builderPage.locator('[data-session-state]').first(),
    ).toBeVisible();

    const dayHeadings = builderPage.locator('h2 time[datetime]');
    const headingCount = await dayHeadings.count();
    expect(headingCount).toBeGreaterThan(1);

    // Every heading is a bare `YYYY-MM-DD` — the ISO slice, never a local
    // reparse, so two members in two timezones see the same grouping.
    for (let index = 0; index < headingCount; index += 1) {
      const value = await dayHeadings.nth(index).getAttribute('datetime');
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    // And the reveal is bounded rather than rendering all fifty at once.
    const revealed = await builderPage.locator('[data-session-state]').count();
    expect(revealed).toBeLessThanOrEqual(26);
  });

  test('the reveal button discloses the rest without a second request', async ({
    builderPage,
  }) => {
    const feedRequests: string[] = [];
    builderPage.on('request', (request) => {
      if (request.url().includes('/api/v1/members/live')) {
        feedRequests.push(request.url());
      }
    });

    await builderPage.goto('/members/live');
    await expect(
      builderPage.locator('[data-session-state]').first(),
    ).toBeVisible();

    const before = await builderPage.locator('[data-session-state]').count();
    const requestsBefore = feedRequests.length;

    const showMore = builderPage.getByRole('button', {
      name: /^Show \d+ more$/,
    });
    await expect(showMore).toBeVisible();
    await showMore.click();

    await expect
      .poll(() => builderPage.locator('[data-session-state]').count())
      .toBeGreaterThan(before);

    // `upcoming` is a bare array by contract — the whole list was already in
    // memory, and a page parameter for it would be a 400.
    expect(feedRequests.length).toBe(requestsBefore);
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 Clause 2 — calendarAvailable: false shows NO error                   */
  /* ---------------------------------------------------------------------- */

  test('🔴 clause 2 — calendarAvailable:false renders the surface with NO error', async ({
    builderPage,
  }) => {
    // 🔴 THIS IS A CLIENT STUB AND IT DOES NOT CLOSE BATCH 12'S F-1.
    // The `503 { reason: 'scheduling_unavailable' }` clause lives on the ADMIN
    // accept route and is unreachable in this workspace precisely because
    // `GOOGLE_OAUTH_*` IS configured. Rewriting the response here proves the
    // FRONTEND's R3.6 behaviour — which is what Batch 13 owns — and proves
    // nothing about the server's branch. Closing F-1 needs a container with the
    // three variables unset, or a stubbed `GoogleAuthProvider` in an API-level
    // test. Both are recorded as still open.
    await builderPage.route('**/api/v1/members/live**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: { ...body, calendarAvailable: false },
      });
    });

    await builderPage.goto('/members/live');

    const note = builderPage.getByRole('status').first();
    await expect(note).toBeVisible();
    await expect(note).toContainText('Nothing has been cancelled.');

    // R3.6 — "SHALL show no error to the member".
    await expect(builderPage.getByRole('alert')).toHaveCount(0);
    await expect(
      builderPage.getByRole('button', { name: 'Try again' }),
    ).toHaveCount(0);

    // ANTI-VACUITY: the seeded Ptah-sourced rows still render. A degraded
    // Calendar must not blank the surface.
    await expect(
      builderPage
        .locator('[data-session-state]')
        .filter({ hasText: LIVE_NOW_TITLE }),
    ).toBeVisible();
  });

  test('a degraded calendar with NOTHING to show still does not say "no sessions"', async ({
    builderPage,
  }) => {
    // The cell RISK-Z exists for. Empty AND degraded is the one combination
    // where the naive render tells a paying member a lie.
    await builderPage.route('**/api/v1/members/live**', async (route) => {
      await route.fulfill({
        json: {
          upcoming: [],
          live: [],
          replays: {
            items: [],
            page: 1,
            pageSize: 25,
            total: 0,
            hasMore: false,
          },
          calendarAvailable: false,
        },
      });
    });

    await builderPage.goto('/members/live');

    await expect(
      builderPage.getByText('We could not read the session calendar just now.'),
    ).toBeVisible();
    await expect(
      builderPage.getByText('No sessions scheduled yet.'),
    ).toHaveCount(0);
    await expect(builderPage.getByRole('alert')).toHaveCount(0);
  });

  /* ---------------------------------------------------------------------- */
  /* Replays                                                                 */
  /* ---------------------------------------------------------------------- */

  test('a replay is playable, and no YouTube request fires until it is', async ({
    builderPage,
  }) => {
    const youtubeRequests: string[] = [];
    builderPage.on('request', (request) => {
      const host = new URL(request.url()).hostname;
      if (
        host.endsWith('youtube.com') ||
        host.endsWith('youtube-nocookie.com')
      ) {
        youtubeRequests.push(request.url());
      }
    });

    await builderPage.goto('/members/live/replays');

    const replayCard = builderPage
      .locator('[data-session-state]')
      .filter({ hasText: REPLAY_TITLE });

    // ANTI-VACUITY: the seeded replay really is there, and it really is a
    // replay — `deriveLiveState` DROPS a past session with no recording.
    await expect(replayCard).toBeVisible();
    await expect(replayCard).toHaveAttribute('data-session-state', 'replay');
    // R3.4 — the persisted runtime, formatted.
    await expect(replayCard).toContainText('30:00');

    await builderPage.waitForTimeout(1_500);
    expect(youtubeRequests).toEqual([]);

    await replayCard.getByRole('button', { name: 'Watch replay' }).click();

    const frame = builderPage.locator('ptah-youtube-player iframe');
    await expect(frame).toBeVisible();

    // NFR-S3 — the embed origin is the nocookie domain, PARSED rather than
    // substring-matched.
    const source = await frame.getAttribute('src');
    expect(new URL(source as string).origin).toBe(
      'https://www.youtube-nocookie.com',
    );
    expect(youtubeRequests.length).toBeGreaterThan(0);
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 Clause 3 — own requests only, proved with TWO identities             */
  /* ---------------------------------------------------------------------- */

  test("🔴 clause 3 — a member sees their own request and NOT another member's", async ({
    builderPage,
    builderUser,
    browser,
  }) => {
    // 🔴 TWO IDENTITIES, BECAUSE ONE PROVES NOTHING. `MemberSessionRequest` has
    // NO requester field, so a `listOwn` that returned everything would render
    // as this member's own list with no visible anomaly. The only assertion that
    // tests the filter is that a DIFFERENT member's request is ABSENT.
    const marker = `B13 own-only marker ${STAMP}`;

    await builderPage.goto('/members/live/request');
    await expect(
      builderPage.getByRole('heading', { name: 'Request a session', level: 1 }),
    ).toBeVisible();

    await builderPage
      .getByLabel('Topic')
      .selectOption('orchestration-workflow');
    await builderPage.getByLabel(/Anything we should know/).fill(marker);
    await builderPage.getByRole('button', { name: 'Send request' }).click();

    // The row lands, with a status the member can read.
    await expect(
      builderPage.locator('[data-request-status="pending"]'),
    ).toBeVisible();
    await expect(builderPage.getByText('Awaiting review')).toBeVisible();

    // The marker is this member's own notes — visible in their own detail.
    await builderPage.getByRole('button', { name: 'Details' }).first().click();
    await expect(builderPage.getByRole('dialog')).toContainText(marker);

    // A SECOND entitled member, in their own context.
    const { seedUser, cleanupUser } = await import('../support/db');
    const { injectAuth } = await import('../support/auth');
    const other = seedUser(`e2e-b13-other-${STAMP}@ptah.local`, {
      builder: true,
    });

    try {
      const context = await browser.newContext({
        baseURL: process.env['E2E_BASE_URL'] || 'http://localhost:4200',
      });
      await injectAuth(context, { ...other, tier: 'builders' });
      const otherPage = await context.newPage();

      await otherPage.goto('/members/live/request');
      await expect(
        otherPage.getByRole('heading', { name: 'Request a session', level: 1 }),
      ).toBeVisible();

      // 🔴 THE ASSERTION. Not "the list is empty" — the list may legitimately
      // hold this member's own rows — but "the OTHER member's marker is absent".
      await expect(otherPage.getByText(marker)).toHaveCount(0);
      await expect(
        otherPage.getByText('You have not requested a session yet.'),
      ).toBeVisible();

      await context.close();
    } finally {
      cleanupSessionRequests(other.id);
      cleanupUser(other.id);
    }

    cleanupSessionRequests(builderUser.id);
  });

  test('a pending request can be withdrawn', async ({
    builderPage,
    builderUser,
  }) => {
    try {
      await builderPage.goto('/members/live/request');
      await builderPage
        .getByLabel('Topic')
        .selectOption('getting-started-ptah');
      await builderPage.getByRole('button', { name: 'Send request' }).click();

      await expect(
        builderPage.locator('[data-request-status="pending"]'),
      ).toBeVisible();

      await builderPage.getByRole('button', { name: 'Withdraw' }).click();

      // 🔴 A WITHDRAWN REQUEST IS CLOSED, NOT DELETED — MEASURED, NOT ASSUMED.
      // The first version of this assertion waited for the empty state and
      // failed: `cancelOwn` sets `status` to `'canceled'` and the row stays in
      // the member's own list. That is the better behaviour (the member keeps a
      // record of what they asked for and what became of it) and it is what
      // `SESSION_REQUEST_STATUSES` describes — `canceled` covers "declined by
      // an admin, OR canceled by the member while still pending".
      await expect(
        builderPage.locator('[data-request-status="canceled"]'),
      ).toBeVisible();
      await expect(builderPage.getByText('Closed')).toBeVisible();
      await expect(
        builderPage.getByRole('button', { name: 'Withdraw' }),
      ).toHaveCount(0);
    } finally {
      cleanupSessionRequests(builderUser.id);
    }
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 Clause 4 — both themes, on POPULATED surfaces                        */
  /* ---------------------------------------------------------------------- */

  for (const theme of ['operator-member', 'operator-member-light'] as const) {
    test(`🔴 clause 4 — the live surfaces render in ${theme} (NFR-U5)`, async ({
      builderPage,
    }, testInfo) => {
      // `MEMBER_THEME_STORAGE_KEY` in `member-theme.service.ts`. Namespaced to
      // the member panel (AD-13) so it cannot collide with the admin panel's.
      await builderPage.addInitScript((value) => {
        localStorage.setItem('ptah.members.theme', value);
      }, theme);

      for (const [name, url, ready] of [
        ['live', '/members/live', `[data-session-state]`],
        ['replays', '/members/live/replays', `[data-session-state]`],
        ['request', '/members/live/request', `select`],
      ] as const) {
        await builderPage.goto(url);

        // ⚠️ POPULATED BEFORE THE SHOT. B7.1's lesson: an empty page renders a
        // centred icon on `base-200`, the least theme-sensitive thing a surface
        // can show. The rows are where the token work is.
        await expect(builderPage.locator(ready).first()).toBeVisible();

        // The panel is really ON the theme under test, not merely rendered.
        await expect(
          builderPage.locator(`[data-theme="${theme}"]`).first(),
        ).toBeAttached();

        await testInfo.attach(`${name}-${theme}`, {
          body: await builderPage.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* 🔴 Clause 5 — axe on all three surfaces                                 */
  /* ---------------------------------------------------------------------- */

  test('🔴 clause 5 — axe finds no violations on any of the three surfaces', async ({
    builderPage,
  }) => {
    for (const [url, ready] of [
      ['/members/live', '[data-session-state]'],
      ['/members/live/replays', '[data-session-state]'],
      ['/members/live/request', 'select'],
    ] as const) {
      await builderPage.goto(url);
      await expect(builderPage.locator(ready).first()).toBeVisible();

      const violations = await runAxe(builderPage);
      expect(violations, `${url}: ${JSON.stringify(violations)}`).toEqual([]);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* axe                                                                         */
/* -------------------------------------------------------------------------- */

interface AxeViolation {
  id: string;
  impact: string | null;
  /**
   * ⚠️ THE SELECTORS, NOT JUST A COUNT. B10's helper returned `nodes: 3` and a
   * failure then said only "three things are wrong somewhere on the page",
   * which costs a re-run with an ad-hoc probe to act on. Two of this batch's
   * three real a11y findings were located from this field.
   */
  targets: string[];
  summary: string;
}

/**
 * Runs axe over the page's OWN DOM.
 *
 * ⚠️ THE SCOPE IS B10'S, VERBATIM, AND KEEPING IT IS DELIBERATE:
 * `{ include: [['body']], exclude: [['iframe']] }`. In the activated replay
 * state the page embeds YouTube's player, whose internals are not this
 * repository's to fix; an unscoped run would report them forever, which is how
 * an a11y gate becomes noise someone learns to ignore.
 *
 * ⚠️ AXE IS STILL LOADED FROM A CDN RATHER THAN FROM A DEV DEPENDENCY.
 * `@axe-core/playwright` is not installed, and installing it rewrites
 * `package.json` and `package-lock.json` while other processes write to this
 * repository. B10 recorded the same trade and routed the durable fix — one
 * `devDependencies` line — to Batch 15's full axe pass; this batch re-records it
 * rather than quietly taking it a second time. The helper FAILS LOUDLY if the
 * script cannot be loaded; it never skips silently.
 */
async function runAxe(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({
    url: 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js',
  });

  const loaded = await page.evaluate(
    () => typeof (window as { axe?: unknown }).axe !== 'undefined',
  );
  expect(loaded, 'axe-core failed to load — the a11y gate did not run').toBe(
    true,
  );

  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run(
            context: unknown,
            options: unknown,
          ): Promise<{
            violations: {
              id: string;
              impact: string | null;
              nodes: { target: string[]; failureSummary?: string }[];
            }[];
          }>;
        };
      }
    ).axe;

    const results = await axe.run(
      { include: [['body']], exclude: [['iframe']] },
      { resultTypes: ['violations'] },
    );

    return results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.flatMap((node) => node.target),
      summary: violation.nodes[0]?.failureSummary ?? '',
    }));
  });
}
