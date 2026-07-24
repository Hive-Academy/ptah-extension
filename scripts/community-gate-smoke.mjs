/**
 * community-gate-smoke.mjs — security test for the Builders gate on
 * GET /api/v1/community/summary (TASK_2026_167).
 *
 * Proves that the in-app community activity endpoint — which fetches forum data
 * via the SYSTEM-level admin Discourse key — is readable ONLY by active Builders
 * members, not by every authenticated Ptah account. A non-Builders caller must
 * degrade to `{ communityUrl: null, topics: [] }` (no forum data), and an
 * anonymous caller must be rejected by the JWT guard.
 *
 * Deterministic: seeds users straight into Postgres + mints ptah_auth JWTs with
 * JWT_SECRET (same mechanism as discourse-e2e.mjs). No browser, no WorkOS.
 * Run from Windows (reaches :3000). Requires docker + JWT_SECRET in .env.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
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

let failures = 0;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
function check(label, ok, detail) {
  console.log(`  ${ok ? green('✓') : red('✗')} ${label}${detail ? dim(`  (${detail})`) : ''}`);
  if (!ok) failures++;
}

async function getSummary(jwt) {
  const res = await fetch(`${LIC}/api/v1/community/summary`, {
    headers: jwt ? { cookie: `ptah_auth=${jwt}` } : {},
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON (e.g. 401) */ }
  return { status: res.status, body };
}

async function main() {
  console.log(`\nCommunity gate security test  (endpoint=${LIC}/api/v1/community/summary)\n`);
  const ts = Date.now();
  const builderId = seedUser(`gate-builder-${ts}@example.com`, { builder: true });
  const communityId = seedUser(`gate-community-${ts}@example.com`, { builder: false });
  console.log(dim(`seeded builder=${builderId} community=${communityId}\n`));

  try {
    // 1. Anonymous — must be rejected by the JWT guard.
    console.log('1. Anonymous request (no ptah_auth cookie) → must be rejected');
    const anon = await getSummary(null);
    check('anonymous is rejected (401/403)', anon.status === 401 || anon.status === 403, `status=${anon.status}`);
    check('anonymous receives NO forum data', !anon.body?.topics?.length && !anon.body?.communityUrl, `body=${JSON.stringify(anon.body)}`);

    // 2. Authenticated non-Builders — must degrade to empty (NO forum data).
    console.log('\n2. Authenticated NON-Builders user → must be denied forum data');
    const community = await getSummary(mintJwt(communityId, `gate-community-${ts}@example.com`));
    check('non-Builders gets 200 (degraded, not an error)', community.status === 200, `status=${community.status}`);
    check('non-Builders communityUrl is null (gate closed)', community.body?.communityUrl === null, `communityUrl=${JSON.stringify(community.body?.communityUrl)}`);
    check('non-Builders topics is empty (no gated data leaked)', Array.isArray(community.body?.topics) && community.body.topics.length === 0, `topics=${JSON.stringify(community.body?.topics)}`);

    // 3. Authenticated Builders — gate opens (communityUrl present).
    console.log('\n3. Authenticated Builders member → gate opens');
    const builder = await getSummary(mintJwt(builderId, `gate-builder-${ts}@example.com`));
    check('Builders gets 200', builder.status === 200, `status=${builder.status}`);
    check('Builders communityUrl is present (gate open)', typeof builder.body?.communityUrl === 'string' && builder.body.communityUrl.length > 0, `communityUrl=${JSON.stringify(builder.body?.communityUrl)}`);
    check('Builders topics is an array', Array.isArray(builder.body?.topics), `topics=${JSON.stringify(builder.body?.topics)?.slice(0, 80)}`);

    // 4. The discriminating assertion: the two identities get DIFFERENT access.
    console.log('\n4. Cross-check: Builders and non-Builders get different access');
    check('gate discriminates (builder.communityUrl set, community.communityUrl null)',
      builder.body?.communityUrl && community.body?.communityUrl === null,
      `builder=${JSON.stringify(builder.body?.communityUrl)} community=${JSON.stringify(community.body?.communityUrl)}`);
  } finally {
    cleanup(builderId);
    cleanup(communityId);
    console.log(dim('\ncleaned up seeded users'));
  }

  if (failures === 0) {
    console.log(green('\nAll community-gate security checks passed — only Builders read forum data.\n'));
    process.exit(0);
  } else {
    console.log(red(`\n${failures} check(s) FAILED — the Builders gate is not enforced correctly.\n`));
    process.exit(1);
  }
}

main().catch((e) => { console.error(red(`\nHarness error: ${e?.stack || e}\n`)); process.exit(2); });
