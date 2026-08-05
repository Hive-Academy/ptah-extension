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
