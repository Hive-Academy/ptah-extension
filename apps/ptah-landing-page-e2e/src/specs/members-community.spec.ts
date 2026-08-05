import { expect, test } from '../support/fixtures';
import {
  cleanupCommunityCategory,
  cleanupUser,
  seedCommunityCategory,
  seedForeignReply,
  seedUser,
  topicIdsInCategory,
} from '../support/db';

/**
 * TASK_2026_177 §8.2 P2 — THE MEMBER COMMUNITY JOURNEY, EXECUTED.
 *
 * ⚠️ THE EXIT GATE IS A JOURNEY AND IT MUST BE RUN, NOT REASONED ABOUT: a member
 * creates a topic, replies one level, reacts, and sees an accurate unread count.
 * Everything below drives the REAL stack — the Angular dev server on :4200
 * proxying `/api` to the license server on :3000, against Postgres. Nothing here
 * stubs a community response. `members-content.spec.ts` stubs the HUB, and only
 * because its `sessions` section reads live Google Calendar; the forum has no
 * such dependency, so stubbing it would test the fixtures instead of the feature.
 *
 * ⚠️ FIXTURE HYGIENE UNDER A CONCURRENT SEED. The `community_*` tables may be
 * empty or may be filling with the MG-1 seed from another batch. So this spec
 * asserts nothing about row counts, never truncates, and tears down strictly by
 * the ids it created (`cleanupCommunityCategory`). Its category carries a
 * timestamped slug so two runs cannot collide either.
 *
 * ⚠️ THE SEEDED CATEGORY IS `visibility: 'member'`. The e2e Builder holds no
 * `member_group_assignment` — deliberately, matching the dev account — so a
 * `'cohort'` category would be invisible and every step would fail as a 404
 * that looked like a rendering bug rather than a fixture one.
 */

const CATEGORY_NAME = 'E2E Community';

