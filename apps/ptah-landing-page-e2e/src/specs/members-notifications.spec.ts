import { auditPopulatedAndEmpty, expectNoAxeViolations } from '../support/axe';
import {
  cleanupNotifications,
  seedNotification,
  unreadNotificationCount,
  type SeededNotification,
} from '../support/db';
import { expect, test } from '../support/fixtures';

/**
 * TASK_2026_177 §8.2 P5 — `/members/notifications` AND THE NAV BADGE.
 * Exit-gate clauses 2, 3 and 4.
 *
 * Drives the REAL stack: :4200 proxying `/api` to the license server on :3000,
 * against Postgres. Only the two cells that require a server FAILURE stub a
 * response, and each says so where it does it.
 *
 * ── 🔴 WHAT THIS FILE IS ACTUALLY FOR ──────────────────────────────────────
 * Three properties, none of which any unit test can reach:
 *
 *   1. **The badge and the inbox are ONE count** (R9.3, R10.4). The store is
 *      provided at the `/members` ROUTE, so the shell and the page resolve the
 *      same instance. A `providers` array on either component would give each
 *      its own — and the only place that is observable is a real navigation,
 *      where acting on the page has to move the number in the nav WITHOUT a
 *      reload.
 *   2. **`bodyPreview` survives as TEXT** (NFR-S2). It is member-authored
 *      markdown the contract states is not sanitized. The fixture writes
 *      `**bold** <img src=x onerror=alert(1)>` and the assertion is that those
 *      characters are on screen and that no `<img>` was created — which is only
 *      meaningful against a real browser parser.
 *   3. **A stored hostile route is refused** (RISK-AO). `route` is frozen in
 *      the row at produce time, so every historical row keeps the hole open
 *      long after a producer is fixed. The fixture writes `//evil.example`
 *      deliberately — a browser reads that as a protocol-relative ABSOLUTE URL,
 *      not a path.
 *
 * ── FIXTURE HYGIENE ───────────────────────────────────────────────────────
 * Rows are written for the throwaway `builderUser` this run seeds and are
 * deleted by that owner, which is itself deleted moments later. Nothing counts
 * rows globally, asserts a table is empty, or truncates anything.
 */

const STAMP = Date.now();

const REPLY_TITLE = `B15B reply notification ${STAMP}`;
const OLDER_TITLE = `B15B older notification ${STAMP}`;
const READ_TITLE = `B15B already-read notification ${STAMP}`;
const HOSTILE_TITLE = `B15B hostile-route notification ${STAMP}`;

/** 🔴 Literal markdown AND a tag. Both must survive as CHARACTERS (NFR-S2). */
const RAW_PREVIEW = '**bold** <img src=x onerror=alert(1)> preview';

