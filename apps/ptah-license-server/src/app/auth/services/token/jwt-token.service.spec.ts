/**
 * Unit tests for JwtTokenService (TASK_2025_294 W1.B2.1).
 *
 * Scope: Cryptographic correctness of JWT sign/verify round-trip and
 * the security-critical tier/role/permission derivation logic.
 *
 * Strategy:
 *   - Use a REAL `@nestjs/jwt` `JwtService` instance (HS256 with a test
 *     secret) so sign/verify actually exercise `jsonwebtoken` — NOT a
 *     mock. The point of these tests is to verify that tamper detection
 *     and expiry enforcement work end-to-end.
 *   - Mock Prisma via `createMockPrisma()` because DB I/O is a boundary.
 *   - Frozen clock via `freezeTime()` from `@ptah-extension/shared/testing`
 *     so expiry edges are deterministic.
 *
 * Coverage:
 *   - sign → verify → RequestUser round-trip.
 *   - Tamper detection: modifying header/payload/signature → UnauthorizedException.
 *   - Expiry enforcement: token rejected after `expiresIn` elapses.
 *   - Role allowlist (TASK_2025_188): privilege escalation via metadata
 *     blocked ('owner' rejected, unknown roles stripped).
 *   - Permissions derived from roles ONLY — metadata-injected perms ignored.
 *   - Tier determination from subscription / license / fallback.
 *   - mapWorkOSUserToRequestUser prefers databaseUserId over WorkOS id.
 */
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import type { User } from '@workos-inc/node';
import { freezeTime, type FrozenClock } from '@ptah-extension/shared/testing';
import {
  createMockPrisma,
  asPrismaService,
  type MockPrisma,
} from '../../../../testing';
import { JwtTokenService } from './jwt-token.service';

const JWT_SECRET = 'test-jwt-secret-256-bit-long-for-hs256-round-trip-xxxxx';
const DB_USER_ID = '00000000-0000-4000-8000-000000000001';
const WORKOS_USER_ID = 'user_01WORKOSID';

function makeWorkOSUser(overrides: Partial<User> = {}): User {
  return {
    id: WORKOS_USER_ID,
    email: 'user@example.com',
    emailVerified: true,
    firstName: 'Test',
    lastName: 'User',
    object: 'user',
    profilePictureUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastSignInAt: null,
    externalId: null,
    metadata: {},
    ...overrides,
  } as unknown as User;
}

