import type { MemberContext } from '@ptah-api/membership';
import type { Visibility } from '@ptah-contracts/community';

import {
  buildCategoryVisibilityWhere,
  buildTopicCategoryVisibilityWhere,
} from './visibility';

/**
 * R1.1.1 / R1.1.2 / R1.1.3 and ASSUMPTION-4.
 *
 * ⚠️ THESE TESTS ASSERT WHICH CATEGORIES ARE VISIBLE, NOT WHAT THE WHERE-CLAUSE
 * LOOKS LIKE.
 *
 * A test that only compared the emitted object to an expected literal would
 * pass for a where-clause that is the right SHAPE and the wrong MEANING — the
 * cohort branch matching on the wrong column, say. So each case below runs the
 * generated clause through {@link matches}, a small model of the two Prisma
 * operators actually used (`OR`, and `hasSome` over a `String[]` column), and
 * asserts the resulting VISIBLE SET.
 *
 * `matches` is a model of Prisma, not Prisma. It is ~15 lines and covers
 * exactly the two operators this builder emits; if the builder ever emits a
 * third, `matches` throws rather than silently returning `false` and turning a
 * new branch into an invisible category. That is the failure mode a hand-rolled
 * interpreter usually has, and the throw is what removes it.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface CategoryRow {
  readonly slug: string;
  readonly visibility: Visibility;
  readonly cohortKeys: readonly string[];
}

const CATEGORIES: readonly CategoryRow[] = [
  { slug: 'general', visibility: 'member', cohortKeys: [] },
  { slug: 'help', visibility: 'member', cohortKeys: [] },
  { slug: 'founding-lounge', visibility: 'cohort', cohortKeys: ['founding'] },
  { slug: 'arabic-cohort', visibility: 'cohort', cohortKeys: ['arabic'] },
  {
    slug: 'multi-cohort',
    visibility: 'cohort',
    cohortKeys: ['founding', 'arabic'],
  },
  { slug: 'staff-room', visibility: 'staff', cohortKeys: [] },
];

function member(overrides: Partial<MemberContext> = {}): MemberContext {
  return {
    userId: 'user-1',
    email: 'member@example.com',
    entitled: true,
    cohortKeys: [],
    isAdmin: false,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* A model of the two Prisma operators this builder emits                      */
/* -------------------------------------------------------------------------- */

/** The shape `buildCategoryVisibilityWhere` actually produces. */
interface Branch {
  visibility?: string;
  cohortKeys?: { hasSome?: string[] };
}

function matchesBranch(branch: Branch, row: CategoryRow): boolean {
  const keys = Object.keys(branch);
  const unsupported = keys.filter(
    (k) => k !== 'visibility' && k !== 'cohortKeys',
  );
  if (unsupported.length > 0) {
    // See the file docblock: a new operator must break this test loudly rather
    // than evaluate to `false` and quietly hide a category from everyone.
    throw new Error(
      `visibility.spec.ts models only 'visibility' and 'cohortKeys.hasSome'; ` +
        `the builder emitted: ${unsupported.join(', ')}. Extend the model.`,
    );
  }

  if (branch.visibility !== undefined && branch.visibility !== row.visibility) {
    return false;
  }
  if (branch.cohortKeys !== undefined) {
    const hasSome = branch.cohortKeys.hasSome ?? [];
    // Postgres array overlap: true iff the two arrays share at least one element.
    if (!hasSome.some((k) => row.cohortKeys.includes(k))) return false;
  }
  return true;
}

/** Apply a generated `where` to the fixture set and return the visible slugs. */
function visibleSlugs(ctx: MemberContext): string[] {
  const where = buildCategoryVisibilityWhere(ctx) as { OR?: Branch[] };
  const branches = where.OR ?? [];

  return CATEGORIES.filter((row) =>
    branches.some((branch) => matchesBranch(branch, row)),
  ).map((row) => row.slug);
}

/* -------------------------------------------------------------------------- */

