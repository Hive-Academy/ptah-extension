import { auditPopulatedAndEmpty, expectNoAxeViolations } from '../support/axe';
import { cleanupPacks, seedPack, type SeededPack } from '../support/db';
import { expect, test } from '../support/fixtures';

/**
 * TASK_2026_177 §8.2 P5 — `/members/packs`, EXIT-GATE CLAUSE 1.
 *
 * Drives the REAL stack: the Angular dev server on :4200 proxying `/api` to the
 * license server on :3000, against Postgres. Nothing here is stubbed.
 *
 * ── 🔴 THE CLAUSE THIS FILE EXISTS FOR ─────────────────────────────────────
 * "Members reach every pack repo link without Discourse, with `accessNote`
 * rendered BEFORE the link so a GitHub 404 is not the first signal." Both
 * halves are asserted, and the ORDER is asserted as DOM order rather than as
 * presence — a page that renders the note somewhere below the link satisfies
 * every "the note is on the page" assertion while failing the requirement
 * completely. B15A proved that exact point in a mutation test: moving the note
 * below the link left "the authored note appears" green.
 *
 * ── 🔴 A-1, PROVEN AT THE HIGHEST LEVEL IT CAN BE ─────────────────────────
 * `member_visible` is the ONLY visibility control; `cohort_key` grants and
 * revokes nothing. So this run seeds a pack that is `member_visible` AND
 * cohort-labelled, and loads it as a member holding NO cohort assignment. If
 * A-1 were false — if the label gated anything — that pack would be missing and
 * this spec would say so. The hidden pack is the other half: it proves the
 * visibility flag is read at all.
 *
 * ── 🔴 R5.2 / NFR-S5 — `notes` IS ADMIN-INTERNAL ──────────────────────────
 * Every seeded pack carries a marker in `notes`. The assertion is that the
 * marker appears NOWHERE in the served page source — not in the rendered text,
 * not in an attribute, not in a hydration payload. Asserting on `content()`
 * rather than on `innerText` is the difference between "the member cannot see
 * it" and "the member cannot read it".
 *
 * ── FIXTURE HYGIENE ───────────────────────────────────────────────────────
 * Every row is minted with a stamped slug and deleted by id, one statement per
 * row with a loud warning on failure — the shape `cleanupCourse` was repaired
 * into after B10's first run orphaned nine courses.
 */

const STAMP = Date.now();

/** 🔴 Seeded into `notes` on EVERY pack. Must never reach a member. */
const ADMIN_ONLY_MARKER = `B15B-ADMIN-ONLY-SECRET-${STAMP}`;

const VISIBLE_TITLE = `B15B Visible Pack ${STAMP}`;
const LABELLED_TITLE = `B15B Cohort-Labelled Pack ${STAMP}`;
const HIDDEN_TITLE = `B15B Hidden Pack ${STAMP}`;

const AUTHORED_NOTE =
  'Invite lands within 24h of your GitHub handle being shared.';

/**
 * The shared line a pack with a NULL `accessNote` falls back to
 * (ASSUMPTION-27). Silence at the exact spot R5.5 exists to fill is the failure
 * mode, and every pack in this workspace has the column null on day one.
 */
const DEFAULT_ACCESS_NOTE =
  'Access is granted on GitHub — ask in the community if the link 404s.';

