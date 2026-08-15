import { InternalServerErrorException, Logger } from '@nestjs/common';
import { Prisma, PrismaService } from '@ptah-api/core';
import { AuditLogService } from '@ptah-api/audit';
import { EmailService } from '@ptah-api/email';
import { LicenseService } from '@ptah-api/licensing';
import type { AdminActor } from '@ptah-api/licensing';
import { WaitlistService } from '@ptah-api/marketing';
import { MemberGroupsService } from '@ptah-api/community';
import { WaitlistApprovalService } from './waitlist-approval.service';

/**
 * `WaitlistApprovalService` — the whole outcome taxonomy and every rollback
 * case (TASK_2026_201 R1, R2, R5, R6, R7 · implementation-plan.md §8).
 *
 * ── HARNESS: REAL COLLABORATORS, MOCK DATABASE ─────────────────────────────
 * `LicenseService`, `WaitlistService` and `MemberGroupsService` are the REAL
 * classes, constructed over one shared Prisma mock whose `$transaction` runs
 * the callback inline with the mock itself as `tx` (the shape
 * `license.service.spec.ts:39-55` established, extended here with `waitlist`,
 * `subscription`, `memberGroup` and `memberGroupAssignment` delegates).
 *
 * That is a deliberate choice over stubbing the three services. The properties
 * under test here are not "did the orchestrator call a method" — they are "how
 * many licence rows exist", "did the claim run before the licence create", "did
 * the P2002 retry produce one licence or two". Every one of those is a
 * statement about DELEGATE CALLS, and a stubbed collaborator cannot make it.
 * Only `EmailService` and `AuditLogService` are mocked, because both are pure
 * side effects with nothing to assert on the far side.
 *
 * ── WHAT THIS HARNESS CANNOT PROVE, STATED UP FRONT ────────────────────────
 * A mock cannot roll back. When a test asserts "nothing persisted", the
 * executable claim is `the callback threw out of $transaction` — which is
 * exactly what Prisma turns into a `ROLLBACK`, and the strongest claim
 * available without a live database. The DATABASE-level assertion for R2.1
 * (`license.count === 0`, `waitlist.approvedAt === null` afterwards) is the
 * task's real-database gate and is still open; it is not silently substituted
 * for here.
 */

interface MockPrisma {
  user: { findUnique: jest.Mock; create: jest.Mock };
  license: { findFirst: jest.Mock; create: jest.Mock };
  subscription: { findFirst: jest.Mock };
  waitlist: { findUnique: jest.Mock; updateMany: jest.Mock };
  memberGroup: { findUnique: jest.Mock; findFirst: jest.Mock };
  memberGroupAssignment: { findUnique: jest.Mock; upsert: jest.Mock };
  $transaction: jest.Mock;
}

const ACTOR: AdminActor = {
  email: 'founder@ptah.live',
  ip: '10.0.0.1',
  userAgent: 'jest',
};

const FOUNDING_GROUP = {
  id: 'grp-founding',
  key: 'founding',
  name: 'Founding Members',
};

const LICENSE_KEY = 'ptah_lic_' + 'a'.repeat(64);

interface MockEmail {
  sendFoundingCohortWelcome: jest.Mock;
  sendWaitlistConfirmation: jest.Mock;
  /** Asserted NEVER called — approval sends exactly one mail (R3.3). */
  sendLicenseKey: jest.Mock;
}

/** `AuditLogService.write`'s params, narrowed to what these tests assert on. */
interface CapturedAuditWrite {
  tx?: unknown;
  actorEmail: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

interface Harness {
  service: WaitlistApprovalService;
  prisma: MockPrisma;
  email: MockEmail;
  audit: { write: jest.Mock };
  license: LicenseService;
  /** Highest number of `$transaction` calls ever open at the same moment. */
  peakConcurrentTransactions: () => number;
  logs: string[];
  errorLogs: string[];
}

function waitlistRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wl-1',
    email: 'lead@example.com',
    notifiedAt: null,
    approvedAt: null,
    ...overrides,
  };
}

