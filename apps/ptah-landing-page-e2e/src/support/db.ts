import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/**
 * Postgres seed/cleanup helpers — the same `docker exec ... psql` path used by
 * `scripts/google-sessions-smoke.mjs` (`seedUser`/`cleanup`). Deterministic fixtures for
 * the UI specs: a plain community user, or a Builder (active subscription row so
 * entitlement resolves from the DB, not the JWT — handoff §4).
 *
 * Container/db/user match docker-compose.yml: `ptah_postgres` / `ptah` / `ptah_db`.
 */
const PG_CONTAINER = process.env['E2E_PG_CONTAINER'] || 'ptah_postgres';
const PG_USER = process.env['E2E_PG_USER'] || 'ptah';
const PG_DB = process.env['E2E_PG_DB'] || 'ptah_db';

export function psql(sql: string): string {
  const escaped = sql.replace(/"/g, '\\"');
  return execSync(
    `docker exec -i ${PG_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -tAc "${escaped}"`,
    { encoding: 'utf8' },
  ).trim();
}

export interface SeededUser {
  id: string;
  email: string;
  builder: boolean;
}

/**
 * Insert a user, and (for a Builder) an active subscription so
 * `GET /api/v1/licenses/me` reports `tier: 'builders'` and the members gate opens.
 * Mirrors `seedUser()` in scripts/google-sessions-smoke.mjs.
 */
export function seedUser(
  email: string,
  opts: { builder: boolean },
): SeededUser {
  const uid = randomUUID();
  psql(
    `INSERT INTO users (id, email, created_at, updated_at) VALUES ('${uid}', '${email}', now(), now())`,
  );
  if (opts.builder) {
    const sid = randomUUID();
    psql(
      `INSERT INTO subscriptions (id, user_id, paddle_subscription_id, paddle_customer_id, status, price_id, current_period_end, created_at, updated_at) ` +
        `VALUES ('${sid}', '${uid}', 'sub_${sid.slice(0, 8)}', 'ctm_${sid.slice(0, 8)}', 'active', 'pri_e2e', now() + interval '30 days', now(), now())`,
    );
  }
  return { id: uid, email, builder: opts.builder };
}

/** Look up an existing user id by email, or null if not registered. */
export function findUserIdByEmail(email: string): string | null {
  const out = psql(`SELECT id FROM users WHERE email='${email}' LIMIT 1`);
  return out || null;
}

/** Best-effort teardown (subscriptions first for the FK). */
export function cleanupUser(userId: string): void {
  try {
    psql(`DELETE FROM subscriptions WHERE user_id='${userId}'`);
    psql(`DELETE FROM users WHERE id='${userId}'`);
  } catch {
    /* ignore — teardown is best-effort */
  }
}

/**
 * Seed a waitlist entry directly (for admin founding-invite specs, §7.4).
 * Table `waitlist` (schema.prisma model Waitlist): id/email/source/created_at,
 * plus nullable notified_at — left null so the row is "un-invited".
 */
export function seedWaitlistEntry(email: string, source = 'landing'): string {
  const id = randomUUID();
  psql(
    `INSERT INTO waitlist (id, email, source, created_at) VALUES ('${id}', '${email}', '${source}', now())`,
  );
  return id;
}

export function cleanupWaitlistEntry(id: string): void {
  try {
    psql(`DELETE FROM waitlist WHERE id='${id}'`);
  } catch {
    /* ignore */
  }
}

/** Remove a waitlist row by email — for rows created through the UI (join spec). */
export function cleanupWaitlistByEmail(email: string): void {
  try {
    psql(`DELETE FROM waitlist WHERE email='${email}'`);
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/* Community fixtures — TASK_2026_177 Batch 7                                  */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ THESE HELPERS CREATE AND REMOVE ONLY WHAT THEY CREATED, BY ID.
 *
 * `community_*` may be empty, or may be filling with the MG-1 seed (4 categories
 * / 9 topics / 11 posts) written by a concurrent batch. So nothing here counts
 * rows, asserts a table is empty, or truncates anything: every fixture carries a
 * unique slug and every teardown deletes by the ids it minted. Truncating to get
 * a clean slate would delete another batch's work.
 */

/**
 * A category for one spec to create topics in.
 *
 * `visibility: 'member'` and `cohort_keys: '{}'` deliberately — the e2e Builder
 * holds no `member_group_assignment` (the fixture does not seed one, and the
 * dev account's empty assignment table is load-bearing evidence elsewhere), so a
 * `'cohort'` category would be invisible to them and every assertion below would
 * fail as a 404 that looks like a bug.
 */
export function seedCommunityCategory(slug: string, name: string): string {
  const id = `cat_${randomUUID()}`;
  psql(
    `INSERT INTO community_categories (id, slug, name, description, sort_order, visibility, cohort_keys, created_at, updated_at) ` +
      `VALUES ('${id}', '${slug}', '${name}', 'e2e fixture', 900, 'member', '{}', now(), now())`,
  );
  return id;
}

/**
 * Appends a reply authored by SOMEONE ELSE, so a spec can observe an unread
 * count that is not the member's own writing.
 *
 * ⚠️ WRITTEN DIRECTLY RATHER THAN THROUGH THE API, AND ONLY BECAUSE THE POST
 * MUST COME FROM A DIFFERENT MEMBER. Driving a second authenticated browser
 * context through the composer would test the composer twice and the unread
 * path once. `post_count` is bumped in the same statement pair because it is the
 * one denormalised counter the design permits (AD-11) and the read model trusts
 * it.
 */
export function seedForeignReply(
  topicId: string,
  authorId: string,
  body: string,
): string {
  const id = `post_${randomUUID()}`;
  psql(
    `INSERT INTO community_posts (id, topic_id, parent_id, post_number, body_markdown, author_id, created_at, updated_at) ` +
      `SELECT '${id}', '${topicId}', NULL, COALESCE(MAX(post_number), 0) + 1, '${body}', '${authorId}', now(), now() ` +
      `FROM community_posts WHERE topic_id='${topicId}'`,
  );
  psql(
    `UPDATE community_topics SET post_count = post_count + 1, last_posted_at = now(), updated_at = now() WHERE id='${topicId}'`,
  );
  return id;
}

/**
 * A whole topic authored by SOMEONE ELSE, body post included (AD-9).
 *
 * ⚠️ IT EXISTS FOR THE NEGATIVE HALF OF THE `?mine=true` SPEC. A "my threads"
 * filter that quietly returned everything looks perfectly healthy in a
 * screenshot; the only assertion that tests the filter is that a thread by a
 * DIFFERENT author, in the SAME category, is absent. Both rows have to be on
 * the unfiltered feed for that absence to mean anything.
 *
 * ⚠️ WRITTEN DIRECTLY RATHER THAN THROUGH THE API, and only because the topic
 * must come from a different member — the same reason `seedForeignReply` does.
 * Driving a second authenticated context through the composer would test the
 * composer twice and the filter once.
 *
 * `post_count` is `0` because it counts REPLIES and post #1 IS the body
 * (AD-9/AD-11) — the same unit confusion that produced the `unreadCount`
 * off-by-one, so it is worth being explicit about here.
 */
export function seedForeignTopic(
  categoryId: string,
  authorId: string,
  title: string,
  bodyMarkdown: string,
): string {
  const id = `top_${randomUUID()}`;
  const slug = `${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)}-${randomUUID().slice(0, 8)}`;
  psql(
    `INSERT INTO community_topics (id, category_id, slug, title, author_id, pinned, locked, post_count, last_posted_at, created_at, updated_at) ` +
      `VALUES ('${id}', '${categoryId}', '${slug}', '${title.replace(/'/g, "''")}', '${authorId}', false, false, 0, now(), now(), now())`,
  );
  psql(
    `INSERT INTO community_posts (id, topic_id, parent_id, post_number, body_markdown, author_id, created_at, updated_at) ` +
      `VALUES ('post_${randomUUID()}', '${id}', NULL, 1, '${bodyMarkdown.replace(/'/g, "''")}', '${authorId}', now(), now())`,
  );
  return id;
}

/** The ids of every topic in a category — for a teardown that deletes by id. */
export function topicIdsInCategory(categoryId: string): string[] {
  const out = psql(
    `SELECT id FROM community_topics WHERE category_id='${categoryId}'`,
  );
  return out ? out.split('\n').filter(Boolean) : [];
}

/**
 * Removes a category and everything created inside it, children first.
 *
 * Best-effort and id-scoped: it never touches a row it did not create, and a
 * `Restrict` on the category's own delete is the reason posts and topics go
 * first.
 */
export function cleanupCommunityCategory(categoryId: string): void {
  try {
    const topics = topicIdsInCategory(categoryId);
    for (const topicId of topics) {
      psql(
        `DELETE FROM community_post_reactions WHERE post_id IN (SELECT id FROM community_posts WHERE topic_id='${topicId}')`,
      );
      psql(
        `DELETE FROM community_topic_read_state WHERE topic_id='${topicId}'`,
      );
      // `accepted_post_id` FKs a post, so it is cleared before the posts go.
      psql(
        `UPDATE community_topics SET accepted_post_id = NULL WHERE id='${topicId}'`,
      );
      psql(`DELETE FROM community_posts WHERE topic_id='${topicId}'`);
      psql(`DELETE FROM community_topics WHERE id='${topicId}'`);
    }
    psql(`DELETE FROM community_categories WHERE id='${categoryId}'`);
  } catch {
    /* teardown is best-effort — see the module docblock */
  }
}

/* -------------------------------------------------------------------------- */
/* Course fixtures — TASK_2026_177 Batch 10                                    */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ THESE HELPERS CREATE AND REMOVE ONLY WHAT THEY CREATED, BY ID — and that
 * discipline matters more here than it did for the forum. `courses`,
 * `course_modules` and `course_lessons` are being filled CONCURRENTLY by
 * TASK_2026_177 Batch 11's curriculum seed. So nothing below counts rows,
 * asserts a table is empty, or truncates anything: every fixture carries a
 * timestamped slug, and {@link cleanupCourse} deletes strictly the ids it was
 * given, children first, in FK order
 * (`lesson_comments` -> `lesson_progress` -> `course_lessons` ->
 * `course_modules` -> `courses`).
 *
 * ⚠️ WRITTEN DIRECTLY RATHER THAN THROUGH THE ADMIN API, and the reason is
 * consistency with every other fixture in this file rather than convenience.
 * `seedCommunityCategory` and `seedForeignTopic` write SQL for the same reason:
 * a fixture that drives the product's own write path tests that path twice and
 * the feature under test once, and it would additionally require an
 * `ADMIN_EMAILS` account inside every spec that wants a course. The admin write
 * path IS exercised — live, with real HTTP — in Batch 10's report.
 */

export interface SeededCourse {
  courseId: string;
  courseSlug: string;
  /** The open module, available immediately. */
  openModuleId: string;
  /** A module with a FUTURE `release_at` — the R2.4.1 lock. */
  lockedModuleId: string;
  /** A lesson in the open module WITH a real 11-character YouTube id. */
  videoLessonId: string;
  videoLessonSlug: string;
  /** A lesson in the open module with NO video — the §7.3 default shape. */
  textLessonId: string;
  textLessonSlug: string;
  /** A lesson inside the locked module. Requesting it is a 403. */
  lockedLessonId: string;
  lockedLessonSlug: string;
}

/** The first line of a multi-line psql error, for a one-line warning. */
function firstLine(message: string): string {
  const [first] = message.split(/\r?\n/);
  return first.trim();
}

/**
 * A published, member-visible course with one open module and one locked one.
 *
 * ⚠️ `visibility: 'member'` AND `cohort_keys: '{}'` DELIBERATELY. The e2e
 * Builder holds no `member_group_assignment` — matching the dev account, whose
 * empty assignment table is load-bearing evidence elsewhere — so a `'cohort'`
 * course would be invisible and every assertion would fail as a 404 that looked
 * like a rendering bug.
 *
 * ⚠️ 🔴 THE VIDEO LESSON CARRIES A REAL 11-CHARACTER ID, AND THAT IS WHAT MAKES
 * THE NFR-S3 NETWORK ASSERTION NON-VACUOUS. Every lesson in Batch 11's seed has
 * `youtube_video_id: null` (§7.3), so a "no YouTube request fired" assertion run
 * against seeded content would be true because there was nothing to request.
 *
 * ⚠️ `video_thumbnail_url` IS SET HERE EVEN THOUGH THE LIVE AUTHORING PATH
 * CANNOT PRODUCE ONE (`YOUTUBE_API_KEY` is unset — ASSUMPTION-6). It is set so
 * the poster renders the `<img>` branch, which is the branch that contacts
 * `i.ytimg.com` and therefore the branch the network assertion's allowlist has
 * to be honest about. Testing the cheaper branch would prove less.
 */
export function seedCourse(slugPrefix: string): SeededCourse {
  const stamp = Date.now();
  const courseId = `crs_${randomUUID()}`;
  const courseSlug = `${slugPrefix}-${stamp}`;
  const openModuleId = `mod_${randomUUID()}`;
  const lockedModuleId = `mod_${randomUUID()}`;
  const videoLessonId = `les_${randomUUID()}`;
  const textLessonId = `les_${randomUUID()}`;
  const lockedLessonId = `les_${randomUUID()}`;

  psql(
    `INSERT INTO courses (id, slug, title, description, visibility, cohort_keys, published, sequential, sort_order, created_at, updated_at) ` +
      `VALUES ('${courseId}', '${courseSlug}', 'E2E Course ${stamp}', 'A throwaway course for the Batch 10 e2e run.', 'member', '{}', true, false, 900, now(), now())`,
  );

  psql(
    `INSERT INTO course_modules (id, course_id, slug, title, description, sort_order, created_at, updated_at) ` +
      `VALUES ('${openModuleId}', '${courseId}', 'open-module', 'Open module', 'Available now.', 0, now(), now())`,
  );
  // ⚠️ A FUTURE `release_at` — R2.4.1's date rule, evaluated SERVER-SIDE.
  psql(
    `INSERT INTO course_modules (id, course_id, slug, title, description, sort_order, release_at, created_at, updated_at) ` +
      `VALUES ('${lockedModuleId}', '${courseId}', 'locked-module', 'Locked module', 'Opens later.', 1, TIMESTAMP '2027-12-25 09:00:00', now(), now())`,
  );

  psql(
    `INSERT INTO course_lessons (id, module_id, slug, title, body_markdown, sort_order, youtube_video_id, video_title, video_duration_seconds, video_thumbnail_url, video_metadata_source, created_at, updated_at) ` +
      `VALUES ('${videoLessonId}', '${openModuleId}', 'video-lesson', 'Video lesson', ` +
      // ⚠️ `E'…'` PLUS A DOUBLED BACKSLASH. The template literal must hand SQL
      // a LITERAL `\n`, not a real newline: `docker exec … psql -tAc "…"` is one
      // line, and an actual newline terminates the quoted string mid-statement
      // (`ERROR: unterminated quoted string`). `E'…'` is what makes Postgres
      // read the two characters back as a newline.
      `E'# Video lesson\\n\\nThis body is **real markdown** and must render as such.', 0, ` +
      `'dQw4w9WgXcQ', 'E2E probe video', 212, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', 'manual', now(), now())`,
  );
  psql(
    `INSERT INTO course_lessons (id, module_id, slug, title, body_markdown, sort_order, created_at, updated_at) ` +
      `VALUES ('${textLessonId}', '${openModuleId}', 'text-lesson', 'Text lesson', ` +
      `E'# Text lesson\\n\\nNo video on this one — the **default** shape.', 1, now(), now())`,
  );
  psql(
    `INSERT INTO course_lessons (id, module_id, slug, title, body_markdown, sort_order, created_at, updated_at) ` +
      `VALUES ('${lockedLessonId}', '${lockedModuleId}', 'locked-lesson', 'Locked lesson', ` +
      `'# SECRET_E2E_LOCKED_BODY_MARKER', 0, now(), now())`,
  );

  return {
    courseId,
    courseSlug,
    openModuleId,
    lockedModuleId,
    videoLessonId,
    videoLessonSlug: 'video-lesson',
    textLessonId,
    textLessonSlug: 'text-lesson',
    lockedLessonId,
    lockedLessonSlug: 'locked-lesson',
  };
}

/* -------------------------------------------------------------------------- */
/* Live-session fixtures — TASK_2026_177 Batch 13                              */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ 🔴 `calendar_event_id` IS ALWAYS LEFT NULL BY THESE HELPERS, AND THAT IS A
 * SAFETY RULE RATHER THAN A SIMPLIFICATION.
 *
 * `live_sessions.calendar_event_id` carries a `@unique` (AD-2), and a
 * `LiveSession` that CLAIMS an event id changes what the member feed returns for
 * the founder's REAL Google Calendar: Batch 12 proved live that claiming one
 * recurring master de-duplicated all 43 of its expanded instances out of the
 * feed. A fixture that claimed an id would therefore mutate what every other
 * spec — and the developer sitting in front of the app — sees on
 * `/members/live`, for as long as the row existed. Nothing here claims one.
 *
 * ⚠️ AND NO FIXTURE HERE CREATES A GOOGLE CALENDAR EVENT. Batch 12's gate
 * created and deleted real events on a real calendar; Batch 13 is read-only
 * against Google. A `LiveSession` row is ours alone.
 *
 * ⚠️ `visibility: 'member'` AND `cohort_keys: '{}'` DELIBERATELY, for the same
 * reason `seedCourse` does it: the e2e Builder holds no
 * `member_group_assignment`, so a `'cohort'` session would be invisible and
 * every assertion would fail as an empty list that looked like a rendering bug.
 */

export interface SeededLiveSession {
  id: string;
  title: string;
}

/**
 * A future session — `state: 'upcoming'` in the feed.
 *
 * `youtube_video_id` and the whole metadata block are left NULL, which is the
 * DEFAULT shape in this workspace: `YOUTUBE_API_KEY` is empty (ASSUMPTION-6) so
 * nothing has ever had metadata resolved, and all fifty real upcoming items
 * measured on 2026-08-09 carry `durationSeconds: null`.
 */
export function seedUpcomingLiveSession(title: string): SeededLiveSession {
  const id = `lvs_${randomUUID()}`;
  psql(
    `INSERT INTO live_sessions (id, title, description, starts_at, ends_at, visibility, cohort_keys, created_by, created_at, updated_at) ` +
      `VALUES ('${id}', '${title.replace(/'/g, "''")}', 'A throwaway session for the Batch 13 e2e run.', ` +
      `now() + interval '3 days', now() + interval '3 days 1 hour', 'member', '{}', 'batch-13-e2e', now(), now())`,
  );
  return { id, title };
}

/**
 * A session that has started and not ended — `state: 'live'`.
 *
 * ⚠️ A REAL `ends_at` IN THE FUTURE, NOT A NULL ONE. A null end would rely on
 * `LIVE_FALLBACK_MINUTES` (120), which is a second rule to get wrong in a
 * fixture; an explicit window makes the state unambiguous.
 */
export function seedLiveNowSession(title: string): SeededLiveSession {
  const id = `lvs_${randomUUID()}`;
  psql(
    `INSERT INTO live_sessions (id, title, starts_at, ends_at, visibility, cohort_keys, created_by, created_at, updated_at) ` +
      `VALUES ('${id}', '${title.replace(/'/g, "''")}', now() - interval '10 minutes', now() + interval '50 minutes', 'member', '{}', 'batch-13-e2e', now(), now())`,
  );
  return { id, title };
}

/**
 * A past session WITH a recording — `state: 'replay'`.
 *
 * 🔴 `replay_youtube_video_id` IS WHAT MAKES IT A REPLAY AT ALL.
 * `deriveLiveState` returns `null` — i.e. the item is DROPPED FROM THE FEED —
 * for a past session with no recording, so a fixture without this column would
 * seed a row that never appears and the assertion would fail as an empty
 * archive that looked like a paging bug.
 *
 * ⚠️ THE ID IS A REAL 11-CHARACTER ONE and the duration is set, because the
 * replay card renders a runtime and the player takes an id. This is the ONE
 * place in this batch where the populated-metadata branch is exercised;
 * everything the live server actually serves has both as null.
 */
export function seedReplaySession(title: string): SeededLiveSession {
  const id = `lvs_${randomUUID()}`;
  psql(
    `INSERT INTO live_sessions (id, title, starts_at, ends_at, visibility, cohort_keys, replay_youtube_video_id, video_title, video_duration_seconds, video_metadata_source, created_by, created_at, updated_at) ` +
      `VALUES ('${id}', '${title.replace(/'/g, "''")}', now() - interval '8 days', now() - interval '8 days' + interval '1 hour', 'member', '{}', ` +
      `'dQw4w9WgXcQ', 'B13 e2e replay', 1800, 'manual', 'batch-13-e2e', now(), now())`,
  );
  return { id, title };
}

/**
 * Removes seeded live sessions by id, one statement per row.
 *
 * ⚠️ PER-ROW ISOLATION AND A LOUD WARNING, the shape `cleanupCourse` was
 * repaired into. A best-effort teardown that abandons the rest because one
 * statement failed is how a table fills with orphans, and a swallowed exception
 * is what makes it invisible — B10's first full e2e run left nine orphaned
 * courses behind exactly that way.
 *
 * ⚠️ A HARD DELETE, NOT A SOFT ONE. `deleted_at` would leave the row in a table
 * whose census other batches read, and the point of a fixture is to leave
 * nothing.
 */
export function cleanupLiveSessions(ids: readonly string[]): void {
  for (const id of ids) {
    try {
      psql(`DELETE FROM live_sessions WHERE id='${id}'`);
    } catch (error: unknown) {
      console.warn(
        `[cleanupLiveSessions] ${id} failed: ${
          error instanceof Error ? firstLine(error.message) : String(error)
        }`,
      );
    }
  }
}

/** This member's own session requests, for a teardown that deletes by owner. */
export function cleanupSessionRequests(userId: string): void {
  try {
    psql(`DELETE FROM session_requests WHERE user_id='${userId}'`);
  } catch (error: unknown) {
    console.warn(
      `[cleanupSessionRequests] ${userId} failed: ${
        error instanceof Error ? firstLine(error.message) : String(error)
      }`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Pack fixtures — TASK_2026_177 Batch 15                                      */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ 🔴 `member_visible` IS THE ONLY THING THAT DECIDES WHAT A MEMBER SEES, AND
 * `cohort_key` IS NOT IT (A-1).
 *
 * That is the single most important property these fixtures exist to prove, and
 * it is counter-intuitive enough that a reader will assume the opposite: a pack
 * carrying `cohort_key: 'founding'` is visible to EVERY entitled member,
 * including one holding no `member_group_assignment` at all. The cohort is a
 * DISPLAY LABEL that grants and revokes nothing. `seedPack` therefore takes the
 * two as independent options rather than deriving one from the other, so a spec
 * can seed the combination that would be a security bug if A-1 were false.
 *
 * ⚠️ `notes` IS ADMIN-INTERNAL (R5.2) AND MUST NEVER REACH A MEMBER. It is
 * seeded with a marker string precisely so a spec can assert its ABSENCE from
 * the page source non-vacuously — an assertion that the page does not contain
 * `undefined` proves nothing.
 */
export interface SeededPack {
  id: string;
  slug: string;
  title: string;
}

export function seedPack(
  slugPrefix: string,
  opts: {
    memberVisible: boolean;
    cohortKey?: string | null;
    accessNote?: string | null;
    notes?: string | null;
    title?: string;
  },
): SeededPack {
  const stamp = Date.now();
  const id = `pck_${randomUUID()}`;
  const slug = `${slugPrefix}-${stamp}-${randomUUID().slice(0, 6)}`;
  const title = opts.title ?? `E2E Pack ${stamp}`;

  const sqlText = (value: string | null | undefined): string =>
    value === null || value === undefined
      ? 'NULL'
      : `'${value.replace(/'/g, "''")}'`;

  psql(
    `INSERT INTO packs (id, slug, title, description, repo_url, notes, member_visible, access_note, tags, cohort_key, created_by, created_at, updated_at) ` +
      `VALUES ('${id}', '${slug}', ${sqlText(title)}, 'A throwaway pack for the Batch 15 e2e run.', ` +
      `'https://github.com/hive-academy/${slug}', ${sqlText(opts.notes)}, ${opts.memberVisible}, ` +
      `${sqlText(opts.accessNote)}, ARRAY['agents','nx']::text[], ${sqlText(opts.cohortKey)}, 'batch-15-e2e', now(), now())`,
  );

  return { id, slug, title };
}

/**
 * Removes seeded packs by id, one statement per row.
 *
 * ⚠️ PER-STATEMENT ISOLATION AND A LOUD WARNING — the shape `cleanupCourse` was
 * repaired into after B10's first full run abandoned nine parent rows because
 * one child delete failed inside a single shared `try`.
 */
export function cleanupPacks(ids: readonly string[]): void {
  for (const id of ids) {
    try {
      psql(`DELETE FROM packs WHERE id='${id}'`);
    } catch (error: unknown) {
      console.warn(
        `[cleanupPacks] ${id} failed: ${
          error instanceof Error ? firstLine(error.message) : String(error)
        }`,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Notification fixtures — TASK_2026_177 Batch 15                              */
/* -------------------------------------------------------------------------- */

/**
 * One row in a member's inbox.
 *
 * ⚠️ 🔴 `route` IS STORED, NOT DERIVED, AND THAT IS WHY IT IS A PARAMETER.
 * The client refuses any stored route outside `/members/` (RISK-AO) because the
 * value is FROZEN in the row and would outlive any later fix to the producer.
 * A fixture that could only write well-formed routes could not test that guard
 * at all, so this helper will happily write `//evil.example` — which is exactly
 * the value a spec needs in order to prove the refusal is real.
 *
 * ⚠️ `bodyPreview` DEFAULTS TO LITERAL MARKDOWN plus an HTML tag. `bodyPreview`
 * is an excerpt of member-authored markdown the contract states is NOT
 * sanitized, and it is rendered as an escaped TEXT NODE (NFR-S2). A fixture of
 * plain prose would make an `[innerHTML]` regression invisible — the characters
 * have to be there for their survival to mean anything.
 *
 * ⚠️ `actor_id` IS NULLABLE AND IS LEFT NULL BY DEFAULT. It is a `@db.Uuid` FK
 * to `users`; a fabricated value would violate it, and the member-facing
 * contract carries `actorName`, never an id (NFR-S4).
 */
export interface SeededNotification {
  id: string;
  title: string;
}

export function seedNotification(
  userId: string,
  opts: {
    kind?: string;
    targetType?: string;
    targetId?: string;
    title?: string;
    bodyPreview?: string | null;
    route?: string;
    read?: boolean;
    actorId?: string | null;
    /** Minutes into the past — newest-first ordering is asserted on this. */
    ageMinutes?: number;
  } = {},
): SeededNotification {
  const id = `ntf_${randomUUID()}`;
  const title = opts.title ?? 'New reply to your topic';
  const bodyPreview =
    opts.bodyPreview === undefined
      ? '**bold** <img src=x onerror=alert(1)> preview'
      : opts.bodyPreview;

  const sqlText = (value: string | null | undefined): string =>
    value === null || value === undefined
      ? 'NULL'
      : `'${value.replace(/'/g, "''")}'`;

  psql(
    `INSERT INTO member_notifications (id, user_id, kind, actor_id, target_type, target_id, title, body_preview, route, read_at, created_at) ` +
      `VALUES ('${id}', '${userId}'::uuid, ${sqlText(opts.kind ?? 'topic.reply')}, ` +
      `${opts.actorId ? `'${opts.actorId}'::uuid` : 'NULL'}, ` +
      `${sqlText(opts.targetType ?? 'Topic')}, ${sqlText(opts.targetId ?? 'top_e2e')}, ` +
      `${sqlText(title)}, ${sqlText(bodyPreview)}, ` +
      `${sqlText(opts.route ?? '/members/community/topics/e2e-topic')}, ` +
      `${opts.read ? 'now()' : 'NULL'}, now() - interval '${opts.ageMinutes ?? 0} minutes')`,
  );

  return { id, title };
}

/**
 * Every notification owned by one member.
 *
 * ⚠️ SCOPED BY OWNER RATHER THAN BY ID, DELIBERATELY, AND ONLY BECAUSE THE
 * OWNER IS ITSELF A THROWAWAY FIXTURE. The specs drive the real UI, which marks
 * rows read and could in principle create more; deleting by the ids this file
 * minted would strand anything the product wrote for the same member. The user
 * row is deleted moments later by `cleanupUser`, so the blast radius is one
 * identity that did not exist before the spec started.
 */
export function cleanupNotifications(userId: string): void {
  try {
    psql(`DELETE FROM member_notifications WHERE user_id='${userId}'::uuid`);
  } catch (error: unknown) {
    console.warn(
      `[cleanupNotifications] ${userId} failed: ${
        error instanceof Error ? firstLine(error.message) : String(error)
      }`,
    );
  }
}

/** How many of a member's notifications are still unread — for anti-vacuity. */
export function unreadNotificationCount(userId: string): number {
  const out = psql(
    `SELECT count(*) FROM member_notifications WHERE user_id='${userId}'::uuid AND read_at IS NULL`,
  );
  return Number.parseInt(out, 10);
}

/**
 * Removes a seeded course and everything under it, children first.
 *
 * Best-effort and id-scoped: it never touches a row it did not create, and the
 * order respects the FKs. `lesson_comments.parent_id` is `onDelete: Restrict`,
 * so replies go before their parents — done here by deleting the whole lesson's
 * comment set in one statement rather than row by row.
 */
export function cleanupCourse(courseId: string): void {
  const lessons = `SELECT l.id FROM course_lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id='${courseId}'`;

  // ⚠️ 🔴 EACH STATEMENT IS ISOLATED, AND THAT IS A REPAIR RATHER THAN A STYLE
  // CHOICE. The first version wrapped the whole sequence in ONE `try`, so a
  // single failing child delete abandoned the PARENT row — and the first full
  // e2e run left nine orphaned courses and eighteen orphaned modules behind,
  // in tables Batch 11 is seeding concurrently. A best-effort teardown that
  // gives up on the parent because a child failed is exactly how a table fills
  // with orphans, and the swallowed exception is what made it invisible.
  //
  // Order still respects the FKs (`lesson_comments.parent_id` is
  // `onDelete: Restrict`, so replies go before their parents); isolating the
  // statements only means a failure at one level cannot strand every level
  // above it.
  for (const statement of [
    `DELETE FROM lesson_comments WHERE parent_id IN (SELECT id FROM lesson_comments WHERE lesson_id IN (${lessons}))`,
    `DELETE FROM lesson_comments WHERE lesson_id IN (${lessons})`,
    `DELETE FROM lesson_progress WHERE lesson_id IN (${lessons})`,
    `DELETE FROM course_lessons WHERE module_id IN (SELECT id FROM course_modules WHERE course_id='${courseId}')`,
    `DELETE FROM course_modules WHERE course_id='${courseId}'`,
    `DELETE FROM courses WHERE id='${courseId}'`,
  ]) {
    try {
      psql(statement);
    } catch (error: unknown) {
      // ⚠️ REPORTED, NEVER SILENT. A teardown that fails quietly leaves rows in
      // a table another batch is writing to, and the next reader has no way to
      // tell a leak from a seed.
      console.warn(
        `[cleanupCourse] ${statement.slice(0, 60)}… failed: ${
          error instanceof Error ? firstLine(error.message) : String(error)
        }`,
      );
    }
  }
}
