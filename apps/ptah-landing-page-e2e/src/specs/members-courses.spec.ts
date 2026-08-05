import type { Page, Request } from '@playwright/test';

import { expect, test } from '../support/fixtures';
import { cleanupCourse, seedCourse, type SeededCourse } from '../support/db';

/**
 * TASK_2026_177 §8.2 P3 — THE MEMBER COURSE JOURNEY, EXECUTED.
 *
 * ⚠️ THE EXIT GATE IS A JOURNEY AND IT MUST BE RUN, NOT REASONED ABOUT: the
 * course list, the course detail, resume, a lesson rendering real markdown,
 * mark-complete updating both the outline and the meter, prev/next crossing a
 * module boundary, a locked module answering `403`, the facade making no
 * YouTube request until it is activated, an axe pass on the player, and both
 * themes. Everything below drives the REAL stack — the Angular dev server on
 * :4200 proxying `/api` to the license server on :3000, against Postgres.
 * Nothing here stubs a course response.
 *
 * ⚠️ FIXTURE HYGIENE UNDER A CONCURRENT SEED. `courses`, `course_modules` and
 * `course_lessons` are being filled by Batch 11 while this runs. So this spec
 * asserts nothing about row counts, never truncates, and tears down strictly by
 * the ids it minted. Its course carries a timestamped slug so two runs cannot
 * collide either, and every locator is scoped to that course.
 */

/* -------------------------------------------------------------------------- */
/* The NFR-S3 network watch                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 🔴 THE HOSTS THAT MUST NOT BE CONTACTED BEFORE THE MEMBER ACTIVATES THE
 * PLAYER — exit-gate clause 2.
 *
 * The script-and-cookie surface: the IFrame API script, the embed itself, the
 * Data API, and the media CDN.
 */
const FORBIDDEN_HOSTS = [
  'youtube.com',
  'youtube-nocookie.com',
  'www.googleapis.com',
  'googlevideo.com',
];

/**
 * ⚠️ 🔴 `www.googleapis.com`, NOT `googleapis.com`, AND THE NARROWING IS A
 * MEASUREMENT RATHER THAN A CONVENIENCE.
 *
 * The first version of this list carried the bare `googleapis.com` and the
 * assertion failed on `fonts.googleapis.com` — the landing app's OWN web fonts,
 * loaded on every page in the product and nothing to do with YouTube. Widening
 * the allowlist to make it pass would have been the wrong repair, and deleting
 * the needle would have been worse. `www.googleapis.com` is the exact host the
 * YouTube Data API is served from (`/youtube/v3/videos`), which is the request
 * NFR-P6 forbids on a member read, and it excludes the font host by being
 * precise instead of by being told to ignore it.
 */
const UNRELATED_GOOGLE_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/**
 * ⚠️ 🔴 `i.ytimg.com` IS A DOCUMENTED EXCEPTION, AND IT IS A LINE SOMEONE READS
 * RATHER THAN A GAP.
 *
 * §4.6.1 makes the facade's poster the persisted `videoThumbnailUrl`, which is
 * served by `i.ytimg.com` — so "zero YouTube network activity" is FALSE the
 * moment the poster renders, and an assertion written only against
 * `youtube.com` would pass while the browser had already contacted Google.
 * Batch 10 took Task 10.4's option (a): assert the NARROWER, TRUE property (no
 * script, no embed, no API, no media) and name the image host as an exception.
 * Option (b) — proxying the thumbnail — needs a backend image route nobody
 * specified (RK-1).
 *
 * NFR-S3's actual concern is the script and cookie surface, not an image: an
 * `<img>` sets no YouTube cookie and runs no third-party code.
 */
const ALLOWED_IMAGE_HOST = 'ytimg.com';

/** Every request the page made, as hostnames. */
function watchHosts(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request: Request) => {
    try {
      seen.push(new URL(request.url()).hostname);
    } catch {
      /* about:blank and data: URLs have no hostname */
    }
  });
  return seen;
}

