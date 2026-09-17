import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@ptah-api/core';

import {
  WAITLIST_ELIGIBLE_PREDICATE,
  WAITLIST_STAGE_PREDICATES,
  buildWaitlistOrderBy,
  buildWaitlistWhere,
  deriveWaitlistStage,
  type WaitlistLifecycleFacts,
  type WaitlistListStage,
} from './waitlist-query';

/**
 * `waitlist-query` — the ONE stage/query policy (TASK_2026_462 Component 1).
 *
 * These are pure-function tests, deliberately without a database: the file's
 * whole value is that the stage math and the filter combination can be proven
 * from literals. The two properties this spec exists for:
 *
 *   🔴 DISJOINT + EXHAUSTIVE — every one of the eight timestamp combinations
 *   lands in EXACTLY ONE stage, and the same combination matches EXACTLY ONE
 *   stage predicate. That is the stage-sum invariant (`new + invited +
 *   approved + converted === total`) in testable form.
 *
 *   🔴 NO DYNAMIC KEYS — an unexpected stage/source/sort value at runtime
 *   contributes nothing (or the default column) rather than becoming a Prisma
 *   key. The DTO layer is the real gate; these guards keep the policy itself
 *   honest when a caller bypasses TypeScript.
 */

const NOTIFIED = new Date('2026-07-01T12:00:00.000Z');
const APPROVED = new Date('2026-08-01T12:00:00.000Z');
const CONVERTED = new Date('2026-09-01T12:00:00.000Z');
const CREATED = new Date('2026-06-01T12:00:00.000Z');

/** All eight presence combinations of the three lifecycle stamps. */
function facts(
  notified: Date | null,
  approved: Date | null,
  converted: Date | null,
): WaitlistLifecycleFacts {
  return {
    createdAt: CREATED,
    notifiedAt: notified,
    approvedAt: approved,
    convertedAt: converted,
  };
}

const ALL_COMBINATIONS: Array<{
  label: string;
  row: WaitlistLifecycleFacts;
  stage: WaitlistListStage;
}> = [
  // (notified, approved, converted) → Converted > Approved > Invited > New.
  { label: 'none', row: facts(null, null, null), stage: 'new' },
  {
    label: 'notified only',
    row: facts(NOTIFIED, null, null),
    stage: 'invited',
  },
  {
    label: 'approved only',
    row: facts(null, APPROVED, null),
    stage: 'approved',
  },
  {
    label: 'converted only',
    row: facts(null, null, CONVERTED),
    stage: 'converted',
  },
  {
    label: 'notified + approved',
    row: facts(NOTIFIED, APPROVED, null),
    stage: 'approved',
  },
  {
    label: 'notified + converted',
    row: facts(NOTIFIED, null, CONVERTED),
    stage: 'converted',
  },
  {
    label: 'approved + converted',
    row: facts(null, APPROVED, CONVERTED),
    stage: 'converted',
  },
  {
    label: 'all three',
    row: facts(NOTIFIED, APPROVED, CONVERTED),
    stage: 'converted',
  },
];

/**
 * Evaluate one of the literal stage predicates against a facts row. The
 * predicates use only `null` and `{ not: null }` conditions, so a small
 * evaluator suffices — no Prisma engine in a policy test.
 */
function matches(
  predicate: Prisma.WaitlistWhereInput,
  row: WaitlistLifecycleFacts,
): boolean {
  return Object.entries(predicate).every(([column, condition]) => {
    const value = row[column as keyof WaitlistLifecycleFacts];
    if (condition === null) {
      return value === null;
    }
    const filter = condition as { not?: null };
    return 'not' in filter && filter.not === null && value !== null;
  });
}

