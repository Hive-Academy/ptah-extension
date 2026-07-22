#!/usr/bin/env node
/**
 * discourse-e2e.mjs — full local DiscourseConnect round-trip e2e against the real
 * Discourse dev container + the local license server. Deterministic (curl/fetch +
 * seeded DB), no browser, no WorkOS login.
 *
 * Flow per user:
 *   1. GET  <DSC>/session/sso            → Discourse mints a nonce, 302 to the
 *                                          license SSO url, sets _forum_session.
 *   2. GET  <LIC>/api/v1/sso/discourse   → license server validates ptah_auth JWT
 *      (Cookie: ptah_auth)                 cookie, signs a response asserting
 *                                          add/remove_groups=builders, 302 back.
 *   3. GET  <DSC>/session/sso_login      → Discourse validates nonce+sig, provisions
 *      (with _forum_session)               the user, applies groups, sets _t cookie.
 *   4. GET  <DSC>/session/current.json    → assert logged in as the external user.
 *   5. admin API by-external lookup       → assert builders group membership matches
 *                                          entitlement.
 *
 * Asserts:
 *   - Builders subscriber → logged in + IN builders group.
 *   - Community user (no sub) → logged in + NOT in builders group.
 *
 * Run from Windows (reaches :3000 and :3001). Requires docker (psql seeding),
 * JWT_SECRET + DISCOURSE_SSO_SECRET + DISCOURSE_API_KEY from .env.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIC = process.env.LIC || 'http://localhost:3000';
const DSC = process.env.DSC || 'http://localhost:3001';

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
const SSO_SECRET = env.DISCOURSE_SSO_SECRET;
const API_KEY = env.DISCOURSE_API_KEY;
const API_USER = env.DISCOURSE_API_USERNAME || 'system';

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function mintJwt(sub, email) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64url(JSON.stringify({ sub, email, tenantId: `user_${sub}`, roles: ['user'], permissions: ['read:docs'], tier: 'community', iat: now, exp: now + 600 }));
  const s = createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

function psql(sql) {
  return execSync(`docker exec -i ptah_postgres psql -U ptah -d ptah_db -tAc "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}

function seedUser(email, { builder }) {
  const uid = randomUUID();
  psql(`INSERT INTO users (id, email, created_at, updated_at) VALUES ('${uid}', '${email}', now(), now())`);
  if (builder) {
    const sid = randomUUID();
    psql(`INSERT INTO subscriptions (id, user_id, paddle_subscription_id, paddle_customer_id, status, price_id, current_period_end, created_at, updated_at) VALUES ('${sid}', '${uid}', 'sub_${sid.slice(0, 8)}', 'ctm_${sid.slice(0, 8)}', 'active', 'pri_e2e', now() + interval '30 days', now(), now())`);
  }
  return uid;
}
function cleanup(uid) {
  try { psql(`DELETE FROM subscriptions WHERE user_id='${uid}'`); psql(`DELETE FROM users WHERE id='${uid}'`); } catch { /* ignore */ }
}

// --- minimal cookie jar (name -> value) for Discourse session ---
function makeJar() {
  const jar = {};
  return {
    absorb(res) {
      for (const [k, v] of res.headers) {
        if (k.toLowerCase() === 'set-cookie') {
          for (const c of v.split(/,(?=[^ ;]+=)/)) {
            const m = /^([^=]+)=([^;]*)/.exec(c.trim());
            if (m) jar[m[1]] = m[2];
          }
        }
      }
    },
    header() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); },
    get: (n) => jar[n],
  };
}