function matching(hosts: readonly string[], needles: readonly string[]) {
  return hosts.filter((host) => needles.some((n) => host.endsWith(n)));
}

/* -------------------------------------------------------------------------- */

test.describe('Member courses — the P3 journey @p0', () => {
  let course: SeededCourse;

  test.beforeEach(() => {
    course = seedCourse('e2e-course');
  });

  test.afterEach(() => {
    cleanupCourse(course.courseId);
  });

  /* ---------------------------------------------------------------------- */
  /* Exit-gate clause 1 — the course renders as an ORDERED course           */
  /* ---------------------------------------------------------------------- */

  test('a member browses the curriculum, resumes, completes a lesson, and crosses a module boundary', async ({
    builderPage,
  }) => {
    /* -- 1. The list. Rows in server order, with a progress meter. -------- */

    await builderPage.goto('/members/courses');
    await expect(builderPage.locator('ptah-member-layout')).toBeVisible({
      timeout: 20_000,
    });

    const card = builderPage.locator(
      `[data-course-slug="${course.courseSlug}"]`,
    );
    await expect(card).toBeVisible({ timeout: 15_000 });
    // COUNTS, not a percentage passed in: 0 of 3 lessons.
    await expect(card.locator('[role="progressbar"]')).toHaveAttribute(
      'aria-valuenow',
      '0',
    );

    /* -- 2. The detail. Modules IN ORDER, the locked one visible. -------- */

    await card.click();
    await expect(builderPage).toHaveURL(
      new RegExp(`/members/courses/${course.courseSlug}$`),
    );

    const modules = builderPage.locator('[data-module-slug]');
    await expect(modules).toHaveCount(2, { timeout: 15_000 });
    // ⚠️ ORDERED — `sortOrder` ascending, computed server-side and not re-sorted.
    await expect(modules.nth(0)).toHaveAttribute(
      'data-module-slug',
      'open-module',
    );
    await expect(modules.nth(1)).toHaveAttribute(
      'data-module-slug',
      'locked-module',
    );
    await expect(modules.nth(1)).toHaveAttribute('data-locked', 'true');

    // The locked module shows its lesson TITLE (R2.4.4) and no link.
    await expect(modules.nth(1)).toContainText('Locked lesson');
    await expect(modules.nth(1).locator('a')).toHaveCount(0);
    // …and the withheld body never reached the browser.
    await expect(builderPage.locator('body')).not.toContainText(
      'SECRET_E2E_LOCKED_BODY_MARKER',
    );

    /* -- 3. Resume goes to the SERVER's first-incomplete lesson. --------- */

    const resume = builderPage.locator('[data-testid="resume-link"]');
    await expect(resume).toBeVisible();
    await resume.click();
    await expect(builderPage).toHaveURL(
      new RegExp(`/lessons/${course.videoLessonSlug}$`),
    );

    /* -- 4. The body renders as REAL MARKDOWN, through the one renderer. -- */

    await expect(builderPage.locator('ptah-markdown-block')).toBeVisible({
      timeout: 15_000,
    });
    // `**real markdown**` became a <strong>, so a renderer really ran.
    await expect(
      builderPage.locator('ptah-markdown-block strong').first(),
    ).toHaveText('real markdown');

    /* -- 5. Mark complete. The server's verdict, reflected back. --------- */

    const toggle = builderPage.locator('[data-testid="completion-toggle"]');
    await expect(toggle).toContainText('Mark complete');
    await toggle.click();
    await expect(toggle).toContainText('Completed', { timeout: 15_000 });
    await expect(
      builderPage.locator('[data-testid="completion-reason"]'),
    ).toContainText('you marked this done');

    /* -- 6. prev/next CROSSES the module boundary (R2.1.5). -------------- */

    const next = builderPage.locator('[data-testid="next-lesson"]');
    await expect(next).toBeVisible();
    await next.click();
    await expect(builderPage).toHaveURL(
      new RegExp(`/lessons/${course.textLessonSlug}$`),
    );
    // The text lesson's `next` is the LOCKED module's lesson — the traversal
    // goes THROUGH the lock rather than around it.
    await expect(
      builderPage.locator('[data-testid="next-lesson"]'),
    ).toContainText('Locked lesson');

    /* -- 7. The outline and the meter BOTH moved. ------------------------ */

    await builderPage.goto(`/members/courses/${course.courseSlug}`);
    await expect(
      builderPage.locator(
        `[data-lesson-slug="${course.videoLessonSlug}"][data-completed="true"]`,
      ),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      builderPage.locator('[role="progressbar"]').first(),
    ).toHaveAttribute('aria-valuenow', '33');

    await builderPage.goto('/members/courses');
    await expect(
      builderPage
        .locator(`[data-course-slug="${course.courseSlug}"]`)
        .locator('[role="progressbar"]'),
    ).toHaveAttribute('aria-valuenow', '33', { timeout: 15_000 });
  });

  /* ---------------------------------------------------------------------- */
  /* The locked module — a 403 READ OFF THE WIRE, not a CSS state           */
  /* ---------------------------------------------------------------------- */

  test('a locked module renders the notice AND the API returned 403', async ({
    builderPage,
  }) => {
    // ⚠️ 🔴 THE STATUS IS READ OFF THE INTERCEPTED RESPONSE (R2.4.5). "The UI
    // looks locked" is exactly what a CSS-only treatment also looks like.
    const statuses: number[] = [];
    builderPage.on('response', (response) => {
      if (response.url().includes(`/lessons/${course.lockedLessonSlug}`)) {
        statuses.push(response.status());
      }
    });

    await builderPage.goto(
      `/members/courses/${course.courseSlug}/lessons/${course.lockedLessonSlug}`,
    );

    await expect(
      builderPage.locator('[data-testid="locked-module-notice"]'),
    ).toBeVisible({ timeout: 20_000 });
    await expect(builderPage.locator('body')).toContainText(
      'This module is not open yet',
    );
    // Plain language, derived from the machine reason — never the server's
    // sentence, and with a real <time datetime>.
    await expect(builderPage.locator('body')).toContainText('Unlocks on');
    await expect(
      builderPage.locator('[data-testid="locked-module-notice"] time'),
    ).toHaveAttribute('datetime', /^2027-12-25/);

    expect(statuses).toContain(403);

    // The lesson's content is ABSENT, not hidden: the payload was never produced.
    await expect(builderPage.locator('ptah-markdown-block')).toHaveCount(0);
    await expect(builderPage.locator('body')).not.toContainText(
      'SECRET_E2E_LOCKED_BODY_MARKER',
    );
  });

  test('a 404 lesson renders neutral copy with none of the three forbidden words', async ({
    builderPage,
  }) => {
    await builderPage.goto(
      `/members/courses/${course.courseSlug}/lessons/no-such-lesson`,
    );
    await expect(builderPage.locator('[role="alert"]')).toBeVisible({
      timeout: 20_000,
    });

    const body = (await builderPage.locator('body').innerText()).toLowerCase();
    expect(body).toContain('this lesson is not available');
    // R1.1.3 — `404` covers absent AND invisible, and leaking the difference in
    // copy undoes the where-clause's work.
    expect(body).not.toContain('not allowed');
    expect(body).not.toContain('forbidden');
    expect(body).not.toContain('permission');
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 Exit-gate clause 2 — NFR-S3                                          */
  /* ---------------------------------------------------------------------- */

  test('🔴 NFR-S3 — no YouTube request until the poster is activated, and at least one after', async ({
    builderPage,
  }) => {
    const hosts = watchHosts(builderPage);

    await builderPage.goto(
      `/members/courses/${course.courseSlug}/lessons/${course.videoLessonSlug}`,
    );

    const poster = builderPage.locator('[data-testid="video-poster"]');
    await expect(poster).toBeVisible({ timeout: 20_000 });
    // ⚠️ ANTI-VACUITY, AND IT IS THE HALF THAT MATTERS. This lesson genuinely
    // HAS an 11-character video id — no seeded lesson does (§7.3) — so "no
    // request fired" is not true merely because there was nothing to request.
    await expect(poster).toHaveAttribute('aria-label', /^Play: /);
    await expect(
      builderPage.locator('[data-testid="video-poster-image"]'),
    ).toBeVisible();
    await expect(builderPage.locator('iframe')).toHaveCount(0);

    // Give any lazy fetch a chance to fire before declaring the negative.
    await builderPage.waitForTimeout(1_500);

    /* -- BEFORE: nothing on the script/embed/API/media surface. ---------- */

    const beforeForbidden = matching(hosts, FORBIDDEN_HOSTS);
    expect(beforeForbidden).toEqual([]);

    // …and the documented exception really did happen, so the allowlist is a
    // statement about reality rather than a precaution.
    expect(matching(hosts, [ALLOWED_IMAGE_HOST]).length).toBeGreaterThan(0);

    // ANTI-VACUITY on the NARROWING: the font host really is contacted, so
    // `www.googleapis.com` is doing work that a bare `googleapis.com` would
    // have done by accident.
    expect(matching(hosts, UNRELATED_GOOGLE_HOSTS).length).toBeGreaterThan(0);

    /* -- ACTIVATE. -------------------------------------------------------- */

    const beforeCount = hosts.length;
    await poster.click();

    // ⚠️ 🔴 THE POSITIVE HALF IS NOT OPTIONAL. Without it this test passes on a
    // page that renders no player at all — RISK-P's frontend twin, and the exact
    // shape of Batch 6's vacuous EXPLAIN and Batch 8's invariant byte check.
    await expect(builderPage.locator('iframe')).toHaveCount(1, {
      timeout: 20_000,
    });
    await builderPage.waitForTimeout(2_000);

    const afterForbidden = matching(hosts.slice(beforeCount), FORBIDDEN_HOSTS);
    expect(afterForbidden.length).toBeGreaterThan(0);

    // The iframe really is on the nocookie origin, parsed rather than matched.
    const src = await builderPage.locator('iframe').getAttribute('src');
    expect(new URL(src ?? '').origin).toBe('https://www.youtube-nocookie.com');
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 Exit-gate clause 3 — keyboard operability and axe                    */
  /* ---------------------------------------------------------------------- */

  for (const key of ['Enter', 'Space'] as const) {
    test(`🔴 NFR-U4 — the player is activated by ${key} with no mouse`, async ({
      builderPage,
    }) => {
      await builderPage.goto(
        `/members/courses/${course.courseSlug}/lessons/${course.videoLessonSlug}`,
      );
      const poster = builderPage.locator('[data-testid="video-poster"]');
      await expect(poster).toBeVisible({ timeout: 20_000 });

      // ⚠️ FOCUSED BY KEYBOARD, NOT BY `.focus()`. A `<div>` with a click
      // handler can be focused programmatically and still be unreachable by
      // Tab, which is the failure this asserts against.
      await builderPage.keyboard.press('Tab');
      for (let i = 0; i < 40; i += 1) {
        const onPoster = await poster.evaluate(
          (node) => node === document.activeElement,
        );
        if (onPoster) break;
        await builderPage.keyboard.press('Tab');
      }
      await expect(poster).toBeFocused();

      await builderPage.keyboard.press(key);
      await expect(builderPage.locator('iframe')).toHaveCount(1, {
        timeout: 20_000,
      });
    });
  }

  test('🔴 axe finds no violations on the lesson page, poster state AND activated', async ({
    builderPage,
  }) => {
    await builderPage.goto(
      `/members/courses/${course.courseSlug}/lessons/${course.videoLessonSlug}`,
    );
    await expect(
      builderPage.locator('[data-testid="video-poster"]'),
    ).toBeVisible({ timeout: 20_000 });

    /* -- The poster state. ------------------------------------------------ */
    const posterResults = await runAxe(builderPage);
    expect(posterResults).toEqual([]);

    /* -- The activated state. --------------------------------------------- */
    await builderPage.locator('[data-testid="video-poster"]').click();
    await expect(builderPage.locator('iframe')).toHaveCount(1, {
      timeout: 20_000,
    });
    const playerResults = await runAxe(builderPage);
    expect(playerResults).toEqual([]);
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 Exit-gate clause 4 — both themes, on POPULATED surfaces              */
  /* ---------------------------------------------------------------------- */

  for (const theme of ['operator-member', 'operator-member-light'] as const) {
    test(`the course surfaces render in ${theme} (NFR-U5)`, async ({
      builderPage,
    }, testInfo) => {
      // ⚠️ THE SURFACES ARE POPULATED, DELIBERATELY. B7.1's lesson: a theme loop
      // passed over a placeholder for a whole batch, and an empty page renders a
      // centred icon on `base-200`, the least theme-sensitive thing a surface
      // can show. The ROWS are where the token work is — `border-hairline`
      // boundaries, `bg-surface-high` hover, the `base-300` meter track, the
      // `badge-success` "Answered" chip and `base-content/60` metadata.
      await builderPage.addInitScript((value) => {
        localStorage.setItem('ptah.members.theme', value);
      }, theme);

      for (const [name, path] of [
        ['courses', '/members/courses'],
        ['course-detail', `/members/courses/${course.courseSlug}`],
        [
          'lesson',
          `/members/courses/${course.courseSlug}/lessons/${course.videoLessonSlug}`,
        ],
        [
          'lesson-locked',
          `/members/courses/${course.courseSlug}/lessons/${course.lockedLessonSlug}`,
        ],
      ] as const) {
        await builderPage.goto(path);
        await expect(builderPage.locator('ptah-member-layout')).toBeVisible({
          timeout: 20_000,
        });

        // The panel really is on the theme under test, not merely rendered.
        await expect(
          builderPage.locator(`[data-theme="${theme}"]`).first(),
        ).toBeAttached();

        // …and the surface really has content on it.
        if (name === 'courses') {
          await expect(
            builderPage.locator(`[data-course-slug="${course.courseSlug}"]`),
          ).toBeVisible({ timeout: 15_000 });
        }
        if (name === 'course-detail') {
          await expect(builderPage.locator('[data-module-slug]')).toHaveCount(
            2,
            { timeout: 15_000 },
          );
        }
        if (name === 'lesson') {
          await expect(builderPage.locator('ptah-markdown-block')).toBeVisible({
            timeout: 15_000,
          });
        }
        if (name === 'lesson-locked') {
          await expect(
            builderPage.locator('[data-testid="locked-module-notice"]'),
          ).toBeVisible({ timeout: 15_000 });
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

  /* ---------------------------------------------------------------------- */
  /* Lesson comments — one level, and the "Answered" treatment              */
  /* ---------------------------------------------------------------------- */

  test('a member asks a question, replies once, and marks it answered — never two levels', async ({
    builderPage,
  }) => {
    await builderPage.goto(
      `/members/courses/${course.courseSlug}/lessons/${course.textLessonSlug}`,
    );
    await expect(builderPage.locator('ptah-lesson-comments')).toBeVisible({
      timeout: 20_000,
    });

    const pageComposer = builderPage.locator(
      'section > ptah-lesson-comment-composer',
    );
    await pageComposer
      .locator('textarea')
      .fill('How does reconciliation work?');
    await pageComposer.getByRole('button', { name: 'Post question' }).click();

    const question = builderPage
      .locator('[data-comment-id]')
      .filter({ hasText: 'How does reconciliation work?' });
    await expect(question).toBeVisible({ timeout: 15_000 });

    // Reply to it — the nested case.
    await question.getByRole('button', { name: /^Reply to / }).click();
    const nested = question.locator('ptah-lesson-comment-composer');
    await nested.locator('textarea').fill('Through the desired state.');
    await nested.getByRole('button', { name: 'Post reply' }).click();

    await expect(
      builderPage
        .locator('[data-comment-id]')
        .filter({ hasText: 'Through the desired state.' }),
    ).toBeVisible({ timeout: 15_000 });

    // ⚠️ §8.2 — `data-reply` is a BOOLEAN, so however deep the data goes there
    // are exactly two rendered levels.
    const indents = await builderPage
      .locator('[data-comment-id]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-reply')));
    expect(new Set(indents).size).toBeLessThanOrEqual(2);
    expect(indents.every((v) => v === 'true' || v === 'false')).toBe(true);
    // The negative control: both values really are present.
    expect(new Set(indents)).toEqual(new Set(['false', 'true']));

    // A-8 — no reaction affordance anywhere on this surface.
    await expect(builderPage.locator('ptah-reaction-bar')).toHaveCount(0);

    // ⚠️ 🔴 AND AN ORDINARY MEMBER SEES NO "Mark answered" CONTROL. R2.5.3
    // restricts the mark to an admin or the course author
    // (`lesson-comments.service.ts:294-312`), so rendering the button for
    // everyone would ship an affordance that always answers 403. The FIRST run
    // of this spec did exactly that and this is the assertion that replaced it.
    await expect(
      builderPage.getByRole('button', { name: 'Mark this question answered' }),
    ).toHaveCount(0);
  });

  /**
   * The positive half of R2.5.3, on the account that actually holds the
   * permission.
   *
   * ⚠️ WITHOUT THIS, "the member sees no button" would be satisfied by a
   * feature that does not exist. `adminPage` reuses the real `ADMIN_EMAILS`
   * account, whose `DEV-BUILDERS-VALIDATION-0001` licence clears the members
   * gate.
   */
  test('an admin CAN mark a question answered, and it renders a StatusBadge', async ({
    adminPage,
  }) => {
    await adminPage.goto(
      `/members/courses/${course.courseSlug}/lessons/${course.textLessonSlug}`,
    );
    await expect(adminPage.locator('ptah-lesson-comments')).toBeVisible({
      timeout: 20_000,
    });

    const composer = adminPage.locator(
      'section > ptah-lesson-comment-composer',
    );
    await composer.locator('textarea').fill('Does the finalizer re-run?');
    await composer.getByRole('button', { name: 'Post question' }).click();

    await expect(
      adminPage
        .locator('[data-comment-id]')
        .filter({ hasText: 'Does the finalizer re-run?' }),
    ).toBeVisible({ timeout: 15_000 });

    // The composer CLEARED, because the server accepted the write. The first
    // run of this spec found it still holding the text.
    await expect(composer.locator('textarea')).toHaveValue('');

    await adminPage
      .getByRole('button', { name: 'Mark this question answered' })
      .click();
    await expect(
      adminPage.locator('ptah-status-badge').filter({ hasText: 'Answered' }),
    ).toBeVisible({ timeout: 15_000 });
  });

  /* ---------------------------------------------------------------------- */
  /* R6.2 / R6.6 — the hub is STILL exactly one request, in Phase 3          */
  /* ---------------------------------------------------------------------- */

  test('🔴 the hub still issues exactly ONE member request, with a live course present', async ({
    builderPage,
  }) => {
    // ⚠️ THE PHASE-3 LIVE VARIANT of Batch 4's assertion, added ALONGSIDE the
    // stubbed original rather than replacing it. Phase 3 is where a "continue
    // learning" card is most tempted to fetch for itself, and the course now
    // EXISTS — so the hub's `learning` section is `'ok'` rather than `'empty'`
    // and the composer has a reason to reach for a second request.
    // ⚠️ 🔴 `…/members/entitlement` IS EXCLUDED, AND IT IS NOT A LOOPHOLE. That
    // request is `MemberGuard`'s ENTITLEMENT PROBE, issued in
    // `@ptah-web/core` BEFORE the route resolves and before `loadChildren`
    // runs — it is what decides whether the member panel is reachable at all,
    // and it fires identically on every member URL including the placeholder
    // ones. Counting it would make this assertion a statement about the guard
    // rather than about the hub. What R6.2/R6.6 forbid is a SECTION fetching
    // for itself, and every such request would land on `/hub`, `/courses`,
    // `/community/*` or `/packs` — all of which are still counted here. The
    // first run of this test measured `['…/members/entitlement',
    // '…/members/hub']`; without the exclusion the constant would have had to
    // read `2`, which describes nothing.
    const memberRequests: string[] = [];
    const guardProbes: string[] = [];
    builderPage.on('request', (request: Request) => {
      const url = request.url();
      if (!url.includes('/api/v1/members/')) return;
      if (url.includes('/members/entitlement')) {
        guardProbes.push(url);
        return;
      }
      memberRequests.push(url);
    });

    await builderPage.goto('/members/hub');
    await expect(builderPage.locator('ptah-member-layout')).toBeVisible({
      timeout: 20_000,
    });
    // Give any lazy child the chance to fetch before counting.
    await builderPage.waitForTimeout(1_500);

    expect(memberRequests).toHaveLength(1);
    expect(memberRequests[0]).toContain('/api/v1/members/hub');
    expect(memberRequests.filter((u) => u.includes('/courses'))).toEqual([]);

    // ANTI-VACUITY on the exclusion: the guard probe really did fire, so the
    // filter above removed something real rather than nothing.
    expect(guardProbes.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* axe                                                                         */
/* -------------------------------------------------------------------------- */

interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: number;
}

/**
 * Runs axe over the page's OWN DOM.
 *
 * ⚠️ 🔴 THE THIRD-PARTY IFRAME IS EXCLUDED, AND THAT EXCLUSION IS STATED. In
 * the activated state the page embeds YouTube's player. Its internals are not
 * this repository's to fix and an unscoped run would report them forever, which
 * is how an a11y gate becomes noise someone learns to ignore. The exclusion is
 * `iframe` and nothing else — every element this repo authored is still in
 * scope.
 *
 * ⚠️ AXE IS LOADED FROM A CDN RATHER THAN FROM A DEV DEPENDENCY, AND THAT IS A
 * DELIBERATE TRADE THIS BATCH REPORTS RATHER THAN HIDES. `@axe-core/playwright`
 * is not installed, and installing it would rewrite `package.json` and
 * `package-lock.json` while two other processes are writing to this repository —
 * the shared-registry collision `context.md`'s serialisation rule exists to
 * prevent. The durable fix is one `devDependencies` line, and it belongs to
 * whoever owns Batch 15's full axe pass. This helper FAILS LOUDLY if the script
 * cannot be loaded — it never skips silently, which would make the gate
 * vacuous.
 */
async function runAxe(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({
    url: 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js',
  });

  const loaded = await page.evaluate(
    () => typeof (window as { axe?: unknown }).axe !== 'undefined',
  );
  // A silent skip here would make the whole clause vacuous.
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
              nodes: unknown[];
            }[];
          }>;
        };
      }
    ).axe;

    const results = await axe.run(
      // The page's own DOM; the third-party iframe is excluded by selector.
      { include: [['body']], exclude: [['iframe']] },
      { resultTypes: ['violations'] },
    );

    return results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
    }));
  });
}
