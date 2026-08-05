import type { MemberContext } from '@ptah-api/membership';
import type { Visibility } from '@ptah-contracts/community';

import {
  buildCourseVisibilityWhere,
  buildLessonCourseVisibilityWhere,
  buildModuleCourseVisibilityWhere,
} from './visibility';

/**
 * R2.1.1 / R2.1.2 / R2.1.3 and ASSUMPTION-7.
 *
 * ⚠️ THESE TESTS ASSERT WHICH COURSES ARE VISIBLE, NOT WHAT THE WHERE-CLAUSE
 * LOOKS LIKE.
 *
 * A test that only compared the emitted object to an expected literal would
 * pass for a where-clause that is the right SHAPE and the wrong MEANING — the
 * cohort branch matching on the wrong column, the `published` gate landing
 * inside the `OR` instead of beside it. So each case below runs the generated
 * clause through {@link matchesBranch}, a small model of the three Prisma
 * operators actually emitted (`published`, `visibility`, and `hasSome` over a
 * `String[]` column), and asserts the resulting VISIBLE SET.
 *
 * The model is ~20 lines and covers exactly what the builder emits; if the
 * builder ever emits a fourth thing, the model THROWS rather than silently
 * returning `false` and turning a new branch into a course nobody can see. That
 * is the failure mode a hand-rolled interpreter usually has, and the throw is
 * what removes it.
 *
 * ⚠️ THE LIVE GATE THIS FILE SERVES. The dev account holds
 * `DEV-BUILDERS-VALIDATION-0001`, is in `ADMIN_EMAILS`, and has ZERO
 * `member_group_assignments`. So one account proves both halves of A-2: a
 * `visibility: 'cohort'` course must be invisible to it (404, never 403) while
 * a `visibility: 'member'` course is visible. Task 9.17 repeats it live.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface CourseRow {
  readonly slug: string;
  readonly visibility: Visibility;
  readonly cohortKeys: readonly string[];
  readonly published: boolean;
}

const COURSES: readonly CourseRow[] = [
  {
    slug: 'foundations',
    visibility: 'member',
    cohortKeys: [],
    published: true,
  },
  { slug: 'shipping', visibility: 'member', cohortKeys: [], published: true },
  {
    slug: 'founding-masterclass',
    visibility: 'cohort',
    cohortKeys: ['founding'],
    published: true,
  },
  {
    slug: 'arabic-track',
    visibility: 'cohort',
    cohortKeys: ['arabic'],
    published: true,
  },
  {
    slug: 'multi-cohort',
    visibility: 'cohort',
    cohortKeys: ['founding', 'arabic'],
    published: true,
  },
  {
    slug: 'staff-playbook',
    visibility: 'staff',
    cohortKeys: [],
    published: true,
  },
  // 🔴 R2.1.2 — a DRAFT `member`-visibility course. It is the row that would be
  // visible to everyone if `published` were dropped from the clause, which is
  // exactly why it carries the most permissive visibility available.
  {
    slug: 'draft-course',
    visibility: 'member',
    cohortKeys: [],
    published: false,
  },
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
/* A model of the Prisma operators this builder emits                          */
/* -------------------------------------------------------------------------- */

/** The shape `buildCourseVisibilityWhere` actually produces. */
interface Branch {
  visibility?: string;
  cohortKeys?: { hasSome?: string[] };
}