test.describe('Member packs surface (§8.2 P5, clause 1)', () => {
  const seeded: SeededPack[] = [];

  test.beforeAll(() => {
    seeded.push(
      // Visible, cohort-labelled, WITH an authored access note.
      seedPack('b15b-labelled', {
        memberVisible: true,
        cohortKey: 'founding',
        accessNote: AUTHORED_NOTE,
        notes: ADMIN_ONLY_MARKER,
        title: LABELLED_TITLE,
      }),
      // Visible, unlabelled, access note NULL — the fallback path.
      seedPack('b15b-visible', {
        memberVisible: true,
        cohortKey: null,
        accessNote: null,
        notes: ADMIN_ONLY_MARKER,
        title: VISIBLE_TITLE,
      }),
      // 🔴 NOT member-visible. The negative half of the whole surface.
      seedPack('b15b-hidden', {
        memberVisible: false,
        cohortKey: null,
        accessNote: 'This note belongs to a pack no member may see.',
        notes: ADMIN_ONLY_MARKER,
        title: HIDDEN_TITLE,
      }),
    );
  });

  test.afterAll(() => {
    cleanupPacks(seeded.map((pack) => pack.id));
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 Clause 1 — the packs render, with the note BEFORE the link           */
  /* ---------------------------------------------------------------------- */

  test('🔴 clause 1 — visible packs render and the repo link is reachable', async ({
    builderPage,
  }) => {
    await builderPage.goto('/members/packs');
    await expect(
      builderPage.getByRole('heading', { name: 'Packs', level: 1 }),
    ).toBeVisible({ timeout: 20_000 });

    // 🔴 ANTI-VACUITY FIRST. Every assertion below is about WHICH packs are on
    // the page; none of them means anything until the page has packs on it.
    // B10's NFR-S3 assertion was true-because-empty until it was made to fail.
    const cards = builderPage.locator('[data-pack-slug]');
    await expect(cards.first()).toBeVisible({ timeout: 20_000 });
    expect(await cards.count()).toBeGreaterThanOrEqual(2);

    await expect(
      builderPage.getByText(LABELLED_TITLE, { exact: false }),
    ).toBeVisible();
    await expect(
      builderPage.getByText(VISIBLE_TITLE, { exact: false }),
    ).toBeVisible();

    // R5.1 — the repo link is a real, reachable anchor to GitHub. Not fetched:
    // the requirement is that the member REACHES it without Discourse, and
    // GitHub's availability is not this suite's to assert.
    const link = builderPage
      .locator('[data-pack-slug]')
      .filter({ hasText: LABELLED_TITLE })
      .getByRole('link');
    await expect(link.first()).toHaveAttribute(
      'href',
      /^https:\/\/github\.com\//,
    );
  });

  test('🔴 clause 1 — accessNote PRECEDES the repo link in DOM order (R5.5)', async ({
    builderPage,
  }) => {
    await builderPage.goto('/members/packs');
    const card = builderPage
      .locator('[data-pack-slug]')
      .filter({ hasText: LABELLED_TITLE });
    await expect(card).toBeVisible({ timeout: 20_000 });

    // Presence first — so the ORDER assertion below is about two things that
    // both exist.
    await expect(card.getByText(AUTHORED_NOTE)).toBeVisible();

    // 🔴 THE ORDER, MEASURED IN THE DOM — and measured between the two elements
    // the component labels for exactly this purpose (`data-access-note` /
    // `data-repo-link`) rather than by searching for the note's text. Text
    // search would break on a copy edit and would silently match an ancestor.
    //
    // `compareDocumentPosition` sets DOCUMENT_POSITION_FOLLOWING (4) when the
    // argument comes AFTER the receiver. A member must be told how access is
    // granted IN ADVANCE (R5.5) — a note below the link is read after the 404
    // it exists to prevent.
    const relation = await card.evaluate((element) => {
      const note = element.querySelector('[data-access-note]');
      const link = element.querySelector('[data-repo-link]');
      if (!note || !link) return -1;
      return note.compareDocumentPosition(link);
    });

    expect(relation, 'both the note and the repo link must exist').not.toBe(-1);
    expect(
      // `4` is DOCUMENT_POSITION_FOLLOWING; the return value is a bitmask by
      // specification, so the bit is tested rather than the whole number.
      (relation & 4) !== 0,
      'accessNote must PRECEDE the repo link in DOM order (R5.5)',
    ).toBe(true);

    // Anti-vacuity on the mask: the two nodes are genuinely distinct, so a
    // relation of 0 (same node) cannot be what passed.
    expect(relation).not.toBe(0);
  });

  test('🔴 a pack with a NULL accessNote shows the shared default, not a gap', async ({
    builderPage,
  }) => {
    // ASSUMPTION-27. Every pack in this workspace has the column null on day
    // one, so the fallback is the path that actually ships — silence at the
    // exact spot R5.5 exists to fill is the failure mode.
    await builderPage.goto('/members/packs');
    const card = builderPage
      .locator('[data-pack-slug]')
      .filter({ hasText: VISIBLE_TITLE });
    await expect(card).toBeVisible({ timeout: 20_000 });

    await expect(card.getByText(DEFAULT_ACCESS_NOTE)).toBeVisible();
    // The AUTHORED note belongs to the other pack and must not leak into this
    // one — a fallback rendered globally would satisfy the line above.
    await expect(card.getByText(AUTHORED_NOTE)).toHaveCount(0);
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 A-1 and the visibility flag                                          */
  /* ---------------------------------------------------------------------- */

  test('🔴 A-1 — a COHORT-LABELLED pack reaches a member with NO cohort', async ({
    builderPage,
  }) => {
    // 🔴 THE ASSERTION MOST LIKELY TO BE READ AS A BUG. `cohort_key` is a
    // DISPLAY LABEL that grants and revokes nothing (A-1); `member_visible` is
    // the only control. The `builderPage` fixture seeds no
    // `member_group_assignment`, so this member holds zero cohorts — and still
    // sees the pack. If the label ever starts gating, this goes red.
    await builderPage.goto('/members/packs');
    const card = builderPage
      .locator('[data-pack-slug]')
      .filter({ hasText: LABELLED_TITLE });

    await expect(card).toBeVisible({ timeout: 20_000 });
    // The label is RENDERED — it is information, just not permission.
    await expect(card.getByText('Founding Members')).toBeVisible();
  });

  test('🔴 a pack with member_visible=false is ABSENT from the page', async ({
    builderPage,
  }) => {
    await builderPage.goto('/members/packs');
    await expect(builderPage.locator('[data-pack-slug]').first()).toBeVisible({
      timeout: 20_000,
    });

    // Asserted against the SERVED SOURCE, not the rendered text: a pack hidden
    // with CSS, or present in a hydration payload, is still disclosed.
    const source = await builderPage.content();
    expect(source).not.toContain(HIDDEN_TITLE);
    expect(source).not.toContain(
      'This note belongs to a pack no member may see.',
    );
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 R5.2 / NFR-S5 — `notes` never reaches a member                       */
  /* ---------------------------------------------------------------------- */

  test('🔴 the admin-only `notes` field appears NOWHERE in the page source', async ({
    builderPage,
  }) => {
    await builderPage.goto('/members/packs');
    await expect(builderPage.locator('[data-pack-slug]').first()).toBeVisible({
      timeout: 20_000,
    });

    // ANTI-VACUITY: the packs carrying that `notes` value ARE on the page, so
    // the absence below is a statement about rendered rows rather than about
    // an empty list.
    await expect(
      builderPage.getByText(LABELLED_TITLE, { exact: false }),
    ).toBeVisible();

    const source = await builderPage.content();
    expect(source).not.toContain(ADMIN_ONLY_MARKER);
    expect(source).not.toContain('B15B-ADMIN-ONLY');
  });

  test('🔴 and the API itself never sends it (the chokepoint, not the template)', async ({
    builderPage,
  }) => {
    // The template could be correct while the field crossed the wire — a
    // reviewer reading only the page would never know. This reads the RESPONSE.
    const bodies: string[] = [];
    builderPage.on('response', async (response) => {
      if (new URL(response.url()).pathname === '/api/v1/members/packs') {
        bodies.push(await response.text().catch(() => ''));
      }
    });

    await builderPage.goto('/members/packs');
    await expect(builderPage.locator('[data-pack-slug]').first()).toBeVisible({
      timeout: 20_000,
    });

    expect(bodies.length).toBeGreaterThan(0);
    const joined = bodies.join('');
    // Anti-vacuity on the body itself.
    expect(joined).toContain(LABELLED_TITLE);
    expect(joined).not.toContain(ADMIN_ONLY_MARKER);
    expect(joined).not.toContain('"notes"');
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 NFR-U5 — both themes, on a POPULATED surface                         */
  /* ---------------------------------------------------------------------- */

  for (const theme of ['operator-member', 'operator-member-light'] as const) {
    test(`the packs surface renders in ${theme} (NFR-U5)`, async ({
      builderPage,
    }, testInfo) => {
      // ⚠️ POPULATED, DELIBERATELY. B7.1's lesson: a theme loop passed over a
      // placeholder for a whole batch, and an empty page renders a centred icon
      // on `base-200` — the least theme-sensitive thing a surface can show. The
      // CARDS are where the token work is.
      await builderPage.addInitScript((value) => {
        window.localStorage.setItem('ptah.members.theme', value);
      }, theme);

      await builderPage.goto('/members/packs');
      await expect(builderPage.locator('[data-pack-slug]').first()).toBeVisible(
        { timeout: 20_000 },
      );

      // 🔴 ASSERTED AS ACTUALLY ATTACHED, not merely requested. A theme written
      // to storage but never bound to `data-theme` renders the daisyUI default
      // and every token silently reverts.
      await expect(
        builderPage.locator(`[data-theme="${theme}"]`).first(),
      ).toBeVisible();

      await testInfo.attach(`packs-${theme}`, {
        body: await builderPage.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* 🔴 Clause 3 — axe, POPULATED **and** EMPTY                              */
  /* ---------------------------------------------------------------------- */

  test('🔴 clause 3 — axe is clean on the packs surface, populated AND empty', async ({
    builderPage,
  }) => {
    // 🔴 THE EMPTY HALF IS THE POINT (RISK-AR). B13's F-1 was a real 3.2:1 WCAG
    // AA failure on `EmptyState`'s hint that survived three phases of axe
    // passes, because every one of them ran against a POPULATED surface and the
    // empty state was never on the page.
    //
    // The surface is emptied by pointing the request at a response with no
    // rows. The SERVER is not touched — other specs in this run share the
    // seeded packs, and emptying the table would break them.
    await auditPopulatedAndEmpty(builderPage, {
      label: '/members/packs',
      populatedMarker: '[data-pack-slug]',
      emptyMarker: 'text=No packs are available to you yet.',
      populate: async () => {
        await builderPage.goto('/members/packs');
      },
      emptyIt: async () => {
        await builderPage.route('**/api/v1/members/packs', (route) =>
          route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify([]),
          }),
        );
        await builderPage.goto('/members/packs');
      },
    });
  });

  test('🔴 RISK-AQ — a FAILED request renders the error cell, not the empty one', async ({
    builderPage,
  }) => {
    // 🔴 THE TWO BLANK SCREENS MEAN DIFFERENT THINGS AND THIS IS THE ONLY PLACE
    // THAT TELLS THEM APART END TO END. "No packs are available to you yet"
    // (the server answered, nothing is visible) and "we could not load your
    // packs" (the request failed) are indistinguishable if the page branches on
    // `items.length` first — RISK-AQ's exact shape, and B13 proved it is the
    // failure that actually ships.
    await builderPage.route('**/api/v1/members/packs', (route) =>
      route.fulfill({ status: 500, body: '{}' }),
    );

    await builderPage.goto('/members/packs');

    const alert = builderPage.locator('[role="alert"]');
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(
      builderPage.getByText('No packs are available to you yet.'),
    ).toHaveCount(0);
    // A retry is what makes the error cell actionable rather than terminal.
    await expect(
      builderPage.getByRole('button', { name: /try again/i }),
    ).toBeVisible();

    // The error cell is itself a surface a member reads — so it is audited too.
    await expectNoAxeViolations(builderPage, '/members/packs [ERROR]');
  });
});
