/**
 * discourse-admin-sync-smoke.mjs — proves the ADMIN_EMAILS -> Discourse admin
 * sync (TASK_2026_165). Drives a real DiscourseConnect SSO login for a given
 * license-server user and asserts that, when their email is in ADMIN_EMAILS, the
 * SSO payload promotes them to a Discourse admin/moderator on login (and demotes
 * otherwise). This is the runtime, on-login mechanism — Discourse has no admin
 * for an email until that email actually logs in via SSO.
 *
 * Usage:  node scripts/discourse-admin-sync-smoke.mjs <userId> <email>
 *   (defaults to abdallah's dev account if omitted)
 * Requires docker + JWT_SECRET / DISCOURSE_* in .env. Reaches :3000 and :3001.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
const API_KEY = env.DISCOURSE_API_KEY;
const API_USER = env.DISCOURSE_API_USERNAME || 'system';
const ADMIN_EMAILS = (env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

const userId = process.argv[2] || '674888a2-b28b-4d83-87c8-8c30d971edc1';
const email = process.argv[3] || 'abdallah@miramarstaffing.com';

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function mintJwt(sub, mail) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64url(JSON.stringify({ sub, email: mail, tenantId: `user_${sub}`, roles: ['user'], permissions: ['read:docs'], tier: 'community', iat: now, exp: now + 600 }));
  const s = createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

function makeJar() {
  const jar = {};
  return {
    absorb(res) {
      for (const [k, v] of res.headers) {
        if (k.toLowerCase() === 'set-cookie') {
          for (const c of v.split(/,(?=[^ ;]+=)/)) { const m = /^([^=]+)=([^;]*)/.exec(c.trim()); if (m) jar[m[1]] = m[2]; }
        }
      }
    },
    header() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); },
  };
}
async function adminUserByExternal(externalId) {
  const res = await fetch(`${DSC}/u/by-external/${externalId}.json`, { headers: { 'Api-Key': API_KEY, 'Api-Username': API_USER } });
  if (!res.ok) return null;
  const j = await res.json();
  return j.user || j;
}

let failed = 0;
const green = (s) => `\x1b[32m${s}\x1b[0m`, red = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`;
const check = (name, ok, detail = '') => { console.log('  ' + (ok ? green('✓') : red('✗')) + ' ' + name + (detail ? dim(`  (${detail})`) : '')); if (!ok) failed++; };

async function ssoLogin(jwt) {
  const jar = makeJar();
  const r1 = await fetch(`${DSC}/session/sso?return_path=%2F`, { redirect: 'manual' });
  jar.absorb(r1);
  const connectUrl = r1.headers.get('location');
  if (!connectUrl) return false;
  const r2 = await fetch(connectUrl, { redirect: 'manual', headers: { cookie: `ptah_auth=${jwt}` } });
  const backUrl = r2.headers.get('location');
  if (!backUrl || !backUrl.includes('/session/sso_login')) return false;
  const r3 = await fetch(backUrl, { redirect: 'manual', headers: { cookie: jar.header() } });
  jar.absorb(r3);
  return r3.status === 302 || r3.status === 200;
}

async function main() {
  console.log(`\nDiscourse admin-sync proof  (user=${email})\n`);
  const expectedAdmin = ADMIN_EMAILS.includes(email.toLowerCase());
  console.log(dim(`ADMIN_EMAILS=${JSON.stringify(ADMIN_EMAILS)} → expect admin=${expectedAdmin}\n`));

  const ok = await ssoLogin(mintJwt(userId, email));
  check('SSO login round-trip completes', ok);

  const u = await adminUserByExternal(userId);
  check('Discourse account exists for this external_id', !!u, u ? `username=${u.username} id=${u.id}` : 'not found');
  if (u) {
    check(`Discourse admin flag matches ADMIN_EMAILS (expect ${expectedAdmin})`, Boolean(u.admin) === expectedAdmin, `admin=${u.admin}`);
    check(`Discourse moderator flag matches ADMIN_EMAILS (expect ${expectedAdmin})`, Boolean(u.moderator) === expectedAdmin, `moderator=${u.moderator}`);
  }

  if (failed === 0) {
    console.log(green(`\nAdmin sync verified — ${email} is ${expectedAdmin ? 'now a Discourse admin' : 'NOT a Discourse admin'} (driven purely by ADMIN_EMAILS on SSO login).\n`));
    process.exit(0);
  }
  console.log(red(`\n${failed} check(s) FAILED.\n`));
  process.exit(1);
}
main().catch((e) => { console.error(red(`\nHarness error: ${e?.stack || e}\n`)); process.exit(2); });
