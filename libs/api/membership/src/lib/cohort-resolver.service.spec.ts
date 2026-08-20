import { PrismaService } from '@ptah-api/core';
import { CohortResolver } from './cohort-resolver.service';

/**
 * Unit tests for `CohortResolver`.
 *
 * Focus: R7.8's "no assignments → `[]`, no throw" edge, the single-query shape,
 * and the A-2 guarantee that this resolver cannot see entitlement tables.
 */

interface AssignmentDelegate {
  findMany: jest.Mock;
}
interface SubscriptionDelegate {
  findFirst: jest.Mock;
}
interface LicenseDelegate {
  findFirst: jest.Mock;
}
interface MockPrisma {
  memberGroupAssignment: AssignmentDelegate;
  /** Present ONLY so "cohorts never read entitlement" is testable. */
  subscription: SubscriptionDelegate;
  license: LicenseDelegate;
}

function createMockPrisma(): MockPrisma {
  return {
    memberGroupAssignment: { findMany: jest.fn().mockResolvedValue([]) },
    subscription: { findFirst: jest.fn() },
    license: { findFirst: jest.fn() },
  };
}

describe('CohortResolver', () => {
  let prisma: MockPrisma;
  let resolver: CohortResolver;

  beforeEach(() => {
    prisma = createMockPrisma();
    resolver = new CohortResolver(prisma as unknown as PrismaService);
  });

  it('returns the assigned cohort keys in assignment order', async () => {
    prisma.memberGroupAssignment.findMany.mockResolvedValue([
      { group: { key: 'founding' } },
      { group: { key: 'arabic' } },
    ]);

    await expect(resolver.resolveCohortKeys('usr_1')).resolves.toEqual([
      'founding',
      'arabic',
    ]);
  });

  it('issues exactly ONE query, scoped to the user, selecting only the key', async () => {
    await resolver.resolveCohortKeys('usr_2');

    expect(prisma.memberGroupAssignment.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.memberGroupAssignment.findMany).toHaveBeenCalledWith({
      where: { userId: 'usr_2' },
      orderBy: { assignedAt: 'asc' },
      include: { group: { select: { key: true } } },
    });
  });

  it('R7.8: an entitled member with NO assignments resolves to [] and never throws', async () => {
    prisma.memberGroupAssignment.findMany.mockResolvedValue([]);

    // The A-2 edge in full. An admin forgetting to place a paying member in a
    // cohort must cost that member SOME CONTENT, never ACCESS — so the answer
    // is an empty list, delivered normally, and not an exception that a caller
    // would have to remember to catch.
    const keys = await resolver.resolveCohortKeys('usr_3');

    expect(keys).toEqual([]);
  });

  it('an unknown user is indistinguishable from an unassigned one: [] either way', async () => {
    prisma.memberGroupAssignment.findMany.mockResolvedValue([]);

    await expect(resolver.resolveCohortKeys('usr_nobody')).resolves.toEqual([]);
  });

  it('A-2: never reads the entitlement tables', async () => {
    prisma.memberGroupAssignment.findMany.mockResolvedValue([
      { group: { key: 'founding' } },
    ]);

    await resolver.resolveCohortKeys('usr_4');

    // If cohort resolution ever consulted License/Subscription the two
    // predicates would have fused, and a cohort lookup could then start
    // denying access.
    expect(prisma.subscription.findFirst).not.toHaveBeenCalled();
    expect(prisma.license.findFirst).not.toHaveBeenCalled();
  });

  it('degrades a lookup failure to [] — restrictive, logged, never a lockout', async () => {
    const warn = jest
      .spyOn(
        (resolver as unknown as { logger: { warn: (m: string) => void } })
          .logger,
        'warn',
      )
      .mockImplementation(() => undefined);
    prisma.memberGroupAssignment.findMany.mockRejectedValue(
      new Error('relation "member_group_assignments" does not exist'),
    );

    // `[]` matches no cohort-gated content, so the member sees LESS, never
    // more. Throwing would turn a partial outage into a total one for a member
    // whose entitlement has ALREADY been proven by the time this runs.
    await expect(resolver.resolveCohortKeys('usr_5')).resolves.toEqual([]);

    // Degraded, not swallowed: the reason is recorded server-side.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('usr_5');
  });
});
