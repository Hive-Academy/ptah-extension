import { BadRequestException, ConflictException } from '@nestjs/common';
import { LicenseService, AdminActor } from './license.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsService } from '../../events/events.service';
import { AuditLogService } from '../../audit/audit-log.service';
import { EmailService } from '../../email/services/email.service';
import type { IssueComplimentaryLicenseDto } from '../dto/issue-complimentary-license.dto';

/**
 * F3 — Complimentary License integration tests (TASK_2025_292 B7-T02).
 *
 * Covers the contract surface called out in task-description §8 F3:
 *   - Duration presets 30d / 1y / 5y / never / custom map to correct expiresAt.
 *   - Custom-date validation: missing / past / non-ISO rejected with 400.
 *   - License row persisted with `source: 'complimentary'` (paddle reconciliation
 *     filters by `source !== 'complimentary'`).
 *   - AdminAuditLog row written inside the same Prisma transaction that creates
 *     the license (R8 atomicity).
 *   - Pre-conflict check explicitly filters `source: { not: 'complimentary' }`
 *     so paddle reconciliation queries that rely on the same predicate are
 *     guarded by a corresponding test contract.
 *
 * Strategy mirrors `admin.service.spec.ts`: a thin Prisma mock with a
 * callback-aware `$transaction` stub so the service's tx-aware code path
 * executes its inner branch and we can inspect the `tx` handle threaded into
 * `auditLog.write`.
 */

interface MockPrisma {
  user: { findUnique: jest.Mock };
  license: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    user: { findUnique: jest.fn() },
    license: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: MockPrisma) => Promise<unknown>)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  return prisma;
}

const ACTOR: AdminActor = {
  email: 'admin@ptah.live',
  ip: '10.0.0.1',
  userAgent: 'jest',
};

const USER_ID = '00000000-0000-0000-0000-000000000abc';
const TEST_USER = {
  id: USER_ID,
  email: 'gift-recipient@example.com',
  firstName: 'Gift',
  lastName: 'Recipient',
};

