import type { Request } from 'express';
import { LicenseService } from '../services/license.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VerifyLicenseDto } from '../dto/verify-license.dto';
import {
  createMockPrisma,
  MockPrisma,
} from '../../testing/mock-prisma.factory';
import { LicenseController } from './license.controller';

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
 *   - POST /v1/licenses/downgrade-to-community — trial-ended downgrade
 *
 * Security invariant tested on reveal-key AND getMyLicense: responses for
 * /me MUST NOT contain the raw license key.
 */

interface AuthenticatedRequestStub {
  user: { id: string; email: string };
}

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
    plan: 'pro',
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
    priceId: 'price_pro_monthly',
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

  beforeEach(() => {
    licenseService = {
      verifyLicense: jest.fn(),
      downgradeToCommunity: jest.fn(),
    } as unknown as jest.Mocked<LicenseService>;
    prisma = createMockPrisma();
    controller = new LicenseController(
      licenseService,
      prisma as unknown as PrismaService,
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
        tier: 'pro' as const,
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
      expect(result['message']).toContain('Start your free trial');
    });

    it('flags trial_ended reason when subscription still "trialing" but past trialEnd', async () => {
      const trialEnd = new Date('2025-11-01T00:00:00Z');
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [makeSubscription({ status: 'trialing', trialEnd })],
        }),
      );
      prisma.license.findFirst.mockResolvedValueOnce(null);

      const result = (await controller.getMyLicense(makeAuthedReq())) as Record<
        string,
        unknown
      >;

      expect(result['reason']).toBe('trial_ended');
      expect(result['message']).toContain('trial has ended');
    });

    it('returns full account details for active Pro license (NO licenseKey in response)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [
            makeSubscription({
              status: 'active',
              priceId: 'price_pro_monthly',
            }),
          ],
        }),
      );
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      prisma.license.findFirst.mockResolvedValueOnce(
        makeLicense({ plan: 'pro', expiresAt }),
      );

      const result = (await controller.getMyLicense(makeAuthedReq())) as Record<
        string,
        unknown
      >;

      expect(result['plan']).toBe('pro');
      expect(result['status']).toBe('active');
      expect(result['daysRemaining']).toBeGreaterThan(0);
      expect(result['daysRemaining']).toBeLessThanOrEqual(31);
      expect(result['planName']).toBe('Pro');
      expect(result['features']).toEqual(
        expect.arrayContaining(['mcp_server', 'workspace_intelligence']),
      );
      // SECURITY: license key MUST NOT be exposed.
      expect(JSON.stringify(result)).not.toContain('ptah_lic_');
      // Subscription info for real Paddle sub should be present.
      expect(result['subscription']).toMatchObject({ status: 'active' });
    });

    it('maps plan="pro" to "trial_pro" when subscription is in trialing state', async () => {
      const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [makeSubscription({ status: 'trialing', trialEnd })],
        }),
      );
      prisma.license.findFirst.mockResolvedValueOnce(
        makeLicense({ plan: 'pro', expiresAt: trialEnd }),
      );

      const result = (await controller.getMyLicense(makeAuthedReq())) as Record<
        string,
        unknown
      >;

      expect(result['plan']).toBe('trial_pro');
      expect(result['reason']).toBeUndefined();
    });

    it('sets reason="expired" when license.expiresAt is in the past (no trial)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [makeSubscription({ status: 'active' })],
        }),
      );
      prisma.license.findFirst.mockResolvedValueOnce(
        makeLicense({
          plan: 'pro',
          expiresAt: new Date('2024-01-01T00:00:00Z'),
        }),
      );

      const result = (await controller.getMyLicense(makeAuthedReq())) as Record<
        string,
        unknown
      >;

      expect(result['reason']).toBe('expired');
    });

    it('excludes internal/expired auto_trial_pro subscription from the response', async () => {
      // Downgraded community users retain a historical trial subscription
      // with priceId=auto_trial_pro — controller must hide it to avoid
      // showing irrelevant billing UI.
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [
            makeSubscription({
              status: 'expired',
              priceId: 'auto_trial_pro',
            }),
          ],
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
        makeLicense({ plan: 'enterprise' as unknown as 'pro' }),
      );

      const result = (await controller.getMyLicense(makeAuthedReq())) as Record<
        string,
        unknown
      >;

      // planName falls back to 'Community' (safe fallback for unknown plans).
      expect(result['planName']).toBe('Community');
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
        plan: 'pro',
      });

      const result = await controller.revealMyLicenseKey(makeAuthedReq());

      expect(result).toEqual({
        success: true,
        licenseKey: 'ptah_lic_' + 'x'.repeat(64),
        plan: 'pro',
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

  // ───────────────────────────────────────────────────────────────
  // POST /v1/licenses/downgrade-to-community
  // ───────────────────────────────────────────────────────────────
  describe('POST /downgrade-to-community (authenticated, rate limited)', () => {
    it('returns "User not found" when user row is missing', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      const result = await controller.downgradeToCommunity(makeAuthedReq());

      expect(result).toEqual({
        success: false,
        message: 'User not found',
      });
      expect(licenseService.downgradeToCommunity).not.toHaveBeenCalled();
    });

    it('refuses downgrade when trial is still active (status=trialing, trialEnd in future)', async () => {
      const trialEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [makeSubscription({ status: 'trialing', trialEnd })],
        }),
      );

      const result = (await controller.downgradeToCommunity(
        makeAuthedReq(),
      )) as { success: boolean; message: string };

      expect(result.success).toBe(false);
      expect(result.message).toMatch(
        /Trial has not ended yet\. You have \d+ day/,
      );
      expect(licenseService.downgradeToCommunity).not.toHaveBeenCalled();
    });

    it('allows downgrade when subscription is "trialing" but past trialEnd (cron not yet run)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [
            makeSubscription({
              status: 'trialing',
              trialEnd: new Date('2024-01-01T00:00:00Z'),
            }),
          ],
        }),
      );
      licenseService.downgradeToCommunity.mockResolvedValueOnce({
        success: true,
        plan: 'community',
        status: 'active',
      });

      const result = (await controller.downgradeToCommunity(
        makeAuthedReq(),
      )) as Record<string, unknown>;

      expect(licenseService.downgradeToCommunity).toHaveBeenCalledWith(
        'user-1',
      );
      expect(result['success']).toBe(true);
      expect(result['plan']).toBe('community');
      expect(result['message']).toBe(
        'Successfully downgraded to Community plan',
      );
    });

    it('allows downgrade when subscription is already "expired" (cron ran)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [makeSubscription({ status: 'expired' })],
        }),
      );
      licenseService.downgradeToCommunity.mockResolvedValueOnce({
        success: true,
        plan: 'community',
        status: 'active',
      });

      const result = (await controller.downgradeToCommunity(
        makeAuthedReq(),
      )) as Record<string, unknown>;

      expect(result['success']).toBe(true);
      expect(licenseService.downgradeToCommunity).toHaveBeenCalledTimes(1);
    });

    it('surfaces "No active license found" when LicenseService rejects with that message', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [makeSubscription({ status: 'expired' })],
        }),
      );
      licenseService.downgradeToCommunity.mockRejectedValueOnce(
        new Error('No active license found'),
      );

      const result = await controller.downgradeToCommunity(makeAuthedReq());

      expect(result).toEqual({
        success: false,
        message: 'No active license found',
      });
    });

    it('returns generic error for unknown LicenseService failures', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [makeSubscription({ status: 'expired' })],
        }),
      );
      licenseService.downgradeToCommunity.mockRejectedValueOnce(
        new Error('DB connection lost'),
      );

      const result = await controller.downgradeToCommunity(makeAuthedReq());

      expect(result).toEqual({
        success: false,
        message: 'Failed to downgrade. Please try again or contact support.',
      });
    });

    it('returns generic error when LicenseService rejects with a non-Error value', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [makeSubscription({ status: 'expired' })],
        }),
      );
      licenseService.downgradeToCommunity.mockRejectedValueOnce(
        'string reject',
      );

      const result = await controller.downgradeToCommunity(makeAuthedReq());

      expect(result).toEqual({
        success: false,
        message: 'Failed to downgrade. Please try again or contact support.',
      });
    });

    it('refuses downgrade when trialEnd is missing and trial still flagged active', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({
          subscriptions: [
            makeSubscription({ status: 'trialing', trialEnd: null }),
          ],
        }),
      );

      const result = (await controller.downgradeToCommunity(
        makeAuthedReq(),
      )) as { success: boolean; message: string };

      expect(result.success).toBe(false);
      expect(result.message).toBe('Trial has not ended yet');
      expect(licenseService.downgradeToCommunity).not.toHaveBeenCalled();
    });
  });
});
