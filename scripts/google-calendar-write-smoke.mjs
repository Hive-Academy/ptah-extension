/**
 * google-calendar-write-smoke.mjs — BLOCKING verification that the Google
 * Calendar grant actually permits event writes (TASK_2026_169, plan §4.2
 * Mechanism 2 / §8.4).
 *
 * WHY THIS EXISTS. `patchEventAttendees` has worked in production for a while,
 * which proves the grant is not a `.readonly` one — but "PATCH works" does NOT
 * by itself prove `events.insert` and `events.delete` work. The refresh-token
 * grant in `google-auth.provider.ts` requests no explicit scopes; it inherits
 * whatever was consented out-of-band. Reading the `scope` field off the token
 * response (Mechanism 1) is cheap but only tells us what Google SAYS was
 * granted. This script is the authoritative check: it creates a real event and
 * deletes it again.
 *
 * WHAT IT ASSERTS
 *   1. Anonymous  POST /api/v1/admin/sessions            → 401
 *   2. Non-admin  POST /api/v1/admin/sessions            → 403   (AdminGuard live)
 *   3. Admin      GET  /api/v1/admin/sessions            → 200 + calendarWritable
 *   4. Admin      POST /api/v1/admin/sessions            → 201 + id/title
 *   5. Admin      DELETE /api/v1/admin/sessions/:id      → 200 { deleted: true }
 *   6. Admin      DELETE same id again                   → 200 { deleted: false }  (idempotent)
 *   7. Admin      DELETE the protected recurring master  → 409 protected_recurring_event
 *
 * WHY THE TEST EVENT IS 10 YEARS OUT. The members' endpoint lists a fixed
 * 60-day window (`LOOKAHEAD_DAYS = 60`), so a far-future event can never appear
 * in the real members' area even if cleanup fails.
 *
 * Deterministic: mints a `ptah_auth` JWT with JWT_SECRET (same mechanism as
 * community-gate-smoke.mjs / discourse-e2e.mjs). `validateToken` is pure JWT
 * verification with no DB lookup, so no user seeding is required.
 *
 * Run from Windows (reaches :3000). Requires `npm run docker:up` and JWT_SECRET
 * + ADMIN_EMAILS in .env. Exits non-zero on any failed assertion.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIC = process.env.LIC || 'http://localhost:3000';

function loadEnv() {
  const out = {};
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const env = loadEnv();
const JWT_SECRET = env.JWT_SECRET;
const ADMIN_EMAIL = (env.ADMIN_EMAILS || '').split(',')[0]?.trim();
const PROTECTED_EVENT_ID = (env.BUILDERS_SESSION_EVENT_ID || '').trim();

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function mintJwt(sub, email) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64url(JSON.stringify({ sub, email, tenantId: `user_${sub}`, roles: ['user'], permissions: ['read:docs'], tier: 'community', iat: now, exp: now + 600 }));
  const s = createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

let failures = 0;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
function check(label, ok, detail) {
  console.log(`  ${ok ? green('✓') : red('✗')} ${label}${detail ? dim(`  (${detail})`) : ''}`);
  if (!ok) failures++;
}

async function call(method, path, { jwt, body } = {}) {
  const res = await fetch(`${LIC}${path}`, {
    method,
    headers: {
      ...(jwt ? { cookie: `ptah_auth=${jwt}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty/non-JSON body */ }
  return { status: res.status, body: json };
}