describe('JwtTokenService', () => {
  let jwtService: JwtService;
  let prisma: MockPrisma;
  let service: JwtTokenService;
  let clock: FrozenClock;

  beforeEach(() => {
    clock = freezeTime('2026-04-24T12:00:00.000Z');
    jwtService = new JwtService({
      secret: JWT_SECRET,
      signOptions: { expiresIn: '1h' },
    });
    prisma = createMockPrisma();
    // Default: no subscription, no license → community tier.
    prisma.subscription.findFirst.mockResolvedValue(null);
    prisma.license.findFirst.mockResolvedValue(null);

    service = new JwtTokenService(jwtService, asPrismaService(prisma));
  });

  afterEach(() => {
    clock.restore();
  });

  // ==========================================================================
  // ROUND-TRIP
  // ==========================================================================

  describe('generateToken → validateToken round-trip', () => {
    it('signs a token and verifies it back to a RequestUser', async () => {
      const token = await service.generateToken(DB_USER_ID, makeWorkOSUser());

      const user = service.validateToken(token);

      expect(user).toEqual({
        id: DB_USER_ID,
        email: 'user@example.com',
        tenantId: `user_${DB_USER_ID}`,
        organizationId: undefined,
        roles: ['user'],
        permissions: ['read:docs', 'write:docs'],
        tier: 'community',
      });
    });

    it('sub claim uses the DATABASE user id, never the WorkOS id', async () => {
      const token = await service.generateToken(DB_USER_ID, makeWorkOSUser());

      // Decode without verification to peek at the payload.
      const [, payloadB64] = token.split('.');
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf-8'),
      ) as { sub: string };

      expect(payload.sub).toBe(DB_USER_ID);
      expect(payload.sub).not.toBe(WORKOS_USER_ID);
    });

    it('propagates organizationId into tenantId when supplied', async () => {
      const token = await service.generateToken(
        DB_USER_ID,
        makeWorkOSUser(),
        'org_BIGCORP',
      );

      const user = service.validateToken(token);
      expect(user.organizationId).toBe('org_BIGCORP');
      expect(user.tenantId).toBe('org_BIGCORP');
    });
  });

  // ==========================================================================
  // TAMPER REJECTION
  // ==========================================================================

  describe('validateToken — tamper rejection', () => {
    it('rejects a token whose payload has been modified', async () => {
      const token = await service.generateToken(DB_USER_ID, makeWorkOSUser());
      const [header, payloadB64, signature] = token.split('.');

      // Escalate to admin by rewriting the payload.
      const payload = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf-8'),
      );
      payload.roles = ['admin'];
      payload.tier = 'pro';
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString(
        'base64url',
      );
      const tampered = `${header}.${tamperedPayload}.${signature}`;

      expect(() => service.validateToken(tampered)).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token whose signature has been modified', async () => {
      const token = await service.generateToken(DB_USER_ID, makeWorkOSUser());
      const [header, payloadB64] = token.split('.');

      // Replace signature with a different base64url blob of the right length.
      const bogusSig = Buffer.from('x'.repeat(32)).toString('base64url');
      const tampered = `${header}.${payloadB64}.${bogusSig}`;

      expect(() => service.validateToken(tampered)).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token signed with a different secret', () => {
      const attackerJwt = new JwtService({
        secret: 'attacker-controlled-secret',
        signOptions: { expiresIn: '1h' },
      });
      const forged = attackerJwt.sign({
        sub: DB_USER_ID,
        email: 'user@example.com',
        tenantId: 'user_x',
        roles: ['admin'],
        permissions: ['manage:users'],
        tier: 'pro',
      });

      expect(() => service.validateToken(forged)).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects the alg=none downgrade attack', () => {
      // Header: {"alg":"none","typ":"JWT"}
      const header = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: DB_USER_ID,
          email: 'attacker@example.com',
          tenantId: 't',
          roles: ['admin'],
          permissions: ['manage:users'],
          tier: 'pro',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ).toString('base64url');
      const forged = `${header}.${payload}.`;

      expect(() => service.validateToken(forged)).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a structurally malformed token', () => {
      expect(() => service.validateToken('not.a.jwt')).toThrow(
        UnauthorizedException,
      );
      expect(() => service.validateToken('')).toThrow(UnauthorizedException);
    });
  });

  // ==========================================================================
  // EXPIRY
  // ==========================================================================

  describe('validateToken — expiry (frozen clock)', () => {
    it('accepts a freshly issued token', async () => {
      const token = await service.generateToken(DB_USER_ID, makeWorkOSUser());
      expect(() => service.validateToken(token)).not.toThrow();
    });

    it('accepts a token just before its expiresIn window closes', async () => {
      const token = await service.generateToken(DB_USER_ID, makeWorkOSUser());

      // Advance 59 minutes 58 seconds — still inside the 1h window.
      clock.advanceBy((60 * 60 - 2) * 1000);

      expect(() => service.validateToken(token)).not.toThrow();
    });

    it('rejects a token once expiresIn has elapsed', async () => {
      const token = await service.generateToken(DB_USER_ID, makeWorkOSUser());

      // Advance 1h + 1s — outside the 1h window.
      clock.advanceBy(60 * 60 * 1000 + 1000);

      expect(() => service.validateToken(token)).toThrow(UnauthorizedException);
    });
  });

  // ==========================================================================
  // SECURITY: ROLE ALLOWLIST (TASK_2025_188)
  // ==========================================================================

  describe('role allowlist — privilege escalation prevention', () => {
    it('strips the "owner" role even when injected via WorkOS metadata', async () => {
      const token = await service.generateToken(
        DB_USER_ID,
        makeWorkOSUser({ metadata: { roles: ['owner', 'user'] } } as never),
      );

      const user = service.validateToken(token);
      expect(user.roles).toEqual(['user']);
      expect(user.roles).not.toContain('owner');
    });

    it('strips arbitrary unknown roles', async () => {
      const token = await service.generateToken(
        DB_USER_ID,
        makeWorkOSUser({
          metadata: { roles: ['god', 'superadmin', 'user'] },
        } as never),
      );

      const user = service.validateToken(token);
      expect(user.roles).toEqual(['user']);
    });

    it('defaults to ["user"] when metadata.roles is absent or empty', async () => {
      const token = await service.generateToken(DB_USER_ID, makeWorkOSUser());

      const user = service.validateToken(token);
      expect(user.roles).toEqual(['user']);
    });

    it('accepts "admin" when present in metadata', async () => {
      const token = await service.generateToken(
        DB_USER_ID,
        makeWorkOSUser({
          metadata: { roles: ['admin', 'user'] },
        } as never),
      );

      const user = service.validateToken(token);
      expect(user.roles).toEqual(expect.arrayContaining(['admin', 'user']));
    });

    it('derives permissions purely from allowlisted roles — never from metadata', async () => {
      const token = await service.generateToken(
        DB_USER_ID,
        makeWorkOSUser({
          metadata: {
            roles: ['user'],
            permissions: ['manage:users', 'delete:*'], // injected but ignored
          },
        } as never),
      );

      const user = service.validateToken(token);
      expect(user.permissions).toEqual(['read:docs', 'write:docs']);
      expect(user.permissions).not.toContain('manage:users');
      expect(user.permissions).not.toContain('delete:*');
    });
  });

  // ==========================================================================
  // TIER DETERMINATION
  // ==========================================================================

  describe('determineTier', () => {
    it('returns "pro" for an active subscription', async () => {
      prisma.subscription.findFirst.mockResolvedValueOnce({
        status: 'active',
      });

      const user = await service.mapWorkOSUserToRequestUser(
        makeWorkOSUser(),
        undefined,
        DB_USER_ID,
      );
      expect(user.tier).toBe('pro');
    });

    it('returns "trial_pro" for a trialing subscription', async () => {
      prisma.subscription.findFirst.mockResolvedValueOnce({
        status: 'trialing',
      });

      const user = await service.mapWorkOSUserToRequestUser(
        makeWorkOSUser(),
        undefined,
        DB_USER_ID,
      );
      expect(user.tier).toBe('trial_pro');
    });

    it('returns "expired" for a past_due subscription', async () => {
      prisma.subscription.findFirst.mockResolvedValueOnce({
        status: 'past_due',
      });

      const user = await service.mapWorkOSUserToRequestUser(
        makeWorkOSUser(),
        undefined,
        DB_USER_ID,
      );
      expect(user.tier).toBe('expired');
    });

    it('falls back to an active pro license when no subscription exists', async () => {
      prisma.subscription.findFirst.mockResolvedValueOnce(null);
      prisma.license.findFirst.mockResolvedValueOnce({
        status: 'active',
        plan: 'pro',
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      });

      const user = await service.mapWorkOSUserToRequestUser(
        makeWorkOSUser(),
        undefined,
        DB_USER_ID,
      );
      expect(user.tier).toBe('pro');
    });

    it('marks a date-expired pro license as "expired"', async () => {
      prisma.subscription.findFirst.mockResolvedValueOnce(null);
      prisma.license.findFirst.mockResolvedValueOnce({
        status: 'active',
        plan: 'pro',
        expiresAt: new Date('2020-01-01T00:00:00Z'), // past
      });

      const user = await service.mapWorkOSUserToRequestUser(
        makeWorkOSUser(),
        undefined,
        DB_USER_ID,
      );
      expect(user.tier).toBe('expired');
    });

    it('returns "expired" for a revoked license', async () => {
      prisma.subscription.findFirst.mockResolvedValueOnce(null);
      prisma.license.findFirst.mockResolvedValueOnce({
        status: 'revoked',
        plan: 'pro',
      });

      const user = await service.mapWorkOSUserToRequestUser(
        makeWorkOSUser(),
        undefined,
        DB_USER_ID,
      );
      expect(user.tier).toBe('expired');
    });

    it('returns "community" for an active community license', async () => {
      prisma.subscription.findFirst.mockResolvedValueOnce(null);
      prisma.license.findFirst.mockResolvedValueOnce({
        status: 'active',
        plan: 'community',
      });

      const user = await service.mapWorkOSUserToRequestUser(
        makeWorkOSUser(),
        undefined,
        DB_USER_ID,
      );
      expect(user.tier).toBe('community');
    });

    it('defaults to "community" when neither subscription nor license exists', async () => {
      // Defaults already seeded in beforeEach.
      const user = await service.mapWorkOSUserToRequestUser(
        makeWorkOSUser(),
        undefined,
        DB_USER_ID,
      );
      expect(user.tier).toBe('community');
    });

    it('propagates DB errors — never silently degrades a Pro user', async () => {
      prisma.subscription.findFirst.mockRejectedValueOnce(
        new Error('db connection lost'),
      );

      await expect(
        service.mapWorkOSUserToRequestUser(
          makeWorkOSUser(),
          undefined,
          DB_USER_ID,
        ),
      ).rejects.toThrow('db connection lost');
    });
  });

  // ==========================================================================
  // mapWorkOSUserToRequestUser
  // ==========================================================================

  describe('mapWorkOSUserToRequestUser', () => {
    it('prefers databaseUserId when provided', async () => {
      const user = await service.mapWorkOSUserToRequestUser(
        makeWorkOSUser(),
        undefined,
        DB_USER_ID,
      );
      expect(user.id).toBe(DB_USER_ID);
    });

    it('falls back to WorkOS id when databaseUserId is absent', async () => {
      const user = await service.mapWorkOSUserToRequestUser(makeWorkOSUser());
      expect(user.id).toBe(WORKOS_USER_ID);
    });

    it('derives tenantId from organizationId when present', async () => {
      const user = await service.mapWorkOSUserToRequestUser(
        makeWorkOSUser(),
        'org_BIGCORP',
        DB_USER_ID,
      );
      expect(user.tenantId).toBe('org_BIGCORP');
    });

    it('falls back to user_<id> tenantId when no organization', async () => {
      const user = await service.mapWorkOSUserToRequestUser(
        makeWorkOSUser(),
        undefined,
        DB_USER_ID,
      );
      expect(user.tenantId).toBe(`user_${DB_USER_ID}`);
    });
  });

  // ==========================================================================
  // generateTokenFromPayload
  // ==========================================================================

  describe('generateTokenFromPayload', () => {
    it('signs an arbitrary payload and verifies back', () => {
      const token = service.generateTokenFromPayload({
        sub: DB_USER_ID,
        email: 'u@example.com',
        tenantId: 't',
        roles: ['user'],
        permissions: ['read:docs'],
        tier: 'community',
      });

      const user = service.validateToken(token);
      expect(user.id).toBe(DB_USER_ID);
      expect(user.email).toBe('u@example.com');
    });
  });
});