function build(): Harness {
  let open = 0;
  let peak = 0;

  const prisma: MockPrisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'user-1',
          email: (data as { email: string }).email,
        }),
      ),
    },
    license: {
      // Serves BOTH the `holdsPaidEntitlement` guard and the licence core's
      // own `EXISTING_ACTIVE_LICENSE` guard. Null = neither trips.
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'license-1',
          ...(data as Record<string, unknown>),
        }),
      ),
    },
    subscription: { findFirst: jest.fn().mockResolvedValue(null) },
    waitlist: {
      findUnique: jest.fn().mockResolvedValue(waitlistRow()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    memberGroup: {
      findUnique: jest.fn().mockResolvedValue(FOUNDING_GROUP),
      // Wired ADVERSARIALLY: if `requireGroupByKey` ever grew an `isDefault`
      // fallback it would find a usable group here and the throw test would
      // pass for the wrong reason. It is asserted never called.
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'grp-default', key: 'general' }),
    },
    memberGroupAssignment: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'mga-1' }),
    },
    $transaction: jest.fn(),
  };

  prisma.$transaction.mockImplementation(async (arg: unknown) => {
    open += 1;
    peak = Math.max(peak, open);
    try {
      if (typeof arg === 'function') {
        return await (arg as (tx: MockPrisma) => Promise<unknown>)(prisma);
      }
      return await Promise.all(arg as Promise<unknown>[]);
    } finally {
      open -= 1;
    }
  });

  const email: MockEmail = {
    sendFoundingCohortWelcome: jest.fn().mockResolvedValue(undefined),
    sendWaitlistConfirmation: jest.fn().mockResolvedValue(undefined),
    sendLicenseKey: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { write: jest.fn().mockResolvedValue('audit-1') };

  const emailService = email as unknown as EmailService;
  const auditLog = audit as unknown as AuditLogService;
  const prismaService = prisma as unknown as PrismaService;

  const waitlistService = new WaitlistService(prismaService, emailService);
  const memberGroups = new MemberGroupsService(prismaService, auditLog);
  const licenseService = new LicenseService(
    prismaService,
    // `EventsService` is untouched by every path under test — the approval
    // never calls `createLicense`.
    {} as never,
    auditLog,
    emailService,
    waitlistService,
  );

  const logs: string[] = [];
  const errorLogs: string[] = [];
  jest.spyOn(Logger.prototype, 'log').mockImplementation((msg: unknown) => {
    logs.push(String(msg));
  });
  jest.spyOn(Logger.prototype, 'error').mockImplementation((msg: unknown) => {
    errorLogs.push(String(msg));
  });
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  const service = new WaitlistApprovalService(
    prismaService,
    licenseService,
    waitlistService,
    memberGroups,
    emailService,
    auditLog,
  );

  return {
    service,
    prisma,
    email,
    audit,
    license: licenseService,
    peakConcurrentTransactions: () => peak,
    logs,
    errorLogs,
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`license_key`)',
    { code: 'P2002', clientVersion: 'test' },
  );
}

/**
 * The `waitlist.approve` audit calls only. The licence core writes its own
 * `license.complimentary.issue` row through the same mock; filtering here is
 * what keeps "one approve audit row" from accidentally counting it.
 */
