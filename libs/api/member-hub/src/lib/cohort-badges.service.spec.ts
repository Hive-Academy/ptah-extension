import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaService } from '@ptah-api/core';
import { CohortBadgesService } from './cohort-badges.service';

/**
 * Unit tests for keys → badges.
 *
 * The property that matters most here is a NEGATIVE one: this service can never
 * add or remove a cohort. It is handed the keys `MemberGuard` resolved and only
 * labels them, which is what keeps `MemberContext.cohortKeys` the single answer
 * to "which cohorts is this member in" (R7.3, A-2).
 */

/**
 * Remove block and line comments so a source-text assertion is about CODE.
 *
 * Deliberately naive: it would also strip the tail of a string literal
 * containing `//`. Neither file it is used on has one, and the failure
 * direction is safe — over-stripping can only make an assertion that a needle
 * is ABSENT weaker in a way the anti-vacuity check beside it catches.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function createService(
  opts: { groups?: { key: string; name: string }[]; throws?: boolean } = {},
): {
  service: CohortBadgesService;
  findMany: jest.Mock;
} {
  const findMany = opts.throws
    ? jest
        .fn()
        .mockRejectedValue(new Error('relation "member_groups" does not exist'))
    : jest.fn().mockResolvedValue(opts.groups ?? []);
  const prisma = { memberGroup: { findMany } };

  const service = new CohortBadgesService(prisma as unknown as PrismaService);
  jest
    .spyOn(
      (service as unknown as { logger: { warn: () => void } }).logger,
      'warn',
    )
    .mockImplementation(() => undefined);

  return { service, findMany };
}

describe('CohortBadgesService', () => {
  describe('zero cohorts — the live default (R7.8, A-2)', () => {
    it('returns [] and issues NO query', async () => {
      // member_group_assignments is empty in the live database, so this is the
      // path every real request takes. Making it free is what keeps the
      // entitlement probe cheap enough to hit on every navigation.
      const { service, findMany } = createService();

      await expect(service.resolveBadges([])).resolves.toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  describe('naming', () => {
    it('labels each key with its MemberGroup name', async () => {
      const { service, findMany } = createService({
        groups: [{ key: 'founding', name: 'Founding Members' }],
      });

      await expect(service.resolveBadges(['founding'])).resolves.toEqual([
        { key: 'founding', name: 'Founding Members' },
      ]);
      expect(findMany).toHaveBeenCalledWith({
        where: { key: { in: ['founding'] } },
        select: { key: true, name: true },
      });
    });

    it('preserves the ORDER OF THE KEYS, not the order the rows came back in', async () => {
      // Cohort keys arrive in assignment order (`CohortResolver` sorts by
      // assignedAt). Postgres makes no such promise about an `IN` query, so the
      // badge order would otherwise be nondeterministic between requests.
      const { service } = createService({
        groups: [
          { key: 'arabic', name: 'Arabic Cohort' },
          { key: 'founding', name: 'Founding Members' },
        ],
      });

      await expect(
        service.resolveBadges(['founding', 'arabic']),
      ).resolves.toEqual([
        { key: 'founding', name: 'Founding Members' },
        { key: 'arabic', name: 'Arabic Cohort' },
      ]);
    });

    it('keeps a key with no matching row, named after itself', async () => {
      // A renamed or deleted MemberGroup. The member IS in that cohort as far
      // as every visibility check is concerned (they all match on the same
      // keys), so dropping it here would make the badge list disagree with what
      // the member can actually see.
      const { service } = createService({ groups: [] });

      await expect(service.resolveBadges(['ghost'])).resolves.toEqual([
        { key: 'ghost', name: 'ghost' },
      ]);
    });

    it('returns exactly one badge per key — it can neither add nor drop a cohort', async () => {
      const { service } = createService({
        groups: [
          { key: 'founding', name: 'Founding Members' },
          { key: 'not-mine', name: 'Someone Else' },
        ],
      });

      const badges = await service.resolveBadges(['founding']);

      expect(badges.map((b) => b.key)).toEqual(['founding']);
    });
  });

  describe('degradation', () => {
    it('a lookup failure labels keys with themselves rather than throwing', async () => {
      // Same direction as CohortResolver's degrade-to-[]: this decides how a
      // badge READS, never what a member may SEE, so failing hard would turn a
      // cosmetic outage into a locked-out paying member.
      const { service } = createService({ throws: true });

      await expect(service.resolveBadges(['founding'])).resolves.toEqual([
        { key: 'founding', name: 'founding' },
      ]);
    });

    it('never surfaces the raw persistence message (NFR-S7)', async () => {
      const { service } = createService({ throws: true });

      const badges = await service.resolveBadges(['founding']);

      expect(JSON.stringify(badges)).not.toMatch(/relation|does not exist/);
    });
  });

  describe('it reads assignments through NOBODY (R7.3)', () => {
    it('never touches memberGroupAssignment — that is CohortResolver’s job', () => {
      // Asserted on source text, matching `membership.service.spec.ts`'s idiom:
      // the invariant is that this file CANNOT answer "which cohorts", and a
      // mock-based test can only show that today it does not.
      //
      // Comments are stripped first, because the file's docblock argues at
      // length about `getGroupsForUser` and why it is not used — an argument
      // worth keeping. `membership.service.spec.ts` solved the same collision
      // by forbidding its subject to mention the needles at all; that works
      // when the needles are three env/guard names and not when the needle is
      // the alternative the docblock exists to reject.
      const source = stripComments(
        readFileSync(join(__dirname, 'cohort-badges.service.ts'), 'utf8'),
      );

      expect(source).not.toContain('memberGroupAssignment');
      expect(source).not.toContain('getGroupsForUser');
      // Anti-vacuity: stripComments must not have eaten the implementation.
      expect(source).toContain('this.prisma.memberGroup.findMany');
    });
  });
});