async function adminUserByExternal(externalId) {
  const res = await fetch(`${DSC}/u/by-external/${externalId}.json`, { headers: { 'Api-Key': API_KEY, 'Api-Username': API_USER } });
  if (!res.ok) return null;
  const j = await res.json();
  return j.user || j;
}
async function adminUserDetail(discourseId) {
  const res = await fetch(`${DSC}/admin/users/${discourseId}.json`, { headers: { 'Api-Key': API_KEY, 'Api-Username': API_USER } });
  if (!res.ok) return null;
  return res.json();
}
async function siteSetting(name) {
  const res = await fetch(`${DSC}/admin/site_settings.json`, { headers: { 'Api-Key': API_KEY, 'Api-Username': API_USER } });
  if (!res.ok) return undefined;
  const j = await res.json();
  const s = (j.site_settings || []).find((x) => x.setting === name);
  return s ? s.value : undefined;
}
async function groupIdByName(name) {
  const res = await fetch(`${DSC}/groups/${encodeURIComponent(name)}.json`, { headers: { 'Api-Key': API_KEY, 'Api-Username': API_USER } });
  if (!res.ok) return undefined;
  const j = await res.json();
  return j.group?.id;
}
async function userGroupNames(externalId) {
  const u = await adminUserByExternal(externalId);
  return (u?.groups || []).map((g) => g.name);
}
// Mirrors DiscourseAdminProvider.syncGroupMembership: PUT (add) / DELETE (remove)
// on /groups/{id}/members.json with {usernames}. This is the exact admin call the
// license-server container makes from the Paddle provisioning fan-out.
async function adminSyncGroup(username, groupId, isMember) {
  const res = await fetch(`${DSC}/groups/${groupId}/members.json`, {
    method: isMember ? 'PUT' : 'DELETE',
    headers: { 'Api-Key': API_KEY, 'Api-Username': API_USER, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ usernames: username }),
  });
  return res.status;
}

let failed = 0;
const green = (s) => `\x1b[32m${s}\x1b[0m`, red = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
function check(name, cond, detail = '') { if (cond) console.log('  ' + green('✓') + ' ' + name); else { failed++; console.log('  ' + red('✗ ' + name) + ' ' + detail); } }

async function roundTrip(label, jwt, externalId) {
  const jar = makeJar();
  // 1. Discourse initiates
  const r1 = await fetch(`${DSC}/session/sso?return_path=%2F`, { redirect: 'manual' });
  jar.absorb(r1);
  const connectUrl = r1.headers.get('location');
  check(`${label}: Discourse issues SSO request`, !!connectUrl && connectUrl.includes('/sso/discourse'), connectUrl || '');
  if (!connectUrl) return null;
  // 2. License server validates + signs
  const u = new URL(connectUrl);
  const r2 = await fetch(connectUrl, { redirect: 'manual', headers: { cookie: `ptah_auth=${jwt}` } });
  const backUrl = r2.headers.get('location');
  check(`${label}: license server signs response → sso_login`, !!backUrl && backUrl.includes('/session/sso_login'), `status=${r2.status} loc=${backUrl}`);
  if (!backUrl) return null;
  console.log(dim(`      backUrl host: ${new URL(backUrl).host}  len=${backUrl.length}`));
  // 3. Discourse consumes SSO login
  let r3;
  try {
    r3 = await fetch(backUrl, { redirect: 'manual', headers: { cookie: jar.header() } });
  } catch (e) {
    check(`${label}: Discourse accepts sso_login`, false, `fetch(${backUrl.slice(0, 60)}...) → ${e.message}`);
    return null;
  }
  jar.absorb(r3);
  check(`${label}: Discourse accepts sso_login (302, sets _t)`, (r3.status === 302 || r3.status === 200), `status=${r3.status}`);
  // 4. current user
  const r4 = await fetch(`${DSC}/session/current.json`, { headers: { cookie: jar.header() } });
  let cur = null;
  if (r4.ok) { const j = await r4.json(); cur = j.current_user; }
  check(`${label}: authenticated session established`, !!cur, cur ? `user=${cur.username}` : `current.json status=${r4.status}`);
  if (cur) console.log(dim(`      logged in as: ${cur.username} (${cur.id})`));
  return cur;
}

