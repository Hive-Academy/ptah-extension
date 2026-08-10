import { BadRequestException, ConflictException } from '@nestjs/common';
import { LicenseService, AdminActor } from './license.service';
import { Prisma, PrismaService } from '@ptah-api/core';
import { EventsService } from '../../events/events.service';
import { AuditLogService } from '@ptah-api/audit';
import { EmailService } from '@ptah-api/email';
import { WaitlistService } from '@ptah-api/marketing';
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
  user: { findUnique: jest.Mock; create: jest.Mock };
  license: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
  $transaction: jest.Mock;
}

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    user: { findUnique: jest.fn(), create: jest.fn() },
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
  let waitlist: jest.Mocked<WaitlistService>;
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
    waitlist = {
      markApproved: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<WaitlistService>;

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
      waitlist,
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

  // ===========================================================================
  // Email recipient path (Early-Adopter approval) + waitlist conversion
  // ===========================================================================

  describe('email recipient path', () => {
    it('find-or-creates the user by lowercased email when no userId is supplied', async () => {
      // No existing user for this email → create is exercised.
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValueOnce({
        ...TEST_USER,
        email: 'new-lead@example.com',
      });

      await service.createComplimentaryLicense(
        makeDto({ userId: undefined, email: 'new-lead@example.com' }),
        ACTOR,
      );

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'new-lead@example.com' },
      });
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: { email: 'new-lead@example.com' },
      });
      expect(prisma.license.create).toHaveBeenCalledTimes(1);
      const createArg = prisma.license.create.mock.calls[0][0];
      expect(createArg.data.userId).toBe(USER_ID);
      expect(createArg.data.source).toBe('complimentary');
    });

    it('reuses the existing user (no create) when the email already resolves', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(TEST_USER);

      await service.createComplimentaryLicense(
        makeDto({ userId: undefined, email: 'gift-recipient@example.com' }),
        ACTOR,
      );

      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.license.create).toHaveBeenCalledTimes(1);
    });

    it('does NOT touch user.create on the userId path', async () => {
      await service.createComplimentaryLicense(makeDto(), ACTOR);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: USER_ID },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Waitlist APPROVAL stamping (best-effort, never fails the grant)
  //
  // TASK_2026_201 R4.3: a gift is not a conversion. This path stamps
  // `approvedAt` via `markApproved`; `convertedAt` is left to the Paddle
  // provisioning fan-out, which is now its only writer.
  // ===========================================================================

  describe('waitlist approval stamping', () => {
    it('stamps the waitlist lead APPROVED with the resolved user email after persist', async () => {
      await service.createComplimentaryLicense(
        makeDto({ userId: undefined, email: 'gift-recipient@example.com' }),
        ACTOR,
      );

      expect(waitlist.markApproved).toHaveBeenCalledTimes(1);
      expect(waitlist.markApproved).toHaveBeenCalledWith(
        'gift-recipient@example.com',
      );
    });

    it('stamps approval on the userId path too (idempotent no-op if not on waitlist)', async () => {
      await service.createComplimentaryLicense(makeDto(), ACTOR);

      expect(waitlist.markApproved).toHaveBeenCalledWith(
        'gift-recipient@example.com',
      );
    });

    it('R4.3 — never stamps convertedAt: markConverted is not called on this path', async () => {
      const markConverted = jest.fn();
      (waitlist as unknown as { markConverted: jest.Mock }).markConverted =
        markConverted;

      await service.createComplimentaryLicense(makeDto(), ACTOR);

      expect(markConverted).not.toHaveBeenCalled();
      expect(waitlist.markApproved).toHaveBeenCalledTimes(1);
    });

    it('swallows a markApproved failure — the persisted grant is still returned', async () => {
      waitlist.markApproved.mockRejectedValueOnce(new Error('db down'));

      const result = await service.createComplimentaryLicense(makeDto(), ACTOR);

      expect(result.license.id).toBe('license-1');
      expect(result.warning).toBeUndefined();
    });
  });

  // ===========================================================================
  // TASK_2026_201 R2 mechanism (b) — the tx-aware core and the whole-transaction
  // retry that must stay OUTSIDE it.
  // ===========================================================================

  describe('issueComplimentaryLicenseTx (the tx-aware core)', () => {
    /**
     * A transaction handle that is a DIFFERENT object from the base client.
     * The suite's shared `$transaction` mock passes `prisma` itself as `tx`
     * (by design — it keeps the pre-existing `prisma.license.*` assertions
     * binding), so identity alone cannot prove a read went through `tx`.
     * Calling the core directly with a distinct handle can.
     */
    function createTxHandle() {
      return {
        user: { findUnique: jest.fn(), create: jest.fn() },
        license: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest
            .fn()
            .mockImplementation(({ data }) =>
              Promise.resolve({ id: 'license-tx-1', ...data }),
            ),
        },
      };
    }

    function coreParams(
      overrides: Record<string, unknown> = {},
    ): Parameters<LicenseService['issueComplimentaryLicenseTx']>[1] {
      return {
        user: TEST_USER,
        plan: 'builders',
        durationPreset: '1y',
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        createdBy: ACTOR.email,
        actor: ACTOR,
        reason: 'Founding cohort approval (waitlist)',
        ...overrides,
      } as Parameters<LicenseService['issueComplimentaryLicenseTx']>[1];
    }

    it('reads the conflict guard through the tx handle, never through this.prisma', async () => {
      const tx = createTxHandle();

      await service.issueComplimentaryLicenseTx(
        tx as unknown as Parameters<
          LicenseService['issueComplimentaryLicenseTx']
        >[0],
        coreParams(),
      );

      expect(tx.license.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: USER_ID,
            status: 'active',
            source: { not: 'complimentary' },
          }),
        }),
      );
      // The TOCTOU window this closes: the guard used to read the base client
      // while the create ran on the transaction.
      expect(prisma.license.findFirst).not.toHaveBeenCalled();
    });

    it('writes the audit row and the licence through the SAME tx handle', async () => {
      const tx = createTxHandle();

      const license = await service.issueComplimentaryLicenseTx(
        tx as unknown as Parameters<
          LicenseService['issueComplimentaryLicenseTx']
        >[0],
        coreParams(),
      );

      expect(auditLog.write).toHaveBeenCalledTimes(1);
      const writeArg = auditLog.write.mock.calls[0][0];
      expect(writeArg.tx).toBe(tx);
      expect(writeArg.action).toBe('license.complimentary.issue');
      expect(writeArg.targetType).toBe('License');
      expect(writeArg.metadata).toMatchObject({
        userId: USER_ID,
        userEmail: 'gift-recipient@example.com',
        durationPreset: '1y',
        expiresAt: '2027-01-01T00:00:00.000Z',
        reason: 'Founding cohort approval (waitlist)',
        plan: 'builders',
        stacked: false,
      });

      expect(tx.license.create).toHaveBeenCalledTimes(1);
      expect(prisma.license.create).not.toHaveBeenCalled();
      const createArg = tx.license.create.mock.calls[0][0];
      expect(createArg.data.source).toBe('complimentary');
      expect(createArg.data.licenseKey).toMatch(/^ptah_lic_[0-9a-f]{64}$/);
      expect(createArg.data.createdBy).toBe(ACTOR.email);
      expect(license.id).toBe('license-tx-1');
    });

    it('never opens a transaction, sends no email and stamps no waitlist row', async () => {
      const tx = createTxHandle();

      await service.issueComplimentaryLicenseTx(
        tx as unknown as Parameters<
          LicenseService['issueComplimentaryLicenseTx']
        >[0],
        coreParams(),
      );

      // Structural suppression: the core has no mail side effect to suppress.
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(emailService.sendLicenseKey).not.toHaveBeenCalled();
      expect(waitlist.markApproved).not.toHaveBeenCalled();
    });

    it('throws 409 EXISTING_ACTIVE_LICENSE from the tx-side guard, before any write', async () => {
      const tx = createTxHandle();
      tx.license.findFirst.mockResolvedValueOnce({
        id: 'existing-paid',
        plan: 'builders',
        source: 'paddle',
        expiresAt: new Date(),
        createdAt: new Date(),
      });

      await expect(
        service.issueComplimentaryLicenseTx(
          tx as unknown as Parameters<
            LicenseService['issueComplimentaryLicenseTx']
          >[0],
          coreParams(),
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(auditLog.write).not.toHaveBeenCalled();
      expect(tx.license.create).not.toHaveBeenCalled();
    });

    it('skips the guard entirely when stackOnTopOfPaid is true', async () => {
      const tx = createTxHandle();

      await service.issueComplimentaryLicenseTx(
        tx as unknown as Parameters<
          LicenseService['issueComplimentaryLicenseTx']
        >[0],
        coreParams({ stackOnTopOfPaid: true }),
      );

      expect(tx.license.findFirst).not.toHaveBeenCalled();
      expect(auditLog.write.mock.calls[0][0].metadata).toMatchObject({
        stacked: true,
      });
    });
  });

  describe('withLicenseKeyRetry (the retry owns the WHOLE transaction)', () => {
    function p2002(): Prisma.PrismaClientKnownRequestError {
      return new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`license_key`)',
        { code: 'P2002', clientVersion: 'test' },
      );
    }

    it('R5.6 — re-enters the whole transaction on P2002 and produces exactly one licence', async () => {
      prisma.license.create
        .mockRejectedValueOnce(p2002())
        .mockImplementationOnce(({ data }) =>
          Promise.resolve({ id: 'license-retry-1', ...data }),
        );

      const result = await service.createComplimentaryLicense(
        makeDto(),
        ACTOR,
      );

      // The retry re-entered `$transaction` rather than re-issuing a statement
      // into the aborted first transaction (PostgreSQL 25P02).
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(prisma.license.create).toHaveBeenCalledTimes(2);

      // Exactly one licence survived, and the retry used a FRESH key.
      expect(result.license.id).toBe('license-retry-1');
      const firstKey = prisma.license.create.mock.calls[0][0].data.licenseKey;
      const secondKey = prisma.license.create.mock.calls[1][0].data.licenseKey;
      expect(firstKey).not.toBe(secondKey);

      // One committed grant ⇒ one outbound stamp, not one per attempt.
      expect(waitlist.markApproved).toHaveBeenCalledTimes(1);
    });

    it('gives up after 3 attempts and rethrows the P2002', async () => {
      prisma.license.create.mockRejectedValue(p2002());

      await expect(
        service.createComplimentaryLicense(makeDto(), ACTOR),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

      expect(prisma.$transaction).toHaveBeenCalledTimes(3);
      expect(waitlist.markApproved).not.toHaveBeenCalled();
      expect(emailService.sendLicenseKey).not.toHaveBeenCalled();
    });

    it('does NOT retry a non-P2002 failure — one attempt, error propagates', async () => {
      prisma.license.create.mockRejectedValue(new Error('connection reset'));

      await expect(
        service.createComplimentaryLicense(makeDto(), ACTOR),
      ).rejects.toThrow('connection reset');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry the 409 conflict raised inside the transaction', async () => {
      prisma.license.findFirst.mockResolvedValueOnce({
        id: 'existing-paid',
        plan: 'builders',
        source: 'paddle',
        expiresAt: new Date(),
        createdAt: new Date(),
      });

      await expect(
        service.createComplimentaryLicense(makeDto(), ACTOR),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.license.create).not.toHaveBeenCalled();
    });

    it('passes a resolving fn straight through without opening anything', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      await expect(service.withLicenseKeyRetry(fn)).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  // ===========================================================================
  // findOrCreateUserByEmail — public + tx-aware since TASK_2026_201
  // ===========================================================================

  describe('findOrCreateUserByEmail', () => {
    it('reports created: false for an existing user and never calls create', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(TEST_USER);

      const result = await service.findOrCreateUserByEmail(
        'Gift-Recipient@Example.com',
      );

      expect(result).toEqual({ user: TEST_USER, created: false });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'gift-recipient@example.com' },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('reports created: true when it had to create the user (R7 userWasCreated)', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValueOnce(TEST_USER);

      const result = await service.findOrCreateUserByEmail('new@example.com');

      expect(result).toEqual({ user: TEST_USER, created: true });
    });

    it('runs both the read and the create on a supplied tx client', async () => {
      const tx = {
        user: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue(TEST_USER),
        },
      };

      const result = await service.findOrCreateUserByEmail(
        'IN-TX@Example.com',
        tx as unknown as Parameters<
          LicenseService['findOrCreateUserByEmail']
        >[1],
      );

      expect(result.created).toBe(true);
      expect(tx.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'in-tx@example.com' },
      });
      expect(tx.user.create).toHaveBeenCalledWith({
        data: { email: 'in-tx@example.com' },
      });
      // A rollback must be able to remove a user this call created.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });
});
