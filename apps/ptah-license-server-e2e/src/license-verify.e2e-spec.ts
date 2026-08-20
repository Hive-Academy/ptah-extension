/**
 * License-verify end-to-end spec — TASK_2025_294 W1.B6.3.
 *
 * Exercises the full `POST /v1/licenses/verify` + `GET /v1/licenses/me`
 * money paths through the real `LicenseController` + real
 * `LicenseService`, with only the data boundary (Prisma) and orthogonal
 * side-effect services (Events / AuditLog / Email) stubbed.
 *
 * Coverage:
 *   - /verify — valid Builders license (wall-clock expiry > now)
 *   - /verify — expired license (expiresAt < now) → tier=expired, reason=expired
 *   - /verify — revoked license → tier=expired, reason=revoked
 *   - /verify — not-found license → tier=expired, reason=not_found
 *   - /verify — retired legacy 'pro' plan mapped to expired tier
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
import type { ConfigService } from '@nestjs/config';

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
const LEGACY_PRO_KEY = 'ptah_lic_' + 'b'.repeat(64);
const EXPIRED_KEY = 'ptah_lic_' + 'c'.repeat(64);
const REVOKED_KEY = 'ptah_lic_' + 'd'.repeat(64);
const UNKNOWN_KEY = 'ptah_lic_' + 'e'.repeat(64);
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
    plan: 'builders',
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
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;
  const controller = new LicenseController(
    service,
    prisma as unknown as PrismaService,
    config,
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

  it('returns {valid, tier: builders} for an active Builders license that has not expired', async () => {
    prisma.license.findUnique.mockResolvedValueOnce(
      makeLicense({ licenseKey: VALID_KEY }),
    );

    const result = await harness.controller.verify({ licenseKey: VALID_KEY });

    expect(result.valid).toBe(true);
    expect(result.tier).toBe('builders');
    expect(result.user).toEqual({
      email: USER.email,
      firstName: USER.firstName,
      lastName: USER.lastName,
    });
    expect(result.signature).toBeUndefined();
    expect(prisma.license.findUnique).toHaveBeenCalledWith({
      where: { licenseKey: VALID_KEY },
      include: expect.any(Object),
    });
  });

  it('treats a retired legacy pro plan as {valid:false, tier:expired}', async () => {
    prisma.license.findUnique.mockResolvedValueOnce(
      makeLicense({ licenseKey: LEGACY_PRO_KEY, plan: 'pro' }),
    );

    const result = await harness.controller.verify({
      licenseKey: LEGACY_PRO_KEY,
    });

    expect(result).toMatchObject({
      valid: false,
      tier: 'expired',
      reason: 'expired',
    });
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

  it('returns account details for an authenticated Builders member WITHOUT the raw licenseKey', async () => {
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
      plan: 'builders',
      status: 'active',
      expiresAt: new Date('2026-12-01T00:00:00Z'),
      createdAt: new Date('2025-12-01T00:00:00Z'),
    });

    const result = (await harness.controller.getMyLicense(
      makeAuthedReq(),
    )) as Record<string, unknown>;

    expect(result['plan']).toBe('builders');
    expect(result['status']).toBe('active');
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
});
