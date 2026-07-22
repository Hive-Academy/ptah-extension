import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

/**
 * Postgres seed/cleanup helpers — the same `docker exec ... psql` path used by
 * `scripts/discourse-e2e.mjs` (`seedUser`/`cleanup`). Deterministic fixtures for
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
 * Mirrors `seedUser()` in scripts/discourse-e2e.mjs.
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