function approveAuditCalls(audit: { write: jest.Mock }): CapturedAuditWrite[] {
  return (audit.write.mock.calls as [CapturedAuditWrite][])
    .map(([arg]) => arg)
    .filter((arg) => arg.action === 'waitlist.approve');
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('WaitlistApprovalService.approve — the happy path (R1)', () => {
  it('grants, places in the cohort, stamps, audits, and mails exactly once', async () => {
    const h = build();

    const response = await h.service.approve(['wl-1'], ACTOR);

    expect(response.requested).toBe(1);
    expect(response.results).toHaveLength(1);
    expect(response.results[0]).toEqual({
      id: 'wl-1',
      email: 'lead@example.com',
      outcome: 'approved',
      licenseId: 'license-1',
      wasNotified: false,
    });
    expect(response.tally).toEqual({
      approved: 1,
      already_approved: 0,
      already_paid: 0,
      not_found: 0,
      failed: 0,
    });

    // The licence: free, active, complimentary, builders, a year out.
    expect(h.prisma.license.create).toHaveBeenCalledTimes(1);
    const licenseData = h.prisma.license.create.mock.calls[0][0].data;
    expect(licenseData).toMatchObject({
      userId: 'user-1',
      plan: 'builders',
      status: 'active',
      source: 'complimentary',
      createdBy: ACTOR.email,
    });
    const days =
      (licenseData.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(364);
    expect(days).toBeLessThan(366);

    // The claim, and the cohort placement.
    expect(h.prisma.waitlist.updateMany).toHaveBeenCalledWith({
      where: { id: 'wl-1', approvedAt: null },
      data: { approvedAt: expect.any(Date) },
    });
    expect(h.prisma.memberGroupAssignment.upsert).toHaveBeenCalledWith({
      where: { userId_groupId: { userId: 'user-1', groupId: 'grp-founding' } },
      create: { userId: 'user-1', groupId: 'grp-founding', source: 'admin' },
      update: {},
    });

    // Exactly one outbound message, carrying the key.
    expect(h.email.sendFoundingCohortWelcome).toHaveBeenCalledTimes(1);
    expect(h.email.sendFoundingCohortWelcome).toHaveBeenCalledWith({
      email: 'lead@example.com',
      licenseKey: licenseData.licenseKey,
      expiresAt: licenseData.expiresAt,
    });
    // R3.3 — the separate licence-key mail is NOT also sent.
    expect(h.email.sendLicenseKey).not.toHaveBeenCalled();
  });

  it('writes ONE `waitlist.approve` audit row, inside the transaction, with R7 metadata', async () => {
    const h = build();

    await h.service.approve(['wl-1'], ACTOR);

    const calls = approveAuditCalls(h.audit);
    expect(calls).toHaveLength(1);
    const arg = calls[0];

    // PRE-6: enlisted in the caller's transaction, not the base client.
    expect(arg.tx).toBe(h.prisma);
    expect(arg).toMatchObject({
      actorEmail: ACTOR.email,
      action: 'waitlist.approve',
      targetType: 'Waitlist',
      targetId: 'wl-1',
      ipAddress: ACTOR.ip,
      userAgent: ACTOR.userAgent,
    });
    expect(arg.metadata).toEqual({
      email: 'lead@example.com',
      userId: 'user-1',
      userWasCreated: true,
      licenseId: 'license-1',
      durationPreset: '1y',
      expiresAt: expect.stringMatching(/^\d{4}-/),
      groupKey: 'founding',
      wasNotified: false,
      cohortAlreadyAssigned: false,
    });
  });

  it('reports `userWasCreated: false` when the address already had a User', async () => {
    const h = build();
    h.prisma.user.findUnique.mockResolvedValue({
      id: 'user-existing',
      email: 'lead@example.com',
    });

    await h.service.approve(['wl-1'], ACTOR);

    expect(h.prisma.user.create).not.toHaveBeenCalled();
    expect(approveAuditCalls(h.audit)[0].metadata).toMatchObject({
      userId: 'user-existing',
      userWasCreated: false,
    });
  });

  it('never passes `stackOnTopOfPaid` to the licence core (R5.4)', async () => {
    const h = build();
    const spy = jest.spyOn(h.license, 'issueComplimentaryLicenseTx');

    await h.service.approve(['wl-1'], ACTOR);

    expect(spy).toHaveBeenCalledTimes(1);
    const params = spy.mock.calls[0][1];
    expect(params.stackOnTopOfPaid).toBeUndefined();
    expect(params).toMatchObject({ plan: 'builders', durationPreset: '1y' });
  });

  it('processes rows SEQUENTIALLY — never more than one transaction open', async () => {
    // Not a style preference: 50 concurrent INTERACTIVE transactions exhaust
    // the connection pool. Under `Promise.all` every row's transaction would
    // open before the first mocked delegate resolved and the peak would be 3.
    const h = build();

    await h.service.approve(['wl-1', 'wl-2', 'wl-3'], ACTOR);

    expect(h.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(h.peakConcurrentTransactions()).toBe(1);
  });
});

describe('WaitlistApprovalService.approve — the cohort is resolved once, and hard (R1.5)', () => {
  it('throws BEFORE any row is touched when the `founding` group is missing', async () => {
    const h = build();
    h.prisma.memberGroup.findUnique.mockResolvedValue(null);

    await expect(
      h.service.approve(['wl-1', 'wl-2'], ACTOR),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    // No licence for ANY row — that is the whole point of resolving up front.
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(h.prisma.license.create).not.toHaveBeenCalled();
    expect(h.prisma.waitlist.updateMany).not.toHaveBeenCalled();
    expect(h.email.sendFoundingCohortWelcome).not.toHaveBeenCalled();
    // NO `isDefault` fallback, even though one was available.
    expect(h.prisma.memberGroup.findFirst).not.toHaveBeenCalled();
  });

  it('resolves the cohort ONCE per request, not once per row', async () => {
    const h = build();

    await h.service.approve(['wl-1', 'wl-2', 'wl-3'], ACTOR);

    expect(h.prisma.memberGroup.findUnique).toHaveBeenCalledTimes(1);
    expect(h.prisma.memberGroup.findUnique).toHaveBeenCalledWith({
      where: { key: 'founding' },
      select: { id: true, key: true, name: true },
    });
  });
});

describe('WaitlistApprovalService.approve — rollback on cohort-assignment failure (R2.1)', () => {
  it('reaches the licence create, then rolls the whole row back with no audit and no mail', async () => {
    const h = build();
    h.prisma.memberGroupAssignment.upsert.mockRejectedValue(
      new Error('deadlock detected'),
    );

    const response = await h.service.approve(['wl-1'], ACTOR);

    // We got past step 5 …
    expect(h.prisma.license.create).toHaveBeenCalledTimes(1);
    // … and the callback still threw out of `$transaction`, which is what
    // Prisma turns into a ROLLBACK. The mock cannot undo the create; the
    // executable claim is the rejection, not the absence of a row.
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);

    expect(approveAuditCalls(h.audit)).toHaveLength(0);
    expect(h.email.sendFoundingCohortWelcome).not.toHaveBeenCalled();
    expect(response.results[0]).toEqual({
      id: 'wl-1',
      email: null,
      outcome: 'failed',
      error: { code: 'GRANT_FAILED' },
    });
    expect(response.tally.failed).toBe(1);
  });

  it('does not leak the underlying message to the client, and logs it server-side', async () => {
    const h = build();
    h.prisma.memberGroupAssignment.upsert.mockRejectedValue(
      new Error('deadlock detected on relation member_group_assignments'),
    );

    const response = await h.service.approve(['wl-1'], ACTOR);

    expect(JSON.stringify(response)).not.toContain('deadlock');
    expect(JSON.stringify(response)).not.toContain('member_group_assignments');
    expect(h.errorLogs.join('\n')).toContain('deadlock detected');
  });

  it('rolls the row back when the AUDIT write fails (R2.2 — no try/catch around it)', async () => {
    const h = build();
    h.audit.write.mockImplementation((arg: { action: string }) =>
      arg.action === 'waitlist.approve'
        ? Promise.reject(new Error('audit table unavailable'))
        : Promise.resolve('audit-1'),
    );

    const response = await h.service.approve(['wl-1'], ACTOR);

    expect(response.results[0].outcome).toBe('failed');
    expect(response.results[0].error).toEqual({ code: 'GRANT_FAILED' });
    // Nothing had gone out yet, so there was nothing to preserve by swallowing.
    expect(h.email.sendFoundingCohortWelcome).not.toHaveBeenCalled();
  });
});

describe('WaitlistApprovalService.approve — post-commit email failure (R2.3)', () => {
  it('keeps the grant, reports `approved` with an APPROVAL_EMAIL_FAILED warning', async () => {
    const h = build();
    h.email.sendFoundingCohortWelcome.mockRejectedValue(
      new Error('Resend 503 upstream'),
    );

    const response = await h.service.approve(['wl-1'], ACTOR);

    const row = response.results[0];
    expect(row.outcome).toBe('approved');
    expect(row.licenseId).toBe('license-1');
    expect(row.warning).toEqual({ code: 'APPROVAL_EMAIL_FAILED' });
    expect(row.error).toBeUndefined();
    expect(response.tally).toMatchObject({ approved: 1, failed: 0 });

    // The transaction committed: licence, cohort and audit all persisted.
    expect(h.prisma.license.create).toHaveBeenCalledTimes(1);
    expect(h.prisma.memberGroupAssignment.upsert).toHaveBeenCalledTimes(1);
    expect(approveAuditCalls(h.audit)).toHaveLength(1);

    // Sanitized on the wire, diagnosable in the log.
    expect(JSON.stringify(response)).not.toContain('Resend');
    expect(h.errorLogs.join('\n')).toContain('Resend 503 upstream');
  });

  it('emits no log line containing a licence key (R7.4)', async () => {
    const h = build();
    h.prisma.license.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'license-1',
        ...(data as Record<string, unknown>),
        licenseKey: LICENSE_KEY,
      }),
    );
    h.email.sendFoundingCohortWelcome.mockRejectedValue(new Error('smtp down'));

    const response = await h.service.approve(['wl-1'], ACTOR);

    const everything = [...h.logs, ...h.errorLogs].join('\n');
    expect(everything).not.toContain(LICENSE_KEY);
    expect(everything).not.toContain('ptah_lic_');
    // …nor does the payload, nor the audit metadata.
    expect(JSON.stringify(response)).not.toContain('ptah_lic_');
    expect(JSON.stringify(approveAuditCalls(h.audit))).not.toContain(
      'ptah_lic_',
    );
  });
});