/** Print the re-consent runbook when the grant lacks a write scope (plan §4.3). */
function printReconsentRunbook() {
  console.log(yellow('\n──────────────────────────────────────────────────────────────'));
  console.log(yellow(' GOOGLE CALENDAR WRITE SCOPE IS INSUFFICIENT — OPERATOR ACTION'));
  console.log(yellow('──────────────────────────────────────────────────────────────'));
  console.log(`
  The server refused the write with 503 { reason: 'calendar_write_unavailable' },
  which means Google answered 401/403 upstream. The backend degrades correctly
  (read path unaffected, admin UI renders read-only via calendarWritable:false),
  but session create/edit/delete will NOT work until the grant is widened.

  Re-consent runbook:
    1. Re-run the Google OAuth consent for the founder account with:
         scope=https://www.googleapis.com/auth/calendar
         access_type=offline
         prompt=consent
    2. Replace GOOGLE_OAUTH_REFRESH_TOKEN in the environment with the new token.
    3. Restart the license server.
    4. Re-run this script.

  Do NOT build an in-app OAuth consent flow — that is a separate feature and is
  explicitly out of scope for TASK_2026_169.
`);
}

async function main() {
  console.log(`\nGoogle Calendar write smoke  (endpoint=${LIC}/api/v1/admin/sessions)\n`);

  if (!JWT_SECRET) { console.error(red('JWT_SECRET missing from .env')); process.exit(2); }
  if (!ADMIN_EMAIL) { console.error(red('ADMIN_EMAILS missing from .env')); process.exit(2); }

  const adminJwt = mintJwt(randomUUID(), ADMIN_EMAIL);
  const outsiderJwt = mintJwt(randomUUID(), `not-an-admin-${Date.now()}@example.com`);
  console.log(dim(`admin=${ADMIN_EMAIL}  protectedEventId=${PROTECTED_EVENT_ID || '(unset)'}\n`));

  const startsAt = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  let createdId = null;

  try {
    // 1 + 2. The admin path is genuinely gated.
    console.log('1. Authorization gate');
    const anon = await call('POST', '/api/v1/admin/sessions', { body: { title: 'x', startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() } });
    check('anonymous is rejected (401)', anon.status === 401, `status=${anon.status}`);

    const outsider = await call('POST', '/api/v1/admin/sessions', { jwt: outsiderJwt, body: { title: 'x', startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() } });
    check('authenticated non-admin is rejected (403)', outsider.status === 403, `status=${outsider.status}`);

    // 3. Read path + scope hint.
    console.log('\n2. Read path + scope verdict');
    const list = await call('GET', '/api/v1/admin/sessions?daysAhead=60', { jwt: adminJwt });
    check('admin lists sessions (200)', list.status === 200, `status=${list.status}`);
    check('response carries a sessions array', Array.isArray(list.body?.sessions), `sessions=${JSON.stringify(list.body?.sessions)?.slice(0, 60)}`);
    check('response carries calendarWritable', typeof list.body?.calendarWritable === 'boolean', `calendarWritable=${list.body?.calendarWritable}`);
    if (list.body?.calendarWritable === false) {
      console.log(yellow('    ! calendarWritable=false — the granted scope does not advertise write access'));
    }

    // 4. Create.
    console.log('\n3. Create a far-future throwaway event');
    const created = await call('POST', '/api/v1/admin/sessions', {
      jwt: adminJwt,
      body: {
        title: '[PTAH SMOKE] delete me',
        description: 'Automated write-scope verification. Safe to delete.',
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        createMeetLink: false,
      },
    });
    if (created.status === 503 && created.body?.reason === 'calendar_write_unavailable') {
      check('create succeeds (201)', false, 'status=503 calendar_write_unavailable');
      printReconsentRunbook();
      process.exit(1);
    }
    check('create succeeds (201)', created.status === 201, `status=${created.status} body=${JSON.stringify(created.body)?.slice(0, 160)}`);
    check('created event has a non-empty id', typeof created.body?.id === 'string' && created.body.id.length > 0, `id=${created.body?.id}`);
    check('created event echoes the title', created.body?.title === '[PTAH SMOKE] delete me', `title=${created.body?.title}`);
    createdId = typeof created.body?.id === 'string' ? created.body.id : null;

    // 5 + 6. Delete, then delete again (idempotent).
    if (createdId) {
      console.log('\n4. Delete it, then prove the delete is idempotent');
      const del = await call('DELETE', `/api/v1/admin/sessions/${encodeURIComponent(createdId)}`, { jwt: adminJwt });
      check('delete succeeds (200 { deleted: true })', del.status === 200 && del.body?.deleted === true, `status=${del.status} body=${JSON.stringify(del.body)}`);
      if (del.status === 200 && del.body?.deleted === true) createdId = null;

      const again = await call('DELETE', `/api/v1/admin/sessions/${encodeURIComponent(createdId ?? created.body?.id)}`, { jwt: adminJwt });
      check('re-delete degrades to { deleted: false }, not a 500', again.status === 200 && again.body?.deleted === false, `status=${again.status} body=${JSON.stringify(again.body)}`);
    } else {
      check('delete step reachable (create produced an id)', false, 'skipped — no id from create');
    }

    // 7. The recurring-master footgun guard — BOTH halves.
    console.log('\n5. Protected recurring series is refused');
    if (PROTECTED_EVENT_ID) {
      // 7a. The master, by its own id.
      const guarded = await call('DELETE', `/api/v1/admin/sessions/${encodeURIComponent(PROTECTED_EVENT_ID)}`, { jwt: adminJwt });
      check('deleting BUILDERS_SESSION_EVENT_ID is refused (409)', guarded.status === 409, `status=${guarded.status}`);
      check('refusal carries reason=protected_recurring_event', guarded.body?.reason === 'protected_recurring_event' || guarded.body?.message?.reason === 'protected_recurring_event', `body=${JSON.stringify(guarded.body)?.slice(0, 160)}`);

      // 7b. THE LOAD-BEARING HALF. `listEvents` uses singleEvents=true, so the
      // admin UI lists expanded INSTANCES whose ids differ from the master's
      // (e.g. `<masterId>_20260805T140000Z`). A guard comparing only `eventId`
      // would happily delete the series through any one of those rows. The
      // service resolves the event first and checks `recurringEventId`, so an
      // instance of the protected series must be refused too.
      //
      // The FARTHEST-future instance is chosen deliberately: if this assertion
      // ever fails, the guard is broken and a real occurrence was deleted —
      // picking the last one minimises the damage while still proving it.
      const instances = (list.body?.sessions ?? []).filter(
        (s) => s && s.recurring === true && s.id !== PROTECTED_EVENT_ID && s.id.startsWith(`${PROTECTED_EVENT_ID}_`),
      );
      const target = instances[instances.length - 1];
      if (target) {
        const guardedInstance = await call('DELETE', `/api/v1/admin/sessions/${encodeURIComponent(target.id)}`, { jwt: adminJwt });
        check('deleting an EXPANDED INSTANCE of the series is refused (409)', guardedInstance.status === 409, `instanceId=${target.id} status=${guardedInstance.status}`);
        check('instance refusal carries reason=protected_recurring_event', guardedInstance.body?.reason === 'protected_recurring_event', `body=${JSON.stringify(guardedInstance.body)?.slice(0, 120)}`);
      } else {
        console.log(dim('  - no expanded instance of the protected series in the window — instance guard not exercised'));
      }
    } else {
      console.log(dim('  - BUILDERS_SESSION_EVENT_ID unset — guard assertion skipped'));
    }
  } finally {
    // Best-effort cleanup: a [PTAH SMOKE] row must never survive a partial run.
    if (createdId) {
      try {
        await call('DELETE', `/api/v1/admin/sessions/${encodeURIComponent(createdId)}`, { jwt: adminJwt });
        console.log(dim('\ncleaned up the smoke event'));
      } catch { /* ignore */ }
    }
  }

  if (failures === 0) {
    console.log(green('\nAll calendar write checks passed — events.insert and events.delete work.\n'));
    process.exit(0);
  }
  console.log(red(`\n${failures} check(s) FAILED — do NOT build session-write UI on this grant.\n`));
  process.exit(1);
}

main().catch((e) => { console.error(red(`\nHarness error: ${e?.stack || e}\n`)); process.exit(2); });