test.describe('Member community — the P2 journey @p0', () => {
  let categoryId: string;
  let categorySlug: string;

  test.beforeEach(() => {
    categorySlug = `e2e-community-${Date.now()}`;
    categoryId = seedCommunityCategory(categorySlug, CATEGORY_NAME);
  });

  test.afterEach(() => {
    cleanupCommunityCategory(categoryId);
  });

  // The §8.2 journey minus its final clause: the unread-count half is a
  // separate `test.fail()` below, because the server currently cannot satisfy
  // it. Splitting it keeps this test an honest green rather than a green that
  // quietly stopped asserting something.
  test('a member creates a topic, replies one level, reacts, and reads the thread clean', async ({
    builderPage,
    builderUser,
  }) => {
    const title = `Wiring a second provider tree ${Date.now()}`;

    /* -- 1. The feed loads, with the seeded category on the rail ----------- */

    await builderPage.goto('/members/community');
    await expect(builderPage.locator('ptah-member-layout')).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      builderPage.getByRole('navigation', { name: 'Categories' }),
    ).toContainText(CATEGORY_NAME);

    /* -- 2. Create a topic. Post #1 IS the body (AD-9). -------------------- */

    await builderPage.getByRole('button', { name: 'Start a thread' }).click();
    await builderPage
      .locator('ptah-topic-composer select')
      .selectOption({ label: CATEGORY_NAME });
    await builderPage
      .locator('ptah-topic-composer input[type="text"]')
      .fill(title);
    await builderPage
      .locator('ptah-topic-composer textarea')
      .fill('The **opening post** is the body of the topic.');
    await builderPage.getByRole('button', { name: 'Post thread' }).click();

    // The feed re-reads and the new row appears.
    await expect(builderPage.getByText(title)).toBeVisible({ timeout: 15_000 });

    /* -- 3. Open the thread. The body renders through the ONE renderer. ---- */

    await builderPage.getByText(title).click();
    await expect(builderPage).toHaveURL(/\/members\/community\/topics\//);
    await expect(
      builderPage.locator('[aria-label="Opening post"] ptah-markdown-block'),
    ).toBeVisible();
    // Markdown really was rendered, not printed: `**opening post**` became <strong>.
    await expect(
      builderPage.locator('[aria-label="Opening post"] strong'),
    ).toHaveText('opening post');

    /* -- 4. Reply once, then reply to that reply. ONE LEVEL ONLY (R1.3.4). - */

    // ⚠️ EVERY COMPOSER IS ADDRESSED THROUGH A SCOPED LOCATOR, never through
    // `.first()` / `.last()` over the page. Two composers exist at different
    // moments — the thread-level one is a direct child of `<article>`, the
    // inline one is inside a `[data-post-number]` row — and an index-based
    // locator resolves against whatever happens to be mounted at that instant,
    // which is how a fill lands in one composer and the click in the other.
    const threadComposer = builderPage.locator('article > ptah-reply-composer');
    await threadComposer.locator('textarea').fill('A top-level reply.');
    await threadComposer.getByRole('button', { name: 'Post reply' }).click();

    const parentRow = builderPage
      .locator('[data-post-number]')
      .filter({ hasText: 'A top-level reply.' });
    await expect(parentRow).toBeVisible({ timeout: 15_000 });

    // Reply TO that reply — the nested case.
    await parentRow.getByRole('button', { name: 'Reply' }).click();
    const nestedComposer = parentRow.locator('ptah-reply-composer');
    await expect(nestedComposer).toBeVisible();
    await nestedComposer
      .locator('textarea')
      .fill('A nested reply, one level down.');
    await nestedComposer.getByRole('button', { name: 'Post reply' }).click();

    await expect(
      builderPage.locator('[data-post-number]').filter({
        hasText: 'A nested reply, one level down.',
      }),
    ).toBeVisible({ timeout: 15_000 });

    // ⚠️ §8.2 EXIT GATE — `data-reply` is a BOOLEAN, so however deep the data
    // goes there are exactly two rendered levels. Asserted over the live DOM,
    // not over a fixture.
    const indents = await builderPage
      .locator('[data-post-number]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-reply')));
    expect(new Set(indents).size).toBeLessThanOrEqual(2);
    expect(indents.every((v) => v === 'true' || v === 'false')).toBe(true);

    /* -- 5. React. PUT converges; the response is authoritative. ----------- */

    const likeButton = builderPage
      .locator('[aria-label^="Add a Like"]')
      .first();
    await likeButton.click();
    // The button flips to the "remove" affordance and carries the count.
    await expect(
      builderPage.locator('[aria-label^="Remove your Like"]').first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      builderPage.locator('[aria-label^="Remove your Like"]').first(),
    ).toContainText('1');

    /* -- 6. A thread the member has read carries no unread badge. --------- */

    await builderPage.goto('/members/community');
    await expect(builderPage.getByText(title)).toBeVisible({ timeout: 15_000 });
    await expect(
      builderPage
        .locator('li')
        .filter({ hasText: title })
        .locator(
          '[aria-label$="unread reply"], [aria-label$="unread replies"]',
        ),
    ).toHaveCount(0);

    void builderUser;
  });

  /**
   * ⚠️ EXPECTED TO FAIL — A LIVE SERVER DEFECT, NOT A FRONTEND ONE.
   *
   * `unreadCount` UNDER-REPORTS BY EXACTLY ONE once a read marker exists, so a
   * thread with one unread reply renders no badge at all. Measured against the
   * running stack on 2026-08-05 (`postCount` and the stored marker read straight
   * out of Postgres alongside each response):
   *
   *   true unread | server unreadCount | post_count | marker
   *        1      |         0          |     2      |   2
   *        2      |         1          |     3      |   2
   *        3      |         2          |     4      |   2
   *        4      |         3          |     5      |   2
   *
   * ROOT CAUSE. `unreadCount(postCount, lastReadPostNumber)` in
   * `libs/api/forum/src/lib/read-state/read-state.service.ts` computes
   * `max(0, postCount - lastReadPostNumber)` — but the two operands are in
   * DIFFERENT UNITS. `Topic.postCount` counts REPLIES and excludes post #1,
   * because post #1 is the topic body (AD-9, AD-11); `lastReadPostNumber` is a
   * `postNumber`, which counts post #1. Subtracting one from the other is off by
   * one for every topic that has ever been read. With no marker at all the
   * default is `0` and the arithmetic is accidentally correct, which is why the
   * "never opened reports its whole reply count" case (R1.6.3) works and why
   * this went unnoticed.
   *
   * WHY THE CLIENT CANNOT COMPENSATE. `PostsService.createReply` advances the
   * author's own marker to the new post's `postNumber` server-side, and the
   * marker is MONOTONIC by design — so a client posting a corrected, lower value
   * is ignored (verified: `markRead(1)` against a stored `2` left it at `2`).
   * The units are fixed on the server and can only be fixed there. The one-line
   * shape is `max(0, postCount - max(0, lastReadPostNumber - 1))`.
   *
   * WHY `test.fail()` RATHER THAN A WEAKER ASSERTION. Asserting the current
   * behaviour would encode the defect as the requirement. Deleting the case
   * would lose it. `test.fail()` keeps the suite green today AND turns RED the
   * moment the server is fixed, which is precisely when someone needs to come
   * back and promote it to a normal test.
   */
  test.fail(
    'sees an accurate unread count after a reply it did not write (server off-by-one)',
    async ({ builderPage }) => {
      const title = `Unread accuracy ${Date.now()}`;

      await builderPage.goto('/members/community');
      await expect(builderPage.locator('ptah-member-layout')).toBeVisible({
        timeout: 20_000,
      });
      await builderPage.getByRole('button', { name: 'Start a thread' }).click();
      await builderPage
        .locator('ptah-topic-composer select')
        .selectOption({ label: CATEGORY_NAME });
      await builderPage
        .locator('ptah-topic-composer input[type="text"]')
        .fill(title);
      await builderPage
        .locator('ptah-topic-composer textarea')
        .fill('Opening body.');
      await builderPage.getByRole('button', { name: 'Post thread' }).click();
      await expect(builderPage.getByText(title)).toBeVisible({
        timeout: 15_000,
      });

      // Open it once so a read marker exists — which is the state the defect
      // needs, and the state every real thread is in after one visit.
      await builderPage.getByText(title).click();
      await expect(builderPage).toHaveURL(/\/members\/community\/topics\//);
      await expect(
        builderPage.locator('[aria-label="Opening post"]'),
      ).toBeVisible({ timeout: 15_000 });

      // Someone ELSE replies. A member is never unread on their own writing, so
      // a second author is the only way to observe the count at all.
      const other = seedUser(`e2e-other-${Date.now()}@ptah.local`, {
        builder: false,
      });
      try {
        const topicIds = topicIdsInCategory(categoryId);
        expect(topicIds).toHaveLength(1);
        seedForeignReply(topicIds[0], other.id, 'A reply you have not read.');

        await builderPage.goto('/members/community');
        await expect(builderPage.getByText(title)).toBeVisible({
          timeout: 15_000,
        });

        // ⚠️ ACCURATE, not merely present: exactly one unread reply. This is
        // the assertion the server currently cannot satisfy.
        await expect(
          builderPage
            .locator('li')
            .filter({ hasText: title })
            .locator('[aria-label="1 unread reply"]')
            .first(),
        ).toBeVisible({ timeout: 15_000 });
      } finally {
        cleanupUser(other.id);
      }
    },
  );

  test('search finds the thread, highlights the match, and emits no markup', async ({
    builderPage,
  }) => {
    const marker = `zqxsearch${Date.now()}`;
    const title = `A thread about ${marker}`;

    // Create through the UI so the row is exactly what the app writes.
    await builderPage.goto('/members/community');
    await expect(builderPage.locator('ptah-member-layout')).toBeVisible({
      timeout: 20_000,
    });
    await builderPage.getByRole('button', { name: 'Start a thread' }).click();
    await builderPage
      .locator('ptah-topic-composer select')
      .selectOption({ label: CATEGORY_NAME });
    await builderPage
      .locator('ptah-topic-composer input[type="text"]')
      .fill(title);
    await builderPage
      .locator('ptah-topic-composer textarea')
      .fill(`The body also mentions ${marker} once.`);
    await builderPage.getByRole('button', { name: 'Post thread' }).click();
    await expect(builderPage.getByText(title)).toBeVisible({ timeout: 15_000 });

    await builderPage.goto('/members/search');
    await builderPage.locator('input[type="search"]').fill(marker);
    await builderPage.getByRole('button', { name: 'Search' }).click();

    await expect(builderPage.locator('#search-topics')).toContainText(
      'Threads (1)',
      { timeout: 15_000 },
    );

    // ⚠️ R1.7.5 — the highlight is a SPAN OVER A TEXT NODE, produced client-side
    // from plain text plus offsets. The server emits no markup, so the match is
    // wrapped by `HighlightTextPipe` and by nothing else.
    const highlighted = builderPage.locator('#search-topics ~ ul .bg-primary');
    await expect(highlighted.first()).toHaveText(marker);

    // The `lessons` group is present and empty — declared now, filled by B10.
    await expect(builderPage.locator('#search-lessons')).toContainText(
      'Lessons (0)',
    );
    await expect(
      builderPage.locator('#search-lessons ~ div ptah-empty-state'),
    ).toBeVisible();
  });

  /* ---------------------------------------------------------------------- */
  /* NFR-U5 — both member themes                                             */
  /* ---------------------------------------------------------------------- */

  for (const theme of ['operator-member', 'operator-member-light'] as const) {
    test(`the community surfaces render in ${theme} (NFR-U5)`, async ({
      builderPage,
    }, testInfo) => {
      // `MemberThemeService` reads `ptah.members.theme` on init and writes it
      // through to `data-theme` (AD-13 — one writer, one key, no `class="dark"`).
      await builderPage.addInitScript((value) => {
        localStorage.setItem('ptah.members.theme', value);
      }, theme);

      for (const [name, path] of [
        ['feed', '/members/community'],
        ['my-threads', '/members/community/my-threads'],
        ['search', '/members/search'],
      ] as const) {
        await builderPage.goto(path);
        await expect(builderPage.locator('ptah-member-layout')).toBeVisible({
          timeout: 20_000,
        });

        // The panel really is on the theme under test, not merely rendered.
        await expect(
          builderPage.locator(`[data-theme="${theme}"]`).first(),
        ).toBeAttached();

        // Attached as run evidence rather than compared against a baseline: a
        // pixel baseline for a surface this new would encode today's layout as
        // a requirement. The full axe pass is Batch 15's (§8.2 P5).
        await testInfo.attach(`${name}-${theme}.png`, {
          body: await builderPage.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      }
    });
  }
});
