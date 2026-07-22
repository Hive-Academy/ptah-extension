import { createHmac } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import { env } from './env';

/**
 * Auth injection for the landing SPA without the WorkOS UI (handoff §1.2).
 *
 * The SPA reads two things: an HTTP-only `ptah_auth` HS256 JWT cookie (signed
 * with `.env` JWT_SECRET) that the license server validates, and a
 * `ptah_auth_hint` localStorage flag that tells the SPA to probe
 * `GET /api/auth/me`. We set both so gated routes (`/profile`, `/members`,
 * `/admin`) render as an authenticated user.
 *
 * The JWT payload mirrors `mintJwt()` in scripts/discourse-e2e.mjs. Note the
 * Builder *entitlement* is resolved server-side from the DB subscription/license,
 * NOT from `tier` in this token (§4) — so `seedUser({ builder: true })` is what
 * actually opens the members gate; `tier` here just keeps the token realistic.
 */
const JWT_SECRET = env['JWT_SECRET'];

export type Tier = 'community' | 'builders' | 'pro';

const b64url = (b: string) =>
  Buffer.from(b)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export function mintJwt(
  sub: string,
  email: string,
  tier: Tier = 'community',
): string {
  if (!JWT_SECRET) {
    throw new Error(
      'JWT_SECRET missing from .env — cannot mint a ptah_auth token for e2e auth injection.',
    );
  }
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub,
      email,
      tenantId: `user_${sub}`,
      roles: ['user'],
      permissions: ['read:docs'],
      tier,
      iat: now,
      exp: now + 3600,
    }),
  );
  const sig = createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/**
 * Inject the `ptah_auth` cookie + `ptah_auth_hint` flag into a browser context.
 * `domain`/`path` scope the cookie to the dev server; the flag is planted via an
 * init script so it exists before the SPA's first paint.
 */
export async function injectAuth(
  context: BrowserContext,
  user: { id: string; email: string; tier?: Tier },
  baseUrl = process.env['E2E_BASE_URL'] || 'http://localhost:4200',
): Promise<void> {
  const { hostname } = new URL(baseUrl);
  const jwt = mintJwt(user.id, user.email, user.tier ?? 'community');
  await context.addCookies([
    {
      name: 'ptah_auth',
      value: jwt,
      domain: hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  // NB: the SPA stores the literal string 'true' (auth.service.ts AUTH_HINT_KEY),
  // NOT '1' as the handoff §1.2 states — matching the real reader is what makes
  // the SPA probe GET /api/auth/me instead of treating the session as guest.
  await context.addInitScript(() => {
    try {
      localStorage.setItem('ptah_auth_hint', 'true');
    } catch {
      /* storage may be unavailable pre-navigation; ignored */
    }
  });
}