async function main() {
  console.log(`\nDiscourse SSO round-trip e2e  (license=${LIC}, discourse=${DSC})\n`);
  const ts = Date.now();
  const seeded = [];
  const seed = (email, opts) => { const id = seedUser(email, opts); seeded.push(id); return id; };
  const builderEmail = `e2e-builder-${ts}@ptah.local`;
  const communityEmail = `e2e-community-${ts}@ptah.local`;
  const syncEmail = `e2e-sync-${ts}@ptah.local`;
  const builderId = seed(builderEmail, { builder: true });
  const communityId = seed(communityEmail, { builder: false });
  console.log(dim(`seeded builder=${builderId} community=${communityId}\n`));

  try {
    console.log('1. Builders subscriber → should be added to builders group');
    const bCur = await roundTrip('  builder', mintJwt(builderId, builderEmail), builderId);
    if (bCur) {
      const u = await adminUserByExternal(builderId);
      const groups = (u?.groups || []).map((g) => g.name);
      const detail = u ? await adminUserDetail(u.id) : null;
      const ssoExt = detail?.single_sign_on_record?.external_id;
      check('  builder: external_id maps to the session user', String(u?.id) === String(bCur.id), `by-external id=${u?.id} session id=${bCur.id}`);
      check('  builder: SSO record external_id == license user id', String(ssoExt) === String(builderId), `sso_ext=${ssoExt}`);
      check('  builder: IS in "builders" group', groups.includes('builders'), `groups=${JSON.stringify(groups)}`);
    }

    console.log('\n2. Community user (no subscription) → must NOT be in builders group');
    const cCur = await roundTrip('  community', mintJwt(communityId, communityEmail), communityId);
    if (cCur) {
      const u = await adminUserByExternal(communityId);
      const groups = (u?.groups || []).map((g) => g.name);
      check('  community: authenticated (SSO provisions account)', !!u, '');
      check('  community: NOT in "builders" group', !groups.includes('builders'), `groups=${JSON.stringify(groups)}`);
    }

    console.log('\n3. Admin group-sync contract (Paddle fan-out → Discourse admin API)');
    const syncId = seed(syncEmail, { builder: false });
    await roundTrip('  sync', mintJwt(syncId, syncEmail), syncId); // provisions the Discourse account
    const gid = await groupIdByName('builders');
    const u0 = await adminUserByExternal(syncId);
    check('  sync: builders group id resolved (GET /groups/builders.json)', typeof gid === 'number', `gid=${gid}`);
    check('  sync: user provisioned, not yet in builders', !!u0 && !(u0.groups || []).some((g) => g.name === 'builders'));
    if (u0 && typeof gid === 'number') {
      const addSt = await adminSyncGroup(u0.username, gid, true);
      check('  sync: admin ADD (PUT /groups/{id}/members) → 200', addSt === 200, `status=${addSt}`);
      check('  sync: user now IN builders server-side (no re-login)', (await userGroupNames(syncId)).includes('builders'));
      const delSt = await adminSyncGroup(u0.username, gid, false);
      check('  sync: admin REMOVE (DELETE /groups/{id}/members) → 200', delSt === 200, `status=${delSt}`);
      check('  sync: user removed from builders server-side', !(await userGroupNames(syncId)).includes('builders'));
    }

    console.log('\n4. DiscourseConnect config (SSO-only) is enforced');
    check('  enable_discourse_connect = true', String(await siteSetting('enable_discourse_connect')) === 'true');
    check('  enable_local_logins = false (SSO-only)', String(await siteSetting('enable_local_logins')) === 'false');
    check('  auth_overrides_email = true', String(await siteSetting('auth_overrides_email')) === 'true');
  } finally {
    for (const id of seeded) cleanup(id);
    console.log(dim('\ncleaned up seeded users'));
  }

  console.log(failed === 0 ? '\n' + green('All Discourse round-trip checks passed.') + '\n' : '\n' + red(`${failed} check(s) failed.`) + '\n');
  process.exitCode = failed === 0 ? 0 : 1;
}
main().catch((e) => { console.error(red('FATAL: ' + (e?.message || e))); process.exitCode = 2; });
