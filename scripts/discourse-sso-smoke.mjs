#!/usr/bin/env node
/**
 * discourse-sso-smoke.mjs — local end-to-end smoke test for the DiscourseConnect
 * SSO provider endpoint exposed by the license server
 * (`GET /api/v1/sso/discourse`, apps/ptah-license-server/src/discourse/).
 *
 * It proves the endpoint's behavior WITHOUT a live Discourse or WorkOS login:
 * the `ptah_auth` cookie is a plain HS256 JWT signed with `JWT_SECRET`, so we
 * mint one locally, and the DiscourseConnect request/response is HMAC-SHA256
 * keyed by `DISCOURSE_SSO_SECRET` — both read from the repo-root `.env`.
 *
 * Checks:
 *   1. Valid signed request + valid cookie  → 302 to <DISCOURSE_URL>/session/sso_login,
 *      response `sig` verifies against `sso`, nonce echoed, add/remove_groups present.
 *   2. Tampered `sig`                        → 403 (never leaks why).
 *   3. Valid request, NO cookie              → 302 to FRONTEND_URL/login?returnUrl=...
 *
 * Usage:
 *   node scripts/discourse-sso-smoke.mjs
 *   API_BASE=http://localhost:3000 node scripts/discourse-sso-smoke.mjs
 *
 * Requires the license server running with DISCOURSE_SSO_SECRET and a non-empty
 * DISCOURSE_URL set (any value satisfies the guard; the real local Discourse URL
 * is ideal). Zero npm dependencies — pure node:crypto.
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_BASE = (process.env.API_BASE || 'http://localhost:3000').replace(/\/+$/, '');

// --- tiny .env loader (repo root), env vars still win -----------------------
function loadEnv() {
  const out = {};
  try {
    const raw = readFileSync(join(ROOT, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  } catch {
    /* no .env — rely on process.env */
  }
  return out;
}

const fileEnv = loadEnv();
const env = (k) => process.env[k] ?? fileEnv[k];

const JWT_SECRET = env('JWT_SECRET');
const SSO_SECRET = env('DISCOURSE_SSO_SECRET');

if (!JWT_SECRET) fail('JWT_SECRET not found in env or .env');
if (!SSO_SECRET) fail('DISCOURSE_SSO_SECRET not found in env or .env');

// --- crypto helpers ---------------------------------------------------------
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hmacHex = (payload, secret) => createHmac('sha256', secret).update(payload).digest('hex');

/** Mint a minimal HS256 ptah_auth JWT for a synthetic test user. */
function mintJwt() {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub: '00000000-0000-4000-8000-00000000dead', // random UUID (not a real member → remove_groups expected)
      email: 'sso-smoke@ptah.live',
      tenantId: 'user_smoke',
      roles: ['user'],
      permissions: ['read:docs'],
      tier: 'community',
      iat: now,
      exp: now + 300,
    }),
  );
  const sig = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/** Build a DiscourseConnect `sso`/`sig` request pair (Discourse → provider). */
function buildRequest(nonce) {
  const qs = new URLSearchParams({ nonce, return_sso_url: 'http://localhost:4200/session/sso_login' });
  const sso = Buffer.from(qs.toString(), 'utf8').toString('base64');
  return { sso, sig: hmacHex(sso, SSO_SECRET) };
}

// --- assertions -------------------------------------------------------------
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`);
  }
}
function fail(msg) {
  console.error(`\x1b[31mFATAL:\x1b[0m ${msg}`);
  process.exit(2);
}

async function ssoGet({ sso, sig, cookie }) {
  const url = `${API_BASE}/api/v1/sso/discourse?sso=${encodeURIComponent(sso)}&sig=${encodeURIComponent(sig)}`;
  return fetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: cookie ? { cookie: `ptah_auth=${cookie}` } : {},
  });
}

// --- scenarios --------------------------------------------------------------
async function run() {
  console.log(`\nDiscourse SSO smoke test → ${API_BASE}/api/v1/sso/discourse\n`);

  // 1. Valid request + valid cookie → signed redirect to Discourse
  console.log('1. Valid signed request with authenticated cookie');
  {
    const nonce = `nonce-${b64url(Buffer.from(String(Date.now())))}`;
    const req = buildRequest(nonce);
    const res = await ssoGet({ ...req, cookie: mintJwt() });
    const loc = res.headers.get('location') || '';
    check('responds 302', res.status === 302 || res.status === 301, `got ${res.status}`);
    check('redirects to /session/sso_login', loc.includes('/session/sso_login'), loc);

    if (loc.includes('/session/sso_login')) {
      const u = new URL(loc);
      const rSso = u.searchParams.get('sso') || '';
      const rSig = u.searchParams.get('sig') || '';
      check('response sig verifies against sso', rSig === hmacHex(rSso, SSO_SECRET), 'HMAC mismatch');
      const decoded = new URLSearchParams(Buffer.from(rSso, 'base64').toString('utf8'));
      check('nonce echoed back', decoded.get('nonce') === nonce, decoded.get('nonce') || '(none)');
      check('external_id present', Boolean(decoded.get('external_id')));
      check('email present', Boolean(decoded.get('email')));
      const groups = decoded.get('add_groups') ?? decoded.get('remove_groups');
      check('asserts builders group (add/remove)', groups === 'builders', groups || '(none)');
    }
  }

  // 2. Tampered signature → 403
  console.log('\n2. Tampered signature is rejected');
  {
    const req = buildRequest('nonce-tampered');
    const res = await ssoGet({ sso: req.sso, sig: 'deadbeef'.repeat(8), cookie: mintJwt() });
    check('responds 403', res.status === 403, `got ${res.status}`);
  }

  // 3. Valid request, no cookie → bounce through login
  console.log('\n3. Unauthenticated request bounces to login');
  {
    const req = buildRequest('nonce-anon');
    const res = await ssoGet({ ...req, cookie: undefined });
    const loc = res.headers.get('location') || '';
    check('responds 302', res.status === 302 || res.status === 301, `got ${res.status}`);
    check('redirects to /login', loc.includes('/login'), loc);
    check('carries returnUrl back to sso endpoint', loc.includes('sso%2Fdiscourse') || loc.includes('sso/discourse'), loc);
  }

  console.log(
    failed === 0
      ? '\n\x1b[32mAll SSO endpoint checks passed.\x1b[0m\n'
      : `\n\x1b[31m${failed} check(s) failed.\x1b[0m\n`,
  );
  // Set exitCode and let the event loop drain (pending fetch sockets close
  // gracefully) rather than force-exiting, which trips a libuv assertion on
  // Windows when handles are still closing.
  process.exitCode = failed === 0 ? 0 : 1;
}

run().catch((e) => fail(e?.message || String(e)));