describe('WaitlistApprovalService.approve — idempotency (R5.1, R5.2)', () => {
  it('a second sequential approval of the same row is `already_approved` and grants nothing more', async () => {
    const h = build();

    // The real Read-Committed behaviour: the claim wins once, then never again.
    h.prisma.waitlist.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });

    const first = await h.service.approve(['wl-1'], ACTOR);
    const second = await h.service.approve(['wl-1'], ACTOR);

    expect(first.results[0].outcome).toBe('approved');
    expect(second.results[0]).toEqual({
      id: 'wl-1',
      email: 'lead@example.com',
      outcome: 'already_approved',
      wasNotified: false,
    });

    // One of everything, attributable to that row.
    expect(h.prisma.license.create).toHaveBeenCalledTimes(1);
    expect(h.prisma.memberGroupAssignment.upsert).toHaveBeenCalledTimes(1);
    expect(approveAuditCalls(h.audit)).toHaveLength(1);
    expect(h.email.sendFoundingCohortWelcome).toHaveBeenCalledTimes(1);
  });

  it('two concurrent approvals produce exactly one winner and neither throws (R5.2)', async () => {
    const h = build();
    h.prisma.waitlist.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });

    const [a, b] = await Promise.all([
      h.service.approve(['wl-1'], ACTOR),
      h.service.approve(['wl-1'], ACTOR),
    ]);

    const outcomes = [a.results[0].outcome, b.results[0].outcome].sort();
    expect(outcomes).toEqual(['already_approved', 'approved']);

    expect(h.prisma.license.create).toHaveBeenCalledTimes(1);
    expect(approveAuditCalls(h.audit)).toHaveLength(1);
    expect(h.email.sendFoundingCohortWelcome).toHaveBeenCalledTimes(1);
    // Neither call raised — both returned a 200-shaped payload.
    expect(a.requested).toBe(1);
    expect(b.requested).toBe(1);
  });

  it('writes NO audit row for a skipped row (R7.3)', async () => {
    const h = build();
    h.prisma.waitlist.updateMany.mockResolvedValue({ count: 0 });

    await h.service.approve(['wl-1'], ACTOR);

    expect(h.audit.write).not.toHaveBeenCalled();
    expect(h.prisma.license.create).not.toHaveBeenCalled();
    expect(h.email.sendFoundingCohortWelcome).not.toHaveBeenCalled();
  });
});