function matchesBranch(branch: Branch, row: CourseRow): boolean {
  const unsupported = Object.keys(branch).filter(
    (k) => k !== 'visibility' && k !== 'cohortKeys',
  );
  if (unsupported.length > 0) {
    // See the file docblock: a new operator must break this test loudly rather
    // than evaluate to `false` and quietly hide a course from everyone.
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
  const where = buildCourseVisibilityWhere(ctx) as {
    published?: boolean;
    OR?: Branch[];
  };

  const unsupportedTop = Object.keys(where).filter(
    (k) => k !== 'published' && k !== 'OR',
  );
  if (unsupportedTop.length > 0) {
    throw new Error(
      `visibility.spec.ts models only a top-level 'published' and 'OR'; the ` +
        `builder emitted: ${unsupportedTop.join(', ')}. Extend the model.`,
    );
  }

  const branches = where.OR ?? [];

  return COURSES.filter((row) => {
    if (where.published !== undefined && where.published !== row.published) {
      return false;
    }
    return branches.some((branch) => matchesBranch(branch, row));
  }).map((row) => row.slug);
}

/* -------------------------------------------------------------------------- */

describe('buildCourseVisibilityWhere — what each member actually sees', () => {
  it('entitled non-admin with ZERO cohorts sees member courses only', () => {
    // The normal state today: `member_group_assignments` holds zero rows. An
    // empty cohort list is a valid, expected value and must never error or
    // blank the surface (R7.8, A-2).
    expect(visibleSlugs(member())).toEqual(['foundations', 'shipping']);
  });

  it("entitled non-admin with 'founding' additionally sees that cohort's courses", () => {
    expect(visibleSlugs(member({ cohortKeys: ['founding'] }))).toEqual([
      'foundations',
      'shipping',
      'founding-masterclass',
      'multi-cohort',
    ]);
  });

  it('cohort matching is ANY-match — one held key is enough for a multi-key course', () => {
    // AD-10: `cohortKeys` is a String[] column matched with `hasSome`, not an
    // ALL-match. `multi-cohort` requires founding OR arabic, not both.
    expect(visibleSlugs(member({ cohortKeys: ['arabic'] }))).toEqual([
      'foundations',
      'shipping',
      'arabic-track',
      'multi-cohort',
    ]);
  });

  it('NOBODY sees a cohort course whose keys they do not hold', () => {
    // The negative control for branch 2. A rule that granted everything would
    // pass every assertion above.
    expect(visibleSlugs(member({ cohortKeys: ['founding'] }))).not.toContain(
      'arabic-track',
    );
  });

  it('an ADMIN additionally sees staff courses (ASSUMPTION-7)', () => {
    expect(visibleSlugs(member({ isAdmin: true }))).toEqual([
      'foundations',
      'shipping',
      'staff-playbook',
    ]);
  });

  it('an entitled NON-ADMIN member does NOT see a staff course — this is what makes the 404 natural (R2.1.3)', () => {
    // ⚠️ THE LOAD-BEARING ASSERTION OF THIS FILE, and the one to change first
    // if ASSUMPTION-7 is overruled.
    //
    // Because the staff course is not in the member's where-clause at all, a
    // request for it finds NO ROW. The controller answers 404 because that is
    // the honest result of the query it ran — not because something remembered
    // to translate a 403.
    expect(visibleSlugs(member({ cohortKeys: ['founding'] }))).not.toContain(
      'staff-playbook',
    );
  });

  it('being an admin does NOT grant cohort content', () => {
    // The stated limit of ASSUMPTION-7: `isAdmin` satisfies the staff branch
    // and nothing else. An admin with no assignments is not in every cohort.
    const slugs = visibleSlugs(member({ isAdmin: true }));

    expect(slugs).not.toContain('founding-masterclass');
    expect(slugs).not.toContain('multi-cohort');
  });

  it('an admin WITH a cohort sees member + that cohort + staff', () => {
    expect(
      visibleSlugs(member({ isAdmin: true, cohortKeys: ['founding'] })),
    ).toEqual([
      'foundations',
      'shipping',
      'founding-masterclass',
      'multi-cohort',
      'staff-playbook',
    ]);
  });

  it('🔴 R2.1.2 — a DRAFT course is invisible to EVERYONE, including the admin', () => {
    // The draft fixture is `visibility: 'member'`, i.e. the most permissive
    // value there is. If `published: true` were ever dropped from the clause —
    // or moved inside the `OR`, where any other branch would satisfy it — this
    // is the assertion that catches it, for every caller shape at once.
    for (const ctx of [
      member(),
      member({ isAdmin: true }),
      member({ cohortKeys: ['founding'] }),
      member({ isAdmin: true, cohortKeys: ['founding', 'arabic'] }),
    ]) {
      expect(visibleSlugs(ctx)).not.toContain('draft-course');
    }
  });
});

describe('buildCourseVisibilityWhere — the emitted clause', () => {
  it('omits the cohort branch entirely when the member holds no keys', () => {
    // Not cosmetic. `hasSome: []` would happen to be correct in Postgres, and
    // relying on that is a correctness argument no reviewer can check by
    // reading the file. An absent branch is correct for a visible reason.
    const where = buildCourseVisibilityWhere(member()) as {
      published: boolean;
      OR: Branch[];
    };

    expect(where.OR).toEqual([{ visibility: 'member' }]);
    expect(JSON.stringify(where)).not.toContain('hasSome');
  });

  it('emits the cohort branch with hasSome when the member holds keys', () => {
    const where = buildCourseVisibilityWhere(
      member({ cohortKeys: ['founding', 'arabic'] }),
    ) as { OR: Branch[] };

    expect(where.OR).toEqual([
      { visibility: 'member' },
      { visibility: 'cohort', cohortKeys: { hasSome: ['founding', 'arabic'] } },
    ]);
  });

  it('carries `published: true` OUTSIDE the OR, so no branch can satisfy it', () => {
    // Inside the `OR` it would be a fourth alternative rather than a
    // conjunction, and any member-visibility draft would match branch 1.
    const where = buildCourseVisibilityWhere(member({ isAdmin: true })) as {
      published: boolean;
      OR: Branch[];
    };

    expect(where.published).toBe(true);
    for (const branch of where.OR) {
      expect(Object.keys(branch)).not.toContain('published');
    }
  });

  it('copies cohortKeys into a mutable array rather than aliasing the context', () => {
    // `MemberContext.cohortKeys` is `readonly string[]`. Handing the same
    // reference to Prisma would let a downstream mutation of the query alter
    // the request-scoped member context.
    const ctx = member({ cohortKeys: ['founding'] });
    const where = buildCourseVisibilityWhere(ctx) as { OR: Branch[] };
    const emitted = where.OR[1]?.cohortKeys?.hasSome;

    expect(emitted).toEqual(['founding']);
    expect(emitted).not.toBe(ctx.cohortKeys);
  });

  it('never emits an empty OR — every member matches at least the member branch', () => {
    // An empty `OR: []` matches NOTHING in Prisma, which would make the whole
    // curriculum invisible to everyone rather than failing loudly.
    for (const ctx of [
      member(),
      member({ isAdmin: true }),
      member({ cohortKeys: ['founding'] }),
    ]) {
      const where = buildCourseVisibilityWhere(ctx) as { OR: Branch[] };

      expect(where.OR.length).toBeGreaterThan(0);
      expect(where.OR).toContainEqual({ visibility: 'member' });
    }
  });

  it('does NOT spread NOT_DELETED at the top level — the caller must, visibly', () => {
    // AD-5's value is that the filter is a token the structural spec can see AT
    // THE READ. A builder that quietly added it would make every scanned call
    // site look unfiltered while being filtered, or vice versa.
    const where = buildCourseVisibilityWhere(member());

    expect(Object.keys(where).sort()).toEqual(['OR', 'published']);
  });
});

describe('the nested builders — invisible and not-found stay one event', () => {
  it('buildModuleCourseVisibilityWhere nests the clause under `course`', () => {
    const ctx = member({ cohortKeys: ['founding'] });

    expect(buildModuleCourseVisibilityWhere(ctx)).toEqual({
      course: { deletedAt: null, ...buildCourseVisibilityWhere(ctx) },
    });
  });

  it('buildLessonCourseVisibilityWhere nests it under `module.course`', () => {
    const ctx = member();

    expect(buildLessonCourseVisibilityWhere(ctx)).toEqual({
      module: {
        deletedAt: null,
        course: { deletedAt: null, ...buildCourseVisibilityWhere(ctx) },
      },
    });
  });

  it('BOTH intermediate levels are soft-delete filtered', () => {
    // The caller cannot reach inside these objects to add `NOT_DELETED`, so a
    // lesson in a deleted module inside a deleted course would otherwise still
    // be served. Asserted as a JSON scan so an added level cannot slip through.
    const clause = buildLessonCourseVisibilityWhere(member());
    const occurrences = JSON.stringify(clause).match(/"deletedAt":null/g) ?? [];

    expect(occurrences).toHaveLength(2);
  });

  it('a draft course is unreachable through the lesson-level builder too', () => {
    const clause = buildLessonCourseVisibilityWhere(member()) as {
      module: { course: { published: boolean } };
    };

    expect(clause.module.course.published).toBe(true);
  });
});

describe('anti-vacuity — the fixtures and the model actually discriminate', () => {
  it('the fixture set contains all three visibility values AND a draft', () => {
    // If every fixture were a published `member` course, every "does not
    // contain" assertion above would pass trivially.
    const kinds = new Set(COURSES.map((c) => c.visibility));

    expect([...kinds].sort()).toEqual(['cohort', 'member', 'staff']);
    expect(COURSES.some((c) => !c.published)).toBe(true);
  });

  it('the model rejects as well as accepts', () => {
    const row: CourseRow = {
      slug: 'x',
      visibility: 'cohort',
      cohortKeys: ['founding'],
      published: true,
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
      matchesBranch({ slug: 'x' } as unknown as Branch, COURSES[0]),
    ).toThrow(/models only/);
  });
});
