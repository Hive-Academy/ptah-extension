/**
 * Auth flow end-to-end spec — TASK_2025_294 W1.B6.2.
 *
 * Exercises the auth domain in-process against real service implementations:
 *
 *   - `MagicLinkService` — create → validate → consume, expiry, single-use
 *   - `JwtTokenService` + real `@nestjs/jwt` `JwtService` — sign/verify
 *     round-trip against HS256, tamper rejection, expiry rejection
 *   - `PkceService` (OAuth 2.1 PKCE == the license-server's "device-code"
 *     equivalent) — state/verifier issuance, single-use, expiry
 *
 * Intent: prove the money-path auth primitives — magic-link (passwordless),
 * JWT session tokens, and PKCE state management — survive round-trips,
 * tampering, expiry, and replay attempts. All services use in-memory
 * storage (Map), so no DB is required for the auth primitives
 * themselves; `JwtTokenService.determineTier` is the only point that
 * touches Prisma, mocked via `createMockPrisma()`.
 *
 * Testcontainers / supertest: see the sibling `paddle-webhook.e2e-spec.ts`
 * header comment. These specs follow the same in-process harness
 * pattern used by `paddle-webhook.service.spec.ts` and
 * `jwt-token.service.spec.ts` shipped in the license-server source
 * tree.
 */

import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import type { User as WorkOSUser } from '@workos-inc/node';

import { MagicLinkService } from '../../ptah-license-server/src/app/auth/services/token/magic-link.service';
import { JwtTokenService } from '../../ptah-license-server/src/app/auth/services/token/jwt-token.service';
import { PkceService } from '../../ptah-license-server/src/app/auth/services/token/pkce.service';
import {
  createMockPrisma,
  asPrismaService,
  type MockPrisma,
} from '../../ptah-license-server/src/testing/mock-prisma.factory';

const JWT_SECRET =
  'e2e-jwt-secret-256-bit-hs256-round-trip-ptah-license-server-test';
const DB_USER_ID = '00000000-0000-4000-8000-000000000042';
const WORKOS_USER_ID = 'user_01E2ELICTEST';
const TEST_EMAIL = 'e2e-auth@example.com';

/** Build a ConfigService stub backed by a map (matches test-module pattern). */
function makeConfig(values: Record<string, unknown>): ConfigService {
  const stub: Pick<ConfigService, 'get'> = {
    get<T = unknown>(key: string, defaultValue?: T): T {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        return values[key] as T;
      }
      return defaultValue as T;
    },
  };
  return stub as ConfigService;
}

function makeWorkOSUser(overrides: Partial<WorkOSUser> = {}): WorkOSUser {
  return {
    id: WORKOS_USER_ID,
    email: TEST_EMAIL,
    emailVerified: true,
    firstName: 'E2E',
    lastName: 'Tester',
    object: 'user',
    profilePictureUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastSignInAt: null,
    externalId: null,
    metadata: {},
    ...overrides,
  } as unknown as WorkOSUser;
}

// ============================================================================
// MAGIC LINK FLOW
// ============================================================================