describe('WaitlistApprovalService.approve — already paying (R5.4)', () => {
  it('skips an address holding an active PAID builders licence', async () => {
    const h = build();
    h.prisma.license.findFirst.mockResolvedValue({ id: 'paid-license' });

    const response = await h.service.approve(['wl-1'], ACTOR);

    expect(response.results[0]).toEqual({
      id: 'wl-1',
      email: 'lead@example.com',
      outcome: 'already_paid',
      wasNotified: false,
    });
    expect(h.prisma.license.create).not.toHaveBeenCalled();
    expect(h.audit.write).not.toHaveBeenCalled();
    expect(h.email.sendFoundingCohortWelcome).not.toHaveBeenCalled();
    expect(h.prisma.license.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        status: 'active',
        plan: 'builders',
        // Both guards on this path read `NON_REVENUE_LICENSE_SOURCES`. When
        // they disagreed, this one passed the row as unpaid and the licence
        // core then 409'd it on the free `signup` community licence.
        source: { notIn: ['complimentary', 'signup'] },
      },
      select: { id: true },
    });
  });

  it('skips an address holding an active or trialing SUBSCRIPTION (the deliberate superset)', async () => {
    for (const status of ['active', 'trialing']) {
      const h = build();
      h.prisma.subscription.findFirst.mockResolvedValue({
        id: `sub-${status}`,
      });

      const response = await h.service.approve(['wl-1'], ACTOR);

      expect(response.results[0].outcome).toBe('already_paid');
      expect(h.prisma.license.create).not.toHaveBeenCalled();
      expect(h.email.sendFoundingCohortWelcome).not.toHaveBeenCalled();
      expect(h.prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: { in: ['active', 'trialing'] } },
        select: { id: true },
      });
    }
  });

  it('does NOT skip a past_due or canceled subscriber — that is who a grant is for', async () => {
    const h = build();
    // The predicate is `status IN ('active','trialing')`, so a `past_due` row
    // simply does not match; the mock returns null exactly as Prisma would.
    h.prisma.subscription.findFirst.mockResolvedValue(null);

    const response = await h.service.approve(['wl-1'], ACTOR);

    expect(response.results[0].outcome).toBe('approved');
  });
});

