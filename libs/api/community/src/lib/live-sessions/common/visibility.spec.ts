import type { MemberContext } from '@ptah-api/membership';
import { VISIBILITIES, type Visibility } from '@ptah-contracts/community';

import { buildLiveSessionVisibilityWhere } from './visibility';

/**
 * `buildLiveSessionVisibilityWhere` — ASSUMPTION-12, ASSUMPTION-13, AD-10.
 *
 * ⚠️ THE `where` IS ASSERTED **AND** EVALUATED. Asserting the object shape alone
 * proves the builder produced a clause; it does not prove the clause SELECTS the
 * right rows, and every visibility bug that matters is a bug about rows. So the
 * block below carries a ~15-line operator model of Prisma's `OR` and `hasSome`
 * — the same instrument `libs/api/learning`'s sibling spec uses — and runs a
 * fixture set of sessions through it.
 *
 * ⚠️ WHAT THE MODEL IS AND IS NOT. It is a faithful reading of the two operators
 * this builder actually emits (`OR` of branches, `hasSome` as array overlap),
 * not a Prisma emulator. It cannot catch a mistake in Prisma; it catches a
 * mistake in the BRANCHES, which is the only kind this file can make.
 */

const BASE: MemberContext = {
  userId: 'user_1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

const ctx = (over: Partial<MemberContext>): MemberContext => ({
  ...BASE,
  ...over,
});

/* -------------------------------------------------------------------------- */
/* The operator model                                                          */
/* -------------------------------------------------------------------------- */

interface SessionRow {
  readonly id: string;
  readonly visibility: Visibility;
  readonly cohortKeys: readonly string[];
}

/** Every fixture session, one per interesting (visibility, cohortKeys) pair. */
const ROWS: readonly SessionRow[] = [
  { id: 'member-open', visibility: 'member', cohortKeys: [] },
  { id: 'cohort-founding', visibility: 'cohort', cohortKeys: ['founding'] },
  { id: 'cohort-alumni', visibility: 'cohort', cohortKeys: ['alumni'] },
  {
    id: 'cohort-either',
    visibility: 'cohort',
    cohortKeys: ['founding', 'alumni'],
  },
  // A `cohort` session whose keys array is empty. Legal in the database (there
  // is no constraint tying the two columns together) and visible to NOBODY —
  // the AD-10 trap `AdminLiveSession.cohortNames` exists to make visible.
  { id: 'cohort-orphan', visibility: 'cohort', cohortKeys: [] },
  { id: 'staff-only', visibility: 'staff', cohortKeys: [] },
];

/**
 * Evaluate the emitted `where` against {@link ROWS}.
 *
 * Models exactly two operators, because those are the only two the builder
 * emits: a top-level `OR` (any branch matching selects the row) and, inside a
 * branch, `cohortKeys: { hasSome: [...] }` (array overlap).
 */
function visibleTo(context: MemberContext): string[] {
  const where = buildLiveSessionVisibilityWhere(context);
  const branches = where.OR;
  if (!Array.isArray(branches)) {
    throw new Error('the builder must emit a top-level OR array');
  }

  return ROWS.filter((row) =>
    branches.some((branch) => {
      const b = branch as {
        visibility?: unknown;
        cohortKeys?: { hasSome?: string[] };
      };
      if (b.visibility !== undefined && b.visibility !== row.visibility) {
        return false;
      }
      const hasSome = b.cohortKeys?.hasSome;
      if (hasSome !== undefined) {
        // Postgres array overlap: at least one element in common.
        return hasSome.some((key) => row.cohortKeys.includes(key));
      }
      return true;
    }),
  ).map((row) => row.id);
}

/* -------------------------------------------------------------------------- */

describe('buildLiveSessionVisibilityWhere', () => {
  describe('the emitted clause', () => {
    it('always includes the `member` branch, even with no cohorts and no admin', () => {
      // R7.8 / A-2: zero cohort assignments is the NORMAL state of this
      // workspace (`member_group_assignments` holds zero rows) and must never
      // reduce a member to seeing nothing.
      expect(buildLiveSessionVisibilityWhere(BASE)).toEqual({
        OR: [{ visibility: 'member' }],
      });
    });

    it('OMITS the cohort branch entirely when the member holds no keys', () => {
      // ⚠️ NOT `hasSome: []`. That would in fact be correct — Postgres array
      // overlap against an empty array matches nothing — and it is still wrong
      // to write, because its correctness rests on a property of one operator
      // that a reviewer cannot verify by reading the builder.
      const where = buildLiveSessionVisibilityWhere(BASE);
      const branches = where.OR as Array<Record<string, unknown>>;

      expect(branches).toHaveLength(1);
      expect(JSON.stringify(where)).not.toContain('hasSome');
    });

    it('adds the cohort branch, with a COPY of the keys, when the member has some', () => {
      const keys = ['founding', 'alumni'];
      const where = buildLiveSessionVisibilityWhere(ctx({ cohortKeys: keys }));

      expect(where).toEqual({
        OR: [
          { visibility: 'member' },
          {
            visibility: 'cohort',
            cohortKeys: { hasSome: ['founding', 'alumni'] },
          },
        ],
      });

      // 🔴 A COPY, NOT AN ALIAS. `MemberContext.cohortKeys` is request-scoped;
      // handing the same array reference to a query object would let a
      // downstream mutation of the query alter the member's own visibility
      // context for the rest of the request.
      const branch = (
        where.OR as Array<{ cohortKeys?: { hasSome: string[] } }>
      )[1];
      expect(branch?.cohortKeys?.hasSome).not.toBe(keys);
      expect(branch?.cohortKeys?.hasSome).toEqual(keys);
    });

    it('adds the staff branch for an admin, and only for an admin', () => {
      expect(buildLiveSessionVisibilityWhere(ctx({ isAdmin: true }))).toEqual({
        OR: [{ visibility: 'member' }, { visibility: 'staff' }],
      });
      expect(
        JSON.stringify(buildLiveSessionVisibilityWhere(BASE)),
      ).not.toContain('staff');
    });

    it('emits all three branches, in a stable order, for an admin with cohorts', () => {
      expect(
        buildLiveSessionVisibilityWhere(
          ctx({ cohortKeys: ['founding'], isAdmin: true }),
        ),
      ).toEqual({
        OR: [
          { visibility: 'member' },
          { visibility: 'cohort', cohortKeys: { hasSome: ['founding'] } },
          { visibility: 'staff' },
        ],
      });
    });

    it('🔴 emits NO `published` clause — ASSUMPTION-13', () => {
      // `LiveSession` has no `published` column (plan §1.5), so unlike a course
      // there is no draft posture. Adding the clause here would be a schema
      // decision made in a where-builder — and it would not compile — but the
      // assertion is written anyway because "the course builder has it and this
      // one does not" is exactly the asymmetry a reader tries to tidy away.
      const where = buildLiveSessionVisibilityWhere(
        ctx({ cohortKeys: ['founding'], isAdmin: true }),
      );

      expect(Object.keys(where)).toEqual(['OR']);
      expect(JSON.stringify(where)).not.toContain('published');
    });

    it('🔴 emits NO `deletedAt` clause — the caller spreads NOT_DELETED', () => {
      // AD-5's value is that the filter is a visible token AT THE READ SITE, so
      // `soft-delete-filter.spec.ts` can see it. A builder that carried it would
      // make every read look filtered whether or not it was.
      expect(
        JSON.stringify(buildLiveSessionVisibilityWhere(BASE)),
      ).not.toContain('deletedAt');
    });

    it('uses only values from the shared VISIBILITIES vocabulary', () => {
      // The `satisfies Visibility` pins in the builder are compile-time; this is
      // the runtime half. `LiveSession.visibility` is a Postgres String, so
      // nothing at the database layer would catch a drifted literal.
      const emitted = (
        buildLiveSessionVisibilityWhere(
          ctx({ cohortKeys: ['founding'], isAdmin: true }),
        ).OR as Array<{ visibility?: string }>
      ).map((branch) => branch.visibility);

      expect(emitted).toEqual(['member', 'cohort', 'staff']);
      for (const value of emitted) {
        expect(VISIBILITIES).toContain(value);
      }
    });
  });

  describe('the rows it actually selects', () => {
    it('a plain member with no cohorts sees ONLY member-visibility sessions', () => {
      expect(visibleTo(BASE)).toEqual(['member-open']);
    });

    it('a member in one cohort sees member + that cohort, and not another', () => {
      expect(visibleTo(ctx({ cohortKeys: ['founding'] }))).toEqual([
        'member-open',
        'cohort-founding',
        'cohort-either',
      ]);
    });

    it('a member in two cohorts matches a session naming EITHER (hasSome, not hasEvery)', () => {
      expect(visibleTo(ctx({ cohortKeys: ['founding', 'alumni'] }))).toEqual([
        'member-open',
        'cohort-founding',
        'cohort-alumni',
        'cohort-either',
      ]);
    });

    it('a `cohort` session with an EMPTY keys array is visible to nobody', () => {
      // The AD-10 trap: `cohortKeys` has no foreign key and no constraint tying
      // it to `visibility`, so this row saves cleanly and matches nobody —
      // including the admin who created it.
      for (const context of [
        BASE,
        ctx({ cohortKeys: ['founding', 'alumni'] }),
        ctx({ isAdmin: true, cohortKeys: ['founding'] }),
      ]) {
        expect(visibleTo(context)).not.toContain('cohort-orphan');
      }
    });

    it('an admin sees staff sessions — and STILL NOT cohort content they are not in', () => {
      // 🔴 ASSUMPTION-12's exact limit. Being an admin is not being in every
      // cohort; the staff grant is a read grant on one visibility value, not a
      // bypass.
      expect(visibleTo(ctx({ isAdmin: true }))).toEqual([
        'member-open',
        'staff-only',
      ]);
    });

    it('an admin WITH a cohort sees member + that cohort + staff, and nothing else', () => {
      expect(visibleTo(ctx({ isAdmin: true, cohortKeys: ['alumni'] }))).toEqual(
        ['member-open', 'cohort-alumni', 'cohort-either', 'staff-only'],
      );
    });

    it('a non-admin NEVER sees a staff session, whatever cohorts they hold', () => {
      expect(
        visibleTo(ctx({ cohortKeys: ['founding', 'alumni', 'staff'] })),
      ).not.toContain('staff-only');
    });

    it('a stale cohort key naming no session simply matches nothing — it is not an error', () => {
      // The failure direction is restrictive by design (R7.8): a data-entry
      // mistake degrades to "missing some content", never to "denied access".
      expect(visibleTo(ctx({ cohortKeys: ['typo-cohort'] }))).toEqual([
        'member-open',
      ]);
    });
  });

  describe('anti-vacuity — the operator model can tell rows apart', () => {
    it('the fixture set really does contain a row of every visibility value', () => {
      // If every fixture were `member`-visible, every assertion above would pass
      // against a builder that emitted one branch and ignored the rest.
      const kinds = [...new Set(ROWS.map((r) => r.visibility))].sort();
      expect(kinds).toEqual(['cohort', 'member', 'staff']);
      expect([...VISIBILITIES].sort()).toEqual(kinds);
    });

    it('a clause matching nothing selects nothing — the model is not a pass-through', () => {
      // The model is the instrument every "selects these rows" assertion is
      // read through; if it returned everything regardless, none of them would
      // mean anything.
      const nobody = ROWS.filter(() => false).map((r) => r.id);
      expect(nobody).toEqual([]);
      expect(visibleTo(BASE).length).toBeLessThan(ROWS.length);
    });
  });
});
