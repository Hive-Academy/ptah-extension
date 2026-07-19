import type { Request } from 'express';
import type { ConfigService } from '@nestjs/config';
import { LicenseService } from '../services/license.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VerifyLicenseDto } from '../dto/verify-license.dto';
import {
  createMockPrisma,
  MockPrisma,
} from '../../testing/mock-prisma.factory';
import { LicenseController } from './license.controller';
import type { MemberGroupsService } from '../../member-groups/member-groups.service';

function makeMemberGroups(
  groups: Array<{ key: string; name: string }> = [],
): jest.Mocked<Pick<MemberGroupsService, 'getGroupsForUser'>> {
  return {
    getGroupsForUser: jest.fn().mockResolvedValue(groups),
  } as unknown as jest.Mocked<Pick<MemberGroupsService, 'getGroupsForUser'>>;
}

/**
 * Unit tests for LicenseController (TASK_2025_294 W1.B4).
 *
 * Strategy: instantiate the controller directly with a mocked LicenseService
 * and a typed MockPrisma. The JwtAuthGuard-protected endpoints get their
 * `req.user` populated by the guard in production; here we set it directly
 * on a request stub. Guard behaviour is validated separately in
 * `jwt-auth.guard.spec.ts`.
 *
 * Endpoints covered:
 *   - POST /v1/licenses/verify — public verification
 *   - GET /v1/licenses/me — authenticated account details
 *   - POST /v1/licenses/me/reveal-key — rate-limited key reveal
 *
 * Security invariant tested on reveal-key AND getMyLicense: responses for
 * /me MUST NOT contain the raw license key.
 */

function makeAuthedReq(
  user: { id: string; email: string } = {
    id: 'user-1',
    email: 'alice@example.com',
  },
): Request {
  return { user } as unknown as Request;
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Doe',
    emailVerified: true,
    createdAt: new Date('2025-12-01T00:00:00Z'),
    subscriptions: [] as unknown[],
    ...overrides,
  };
}

function makeLicense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'license-1',
    userId: 'user-1',
    licenseKey: 'ptah_lic_' + 'a'.repeat(64),
    plan: 'builders',
    status: 'active',
    expiresAt: null as Date | null,
    createdAt: new Date('2025-12-01T00:00:00Z'),
    ...overrides,
  };
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    status: 'active',
    priceId: 'price_builders_monthly',
    trialEnd: null as Date | null,
    currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
    canceledAt: null as Date | null,
    ...overrides,
  };
}