describe('LicenseService.createComplimentaryLicense', () => {
  let prisma: MockPrisma;
  let events: jest.Mocked<EventsService>;
  let auditLog: jest.Mocked<AuditLogService>;
  let emailService: jest.Mocked<EmailService>;
  let service: LicenseService;

  beforeEach(() => {
    prisma = createMockPrisma();
    events = {
      emitLicenseEvent: jest.fn(),
    } as unknown as jest.Mocked<EventsService>;
    auditLog = {
      write: jest.fn().mockResolvedValue('audit-row-1'),
    } as unknown as jest.Mocked<AuditLogService>;
    emailService = {
      sendLicenseKey: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EmailService>;

    prisma.user.findUnique.mockResolvedValue(TEST_USER);
    prisma.license.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'license-1',
        ...data,
      }),
    );

    service = new LicenseService(
      prisma as unknown as PrismaService,
      events,
      auditLog,
      emailService,
    );
  });

  function makeDto(
    overrides: Partial<IssueComplimentaryLicenseDto> = {},
  ): IssueComplimentaryLicenseDto {
    return {
      userId: USER_ID,
      durationPreset: '30d',
      plan: 'pro',
      reason: 'Beta tester reward',
      sendEmail: false,
      ...overrides,
    } as IssueComplimentaryLicenseDto;
  }

  // ===========================================================================
  // Duration presets — expiresAt computation
  // ===========================================================================

  describe('duration presets', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const TOLERANCE_MS = 5 * 1000; // generous for slow CI

    it('30d preset → expiresAt is ~30 days from now and source = complimentary', async () => {
      const before = Date.now();
      const result = await service.createComplimentaryLicense(
        makeDto({ durationPreset: '30d' }),
        ACTOR,
      );
      const after = Date.now();

      const createArg = prisma.license.create.mock.calls[0][0];
      expect(createArg.data.source).toBe('complimentary');
      expect(createArg.data.plan).toBe('pro');
      expect(createArg.data.status).toBe('active');
      expect(createArg.data.createdBy).toBe('admin@ptah.live');
      expect(createArg.data.licenseKey).toMatch(/^ptah_lic_[0-9a-f]{64}$/);

      const expiresAt: Date = createArg.data.expiresAt;
      expect(expiresAt).toBeInstanceOf(Date);
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + 30 * DAY_MS - TOLERANCE_MS,
      );
      expect(expiresAt.getTime()).toBeLessThanOrEqual(
        after + 30 * DAY_MS + TOLERANCE_MS,
      );

      expect(result.license.id).toBe('license-1');
      expect(result.warning).toBeUndefined();
    });

    it('1y preset → expiresAt is ~365 days from now', async () => {
      const before = Date.now();
      await service.createComplimentaryLicense(
        makeDto({ durationPreset: '1y' }),
        ACTOR,
      );
      const after = Date.now();

      const expiresAt: Date =
        prisma.license.create.mock.calls[0][0].data.expiresAt;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + 365 * DAY_MS - TOLERANCE_MS,
      );
      expect(expiresAt.getTime()).toBeLessThanOrEqual(
        after + 365 * DAY_MS + TOLERANCE_MS,
      );
    });

    it('5y preset → expiresAt is ~5*365 days from now', async () => {
      const before = Date.now();
      await service.createComplimentaryLicense(
        makeDto({ durationPreset: '5y' }),
        ACTOR,
      );
      const after = Date.now();

      const expiresAt: Date =
        prisma.license.create.mock.calls[0][0].data.expiresAt;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + 5 * 365 * DAY_MS - TOLERANCE_MS,
      );
      expect(expiresAt.getTime()).toBeLessThanOrEqual(
        after + 5 * 365 * DAY_MS + TOLERANCE_MS,
      );
    });

    it('never preset → expiresAt is null', async () => {
      await service.createComplimentaryLicense(
        makeDto({ durationPreset: 'never' }),
        ACTOR,
      );
      expect(prisma.license.create.mock.calls[0][0].data.expiresAt).toBeNull();
    });

    it('custom preset with valid future ISO date → uses provided date', async () => {
      const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      await service.createComplimentaryLicense(
        makeDto({
          durationPreset: 'custom',
          customExpiresAt: future.toISOString(),
        }),
        ACTOR,
      );
      const expiresAt: Date =
        prisma.license.create.mock.calls[0][0].data.expiresAt;
      expect(expiresAt.toISOString()).toBe(future.toISOString());
    });
  });

  // ===========================================================================
  // Custom duration validation
  // ===========================================================================

  describe('custom duration validation', () => {
    it('rejects past date with 400 INVALID_CUSTOM_DATE', async () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await expect(
        service.createComplimentaryLicense(
          makeDto({ durationPreset: 'custom', customExpiresAt: past }),
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.license.create).not.toHaveBeenCalled();
      expect(auditLog.write).not.toHaveBeenCalled();
    });

    it('rejects "now" (zero delta) — must be strictly in the future', async () => {
      const now = new Date().toISOString();
      await expect(
        service.createComplimentaryLicense(
          makeDto({ durationPreset: 'custom', customExpiresAt: now }),
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects unparseable ISO string', async () => {
      await expect(
        service.createComplimentaryLicense(
          makeDto({
            durationPreset: 'custom',
            customExpiresAt: 'not-a-date',
          }),
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects missing customExpiresAt when preset = custom', async () => {
      await expect(
        service.createComplimentaryLicense(
          makeDto({ durationPreset: 'custom' }),
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    // Service layer accepts any future ISO date — there is no >10y ceiling
    // implemented today. The DTO `@IsISO8601()` is the only structural cap.
    // Regression guard: confirm that a 50-year-out date currently succeeds so
    // when/if a ceiling is added, the test surfaces the new contract.
    it('accepts far-future date (>10y) — no ceiling currently enforced', async () => {
      const farFuture = new Date(
        Date.now() + 50 * 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
      await expect(
        service.createComplimentaryLicense(
          makeDto({
            durationPreset: 'custom',
            customExpiresAt: farFuture,
          }),
          ACTOR,
        ),
      ).resolves.toMatchObject({ license: expect.any(Object) });
    });
  });

  // ===========================================================================
  // Audit log atomicity (R8) + reconciliation source filter (R1)
  // ===========================================================================

  describe('audit + reconciliation contract', () => {
    it('writes audit log inside the same Prisma transaction as license.create', async () => {
      await service.createComplimentaryLicense(makeDto(), ACTOR);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(auditLog.write).toHaveBeenCalledTimes(1);
      expect(prisma.license.create).toHaveBeenCalledTimes(1);

      const writeArg = auditLog.write.mock.calls[0][0];
      expect(writeArg.tx).toBe(prisma); // R8: same handle as license.create
      expect(writeArg.action).toBe('license.complimentary.issue');
      expect(writeArg.targetType).toBe('License');
      expect(writeArg.actorEmail).toBe('admin@ptah.live');
      expect(writeArg.ipAddress).toBe('10.0.0.1');
      expect(writeArg.userAgent).toBe('jest');
      expect(writeArg.metadata).toMatchObject({
        userId: USER_ID,
        userEmail: 'gift-recipient@example.com',
        durationPreset: '30d',
        plan: 'pro',
        reason: 'Beta tester reward',
        stacked: false,
      });
    });

    it('persists source = "complimentary" so paddle reconciliation queries can filter it out', async () => {
      await service.createComplimentaryLicense(makeDto(), ACTOR);

      const createArg = prisma.license.create.mock.calls[0][0];
      expect(createArg.data.source).toBe('complimentary');

      // Sanity check: a reconciliation query of the form
      //   prisma.license.findMany({ where: { source: { not: 'complimentary' } } })
      // would NOT return this row. We assert the column value rather than
      // attempting to model the whole reconciliation pipeline here.
      expect(createArg.data.source).not.toBe('paddle');
    });

    it('R1 — pre-conflict check filters by `source: { not: "complimentary" }` and never calls updateMany', async () => {
      await service.createComplimentaryLicense(makeDto(), ACTOR);

      expect(prisma.license.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: USER_ID,
            status: 'active',
            source: { not: 'complimentary' },
          }),
        }),
      );

      // R1 explicit guard: comp path must NEVER revoke other licenses.
      const updateMany = (
        prisma as unknown as {
          license: { updateMany?: jest.Mock };
        }
      ).license.updateMany;
      expect(updateMany).toBeUndefined(); // not even mocked → never called
    });

    it('blocks with 409 EXISTING_ACTIVE_LICENSE when paid license exists and stackOnTopOfPaid is false', async () => {
      prisma.license.findFirst.mockResolvedValueOnce({
        id: 'existing-paid',
        plan: 'pro',
        source: 'paddle',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      });

      await expect(
        service.createComplimentaryLicense(makeDto(), ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.license.create).not.toHaveBeenCalled();
      expect(auditLog.write).not.toHaveBeenCalled();
    });

    it('skips conflict check entirely when stackOnTopOfPaid: true (no findFirst call)', async () => {
      await service.createComplimentaryLicense(
        makeDto({ stackOnTopOfPaid: true }),
        ACTOR,
      );

      expect(prisma.license.findFirst).not.toHaveBeenCalled();
      expect(prisma.license.create).toHaveBeenCalledTimes(1);
      const writeArg = auditLog.write.mock.calls[0][0];
      expect(writeArg.metadata).toMatchObject({ stacked: true });
    });
  });
});
