/**
 * License-verify end-to-end spec — TASK_2025_294 W1.B6.3.
 *
 * Exercises the full `POST /v1/licenses/verify` + `GET /v1/licenses/me`
 * money paths through the real `LicenseController` + real
 * `LicenseService`, with only the data boundary (Prisma) and orthogonal
 * side-effect services (Events / AuditLog / Email) stubbed.
 *
 * Coverage:
 *   - /verify — valid Pro license (wall-clock expiry > now)
 *   - /verify — trial license (subscription.status === 'trialing')
 *   - /verify — expired license (expiresAt < now) → tier=expired, reason=expired
 *   - /verify — revoked license → tier=expired, reason=revoked
 *   - /verify — not-found license → tier=expired, reason=not_found
 *   - /verify — trial_ended (subscription.trialEnd < now) → reason=trial_ended
 *   - /verify — unknown plan mapped to expired tier
 *   - /me — JwtAuthGuard attaches req.user; controller returns non-secret payload
 *   - /me — response NEVER includes the raw licenseKey (TASK_2025_129 invariant)
 *
 * Testcontainers / supertest: see `paddle-webhook.e2e-spec.ts` header.
 * The response-signing path (Ed25519 via LICENSE_SIGNING_PRIVATE_KEY)
 * is intentionally left DISABLED here — `LicenseService.getSigningKey`
 * returns undefined when the env var is missing, which is the default
 * in CI, so `signature` is omitted from responses (graceful degradation).
 */

import 'reflect-metadata';
import type { Request } from 'express';

import { LicenseController } from '../../ptah-license-server/src/license/controllers/license.controller';
import { LicenseService } from '../../ptah-license-server/src/license/services/license.service';
import { PrismaService } from '../../ptah-license-server/src/prisma/prisma.service';
import { EventsService } from '../../ptah-license-server/src/events/events.service';
import { AuditLogService } from '../../ptah-license-server/src/audit/audit-log.service';
import { EmailService } from '../../ptah-license-server/src/email/services/email.service';
import {
  createMockPrisma,
  type MockPrisma,
} from '../../ptah-license-server/src/testing/mock-prisma.factory';

const VALID_KEY = 'ptah_lic_' + 'a'.repeat(64);
const TRIAL_KEY = 'ptah_lic_' + 'b'.repeat(64);
const EXPIRED_KEY = 'ptah_lic_' + 'c'.repeat(64);
const REVOKED_KEY = 'ptah_lic_' + 'd'.repeat(64);
const UNKNOWN_KEY = 'ptah_lic_' + 'e'.repeat(64);
const TRIAL_ENDED_KEY = 'ptah_lic_' + 'f'.repeat(64);
const STRANGE_PLAN_KEY = 'ptah_lic_' + '9'.repeat(64);

const USER = {
  id: 'user-1',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Doe',
  emailVerified: true,
  createdAt: new Date('2025-12-01T00:00:00Z'),
};

function makeLicense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'license-1',
    userId: USER.id,
    licenseKey: VALID_KEY,
    plan: 'pro',
    status: 'active',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30d
    createdAt: new Date('2025-12-01T00:00:00Z'),
    user: {
      ...USER,
      subscriptions: [] as unknown[],
    },
    ...overrides,
  };
}