describe('auth-flow e2e :: magic-link request → token issue', () => {
  let magicLink: MagicLinkService;

  beforeEach(() => {
    jest.useRealTimers();
    // Short TTL so expiry tests are fast but deterministic (100ms).
    magicLink = new MagicLinkService(
      makeConfig({
        MAGIC_LINK_TTL_MS: 100,
        FRONTEND_URL: 'https://portal.test',
      }),
    );
  });

  it('creates a magic link URL containing a 64-char hex token', async () => {
    const url = await magicLink.createMagicLink(TEST_EMAIL);

    expect(url).toMatch(
      /^https:\/\/portal\.test\/api\/auth\/verify\?token=[a-f0-9]{64}$/,
    );
  });

  it('validates the freshly created token and returns the bound email', async () => {
    const url = await magicLink.createMagicLink(TEST_EMAIL);
    const token = new URL(url).searchParams.get('token') as string;

    const result = await magicLink.validateAndConsume(token);

    expect(result).toEqual({
      valid: true,
      email: TEST_EMAIL,
      returnUrl: null,
      plan: null,
    });
  });

  it('propagates returnUrl and plan through the create → consume round-trip', async () => {
    const url = await magicLink.createMagicLink(TEST_EMAIL, {
      returnUrl: '/checkout',
      plan: 'pro-monthly',
    });
    const token = new URL(url).searchParams.get('token') as string;

    const result = await magicLink.validateAndConsume(token);

    expect(result).toEqual({
      valid: true,
      email: TEST_EMAIL,
      returnUrl: '/checkout',
      plan: 'pro-monthly',
    });
  });

  it('enforces single-use — second consumption returns token_not_found', async () => {
    const url = await magicLink.createMagicLink(TEST_EMAIL);
    const token = new URL(url).searchParams.get('token') as string;

    const first = await magicLink.validateAndConsume(token);
    const second = await magicLink.validateAndConsume(token);

    expect(first.valid).toBe(true);
    expect(second).toEqual({
      valid: false,
      error: 'token_not_found',
    });
  });

  it('rejects unknown tokens with token_not_found', async () => {
    const result = await magicLink.validateAndConsume(
      'a'.repeat(64), // plausible shape, never issued
    );

    expect(result).toEqual({
      valid: false,
      error: 'token_not_found',
    });
  });

  it('rejects expired tokens once the TTL elapses', async () => {
    const url = await magicLink.createMagicLink(TEST_EMAIL);
    const token = new URL(url).searchParams.get('token') as string;

    // Wait past the 100ms TTL configured above.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await magicLink.validateAndConsume(token);

    expect(result).toEqual({
      valid: false,
      error: 'token_expired',
    });
    // Expired tokens are evicted — storage should be empty afterwards.
    expect(magicLink.getTokenCount()).toBe(0);
  });
});

// ============================================================================
// JWT SESSION TOKEN FLOW
// ============================================================================

describe('auth-flow e2e :: JWT session issue → validate → refresh', () => {
  let jwtService: JwtService;
  let prisma: MockPrisma;
  let tokens: JwtTokenService;

  beforeEach(() => {
    prisma = createMockPrisma();
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.license.findFirst.mockResolvedValue(null);

    jwtService = new JwtService({
      secret: JWT_SECRET,
      signOptions: { expiresIn: '1h' },
    });

    tokens = new JwtTokenService(jwtService, asPrismaService(prisma));
  });

  it('signs a JWT that round-trips back to the original RequestUser', async () => {
    const jwt = await tokens.generateToken(DB_USER_ID, makeWorkOSUser());

    const user = tokens.validateToken(jwt);

    expect(user).toEqual({
      id: DB_USER_ID,
      email: TEST_EMAIL,
      tenantId: `user_${DB_USER_ID}`,
      organizationId: undefined,
      roles: ['user'],
      permissions: ['read:docs', 'write:docs'],
      tier: 'community',
    });
  });

  it('rejects tokens signed with a different secret (signature mismatch)', async () => {
    const attackerSigner = new JwtService({ secret: 'attacker-secret-xxx' });
    const forged = attackerSigner.sign({
      sub: DB_USER_ID,
      email: 'attacker@evil.test',
      tenantId: `user_${DB_USER_ID}`,
      roles: ['admin'],
      permissions: ['manage:users'],
      tier: 'pro',
    });

    expect(() => tokens.validateToken(forged)).toThrow(UnauthorizedException);
  });

  it('rejects tokens whose payload has been tampered with', async () => {
    const jwt = await tokens.generateToken(DB_USER_ID, makeWorkOSUser());
    const [header, , signature] = jwt.split('.');
    // Swap in an attacker-chosen payload, keep the original signature.
    const maliciousPayload = Buffer.from(
      JSON.stringify({ sub: DB_USER_ID, email: TEST_EMAIL, tier: 'pro' }),
      'utf8',
    )
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const tampered = `${header}.${maliciousPayload}.${signature}`;

    expect(() => tokens.validateToken(tampered)).toThrow(UnauthorizedException);
  });

  it('rejects expired tokens once expiresIn elapses', async () => {
    const shortLived = new JwtService({
      secret: JWT_SECRET,
      signOptions: { expiresIn: '1ms' },
    });
    const forSpec = new JwtTokenService(shortLived, asPrismaService(prisma));

    const jwt = await forSpec.generateToken(DB_USER_ID, makeWorkOSUser());
    // Wait past the 1ms expiry (jsonwebtoken enforces at verify-time).
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(() => forSpec.validateToken(jwt)).toThrow(UnauthorizedException);
  });

  it('refreshes a session by re-signing the same subject claim', async () => {
    const first = await tokens.generateToken(DB_USER_ID, makeWorkOSUser());
    // Small delay so the `iat` claim differs — proves it is a NEW token.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const refreshed = await tokens.generateToken(DB_USER_ID, makeWorkOSUser());

    expect(refreshed).not.toBe(first);

    const firstUser = tokens.validateToken(first);
    const refreshedUser = tokens.validateToken(refreshed);

    expect(firstUser.id).toBe(refreshedUser.id);
    expect(firstUser.email).toBe(refreshedUser.email);
  });

  it('strips attacker-supplied roles/permissions from WorkOS metadata', async () => {
    const malicious = makeWorkOSUser({
      metadata: {
        roles: ['owner', 'admin', 'user', 'superuser'],
        permissions: ['system:root', 'bypass:billing'],
      } as unknown as WorkOSUser['metadata'],
    });

    const jwt = await tokens.generateToken(DB_USER_ID, malicious);
    const user = tokens.validateToken(jwt);

    // 'owner' and 'superuser' are blocked — only admin + user survive.
    expect(user.roles).toEqual(['admin', 'user']);
    // Permissions are derived server-side — metadata-injected perms are ignored.
    expect(user.permissions).toEqual(
      expect.arrayContaining(['read:docs', 'write:docs', 'manage:users']),
    );
    expect(user.permissions).not.toContain('system:root');
    expect(user.permissions).not.toContain('bypass:billing');
  });
});