describe('WaitlistApprovalService.approve — already-notified rows (R6)', () => {
  it('approves a notified row identically, reports `wasNotified`, and never touches `notifiedAt`', async () => {
    const h = build();
    const notifiedAt = new Date('2026-07-01T00:00:00.000Z');
    h.prisma.waitlist.findUnique.mockResolvedValue(waitlistRow({ notifiedAt }));

    const response = await h.service.approve(['wl-1'], ACTOR);

    expect(response.results[0]).toEqual({
      id: 'wl-1',
      email: 'lead@example.com',
      outcome: 'approved',
      licenseId: 'license-1',
      wasNotified: true,
    });
    expect(approveAuditCalls(h.audit)[0].metadata).toMatchObject({
      wasNotified: true,
    });

    // `notifiedAt` is not a precondition and not a write target: the ONLY
    // waitlist update in the whole path is the claim, and it names one column.
    expect(h.prisma.waitlist.updateMany).toHaveBeenCalledTimes(1);
    const update = h.prisma.waitlist.updateMany.mock.calls[0][0];
    expect(Object.keys(update.data)).toEqual(['approvedAt']);
    expect(update.where).not.toHaveProperty('notifiedAt');
  });
});

describe('WaitlistApprovalService.approve — per-row isolation (R1.6, R2.4)', () => {
  it('a `not_found` row mid-batch does not stop the rows around it', async () => {
    const h = build();
    h.prisma.waitlist.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(
        (where as { id: string }).id === 'wl-missing'
          ? null
          : waitlistRow({ id: (where as { id: string }).id }),
      ),
    );

    const response = await h.service.approve(
      ['wl-1', 'wl-missing', 'wl-3'],
      ACTOR,
    );

    expect(response.results.map((r) => r.outcome)).toEqual([
      'approved',
      'not_found',
      'approved',
    ]);
    expect(response.tally).toMatchObject({ approved: 2, not_found: 1 });
    // `not_found` has no address to report and no row to read `wasNotified` off.
    expect(response.results[1]).toEqual({
      id: 'wl-missing',
      email: null,
      outcome: 'not_found',
    });
    expect(h.prisma.license.create).toHaveBeenCalledTimes(2);
    expect(h.email.sendFoundingCohortWelcome).toHaveBeenCalledTimes(2);
  });

  it('a hard failure on row 3 of 5 leaves the other four committed', async () => {
    const h = build();
    let call = 0;
    h.prisma.license.create.mockImplementation(({ data }) => {
      call += 1;
      return call === 3
        ? Promise.reject(new Error('connection reset by peer'))
        : Promise.resolve({
            id: `license-${call}`,
            ...(data as Record<string, unknown>),
          });
    });

    const response = await h.service.approve(['a', 'b', 'c', 'd', 'e'], ACTOR);

    expect(response.results.map((r) => r.outcome)).toEqual([
      'approved',
      'approved',
      'failed',
      'approved',
      'approved',
    ]);
    expect(response.tally).toMatchObject({ approved: 4, failed: 1 });
    expect(h.email.sendFoundingCohortWelcome).toHaveBeenCalledTimes(4);
    expect(approveAuditCalls(h.audit)).toHaveLength(4);
  });
});

