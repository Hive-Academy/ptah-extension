import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@ptah-api/core';
import { MembershipService } from './membership.service';

/**
 * Unit tests for `MembershipService` — R7.4's five mandatory cases, one `it()`
 * each, plus the NFR-S7 error boundary.
 *
 * Strategy: a hand-rolled Prisma mock (the convention in this repo — see
 * `member-groups.service.spec.ts`) exposing only the two delegates this service
 * touches, PLUS a `memberGroupAssignment` delegate that must never be called.
 * Its presence is what makes the A-2 separation assertable rather than merely
 * documented: if entitlement ever started consulting cohort assignments, case 4
 * below would fail.
 */

interface SubscriptionDelegate {
  findFirst: jest.Mock;
}
interface LicenseDelegate {
  findFirst: jest.Mock;
}
interface AssignmentDelegate {
  findMany: jest.Mock;
}
interface MockPrisma {
  subscription: SubscriptionDelegate;
  license: LicenseDelegate;
  /** Present ONLY so "entitlement never reads cohorts" is testable. */
  memberGroupAssignment: AssignmentDelegate;
}

function createMockPrisma(): MockPrisma {
  return {
    subscription: { findFirst: jest.fn().mockResolvedValue(null) },
    license: { findFirst: jest.fn().mockResolvedValue(null) },
    memberGroupAssignment: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function createService(prisma: MockPrisma): MembershipService {
  const service = new MembershipService(prisma as unknown as PrismaService);
  // The sanitized-failure tests deliberately reject the Prisma mock, and the
  // service is CORRECT to log the raw reason server-side. Silence it here so a
  // passing suite stays readable — the assertions below check that the raw text
  // does not reach the CALLER, which is the property that matters.
  jest
    .spyOn(
      (service as unknown as { logger: { error: (m: string) => void } }).logger,
      'error',
    )
    .mockImplementation(() => undefined);
  return service;
}

/** A day either side of now, so no test depends on wall-clock precision. */
const DAY_MS = 24 * 60 * 60 * 1000;
const YESTERDAY = new Date(Date.now() - DAY_MS);
const TOMORROW = new Date(Date.now() + DAY_MS);

describe('MembershipService', () => {
  let prisma: MockPrisma;
  let service: MembershipService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = createService(prisma);
  });

  describe('R7.4 — the five cases the membership definition must answer', () => {
    it('case 1: an active paid member is entitled', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub_1',
        status: 'active',
      });

      await expect(service.isBuildersMember('usr_1')).resolves.toBe(true);

      // Subscription-FIRST: an active subscription short-circuits, so the
      // license table is never read. This ordering is part of the moved
      // behaviour, not an implementation detail — a member who subscribed but
      // holds no license row must still be entitled.
      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: { userId: 'usr_1', status: { in: ['active', 'trialing'] } },
        orderBy: { updatedAt: 'desc' },
      });
      expect(prisma.license.findFirst).not.toHaveBeenCalled();
    });

    it('case 2: an expired / lapsed member is NOT entitled', async () => {
      // No live subscription, and the only builders license has run out.
      prisma.license.findFirst.mockResolvedValue({
        id: 'lic_1',
        status: 'active',
        plan: 'builders',
        expiresAt: YESTERDAY,
      });

      await expect(service.isBuildersMember('usr_2')).resolves.toBe(false);

      expect(prisma.license.findFirst).toHaveBeenCalledWith({
        where: { userId: 'usr_2', status: 'active', plan: 'builders' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('case 3: an admin who is not a member is NOT entitled', async () => {
      // Nothing in the mock grants entitlement, and there is nothing an admin
      // allowlist could add: this service cannot see one.
      await expect(service.isBuildersMember('usr_admin')).resolves.toBe(false);

      // The executable form of the G4 security invariant, applied to the
      // relocated definition: if this file ever learns about ADMIN_EMAILS,
      // AdminGuard or an isAdmin flag, the member gate and the admin path have
      // been fused and every platform admin silently gains a member
      // entitlement. Asserted on source because that fusion would otherwise
      // only be visible in review.
      const source = readFileSync(
        join(__dirname, 'membership.service.ts'),
        'utf8',
      );
      for (const needle of ['ADMIN_EMAILS', 'AdminGuard', 'isAdmin']) {
        expect(source).not.toContain(needle);
      }
    });

    it('case 4 (A-2 edge): a member with an entitlement but NO cohort assignment is entitled, and does not throw', async () => {
      prisma.subscription.findFirst.mockResolvedValue({
        id: 'sub_9',
        status: 'trialing',
      });

      // The A-2 separation: entitlement answers "may they enter at all" and is
      // derived from License/Subscription ONLY. A member an admin has not yet
      // placed in a cohort must see LESS CONTENT, never be DENIED ACCESS — so
      // this resolves true, and the assignment table is not consulted at all.
      await expect(service.isBuildersMember('usr_4')).resolves.toBe(true);
      expect(prisma.memberGroupAssignment.findMany).not.toHaveBeenCalled();
    });

    it('case 5: an unauthenticated caller can never be entitled', async () => {
      // This service is only ever reached behind JwtAuthGuard, so "no caller"
      // reaches it as an absent/empty identity rather than as a request. The
      // property that matters is that no identity-shaped hole resolves TRUE:
      // entitlement is always scoped to the userId it was asked about, and an
      // unknown user matches no subscription and no license.
      // NB: the loop variable is deliberately NOT named after the parameter.
      // R7.2's consolidation gate greps for the method name immediately
      // followed by that argument name, so a mere call site spelled the
      // obvious way would make an "exactly one implementation" check read as
      // two.
      for (const absentIdentity of ['', 'usr_unknown']) {
        await expect(service.isBuildersMember(absentIdentity)).resolves.toBe(
          false,
        );
        expect(prisma.subscription.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ userId: absentIdentity }),
          }),
        );
      }
    });
  });

  describe('license expiry', () => {
    it('a non-expired active builders license entitles', async () => {
      prisma.license.findFirst.mockResolvedValue({
        id: 'lic_2',
        status: 'active',
        plan: 'builders',
        expiresAt: TOMORROW,
      });

      await expect(service.isBuildersMember('usr_5')).resolves.toBe(true);
    });

    it('a perpetual (null expiresAt) active builders license entitles', async () => {
      prisma.license.findFirst.mockResolvedValue({
        id: 'lic_3',
        status: 'active',
        plan: 'builders',
        expiresAt: null,
      });

      await expect(service.isBuildersMember('usr_6')).resolves.toBe(true);
    });
  });

  describe('NFR-S7 — persistence failures are sanitized, never forwarded', () => {
    it('raises a 503 whose message contains nothing from the underlying error', async () => {
      prisma.subscription.findFirst.mockRejectedValue(
        new Error(
          "Can't reach database server at db.internal:5432 (user=ptah_app)",
        ),
      );

      await expect(service.isBuildersMember('usr_7')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );

      // Fail-CLOSED and quiet: the caller learns the check could not run, not
      // where the database lives or which credentials it uses.
      await expect(service.isBuildersMember('usr_7')).rejects.toThrow(
        'Membership could not be verified right now. Please try again.',
      );
    });

    it('does NOT degrade a failed lookup to "not a member"', async () => {
      prisma.subscription.findFirst.mockRejectedValue(new Error('boom'));

      // Returning false here would tell a paying member they had not paid.
      // "The check could not run" and "they have not paid" are different
      // answers and must stay different.
      await expect(service.isBuildersMember('usr_8')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