describe('waitlist-query', () => {
  describe('deriveWaitlistStage — all eight timestamp combinations', () => {
    it.each(ALL_COMBINATIONS)(
      '($label) resolves to $stage',
      ({ row, stage }) => {
        expect(deriveWaitlistStage(row).stage).toBe(stage);
      },
    );

    it('stageAt is the timestamp of the winning stage, createdAt for New', () => {
      expect(deriveWaitlistStage(facts(null, null, null)).stageAt).toBe(
        CREATED,
      );
      expect(deriveWaitlistStage(facts(NOTIFIED, null, null)).stageAt).toBe(
        NOTIFIED,
      );
      expect(deriveWaitlistStage(facts(NOTIFIED, APPROVED, null)).stageAt).toBe(
        APPROVED,
      );
      expect(
        deriveWaitlistStage(facts(NOTIFIED, APPROVED, CONVERTED)).stageAt,
      ).toBe(CONVERTED);
    });

    it('approvalEligible is true only when BOTH approvedAt and convertedAt are absent (R1.3)', () => {
      expect(
        deriveWaitlistStage(facts(null, null, null)).approvalEligible,
      ).toBe(true);
      expect(
        deriveWaitlistStage(facts(NOTIFIED, null, null)).approvalEligible,
      ).toBe(true);
      // An approved-but-never-notified row is the exact case the old UI got
      // wrong: it is NOT pending, and it is NOT eligible.
      expect(
        deriveWaitlistStage(facts(null, APPROVED, null)).approvalEligible,
      ).toBe(false);
      expect(
        deriveWaitlistStage(facts(null, null, CONVERTED)).approvalEligible,
      ).toBe(false);
    });
  });

  describe('stage predicates are disjoint and exhaustive', () => {
    const stages = Object.keys(
      WAITLIST_STAGE_PREDICATES,
    ) as WaitlistListStage[];

    it.each(ALL_COMBINATIONS)(
      '($label) matches EXACTLY ONE stage predicate — the derived one',
      ({ row, stage }) => {
        const matched = stages.filter((candidate) =>
          matches(WAITLIST_STAGE_PREDICATES[candidate], row),
        );
        expect(matched).toEqual([stage]);
      },
    );

    it('eligibility requires BOTH stamps absent — the predicate twin of the derivation', () => {
      expect(
        matches(WAITLIST_ELIGIBLE_PREDICATE, facts(null, null, null)),
      ).toBe(true);
      expect(
        matches(WAITLIST_ELIGIBLE_PREDICATE, facts(NOTIFIED, null, null)),
      ).toBe(true);
      expect(
        matches(WAITLIST_ELIGIBLE_PREDICATE, facts(null, APPROVED, null)),
      ).toBe(false);
      expect(
        matches(WAITLIST_ELIGIBLE_PREDICATE, facts(null, null, CONVERTED)),
      ).toBe(false);
    });
  });

  describe('buildWaitlistWhere — AND combination of every optional filter', () => {
    it('returns {} when nothing is supplied', () => {
      expect(buildWaitlistWhere({})).toEqual({});
      expect(buildWaitlistWhere({ stage: 'all' })).toEqual({});
    });

    it('selects the literal predicate for each stage', () => {
      expect(buildWaitlistWhere({ stage: 'new' })).toEqual(
        WAITLIST_STAGE_PREDICATES.new,
      );
      expect(buildWaitlistWhere({ stage: 'invited' })).toEqual(
        WAITLIST_STAGE_PREDICATES.invited,
      );
      expect(buildWaitlistWhere({ stage: 'approved' })).toEqual(
        WAITLIST_STAGE_PREDICATES.approved,
      );
      expect(buildWaitlistWhere({ stage: 'converted' })).toEqual(
        WAITLIST_STAGE_PREDICATES.converted,
      );
    });

    it('search is trimmed and matches email OR source, case-insensitive', () => {
      expect(buildWaitlistWhere({ search: '  Jane@Example.com  ' })).toEqual({
        OR: [
          { email: { contains: 'Jane@Example.com', mode: 'insensitive' } },
          { source: { contains: 'Jane@Example.com', mode: 'insensitive' } },
        ],
      });
    });

    it('a whitespace-only search contributes nothing', () => {
      expect(buildWaitlistWhere({ search: '   ' })).toEqual({});
    });

    it('a known source filters by equality, unknown reads IS NULL', () => {
      expect(buildWaitlistWhere({ source: 'landing' })).toEqual({
        source: 'landing',
      });
      expect(buildWaitlistWhere({ source: 'unknown' })).toEqual({
        source: null,
      });
    });

    it('each date bound alone is an inclusive createdAt filter', () => {
      expect(
        buildWaitlistWhere({ createdFrom: '2026-09-01T00:00:00.000Z' }),
      ).toEqual({
        createdAt: { gte: new Date('2026-09-01T00:00:00.000Z') },
      });
      expect(
        buildWaitlistWhere({ createdTo: '2026-09-16T23:59:59.999Z' }),
      ).toEqual({
        createdAt: { lte: new Date('2026-09-16T23:59:59.999Z') },
      });
    });

    it('an equal boundary pair is accepted (inclusive, not exclusive)', () => {
      expect(
        buildWaitlistWhere({
          createdFrom: '2026-09-16T00:00:00.000Z',
          createdTo: '2026-09-16T00:00:00.000Z',
        }),
      ).toEqual({
        createdAt: {
          gte: new Date('2026-09-16T00:00:00.000Z'),
          lte: new Date('2026-09-16T00:00:00.000Z'),
        },
      });
    });

    it('🔴 a reversed range throws INVALID_DATE_RANGE with the exact safe body', () => {
      let thrown: unknown;
      try {
        buildWaitlistWhere({
          createdFrom: '2026-09-16T00:00:00.000Z',
          createdTo: '2026-09-01T00:00:00.000Z',
        });
      } catch (error: unknown) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(BadRequestException);
      const body = (thrown as BadRequestException).getResponse() as Record<
        string,
        unknown
      >;
      expect(body).toMatchObject({
        code: 'INVALID_DATE_RANGE',
        message: 'createdFrom must be before or equal to createdTo',
      });
    });

    it('stage + search + source + range form one AND, search keeping its OR', () => {
      const where = buildWaitlistWhere({
        stage: 'new',
        search: 'builder',
        source: 'landing',
        createdFrom: '2026-09-01T00:00:00.000Z',
        createdTo: '2026-09-16T23:59:59.999Z',
      });

      expect(Object.keys(where)).toEqual(['AND']);
      const clauses = (where as { AND: Prisma.WaitlistWhereInput[] }).AND;
      expect(clauses).toHaveLength(4);
      expect(clauses[0]).toEqual(WAITLIST_STAGE_PREDICATES.new);
      expect(clauses[1]).toEqual({
        OR: [
          { email: { contains: 'builder', mode: 'insensitive' } },
          { source: { contains: 'builder', mode: 'insensitive' } },
        ],
      });
      expect(clauses[2]).toEqual({ source: 'landing' });
      expect(clauses[3]).toEqual({
        createdAt: {
          gte: new Date('2026-09-01T00:00:00.000Z'),
          lte: new Date('2026-09-16T23:59:59.999Z'),
        },
      });
    });

    it('🔴 unexpected runtime stage/source values create no keys at all', () => {
      // The DTO layer is the real gate; these guards keep the policy honest
      // when a caller bypasses TypeScript. An injected value must not become
      // a Prisma key or a predicate.
      const where = buildWaitlistWhere({
        stage: 'not-a-stage' as never,
        source: 'landing; DROP TABLE' as never,
      });

      expect(where).toEqual({});
    });
  });

  describe('buildWaitlistOrderBy — deterministic order with id tie-breaker', () => {
    it('maps every allowlisted field and appends { id: asc }', () => {
      expect(buildWaitlistOrderBy('createdAt', 'desc')).toEqual([
        { createdAt: 'desc' },
        { id: 'asc' },
      ]);
      expect(buildWaitlistOrderBy('source', 'asc')).toEqual([
        { source: 'asc' },
        { id: 'asc' },
      ]);
      expect(buildWaitlistOrderBy('convertedAt', 'asc')).toEqual([
        { convertedAt: 'asc' },
        { id: 'asc' },
      ]);
    });

    it('🔴 an unexpected runtime sort value falls back to createdAt, never a dynamic key', () => {
      expect(
        buildWaitlistOrderBy('email; DROP TABLE' as never, 'desc'),
      ).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    });

    it('an unexpected order value falls back to desc', () => {
      expect(buildWaitlistOrderBy('createdAt', 'up' as never)).toEqual([
        { createdAt: 'desc' },
        { id: 'asc' },
      ]);
    });
  });
});