describe('WaitlistApprovalService.approve — licence-key collisions (R5.6)', () => {
  it('retries the WHOLE transaction on P2002 and produces exactly one licence', async () => {
    const h = build();
    h.prisma.license.create
      .mockRejectedValueOnce(p2002())
      .mockImplementationOnce(({ data }) =>
        Promise.resolve({
          id: 'license-retry',
          ...(data as Record<string, unknown>),
        }),
      );

    const response = await h.service.approve(['wl-1'], ACTOR);

    expect(response.results[0].outcome).toBe('approved');
    expect(response.results[0].licenseId).toBe('license-retry');
    // Two attempts, two transactions — the retry re-ENTERS the transaction
    // rather than retrying a statement inside an aborted one.
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(2);
    // Two `create` ATTEMPTS, one surviving row: attempt 1 rejected and rolled
    // back in full, so the claim was re-taken rather than double-counted.
    expect(h.prisma.license.create).toHaveBeenCalledTimes(2);
    // And exactly ONE `waitlist.approve` audit row — the failed attempt never
    // reached the audit write, which sits after the licence create.
    expect(approveAuditCalls(h.audit)).toHaveLength(1);
    expect(h.email.sendFoundingCohortWelcome).toHaveBeenCalledTimes(1);

    // Each attempt generated a FRESH key — retrying the colliding one forever
    // is the failure mode this proves absent.
    const keys = h.prisma.license.create.mock.calls.map(
      ([arg]) => arg.data.licenseKey,
    );
    expect(new Set(keys).size).toBe(2);
  });

  it('gives up after 3 attempts and reports `failed`, not a 500', async () => {
    const h = build();
    h.prisma.license.create.mockRejectedValue(p2002());

    const response = await h.service.approve(['wl-1'], ACTOR);

    expect(h.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(response.results[0]).toEqual({
      id: 'wl-1',
      email: null,
      outcome: 'failed',
      error: { code: 'GRANT_FAILED' },
    });
    expect(h.email.sendFoundingCohortWelcome).not.toHaveBeenCalled();
  });
});

describe('WaitlistApprovalService.approve — cohort already assigned (R5.3)', () => {
  it('is still `approved`, and records `cohortAlreadyAssigned: true`', async () => {
    const h = build();
    h.prisma.memberGroupAssignment.findUnique.mockResolvedValue({
      id: 'mga-existing',
    });

    const response = await h.service.approve(['wl-1'], ACTOR);

    expect(response.results[0].outcome).toBe('approved');
    expect(approveAuditCalls(h.audit)[0].metadata).toMatchObject({
      cohortAlreadyAssigned: true,
    });
    // The upsert absorbs the `@@unique` collision — no P2002 is ever raised, so
    // nothing inside the transaction is put into the aborted state.
    expect(h.prisma.memberGroupAssignment.upsert).toHaveBeenCalledTimes(1);
  });
});

describe('WaitlistApprovalService.approve — observability (R7.5)', () => {
  it('emits one row line per row and one wave summary carrying the full tally', async () => {
    const h = build();
    h.prisma.waitlist.findUnique.mockImplementation(({ where }) =>
      Promise.resolve(
        (where as { id: string }).id === 'gone'
          ? null
          : waitlistRow({ id: (where as { id: string }).id }),
      ),
    );

    await h.service.approve(['wl-1', 'gone'], ACTOR);

    const rowLines = h.logs.filter((l) =>
      l.startsWith('Waitlist approve row:'),
    );
    expect(rowLines).toHaveLength(2);
    expect(rowLines[0]).toContain('waitlistId=wl-1');
    expect(rowLines[0]).toContain('outcome=approved');
    expect(rowLines[0]).toContain('licenseId=license-1');
    expect(rowLines[1]).toContain('outcome=not_found');

    const summary = h.logs.find((l) => l.startsWith('Waitlist approve wave:'));
    expect(summary).toBeDefined();
    expect(summary).toContain(`actor=${ACTOR.email}`);
    expect(summary).toContain('requested=2');
    expect(summary).toContain('approved=1');
    expect(summary).toContain('not_found=1');
    expect(summary).toContain('failed=0');
  });

  it('the tally always carries all five outcomes, zeros included', async () => {
    const h = build();

    const response = await h.service.approve(['wl-1'], ACTOR);

    expect(Object.keys(response.tally).sort()).toEqual([
      'already_approved',
      'already_paid',
      'approved',
      'failed',
      'not_found',
    ]);
  });
});