describe('LicenseController', () => {
  let licenseService: jest.Mocked<LicenseService>;
  let prisma: MockPrisma;
  let controller: LicenseController;
  let memberGroups: jest.Mocked<Pick<MemberGroupsService, 'getGroupsForUser'>>;

  beforeEach(() => {
    licenseService = {
      verifyLicense: jest.fn(),
    } as unknown as jest.Mocked<LicenseService>;
    prisma = createMockPrisma();
    memberGroups = makeMemberGroups();
    // ConfigService stub: BUILDERS_CHECKOUT_ENABLED unset ⇒ checkoutEnabled=false.
    const configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;
    controller = new LicenseController(
      licenseService,
      prisma as unknown as PrismaService,
      configService,
      memberGroups as unknown as MemberGroupsService,
    );
  });

  // ───────────────────────────────────────────────────────────────
  // POST /v1/licenses/verify
  // ───────────────────────────────────────────────────────────────
  describe('POST /verify (public)', () => {
    it('delegates to LicenseService.verifyLicense with the DTO key', async () => {
      const dto: VerifyLicenseDto = {
        licenseKey: 'ptah_lic_' + 'a'.repeat(64),
      };
      const response = {
        valid: true as const,
        tier: 'builders' as const,
      };
      // Cast: verifyLicense has a rich union return shape; test only cares
      // the response flows through untouched.
      licenseService.verifyLicense.mockResolvedValueOnce(
        response as unknown as Awaited<
          ReturnType<LicenseService['verifyLicense']>
        >,
      );

      const result = await controller.verify(dto);

      expect(licenseService.verifyLicense).toHaveBeenCalledWith(dto.licenseKey);
      expect(result).toBe(response);
    });

    it('propagates the "not_found" response from the service unchanged', async () => {
      const response = {
        valid: false as const,
        tier: 'expired' as const,
        reason: 'not_found' as const,
      };
      licenseService.verifyLicense.mockResolvedValueOnce(
        response as unknown as Awaited<
          ReturnType<LicenseService['verifyLicense']>
        >,
      );

      const result = await controller.verify({
        licenseKey: 'ptah_lic_' + 'b'.repeat(64),
      });

      expect(result).toEqual(response);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // GET /v1/licenses/me
  // ───────────────────────────────────────────────────────────────
  describe('GET /me (authenticated)', () => {
    it('returns "User not found" shape when user row is missing', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      const result = await controller.getMyLicense(makeAuthedReq());

      expect(result).toEqual({
        plan: null,
        status: 'none',
        message: 'User not found',
        checkoutEnabled: false,
      });
      // Must not even look up the license if user is missing.
      expect(prisma.license.findFirst).not.toHaveBeenCalled();
    });

    it('returns no-active-license response when user exists but has no active license', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(makeUser());
      prisma.license.findFirst.mockResolvedValueOnce(null);

      const result = (await controller.getMyLicense(makeAuthedReq())) as Record<
        string,
        unknown
      >;

      expect(result['plan']).toBeNull();
      expect(result['status']).toBe('none');
      expect(result['features']).toEqual([]);
      expect(result['subscription']).toBeNull();
      expect(result['reason']).toBeUndefined();
      expect(result['message']).toContain('free and open source');
      expect(result['checkoutEnabled']).toBe(false);
    });

    it('returns full account details for an active Builders license (NO licenseKey in response)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [
            makeSubscription({
              status: 'active',
              priceId: 'price_builders_monthly',
            }),
          ],
        }),
      );
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      prisma.license.findFirst.mockResolvedValueOnce(
        makeLicense({ plan: 'builders', expiresAt }),
      );

      const result = (await controller.getMyLicense(makeAuthedReq())) as Record<
        string,
        unknown
      >;

      expect(result['plan']).toBe('builders');
      expect(result['status']).toBe('active');
      expect(result['daysRemaining']).toBeGreaterThan(0);
      expect(result['daysRemaining']).toBeLessThanOrEqual(31);
      expect(result['planName']).toBe('Ptah Builders');
      expect(result['features']).toEqual(
        expect.arrayContaining(['builders_membership']),
      );
      // SECURITY: license key MUST NOT be exposed.
      expect(JSON.stringify(result)).not.toContain('ptah_lic_');
      // Subscription info for real Paddle sub should be present.
      expect(result['subscription']).toMatchObject({ status: 'active' });
    });

    it('surfaces memberGroups ({key,name}) on the active-license response', async () => {
      memberGroups.getGroupsForUser.mockResolvedValueOnce([
        { key: 'founding', name: 'Founding Members' },
      ]);
      prisma.user.findUnique.mockResolvedValueOnce(makeUser());
      prisma.license.findFirst.mockResolvedValueOnce(
        makeLicense({ plan: 'builders', expiresAt: null }),
      );

      const result = (await controller.getMyLicense(makeAuthedReq())) as Record<
        string,
        unknown
      >;

      expect(memberGroups.getGroupsForUser).toHaveBeenCalledWith('user-1');
      expect(result['memberGroups']).toEqual([
        { key: 'founding', name: 'Founding Members' },
      ]);
    });

    it('falls back to an empty memberGroups array when the lookup throws', async () => {
      memberGroups.getGroupsForUser.mockRejectedValueOnce(new Error('db down'));
      prisma.user.findUnique.mockResolvedValueOnce(makeUser());
      prisma.license.findFirst.mockResolvedValueOnce(null);

      const result = (await controller.getMyLicense(makeAuthedReq())) as Record<
        string,
        unknown
      >;

      expect(result['memberGroups']).toEqual([]);
    });

    it('sets reason="expired" when license.expiresAt is in the past', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [makeSubscription({ status: 'active' })],
        }),
      );
      prisma.license.findFirst.mockResolvedValueOnce(
        makeLicense({
          plan: 'builders',
          expiresAt: new Date('2024-01-01T00:00:00Z'),
        }),
      );

      const result = (await controller.getMyLicense(makeAuthedReq())) as Record<
        string,
        unknown
      >;

      expect(result['reason']).toBe('expired');
    });

    it('excludes an expired subscription from the response', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [makeSubscription({ status: 'expired' })],
        }),
      );
      prisma.license.findFirst.mockResolvedValueOnce(
        makeLicense({ plan: 'community' }),
      );

      const result = (await controller.getMyLicense(makeAuthedReq())) as Record<
        string,
        unknown
      >;

      expect(result['subscription']).toBeNull();
    });

    it('falls back to community plan config when license.plan is unknown', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(makeUser());
      prisma.license.findFirst.mockResolvedValueOnce(
        makeLicense({ plan: 'enterprise' }),
      );

      const result = (await controller.getMyLicense(makeAuthedReq())) as Record<
        string,
        unknown
      >;

      // planName falls back to 'Community' (safe fallback for unknown plans).
      expect(result['planName']).toBe('Community');
    });

    it('resolves a Builders license and mirrors checkoutEnabled from the flag', async () => {
      const configService = {
        get: jest.fn((key: string) =>
          key === 'BUILDERS_CHECKOUT_ENABLED' ? 'true' : undefined,
        ),
      } as unknown as ConfigService;
      controller = new LicenseController(
        licenseService,
        prisma as unknown as PrismaService,
        configService,
      );
      prisma.user.findUnique.mockResolvedValueOnce(makeUser());
      prisma.license.findFirst.mockResolvedValueOnce(
        makeLicense({ plan: 'builders', expiresAt: null }),
      );

      const result = (await controller.getMyLicense(makeAuthedReq())) as Record<
        string,
        unknown
      >;

      expect(result['plan']).toBe('builders');
      expect(result['planName']).toBe('Ptah Builders');
      expect(result['checkoutEnabled']).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────
  // POST /v1/licenses/me/reveal-key
  // ───────────────────────────────────────────────────────────────
  describe('POST /me/reveal-key (authenticated, rate limited)', () => {
    it('returns licenseKey + plan when user has an active license', async () => {
      prisma.license.findFirst.mockResolvedValueOnce({
        id: 'license-1',
        licenseKey: 'ptah_lic_' + 'x'.repeat(64),
        plan: 'builders',
      });

      const result = await controller.revealMyLicenseKey(makeAuthedReq());

      expect(result).toEqual({
        success: true,
        licenseKey: 'ptah_lic_' + 'x'.repeat(64),
        plan: 'builders',
      });

      // The query must explicitly select only id/licenseKey/plan to avoid
      // accidentally exposing other license fields.
      expect(prisma.license.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', status: 'active' },
          select: { id: true, licenseKey: true, plan: true },
        }),
      );
    });

    it('returns success=false when no active license exists', async () => {
      prisma.license.findFirst.mockResolvedValueOnce(null);

      const result = await controller.revealMyLicenseKey(makeAuthedReq());

      expect(result).toEqual({
        success: false,
        message: 'No active license found',
      });
      // No key in failure response.
      expect(JSON.stringify(result)).not.toContain('ptah_lic_');
    });

    it('queries licenses filtered by the authenticated userId (not email)', async () => {
      prisma.license.findFirst.mockResolvedValueOnce(null);

      await controller.revealMyLicenseKey(
        makeAuthedReq({ id: 'user-abc', email: 'bob@example.com' }),
      );

      const call = prisma.license.findFirst.mock.calls[0][0] as {
        where: { userId: string; status: string };
      };
      expect(call.where.userId).toBe('user-abc');
      expect(call.where.status).toBe('active');
    });
  });
});
