import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaService } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';

import { MemberPacksService } from './member-packs.service';
import { toMemberPack, type PackRow } from './packs.types';

/**
 * `MemberPacksService` — R5.1, R5.2, R5.3, R5.4 / A-1, R5.5, NFR-S4, NFR-S5.
 *
 * FOUR PROPERTIES, AND TWO OF THEM ARE ABSENCES:
 *
 *   1. NFR-S5 (exit-gate clause 1) — `notes` is not a key of the response AND
 *      the notes VALUE appears nowhere in the serialised body. The second half
 *      is what catches a `notes` string smuggled into a different field.
 *   2. THE ABSENCE OF INJECTION — the service imports and injects neither
 *      `CohortResolver` nor `MembershipService` nor `MemberGroupsService`.
 *      `CohortResolver` is `@Global()` and reachable from anywhere without a
 *      module import, so nothing structural stops it: this assertion IS the
 *      control.
 *   3. A-1 POSITIVELY — three fixtures against a ZERO-COHORT member. Two come
 *      back, one of them cohort-labelled. A cohort-filtering implementation
 *      returns one and fails here (RISK-AK: the live table holds zero rows, so
 *      an assertion that does not seed its own fixtures is vacuous).
 *   4. `accessNote` SURVIVES the mapper as its own field and is never conflated
 *      with `notes` (R5.5).
 *
 * A hand-rolled Prisma double, the way `packs.service.spec.ts` and
 * `member-groups.service.spec.ts` do it — `createMockPrisma()` in
 * `@ptah-api/core/testing` covers nine models and `pack` is not one of them.
 */

interface MockPrisma {
  pack: { findMany: jest.Mock };
}

/** The admin-internal note. Its VALUE is what NFR-S5's second half hunts for. */
const SECRET_NOTE = 'INTERNAL-ONLY: invoice not settled, do not chase publicly';

function row(overrides: Partial<PackRow>): PackRow {
  return {
    id: 'pack_base',
    slug: 'base',
    title: 'Base',
    description: 'A pack.',
    repoUrl: 'https://github.com/Hive-Academy/base',
    notes: SECRET_NOTE,
    memberVisible: true,
    accessNote: null,
    tags: [],
    cohortKey: null,
    createdBy: 'admin@example.com',
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-02T10:00:00.000Z'),
    cohort: null,
    ...overrides,
  };
}

/**
 * The three fixtures RISK-AK's mitigation names. Note that `HIDDEN` is here to
 * be *filtered by the query* — the double returns whatever the service's `where`
 * asks for, so the filter is asserted on the `where` ARGUMENT rather than by
 * pretending the double implements Postgres.
 */
const VISIBLE_LABELLED = row({
  id: 'pack_labelled',
  slug: 'saas-starter',
  title: 'A SaaS Starter',
  tags: ['nestjs', 'angular'],
  cohortKey: 'founding',
  cohort: { name: 'Founding Members' },
  accessNote: 'You will receive a GitHub invite within 24h.',
});

const VISIBLE_UNLABELLED = row({
  id: 'pack_unlabelled',
  slug: 'agent-harness',
  title: 'B Agent Harness',
  tags: ['claude'],
  cohortKey: null,
  cohort: null,
});

/**
 * 🔴 DERIVED FROM `VISIBLE_UNLABELLED` SO THE ONLY MEANINGFUL DIFFERENCE IS
 * `memberVisible`. Written out independently, this fixture could differ in a
 * tag, a cohort or a note, and the filter assertion below would then be passing
 * for a reason nobody chose. Identity fields differ because they must.
 */
const HIDDEN: PackRow = {
  ...VISIBLE_UNLABELLED,
  id: 'pack_hidden',
  slug: 'unreleased',
  title: 'C Unreleased',
  memberVisible: false,
};

/**
 * A member with NO cohort assignments — the state A-1 is about. An entitled
 * member an admin has not yet placed in a group resolves to `cohortKeys: []`
 * (R7.8), and every member-visible pack must still reach them.
 */