test.describe('Member notifications surface (§8.2 P5, clauses 2–4)', () => {
  /* ---------------------------------------------------------------------- */
  /* 🔴 The inbox                                                            */
  /* ---------------------------------------------------------------------- */

  test('🔴 the inbox renders the member’s own rows, newest first', async ({
    builderPage,
    builderUser,
  }) => {
    const seeded: SeededNotification[] = [
      seedNotification(builderUser.id, {
        title: OLDER_TITLE,
        ageMinutes: 120,
      }),
      seedNotification(builderUser.id, { title: REPLY_TITLE, ageMinutes: 1 }),
      seedNotification(builderUser.id, {
        title: READ_TITLE,
        ageMinutes: 240,
        read: true,
      }),
    ];
    expect(seeded).toHaveLength(3);

    try {
      await builderPage.goto('/members/notifications');
      await expect(
        builderPage.getByRole('heading', { name: 'Notifications', level: 1 }),
      ).toBeVisible({ timeout: 20_000 });

      // 🔴 ANTI-VACUITY FIRST — every assertion below is about which row is
      // where, and none of it means anything on an empty inbox.
      const rows = builderPage.locator('[data-notification-id]');
      await expect(rows.first()).toBeVisible({ timeout: 20_000 });
      expect(await rows.count()).toBe(3);

      // Newest first (R10.3), asserted as ORDER rather than as presence.
      const titles = await rows.allInnerTexts();
      expect(titles[0]).toContain(REPLY_TITLE);
      expect(titles[1]).toContain(OLDER_TITLE);
      expect(titles[2]).toContain(READ_TITLE);

      // The unread marker is driven by `readAt` and is ALSO carried in text, so
      // it is not colour alone (NFR-U).
      await expect(rows.filter({ hasText: REPLY_TITLE })).toHaveAttribute(
        'data-unread',
        'true',
      );
      await expect(rows.filter({ hasText: READ_TITLE })).toHaveAttribute(
        'data-unread',
        'false',
      );
      await expect(
        rows.filter({ hasText: REPLY_TITLE }).getByText('(unread)'),
      ).toBeAttached();
    } finally {
      cleanupNotifications(builderUser.id);
    }
  });

  test('🔴 NFR-S2 — bodyPreview is an ESCAPED TEXT NODE, never rendered markup', async ({
    builderPage,
    builderUser,
  }) => {
    seedNotification(builderUser.id, {
      title: REPLY_TITLE,
      bodyPreview: RAW_PREVIEW,
    });

    try {
      await builderPage.goto('/members/notifications');
      const row = builderPage
        .locator('[data-notification-id]')
        .filter({ hasText: REPLY_TITLE });
      await expect(row).toBeVisible({ timeout: 20_000 });

      const preview = row.locator('[data-body-preview]');
      await expect(preview).toBeVisible();

      // 🔴 THE ASTERISKS AND THE TAG SHOW AS CHARACTERS. An excerpt of markdown
      // is a teaser, not a rendering; introducing a seventh renderer for a
      // one-line preview of UNSANITIZED text is the trade NFR-S2 refuses.
      await expect(preview).toContainText('**bold**');
      await expect(preview).toContainText('<img src=x onerror=alert(1)>');

      // 🔴 AND NOTHING WAS PARSED INTO AN ELEMENT. This is the assertion that
      // separates "escaped" from "happens to look escaped": a real browser
      // would have created an <img> node from an `[innerHTML]` binding.
      expect(await preview.locator('img').count()).toBe(0);
      expect(await preview.locator('strong, b').count()).toBe(0);
    } finally {
      cleanupNotifications(builderUser.id);
    }
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 Clause 2 — ONE badge, moved by the page, with NO reload              */
  /* ---------------------------------------------------------------------- */

  test('🔴 clause 2 — the nav badge reads the unread count and CLEARS without a reload', async ({
    builderPage,
    builderUser,
  }) => {
    // 🔴 THE EXIT-GATE CLAUSE R9.3 EXISTS FOR, END TO END. Two instances of the
    // store — one for the shell, one for the page — would satisfy every unit
    // test and would show up ONLY here: the page would mark rows read and the
    // nav would go on displaying the old number until something re-fetched.
    seedNotification(builderUser.id, { title: REPLY_TITLE, ageMinutes: 1 });
    seedNotification(builderUser.id, { title: OLDER_TITLE, ageMinutes: 5 });

    try {
      expect(unreadNotificationCount(builderUser.id)).toBe(2);

      await builderPage.goto('/members/hub');
      await expect(builderPage.locator('ptah-member-layout')).toBeVisible({
        timeout: 20_000,
      });

      // The badge lives on the Notifications nav item, which is `primary: false`
      // and therefore renders through PanelLayout's SECONDARY branch.
      const navLink = builderPage.locator('a[href="/members/notifications"]');
      const badge = navLink.locator('.badge');
      await expect(badge).toHaveText('2', { timeout: 20_000 });

      // 🔴 NAVIGATE IN-APP — no `goto`, because a reload would rebuild the
      // store and prove nothing about shared state.
      await navLink.click();
      await expect(builderPage).toHaveURL(/\/members\/notifications/);
      await expect(
        builderPage.locator('[data-notification-id]').first(),
      ).toBeVisible({ timeout: 20_000 });

      // Select both rows and mark them read through the shared toolbar.
      for (const id of await builderPage
        .locator('[data-select-id]')
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-select-id') ?? ''),
        )) {
        await builderPage.locator(`[data-select-id="${id}"]`).check();
      }

      const toolbar = builderPage.locator(
        '[role="region"][aria-label="Bulk actions"]',
      );
      await expect(toolbar).toBeVisible();
      await toolbar.getByRole('button', { name: 'Mark read' }).click();

      // 🔴 THE BADGE CLEARS, IN THE SAME PAGE INSTANCE. `@if (item.badgeCount)`
      // in the shell hides it at 0, so "cleared" is "detached", not "reads 0".
      await expect(badge).toHaveCount(0, { timeout: 20_000 });

      // And the server agrees — the optimistic decrement was not the whole of
      // it. A badge that cleared locally while the rows stayed unread is the
      // failure this second assertion exists for.
      await expect
        .poll(() => unreadNotificationCount(builderUser.id), {
          timeout: 20_000,
        })
        .toBe(0);
    } finally {
      cleanupNotifications(builderUser.id);
    }
  });

  test('🔴 R9.7 — a PARTIAL selection costs ONE request and marks only those rows', async ({
    builderPage,
    builderUser,
  }) => {
    // 🔴 THE WHOLE REASON `POST /v1/members/notifications/read` WAS ADDED.
    // Before it, a partial selection had to choose between `read-all` (which
    // marks rows the member never selected — irreversibly, because there is no
    // mark-unread) and N per-row writes. This asserts BOTH halves live: one
    // request, and the unselected row still unread in Postgres.
    seedNotification(builderUser.id, { title: REPLY_TITLE, ageMinutes: 1 });
    seedNotification(builderUser.id, { title: OLDER_TITLE, ageMinutes: 5 });
    const untouched = seedNotification(builderUser.id, {
      title: READ_TITLE,
      ageMinutes: 9,
    });

    const writes: { url: string; body: string | null }[] = [];
    builderPage.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (
        request.method() === 'POST' &&
        pathname.startsWith('/api/v1/members/notifications')
      ) {
        writes.push({ url: pathname, body: request.postData() });
      }
    });

    try {
      expect(unreadNotificationCount(builderUser.id)).toBe(3);

      await builderPage.goto('/members/notifications');
      const rows = builderPage.locator('[data-notification-id]');
      await expect(rows.first()).toBeVisible({ timeout: 20_000 });
      expect(await rows.count()).toBe(3);

      // Select exactly TWO of the three.
      await rows
        .filter({ hasText: REPLY_TITLE })
        .locator('[data-select-id]')
        .check();
      await rows
        .filter({ hasText: OLDER_TITLE })
        .locator('[data-select-id]')
        .check();

      await builderPage
        .locator('[role="region"][aria-label="Bulk actions"]')
        .getByRole('button', { name: 'Mark read' })
        .click();

      await expect
        .poll(() => unreadNotificationCount(builderUser.id), {
          timeout: 20_000,
        })
        .toBe(1);

      // 🔴 EXACTLY ONE WRITE, AND IT IS THE BULK ONE — not `read-all`, and not
      // two `:id/read` calls.
      expect(
        writes,
        `notification writes: ${JSON.stringify(writes)}`,
      ).toHaveLength(1);
      expect(writes[0].url).toBe('/api/v1/members/notifications/read');
      expect(writes[0].url).not.toContain('read-all');
      const body = JSON.parse(writes[0].body ?? '{}') as { ids: string[] };
      expect(body.ids).toHaveLength(2);
      expect(body.ids).not.toContain(untouched.id);

      // 🔴 AND THE UNSELECTED ROW IS STILL UNREAD IN POSTGRES — the property
      // `read-all` would have destroyed, permanently.
      const stillUnread = unreadNotificationCount(builderUser.id);
      expect(stillUnread).toBe(1);
    } finally {
      cleanupNotifications(builderUser.id);
    }
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 RISK-AO — a stored route is not a trusted route                      */
  /* ---------------------------------------------------------------------- */

  test('🔴 RISK-AO — a hostile stored route is REFUSED and never leaves the origin', async ({
    builderPage,
    builderUser,
  }) => {
    // 🔴 `//evil.example` IS NOT A PATH. A browser resolves a protocol-relative
    // value as an absolute cross-origin URL, so a router that trusted the
    // stored string would navigate off-site. The value is FROZEN in the row, so
    // every historical notification keeps the hole open after any producer fix
    // — which is why the client guard exists alongside the server's builder and
    // neither may be dropped on the grounds that the other is there.
    seedNotification(builderUser.id, {
      title: HOSTILE_TITLE,
      route: '//evil.example/steal',
    });

    try {
      await builderPage.goto('/members/notifications');
      const row = builderPage
        .locator('[data-notification-id]')
        .filter({ hasText: HOSTILE_TITLE });
      await expect(row).toBeVisible({ timeout: 20_000 });

      const originBefore = new URL(builderPage.url()).origin;
      await row.locator('[data-open-id]').click();

      // Lands on the inbox rather than nowhere, and stays on this origin.
      await expect(builderPage).toHaveURL(/\/members\/notifications/, {
        timeout: 20_000,
      });
      expect(new URL(builderPage.url()).origin).toBe(originBefore);
      expect(builderPage.url()).not.toContain('evil.example');

      // A refused route still marks the notification read — the member DID
      // open it.
      await expect
        .poll(() => unreadNotificationCount(builderUser.id), {
          timeout: 20_000,
        })
        .toBe(0);
    } finally {
      cleanupNotifications(builderUser.id);
    }
  });

  test('a LEGITIMATE stored route navigates, so the guard is not refusing everything', async ({
    builderPage,
    builderUser,
  }) => {
    // Anti-vacuity for the case above: a guard that refused every route would
    // pass it and would break the feature entirely.
    seedNotification(builderUser.id, {
      title: REPLY_TITLE,
      route: '/members/account',
    });

    try {
      await builderPage.goto('/members/notifications');
      const row = builderPage
        .locator('[data-notification-id]')
        .filter({ hasText: REPLY_TITLE });
      await expect(row).toBeVisible({ timeout: 20_000 });

      await row.locator('[data-open-id]').click();
      await expect(builderPage).toHaveURL(/\/members\/account/, {
        timeout: 20_000,
      });
    } finally {
      cleanupNotifications(builderUser.id);
    }
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 NFR-U5 — both themes, POPULATED                                      */
  /* ---------------------------------------------------------------------- */

  for (const theme of ['operator-member', 'operator-member-light'] as const) {
    test(`the notifications surface renders in ${theme} (NFR-U5)`, async ({
      builderPage,
      builderUser,
    }, testInfo) => {
      seedNotification(builderUser.id, { title: REPLY_TITLE });

      try {
        await builderPage.addInitScript((value) => {
          window.localStorage.setItem('ptah.members.theme', value);
        }, theme);

        await builderPage.goto('/members/notifications');
        await expect(
          builderPage.locator('[data-notification-id]').first(),
        ).toBeVisible({ timeout: 20_000 });

        // Asserted as ACTUALLY ATTACHED — a theme written to storage but never
        // bound to `data-theme` renders the daisyUI default and every token
        // silently reverts.
        await expect(
          builderPage.locator(`[data-theme="${theme}"]`).first(),
        ).toBeVisible();

        await testInfo.attach(`notifications-${theme}`, {
          body: await builderPage.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      } finally {
        cleanupNotifications(builderUser.id);
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* 🔴 Clause 3 — axe, POPULATED **and** EMPTY                              */
  /* ---------------------------------------------------------------------- */

  test('🔴 clause 3 — axe is clean on the inbox, populated AND empty', async ({
    builderPage,
    builderUser,
  }) => {
    // 🔴 THE EMPTY HALF IS THE POINT (RISK-AR). Here the surface is emptied by
    // DELETING THE FIXTURE ROWS rather than by stubbing — this member's inbox
    // is genuinely theirs, so the empty state can be produced honestly, which
    // is a stronger run than a faked one.
    seedNotification(builderUser.id, { title: REPLY_TITLE });

    try {
      await auditPopulatedAndEmpty(builderPage, {
        label: '/members/notifications',
        populatedMarker: '[data-notification-id]',
        emptyMarker: 'text=You have no notifications yet.',
        populate: async () => {
          await builderPage.goto('/members/notifications');
        },
        emptyIt: async () => {
          cleanupNotifications(builderUser.id);
          await builderPage.goto('/members/notifications');
        },
      });
    } finally {
      cleanupNotifications(builderUser.id);
    }
  });

  test('🔴 a FAILED request renders the error cell, not "you are all caught up"', async ({
    builderPage,
  }) => {
    // The inbox's half of RISK-AQ. "You have no notifications" after a 500 tells
    // a member nothing happened when something may well have.
    await builderPage.route('**/api/v1/members/notifications', (route) =>
      route.fulfill({ status: 500, body: '{}' }),
    );

    await builderPage.goto('/members/notifications');

    await expect(builderPage.locator('[role="alert"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      builderPage.getByText('You have no notifications yet.'),
    ).toHaveCount(0);

    await expectNoAxeViolations(builderPage, '/members/notifications [ERROR]');
  });
});