function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    status: 'active' as string,
    priceId: 'price_pro_monthly',
    trialEnd: null as Date | null,
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    canceledAt: null as Date | null,
    createdAt: new Date('2025-12-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Build the verify harness: real LicenseService + real LicenseController
 * wired over a MockPrisma. Ensures no Ed25519 key is configured so the
 * signing branch stays disabled (deterministic + Windows-CI friendly).
 */
function buildHarness() {
  const prisma = createMockPrisma();

  // Orthogonal collaborators are no-ops for the verify/me paths.
  const events = {
    emitLicenseUpdated: jest.fn(),
    emitSubscriptionUpdated: jest.fn(),
  } as unknown as EventsService;
  const audit = {
    write: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogService;
  const email = {
    sendLicenseKey: jest.fn().mockResolvedValue(undefined),
  } as unknown as EmailService;

  const originalSigningKey = process.env['LICENSE_SIGNING_PRIVATE_KEY'];
  delete process.env['LICENSE_SIGNING_PRIVATE_KEY'];

  const service = new LicenseService(
    prisma as unknown as PrismaService,
    events,
    audit,
    email,
  );
  const controller = new LicenseController(
    service,
    prisma as unknown as PrismaService,
  );

  const restoreEnv = () => {
    if (originalSigningKey !== undefined) {
      process.env['LICENSE_SIGNING_PRIVATE_KEY'] = originalSigningKey;
    }
  };

  return { controller, service, prisma, restoreEnv };
}

function makeAuthedReq(): Request {
  return { user: { id: USER.id, email: USER.email } } as unknown as Request;
}

describe('license-verify e2e :: POST /v1/licenses/verify', () => {
  let harness: ReturnType<typeof buildHarness>;
  let prisma: MockPrisma;

  beforeEach(() => {
    harness = buildHarness();
    prisma = harness.prisma;
  });

  afterEach(() => {
    harness.restoreEnv();
    jest.restoreAllMocks();
  });

  it('returns {valid, tier: pro} for an active Pro license that has not expired', async () => {
    prisma.license.findUnique.mockResolvedValueOnce(
      makeLicense({ licenseKey: VALID_KEY }),
    );

    const result = await harness.controller.verify({ licenseKey: VALID_KEY });

    expect(result.valid).toBe(true);
    expect(result.tier).toBe('pro');
    expect(result.trialActive).toBeFalsy();
    expect(result.user).toEqual({
      email: USER.email,
      firstName: USER.firstName,
      lastName: USER.lastName,
    });
    // Signing disabled in CI — signature must NOT be attached.
    expect(result.signature).toBeUndefined();
    expect(prisma.license.findUnique).toHaveBeenCalledWith({
      where: { licenseKey: VALID_KEY },
      include: expect.any(Object),
    });
  });

  it('returns {valid, tier: trial_pro, trialActive: true} for an active trial', async () => {
    const in50d = new Date(Date.now() + 50 * 24 * 60 * 60 * 1000);
    prisma.license.findUnique.mockResolvedValueOnce(
      makeLicense({
        licenseKey: TRIAL_KEY,
        plan: 'pro',
        expiresAt: in50d,
        user: {
          ...USER,
          subscriptions: [
            makeSubscription({ status: 'trialing', trialEnd: in50d }),
          ],
        },
      }),
    );

    const result = await harness.controller.verify({ licenseKey: TRIAL_KEY });

    expect(result.valid).toBe(true);
    expect(result.tier).toBe('trial_pro');
    expect(result.trialActive).toBe(true);
    expect(result.trialDaysRemaining).toBeGreaterThan(0);
    expect(result.trialDaysRemaining).toBeLessThanOrEqual(50);
  });

  it('rejects expired licenses with {valid:false, tier:expired, reason:expired}', async () => {
    prisma.license.findUnique.mockResolvedValueOnce(
      makeLicense({
        licenseKey: EXPIRED_KEY,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // yesterday
      }),
    );

    const result = await harness.controller.verify({ licenseKey: EXPIRED_KEY });

    expect(result).toMatchObject({
      valid: false,
      tier: 'expired',
      reason: 'expired',
    });
  });

  it('rejects revoked licenses with {valid:false, tier:expired, reason:revoked}', async () => {
    prisma.license.findUnique.mockResolvedValueOnce(
      makeLicense({ licenseKey: REVOKED_KEY, status: 'revoked' }),
    );

    const result = await harness.controller.verify({ licenseKey: REVOKED_KEY });

    expect(result).toMatchObject({
      valid: false,
      tier: 'expired',
      reason: 'revoked',
    });
  });

  it('returns {valid:false, reason:not_found} when the license does not exist', async () => {
    prisma.license.findUnique.mockResolvedValueOnce(null);

    const result = await harness.controller.verify({ licenseKey: UNKNOWN_KEY });

    expect(result).toMatchObject({
      valid: false,
      tier: 'expired',
      reason: 'not_found',
    });
  });

  it('rejects trials whose trialEnd has passed with reason:trial_ended', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    prisma.license.findUnique.mockResolvedValueOnce(
      makeLicense({
        licenseKey: TRIAL_ENDED_KEY,
        plan: 'pro',
        // License itself hasn't hit its expiresAt yet — but the
        // subscription trial window has elapsed.
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        user: {
          ...USER,
          subscriptions: [
            makeSubscription({ status: 'trialing', trialEnd: yesterday }),
          ],
        },
      }),
    );

    const result = await harness.controller.verify({
      licenseKey: TRIAL_ENDED_KEY,
    });

    expect(result).toMatchObject({
      valid: false,
      tier: 'expired',
      reason: 'trial_ended',
    });
  });

  it('maps unknown plan values to tier:expired (defensive fallback)', async () => {
    prisma.license.findUnique.mockResolvedValueOnce(
      makeLicense({
        licenseKey: STRANGE_PLAN_KEY,
        plan: 'enterprise-xxl', // not in PLANS
      }),
    );

    const result = await harness.controller.verify({
      licenseKey: STRANGE_PLAN_KEY,
    });

    expect(result).toMatchObject({
      valid: false,
      tier: 'expired',
      reason: 'expired',
    });
  });
});

describe('license-verify e2e :: GET /v1/licenses/me (JWT-guarded)', () => {
  let harness: ReturnType<typeof buildHarness>;
  let prisma: MockPrisma;

  beforeEach(() => {
    harness = buildHarness();
    prisma = harness.prisma;
  });

  afterEach(() => {
    harness.restoreEnv();
  });

  it('returns account details for an authenticated Pro user WITHOUT the raw licenseKey', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      ...USER,
      subscriptions: [
        makeSubscription({
          status: 'active',
          currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
        }),
      ],
    });
    prisma.license.findFirst.mockResolvedValueOnce({
      id: 'license-1',
      userId: USER.id,
      licenseKey: VALID_KEY,
      plan: 'pro',
      status: 'active',
      expiresAt: new Date('2026-12-01T00:00:00Z'),
      createdAt: new Date('2025-12-01T00:00:00Z'),
    });

    const result = (await harness.controller.getMyLicense(
      makeAuthedReq(),
    )) as Record<string, unknown>;

    expect(result['plan']).toBe('pro');
    expect(result['status']).toBe('active');
    // CRITICAL: /me must NEVER return the raw key (reveal-key is a separate
    // strictly rate-limited endpoint).
    expect(JSON.stringify(result)).not.toContain(VALID_KEY);
    expect(result['licenseKey']).toBeUndefined();
  });

  it('returns {plan:null,status:none} when the user has no active license', async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      ...USER,
      subscriptions: [],
    });
    prisma.license.findFirst.mockResolvedValueOnce(null);

    const result = (await harness.controller.getMyLicense(
      makeAuthedReq(),
    )) as Record<string, unknown>;

    expect(result['plan']).toBeNull();
    expect(result['status']).toBe('none');
    expect(result['features']).toEqual([]);
  });

  it('surfaces reason:trial_ended when the subscription trial window has elapsed', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    prisma.user.findUnique.mockResolvedValueOnce({
      ...USER,
      subscriptions: [
        makeSubscription({ status: 'trialing', trialEnd: yesterday }),
      ],
    });
    prisma.license.findFirst.mockResolvedValueOnce(null);

    const result = (await harness.controller.getMyLicense(
      makeAuthedReq(),
    )) as Record<string, unknown>;

    expect(result['reason']).toBe('trial_ended');
    expect(result['status']).toBe('none');
  });
});