// ============================================================================
// PKCE (OAuth 2.1 — "DEVICE-CODE"-EQUIVALENT) FLOW
// ============================================================================

describe('auth-flow e2e :: PKCE state issue → consume → replay', () => {
  let pkce: PkceService;

  beforeEach(() => {
    pkce = new PkceService();
  });

  afterEach(() => {
    pkce.onModuleDestroy();
  });

  it('issues a matching code_verifier / code_challenge / state triple', () => {
    const params = pkce.generatePkceParams();

    // code_verifier must be 43-128 chars of base64url (RFC 7636).
    expect(params.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    // code_challenge is SHA-256 of the verifier, base64url-encoded (43 chars).
    expect(params.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // state is 32 hex chars (16 bytes).
    expect(params.state).toMatch(/^[a-f0-9]{32}$/);

    // Verifier and challenge should not be equal — challenge is the hash.
    expect(params.codeVerifier).not.toBe(params.codeChallenge);
  });

  it('consumes the stored verifier when given the matching state', () => {
    const { codeVerifier, state } = pkce.generatePkceParams({
      returnUrl: '/checkout',
      plan: 'pro-yearly',
    });

    const consumed = pkce.consumeVerifier(state);

    expect(consumed).toEqual({
      verifier: codeVerifier,
      returnUrl: '/checkout',
      plan: 'pro-yearly',
    });
  });

  it('enforces single-use — replayed state returns null', () => {
    const { state } = pkce.generatePkceParams();

    const first = pkce.consumeVerifier(state);
    const replay = pkce.consumeVerifier(state);

    expect(first).not.toBeNull();
    expect(replay).toBeNull();
  });

  it('rejects unknown state values', () => {
    const result = pkce.consumeVerifier('deadbeef'.repeat(4));

    expect(result).toBeNull();
  });

  it('expires stored verifiers after STATE_TTL_MS (simulated via fake timers)', () => {
    jest.useFakeTimers();
    try {
      const local = new PkceService();
      try {
        const { state } = local.generatePkceParams();

        // Advance just past the 5-minute TTL baked into PkceService.
        jest.advanceTimersByTime(5 * 60 * 1000 + 1);

        const result = local.consumeVerifier(state);
        expect(result).toBeNull();
      } finally {
        local.onModuleDestroy();
      }
    } finally {
      jest.useRealTimers();
    }
  });
});
