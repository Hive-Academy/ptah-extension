import { expect, test } from '../support/fixtures';
import {
  cleanupCommunityCategory,
  cleanupUser,
  seedCommunityCategory,
  seedForeignReply,
  seedForeignTopic,
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

  // The §8.2 journey's first four clauses. The fifth — an ACCURATE unread
  // count — needs a second author to be observable at all, so it is the test
  // below rather than a step here. The two together are the gate.
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
   * §8.2 EXIT GATE, FINAL CLAUSE — "sees an ACCURATE unread count".
   *
   * ⚠️ THIS WAS A `test.fail()` IN BATCH 7 AND IT IS NOW A NORMAL TEST. It was
   * never weakened to match the server; the server was fixed to match it.
   * Keeping the history here because it is the whole argument for having
   * written it as a failing case rather than deleting it or asserting whatever
   * the API happened to return.
   *
   * WHAT WAS WRONG. `unreadCount` under-reported by exactly one on every topic
   * that had ever been read, so a thread with ONE unread reply rendered NO badge
   * at all. `Topic.postCount` counts REPLIES and excludes post #1 because post
   * #1 is the topic body (AD-9, AD-11), while `lastReadPostNumber` is a
   * postNumber that counts post #1 — and the read side subtracted one from the
   * other. With no marker the default `0` made the arithmetic accidentally
   * correct, which is why R1.6.3 passed and this went unnoticed. It turned out
   * to be FOUR sites, not one, including the `markCategoryRead` WRITE path,
   * which stored a reply count into a post-number column — so the obvious
   * one-line read-side fix would have made every topic report 1 unread
   * immediately after "mark all read".
   *
   * MEASURED, BEFORE AND AFTER — same fixtures, same markers, same rows in
   * Postgres, `post_count` and the stored marker read alongside each response:
   *
   *   TRUE | BATCH 7 (before) | BATCH 7.1 (after) | post_count | marker
   *     1  |        0         |         1         |     2      |   2
   *     2  |        1         |         2         |     3      |   2
   *     3  |        2         |         3         |     4      |   2
   *     4  |        3         |         4         |     5      |   2
   *
   * The fix named the two units instead of hiding a `- 1`:
   * `libs/api/forum/src/lib/common/post-numbering.ts` exports `repliesRead()`
   * (post number → reply count) and `markerForAllRepliesRead()` (reply count →
   * post number), and all four sites go through it.
   *
   * ⚠️ WHY IT ASSERTS A PROGRESSION AND NOT ONE NUMBER. "Exactly 1" alone would
   * catch the off-by-one that shipped, and nothing else. Stepping 1 → 2 → 0 also
   * catches a badge that is really a boolean, a count that saturates, and a read
   * marker that does not advance — three ways of being wrong that a single
   * observation cannot tell apart from being right.
   */
  test('sees an accurate unread count after replies it did not write', async ({
    builderPage,
  }) => {
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

    // Open it once, so the read state is the one every real thread is in after
    // a visit rather than the never-opened default the old arithmetic happened
    // to get right.
    await builderPage.getByText(title).click();
    await expect(builderPage).toHaveURL(/\/members\/community\/topics\//);
    await expect(
      builderPage.locator('[aria-label="Opening post"]'),
    ).toBeVisible({ timeout: 15_000 });

    // Someone ELSE replies. A member is never unread on their own writing, so a
    // second author is the only way to observe the count at all.
    const other = seedUser(`e2e-other-${Date.now()}@ptah.local`, {
      builder: false,
    });
    try {
      const topicIds = topicIdsInCategory(categoryId);
      expect(topicIds).toHaveLength(1);
      const topicId = topicIds[0];

      /* -- 1 unread. The case that used to render NOTHING. ---------------- */

      seedForeignReply(topicId, other.id, 'A reply you have not read.');
      await builderPage.goto('/members/community');
      const row = builderPage.locator('li').filter({ hasText: title });
      await expect(row).toBeVisible({ timeout: 15_000 });

      const badge = row
        .locator('[aria-label$="unread reply"], [aria-label$="unread replies"]')
        .first();
      await expect(badge).toBeVisible({ timeout: 15_000 });
      // ⚠️ ACCURATE, not merely present. Both halves are asserted because the
      // accessible label and the visible chip are produced separately, and a row
      // that says "1 new" to a sighted member and "2 unread replies" to a
      // screen reader is its own defect.
      await expect(badge).toHaveAttribute('aria-label', '1 unread reply');
      await expect(badge).toHaveText('1 new');

      /* -- 2 unread. A boolean badge would still say 1 here. --------------- */

      seedForeignReply(topicId, other.id, 'A second reply you have not read.');
      await builderPage.goto('/members/community');
      const rowAgain = builderPage.locator('li').filter({ hasText: title });
      const badgeAgain = rowAgain
        .locator('[aria-label$="unread reply"], [aria-label$="unread replies"]')
        .first();
      await expect(badgeAgain).toHaveAttribute(
        'aria-label',
        '2 unread replies',
        { timeout: 15_000 },
      );
      await expect(badgeAgain).toHaveText('2 new');

      /* -- 0 unread once read. The write half of the same units. ---------- */

      // Opening the thread posts the highest rendered `postNumber` as the read
      // marker. If the marker were still written in reply-count units the row
      // would come back reading "1 new" rather than clearing — which is exactly
      // what a read-side-only repair would have produced.
      await rowAgain.getByText(title).click();
      await expect(builderPage).toHaveURL(/\/members\/community\/topics\//);
      await expect(
        builderPage
          .locator('[data-post-number]')
          .filter({ hasText: 'A second reply you have not read.' }),
      ).toBeVisible({ timeout: 15_000 });

      await builderPage.goto('/members/community');
      await expect(builderPage.getByText(title)).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        builderPage
          .locator('li')
          .filter({ hasText: title })
          .locator(
            '[aria-label$="unread reply"], [aria-label$="unread replies"]',
          ),
      ).toHaveCount(0);
    } finally {
      cleanupUser(other.id);
    }
  });

  /* ---------------------------------------------------------------------- */
  /* R9.2 — My Threads                                                       */
  /* ---------------------------------------------------------------------- */

  /**
   * ⚠️ THIS SPEC OWES ITS EXISTENCE TO A REPORTED GAP. Batch 7 could not build
   * this page at all: the member feed had no author filter, and with
   * `forbidNonWhitelisted: true` an invented `?authorId=` was a 400. The route
   * was left on its placeholder and reported. The server then grew `?mine=true`
   * — a boolean on the existing whole-object DTO, resolving the author from
   * `MemberGuard`'s context rather than from anything the browser sends.
   *
   * ⚠️ IT ASSERTS BOTH DIRECTIONS ON THE SAME PAGE. A "my stuff" filter that
   * returned everything would look perfectly healthy in a screenshot, so the
   * negative half — a thread written by SOMEONE ELSE in the same category is
   * absent — is the half that actually tests the filter.
   */
  test('My Threads lists the member’s own thread and excludes another author’s', async ({
    builderPage,
  }) => {
    const mine = `My own thread ${Date.now()}`;

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
      .fill(mine);
    await builderPage
      .locator('ptah-topic-composer textarea')
      .fill('Written by the member under test.');
    await builderPage.getByRole('button', { name: 'Post thread' }).click();
    await expect(builderPage.getByText(mine)).toBeVisible({ timeout: 15_000 });

    // A thread by a DIFFERENT author, in the SAME category, so the only thing
    // separating the two rows is the filter under test.
    const other = seedUser(`e2e-author-${Date.now()}@ptah.local`, {
      builder: false,
    });
    const theirs = `Someone else's thread ${Date.now()}`;
    try {
      seedForeignTopic(categoryId, other.id, theirs, 'Not the member’s.');

      // Both are visible on the unfiltered feed — otherwise the absence below
      // would prove nothing about the filter.
      await builderPage.goto('/members/community');
      await expect(builderPage.getByText(mine)).toBeVisible({
        timeout: 15_000,
      });
      await expect(builderPage.getByText(theirs)).toBeVisible();

      await builderPage.goto('/members/community/my-threads');
      await expect(
        builderPage.getByRole('heading', { name: 'My threads' }),
      ).toBeVisible({ timeout: 20_000 });

      await expect(builderPage.getByText(mine)).toBeVisible({
        timeout: 15_000,
      });
      await expect(builderPage.getByText(theirs)).toHaveCount(0);

      // The page resolved: it is a real list, not a placeholder and not a
      // spinner. One request, on the shared feed endpoint.
      await expect(builderPage.locator('ptah-thread-row')).toHaveCount(1);
      await expect(builderPage.locator('[aria-busy="true"]')).toHaveCount(0);
    } finally {
      cleanupUser(other.id);
    }
  });

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
      builderUser,
    }, testInfo) => {
      // ⚠️ MY THREADS IS SEEDED WITH A ROW, DELIBERATELY. An empty page renders
      // an `EmptyState` — a centred icon on `base-200` — which is the LEAST
      // theme-sensitive thing this surface can show. The row is where the token
      // work actually is: `divide-hairline` boundaries, `bg-surface-high` hover,
      // `base-content/60` metadata and a `badge-primary` unread chip, all of
      // which have to hold in both themes. Seeding one authored by the member
      // under test is what makes the screenshot worth attaching.
      seedForeignTopic(
        categoryId,
        builderUser.id,
        `Theme probe ${theme} ${Date.now()}`,
        'A row to render.',
      );

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

        // My Threads is POPULATED in the shot, not an empty state.
        if (name === 'my-threads') {
          await expect(builderPage.locator('ptah-thread-row')).toHaveCount(1, {
            timeout: 15_000,
          });
        }

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