const ZERO_COHORT_CTX: MemberContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

function build(rows: PackRow[]) {
  const prisma: MockPrisma = {
    pack: { findMany: jest.fn().mockResolvedValue(rows) },
  };
  const service = new MemberPacksService(prisma as unknown as PrismaService);
  return { service, prisma };
}

/**
 * A double that actually APPLIES the `where` the service issues, so the
 * three-fixture case is a real filter assertion rather than a restatement of
 * whatever rows the test decided to hand back (RISK-AK: `packs` holds zero rows
 * in this workspace, so a double that ignores the `where` proves nothing).
 *
 * ⚠️ IT COMPARES EVERY KEY OF THE `where` BY EQUALITY, AND THAT IS WHY IT IS
 * SAFE. It is not a re-implementation of Postgres: it understands scalar
 * equality and nothing else. An implementation that added `cohortKey: { in: [] }`
 * would produce a clause this cannot match, every row would be filtered out, and
 * the assertion below would fail loudly instead of quietly passing. The
 * non-vacuous LIVE version, against three seeded rows, is Task 14.17's.
 */
function buildFiltering(allRows: PackRow[]) {
  const prisma: MockPrisma = {
    pack: {
      findMany: jest.fn(async (args: { where: Record<string, unknown> }) =>
        allRows.filter((r) =>
          Object.entries(args.where).every(
            ([key, value]) =>
              (r as unknown as Record<string, unknown>)[key] === value,
          ),
        ),
      ),
    },
  };
  const service = new MemberPacksService(prisma as unknown as PrismaService);
  return { service, prisma };
}