describe('buildCategoryVisibilityWhere — what each member actually sees', () => {
  it('entitled non-admin with ZERO cohorts sees member categories only', () => {
    // The normal state today: `member_group_assignments` holds zero rows. An
    // empty cohort list is a valid, expected value and must never error or
    // blank the surface (R7.8, A-2).
    expect(visibleSlugs(member())).toEqual(['general', 'help']);
  });

  it("entitled non-admin with 'founding' additionally sees that cohort's categories", () => {
    const slugs = visibleSlugs(member({ cohortKeys: ['founding'] }));

    expect(slugs).toEqual([
      'general',
      'help',
      'founding-lounge',
      'multi-cohort',
    ]);
  });

  it('cohort matching is ANY-match — one held key is enough for a multi-key category', () => {
    // AD-10: `cohortKeys` is a String[] column matched with `hasSome`, not an
    // ALL-match. `multi-cohort` requires founding OR arabic, not both.
    expect(visibleSlugs(member({ cohortKeys: ['arabic'] }))).toEqual([
      'general',
      'help',
      'arabic-cohort',
      'multi-cohort',
    ]);
  });

  it('NOBODY sees a cohort category whose keys they do not hold', () => {
    // The negative control for branch 2. A rule that granted everything would
    // pass every assertion above.
    const slugs = visibleSlugs(member({ cohortKeys: ['founding'] }));

    expect(slugs).not.toContain('arabic-cohort');
  });

  it('an ADMIN additionally sees staff categories (ASSUMPTION-4)', () => {
    expect(visibleSlugs(member({ isAdmin: true }))).toEqual([
      'general',
      'help',
      'staff-room',
    ]);
  });

  it('an entitled NON-ADMIN member does NOT see a staff category — this is what makes the 404 natural (R1.1.3)', () => {
    // ⚠️ THE LOAD-BEARING ASSERTION OF THIS FILE, and the one to change first if
    // ASSUMPTION-4 is overruled.
    //
    // Because the staff category is not in the member's where-clause at all,
    // a request for it finds NO ROW. The controller therefore answers 404
    // because that is the honest result of the query it ran — not because
    // something remembered to translate a 403. A 403 would confirm the
    // category exists, which is the membership oracle R1.1.3 forbids.
    const slugs = visibleSlugs(member({ cohortKeys: ['founding'] }));

    expect(slugs).not.toContain('staff-room');
  });

  it('being an admin does NOT grant cohort content', () => {
    // The stated limit of ASSUMPTION-4: `isAdmin` satisfies the staff branch
    // and nothing else. An admin with no assignments is not in every cohort.
    const slugs = visibleSlugs(member({ isAdmin: true }));

    expect(slugs).not.toContain('founding-lounge');
    expect(slugs).not.toContain('multi-cohort');
  });

  it('an admin WITH a cohort sees member + that cohort + staff', () => {
    const slugs = visibleSlugs(
      member({ isAdmin: true, cohortKeys: ['founding'] }),
    );

    expect(slugs).toEqual([
      'general',
      'help',
      'founding-lounge',
      'multi-cohort',
      'staff-room',
    ]);
  });
});

describe('buildCategoryVisibilityWhere — the emitted clause', () => {
  it('omits the cohort branch entirely when the member holds no keys', () => {
    // Not cosmetic. `hasSome: []` would happen to be correct in Postgres, and
    // relying on that is a correctness argument no reviewer can check by
    // reading the file. An absent branch is correct for a visible reason.
    const where = buildCategoryVisibilityWhere(member()) as { OR: Branch[] };

    expect(where.OR).toEqual([{ visibility: 'member' }]);
    expect(JSON.stringify(where)).not.toContain('hasSome');
  });

  it('emits the cohort branch with hasSome when the member holds keys', () => {
    const where = buildCategoryVisibilityWhere(
      member({ cohortKeys: ['founding', 'arabic'] }),
    ) as { OR: Branch[] };

    expect(where.OR).toEqual([
      { visibility: 'member' },
      {
        visibility: 'cohort',
        cohortKeys: { hasSome: ['founding', 'arabic'] },
      },
    ]);
  });

  it('copies cohortKeys into a mutable array rather than aliasing the context', () => {
    // `MemberContext.cohortKeys` is `readonly string[]`. Handing the same
    // reference to Prisma would let a downstream mutation of the query alter
    // the request-scoped member context.
    const ctx = member({ cohortKeys: ['founding'] });
    const where = buildCategoryVisibilityWhere(ctx) as { OR: Branch[] };
    const emitted = where.OR[1]?.cohortKeys?.hasSome;

    expect(emitted).toEqual(['founding']);
    expect(emitted).not.toBe(ctx.cohortKeys);
  });

  it('never emits an empty OR — every member matches at least the member branch', () => {
    // An empty `OR: []` matches NOTHING in Prisma, which would make the whole
    // forum invisible to everyone rather than failing loudly.
    for (const ctx of [
      member(),
      member({ isAdmin: true }),
      member({ cohortKeys: ['founding'] }),
    ]) {
      const where = buildCategoryVisibilityWhere(ctx) as { OR: Branch[] };

      expect(where.OR.length).toBeGreaterThan(0);
      expect(where.OR).toContainEqual({ visibility: 'member' });
    }
  });
});

describe('buildTopicCategoryVisibilityWhere', () => {
  it('nests the same clause under `category`, so invisible and not-found are one event', () => {
    const ctx = member({ cohortKeys: ['founding'] });

    expect(buildTopicCategoryVisibilityWhere(ctx)).toEqual({
      category: buildCategoryVisibilityWhere(ctx),
    });
  });
});

describe('anti-vacuity — the fixtures and the model actually discriminate', () => {
  it('the fixture set contains all three visibility values', () => {
    // If every fixture were `member`, every "does not contain" assertion above
    // would pass trivially.
    const kinds = new Set(CATEGORIES.map((c) => c.visibility));

    expect([...kinds].sort()).toEqual(['cohort', 'member', 'staff']);
  });

  it('the model rejects as well as accepts', () => {
    const row: CategoryRow = {
      slug: 'x',
      visibility: 'cohort',
      cohortKeys: ['founding'],
    };

    expect(matchesBranch({ visibility: 'cohort' }, row)).toBe(true);
    expect(matchesBranch({ visibility: 'member' }, row)).toBe(false);
    expect(matchesBranch({ cohortKeys: { hasSome: ['arabic'] } }, row)).toBe(
      false,
    );
    expect(
      matchesBranch({ cohortKeys: { hasSome: ['arabic', 'founding'] } }, row),
    ).toBe(true);
  });

  it('the model THROWS on an operator it does not understand', () => {
    // The guard described in the file docblock: a future branch using a filter
    // this model does not implement must break the test, not evaluate false.
    expect(() =>
      matchesBranch({ slug: 'x' } as unknown as Branch, CATEGORIES[0]),
    ).toThrow(/models only/);
  });
});