describe('MemberPacksService', () => {
  describe('A-1 — the where clause is `memberVisible: true` and nothing else', () => {
    it('queries on memberVisible ONLY, by exact equality on the where object', () => {
      const { service, prisma } = build([]);

      return service.list(ZERO_COHORT_CTX).then(() => {
        const args = prisma.pack.findMany.mock.calls[0]?.[0] as {
          where: unknown;
        };

        // 🔴 EXACT EQUALITY, NOT `toMatchObject`. `toMatchObject` would pass
        // against `{ memberVisible: true, cohortKey: { in: [] } }` — which is
        // precisely the implementation this assertion exists to reject, and
        // which would return NOTHING for a zero-cohort member.
        expect(args.where).toEqual({ memberVisible: true });
      });
    });

    it('never passes the member context into the query in any form', async () => {
      const { service, prisma } = build([]);

      await service.list(ZERO_COHORT_CTX);

      const serialised = JSON.stringify(
        prisma.pack.findMany.mock.calls[0]?.[0],
      );
      expect(serialised).not.toContain(ZERO_COHORT_CTX.userId);
      expect(serialised).not.toContain('cohortKey');
      expect(serialised).not.toContain('cohortKeys');
    });

    it('THREE fixtures in, TWO out, for a ZERO-COHORT member (RISK-AK)', async () => {
      // visible+cohort-labelled · visible+unlabelled · hidden.
      const { service } = buildFiltering([
        VISIBLE_LABELLED,
        VISIBLE_UNLABELLED,
        HIDDEN,
      ]);

      const result = await service.list(ZERO_COHORT_CTX);

      expect(result.map((p) => p.slug).sort()).toEqual([
        'agent-harness',
        'saas-starter',
      ]);
      // 🔴 THE COHORT-LABELLED PACK IS AMONG THEM, AND THE MEMBER HAS NO
      // COHORTS. A cohort-filtering implementation drops exactly this one and
      // returns a list of length 1 — which is what makes the assertion a
      // control rather than a restatement.
      expect(result.find((p) => p.slug === 'saas-starter')?.cohortName).toBe(
        'Founding Members',
      );
      // And the hidden one is not merely absent from the response — it never
      // came back from the query.
      expect(result.some((p) => p.slug === HIDDEN.slug)).toBe(false);
    });

    it('the hidden fixture differs from a visible one ONLY in memberVisible', () => {
      // Otherwise the filter assertion above could be passing for a reason
      // nobody chose — a different tag, a different cohort, a different note.
      const differingKeys = (
        Object.keys(HIDDEN) as Array<keyof PackRow>
      ).filter((key) => HIDDEN[key] !== VISIBLE_UNLABELLED[key]);

      expect(differingKeys.sort()).toEqual([
        'id',
        'memberVisible',
        'slug',
        'title',
      ]);
    });

    it('orders by title ascending and includes only the cohort NAME', async () => {
      const { service, prisma } = build([]);

      await service.list(ZERO_COHORT_CTX);

      const args = prisma.pack.findMany.mock.calls[0]?.[0] as {
        orderBy: unknown;
        include: unknown;
      };
      expect(args.orderBy).toEqual({ title: 'asc' });
      // `select: { name: true }` and not the whole cohort row: a member has no
      // business receiving `MemberGroup.key`, which is the value that looks like
      // an access control.
      expect(args.include).toEqual({ cohort: { select: { name: true } } });
    });
  });

  describe('NFR-S5 — `notes` cannot reach a member (exit-gate clause 1)', () => {
    it('does not carry `notes` as a key, for a pack whose notes is non-empty', async () => {
      const { service } = build([VISIBLE_LABELLED]);

      const result = await service.list(ZERO_COHORT_CTX);

      expect(VISIBLE_LABELLED.notes).toEqual(expect.any(String));
      expect(VISIBLE_LABELLED.notes).not.toHaveLength(0);
      expect(Object.keys(result[0] ?? {})).not.toContain('notes');
    });

    it('the notes VALUE appears nowhere in the serialised response', async () => {
      // 🔴 THE HALF THAT CATCHES A SMUGGLED VALUE. A mapper that wrote
      // `accessNote: row.accessNote ?? row.notes` passes the key assertion above
      // and fails this one.
      const { service } = build([VISIBLE_LABELLED, VISIBLE_UNLABELLED]);

      const result = await service.list(ZERO_COHORT_CTX);

      expect(JSON.stringify(result)).not.toContain(SECRET_NOTE);
    });

    it('emits exactly the eight MemberPack fields — no admin field by any name', async () => {
      const { service } = build([VISIBLE_LABELLED]);

      const [first] = await service.list(ZERO_COHORT_CTX);

      expect(Object.keys(first ?? {}).sort()).toEqual([
        'accessNote',
        'cohortName',
        'description',
        'id',
        'repoUrl',
        'slug',
        'tags',
        'title',
      ]);
      // Named individually so a failure says WHICH one leaked.
      for (const forbidden of [
        'notes',
        'createdBy',
        'createdAt',
        'updatedAt',
        'cohortKey',
        'memberVisible',
      ]) {
        expect({ forbidden, present: forbidden in (first ?? {}) }).toEqual({
          forbidden,
          present: false,
        });
      }
    });
  });

  describe('R5.5 — accessNote survives, and is never conflated with notes', () => {
    it('carries the member-facing note through unchanged', async () => {
      const { service } = build([VISIBLE_LABELLED]);

      const [first] = await service.list(ZERO_COHORT_CTX);

      expect(first?.accessNote).toBe(
        'You will receive a GitHub invite within 24h.',
      );
    });

    it('is null — not the admin note — when the admin wrote no access note', async () => {
      const { service } = build([VISIBLE_UNLABELLED]);

      const [first] = await service.list(ZERO_COHORT_CTX);

      expect(VISIBLE_UNLABELLED.notes).toBe(SECRET_NOTE);
      expect(first?.accessNote).toBeNull();
    });

    it('cohortName is null when the pack is unlabelled or its cohort was deleted', () => {
      expect(toMemberPack(VISIBLE_UNLABELLED).cohortName).toBeNull();
      // `onDelete: SetNull` on the FK leaves `cohortKey` set with no row behind
      // it only in the deleted-cohort case; the include then yields no `cohort`.
      expect(
        toMemberPack(row({ cohortKey: 'gone', cohort: null })).cohortName,
      ).toBeNull();
    });

    it('the mapper is explicit, not a spread — an unknown column cannot ride along', () => {
      // A future migration's column, present on the row and absent from
      // `MemberPack`. A `{ ...row }` mapper emits it; this one cannot.
      const future = {
        ...row({}),
        internalRiskScore: 42,
      } as unknown as PackRow;

      expect(Object.keys(toMemberPack(future))).not.toContain(
        'internalRiskScore',
      );
      expect(JSON.stringify(toMemberPack(future))).not.toContain('42');
    });
  });

  /**
   * 🔴 THE CONTROL. `CohortResolver` is `@Global()` and provided by
   * `MembershipModule`, so `@Inject(CohortResolver)` in this file would compile,
   * resolve at runtime and pass every behavioural test above that did not
   * happen to notice. The only thing that can catch it is an assertion over the
   * SOURCE TEXT.
   *
   * ⚠️ ASSERTED AGAINST IMPORT STATEMENTS AND `@Inject(...)`, NOT RAW
   * SUBSTRINGS. The class docblock names all three services in prose to explain
   * why they are absent, and a `toContain` would read that documentation as the
   * violation — the idiom `admin-guards.spec.ts` G6 and
   * `admin-courses.controller.spec.ts` already use, for the identical reason.
   */
  describe('the absence of injection IS the control (ground truth 12)', () => {
    const SOURCE = readFileSync(
      join(__dirname, 'member-packs.service.ts'),
      'utf8',
    );

    it.each([
      ['CohortResolver', /import\s[^;]*\bCohortResolver\b[^;]*from/],
      ['MembershipService', /import\s[^;]*\bMembershipService\b[^;]*from/],
      ['MemberGroupsService', /import\s[^;]*\bMemberGroupsService\b[^;]*from/],
    ])('imports no %s', (_name, pattern) => {
      expect(pattern.test(SOURCE)).toBe(false);
    });

    it.each([
      ['CohortResolver', /@Inject\(\s*CohortResolver\s*\)/],
      ['MembershipService', /@Inject\(\s*MembershipService\s*\)/],
      ['MemberGroupsService', /@Inject\(\s*MemberGroupsService\s*\)/],
    ])('injects no %s by token', (_name, pattern) => {
      expect(pattern.test(SOURCE)).toBe(false);
    });

    it('imports neither module barrel that would make one reachable', () => {
      expect(SOURCE).not.toMatch(/from\s+'[^']*cohort-resolver[^']*'/);
      expect(SOURCE).not.toMatch(/from\s+'[^']*membership\.service'/);
      expect(SOURCE).not.toMatch(/from\s+'[^']*member-groups\.service'/);
    });

    it('takes PrismaService and nothing else — one constructor parameter', () => {
      // `MemberPacksService.length` is the arity of the constructor Nest calls.
      expect(MemberPacksService.length).toBe(1);
    });

    it('does not import the ADMIN service or its module', () => {
      // Co-location is not co-registration (RISK-AG). Same directory, and no
      // edge between the two.
      expect(SOURCE).not.toMatch(/from\s+'\.\/packs\.service'/);
      expect(SOURCE).not.toMatch(/from\s+'\.\/packs\.module'/);
    });

    it('the deliberately-unread ctx is documented, not accidental', () => {
      // Without the note the next reader sees an unused parameter, "fixes" it
      // into a cohort filter, and every unlabelled pack disappears for everyone.
      expect(SOURCE).toContain('_ctx');
      expect(SOURCE).toMatch(/DELIBERATELY UNREAD/);
      expect(SOURCE).toContain('A-1');
    });
  });
});
