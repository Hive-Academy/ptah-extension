import { LOCK_REASONS } from '@ptah-contracts/community';

import {
  ModuleLockService,
  type LockCourse,
  type LockModule,
} from './module-lock.service';

/**
 * R2.4.1 – R2.4.5 and §8.2 P3 exit-gate clause 1.
 *
 * ⚠️ THESE TESTS ASSERT THE OUTCOME, NOT THE SHAPE — the technique
 * `libs/api/forum/src/lib/common/visibility.spec.ts` uses. Every case builds a
 * real course tree, a real completion set and a real instant, and asserts the
 * whole verdict object. There is no mock and no injected clock, because the
 * service is a pure function over data already fetched: that is the property
 * that keeps `CourseReadService` inside its query budget, and it is what makes
 * this file a table rather than a ceremony.
 *
 * 🔴 THE SEQUENTIAL BRANCH HAS NO LIVE DATA BEHIND IT IN THIS WORKSPACE. The
 * seeded curriculum course is `sequential: false` (§7.3), so R2.4.2 is
 * exercised by nothing a human will click during Phase 3 — which makes these
 * cases the ONLY thing standing between it and shipping wrong. That is a reason
 * for more of them, not fewer.
 */

const service = new ModuleLockService();

/** 2026-08-05T12:00:00Z — every date fixture is relative to this. */
const NOW = new Date('2026-08-05T12:00:00.000Z');
const AN_HOUR = 60 * 60 * 1000;

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

function moduleOf(
  id: string,
  lessonIds: readonly string[],
  releaseAt: Date | null = null,
): LockModule {
  return { id, releaseAt, lessonIds };
}

/**
 * A three-module course. Module 1 has two lessons, module 2 has one, module 3
 * has one — so "the preceding module is complete" is a different question for
 * each of them.
 */
function courseOf(
  sequential: boolean,
  modules: LockModule[] = [
    moduleOf('m1', ['l1a', 'l1b']),
    moduleOf('m2', ['l2a']),
    moduleOf('m3', ['l3a']),
  ],
): LockCourse {
  return { sequential, modules };
}

const NOTHING_COMPLETED: ReadonlySet<string> = new Set();

/**
 * The Nth module of a fixture course, or a loud failure.
 *
 * ⚠️ A THROWING ACCESSOR RATHER THAN `course.modules[n]!`. If a fixture is ever
 * edited to have fewer modules, the assertion below it would silently run
 * against `undefined` and the test would fail somewhere unhelpful — or, worse,
 * pass. This names the fixture and the index.
 */
function moduleAt(course: LockCourse, index: number): LockModule {
  const module = course.modules[index];
  if (!module) {
    throw new Error(
      `fixture course has no module at index ${index} (it has ${course.modules.length})`,
    );
  }
  return module;
}

/* -------------------------------------------------------------------------- */

describe('R2.4.1 — the date rule', () => {
  it('a FUTURE releaseAt locks the module and reports when it opens', () => {
    const course = courseOf(false);
    const first = moduleAt(course, 0);
    const scheduled = moduleOf(first.id, first.lessonIds, at(24 * AN_HOUR));

    expect(
      service.evaluate(
        scheduled,
        { ...course, modules: [scheduled, ...course.modules.slice(1)] },
        NOTHING_COMPLETED,
        NOW,
      ),
    ).toEqual({
      locked: true,
      reason: 'not_released',
      unlocksAt: at(24 * AN_HOUR),
    });
  });

  it('a PAST releaseAt is inert', () => {
    const released = moduleOf('m1', ['l1a'], at(-AN_HOUR));
    const course: LockCourse = { sequential: false, modules: [released] };

    expect(service.evaluate(released, course, NOTHING_COMPLETED, NOW)).toEqual({
      locked: false,
      reason: null,
      unlocksAt: null,
    });
  });

  it('🔴 releaseAt EXACTLY equal to now is UNLOCKED — the boundary is closed on the open side', () => {
    // Stated so it stays consistent with the forum's `EDIT_WINDOW_MS`
    // convention: at the boundary the event HAS happened. The alternative
    // reading would make "released at 09:00" true only from 09:00.001, which is
    // not what an admin means when they type a time.
    const opening = moduleOf('m1', ['l1a'], NOW);
    const course: LockCourse = { sequential: false, modules: [opening] };

    expect(
      service.evaluate(opening, course, NOTHING_COMPLETED, NOW).locked,
    ).toBe(false);
  });

  it('one millisecond before the release instant it is still locked', () => {
    // The other side of the same boundary, so "closed on the open side" is
    // asserted rather than assumed.
    const opening = moduleOf('m1', ['l1a'], NOW);
    const course: LockCourse = { sequential: false, modules: [opening] };

    expect(
      service.evaluate(
        opening,
        course,
        NOTHING_COMPLETED,
        new Date(NOW.getTime() - 1),
      ),
    ).toEqual({ locked: true, reason: 'not_released', unlocksAt: NOW });
  });

  it('a null releaseAt never locks by date', () => {
    const course = courseOf(false);

    expect(
      service.evaluate(moduleAt(course, 2), course, NOTHING_COMPLETED, NOW)
        .locked,
    ).toBe(false);
  });
});

describe('R2.4.2 / R2.4.3 — the sequential rule', () => {
  it('🔴 sequential: FALSE + an incomplete predecessor ⇒ UNLOCKED', () => {
    // R2.4.3 in one assertion. This is the live configuration of the seeded
    // course, so a service that ignored `sequential` would pass every manual
    // check in this workspace and lock every cohort course in production.
    const course = courseOf(false);

    expect(
      service.evaluate(moduleAt(course, 1), course, NOTHING_COMPLETED, NOW),
    ).toEqual({ locked: false, reason: null, unlocksAt: null });
  });

  it('sequential: TRUE + an incomplete predecessor ⇒ LOCKED, with no unlocksAt', () => {
    const course = courseOf(true);

    expect(
      service.evaluate(moduleAt(course, 1), course, new Set(['l1a']), NOW),
    ).toEqual({
      locked: true,
      reason: 'previous_module_incomplete',
      // ⚠️ `null`, not a date. This rule unlocks on an ACTION, and a countdown
      // to an invented moment would be worse than no countdown.
      unlocksAt: null,
    });
  });

  it('sequential: TRUE + a fully complete predecessor ⇒ unlocked', () => {
    const course = courseOf(true);

    expect(
      service.evaluate(
        moduleAt(course, 1),
        course,
        new Set(['l1a', 'l1b']),
        NOW,
      ).locked,
    ).toBe(false);
  });

  it('ALL of the predecessor is required, not any of it', () => {
    // The negative control for the `every` above: a service using `some` would
    // pass the "fully complete" case and unlock on the first lesson.
    const course = courseOf(true);

    expect(
      service.evaluate(moduleAt(course, 1), course, new Set(['l1b']), NOW)
        .locked,
    ).toBe(true);
  });

  it('🔴 the FIRST module is NEVER sequential-locked', () => {
    // An off-by-one here locks the entire curriculum for every member on every
    // sequential course, with no error anywhere. The single most expensive
    // mistake available in this file.
    const course = courseOf(true);

    expect(
      service.evaluate(moduleAt(course, 0), course, NOTHING_COMPLETED, NOW),
    ).toEqual({ locked: false, reason: null, unlocksAt: null });
  });

  it('🔴 an EMPTY preceding module does not lock the next one', () => {
    // "Every lesson in the preceding module is complete" is vacuously true of a
    // module with no lessons. The alternative is a course an admin can
    // permanently brick by adding an empty module — an unfinishable
    // prerequisite with nothing in it to finish.
    const course: LockCourse = {
      sequential: true,
      modules: [moduleOf('m1', []), moduleOf('m2', ['l2a'])],
    };

    expect(
      service.evaluate(moduleAt(course, 1), course, NOTHING_COMPLETED, NOW)
        .locked,
    ).toBe(false);
  });

  it('only the IMMEDIATELY preceding module is consulted', () => {
    // R2.4.2's words are "the preceding module". Module 3 unlocks when module 2
    // is complete, even with module 1 unfinished — reachable in practice only
    // by a member who manually completed module 2's lessons (R2.3.3 works
    // regardless of position) while module 1 was open. Pinned so the difference
    // from a transitive reading is a decision rather than an oversight.
    const course = courseOf(true);

    expect(
      service.evaluate(moduleAt(course, 2), course, new Set(['l2a']), NOW)
        .locked,
    ).toBe(false);
  });

  it('completing lessons in a LATER module does not unlock an earlier gate', () => {
    // The negative control for the previous case: the set is consulted against
    // the PREDECESSOR's lesson ids, not against its size.
    const course = courseOf(true);

    expect(
      service.evaluate(
        moduleAt(course, 1),
        course,
        new Set(['l2a', 'l3a']),
        NOW,
      ).locked,
    ).toBe(true);
  });
});

describe('precedence — both rules would fire', () => {
  it('🔴 the DATE wins, because unlocksAt is the fact the UI can render', () => {
    // Both apply: module 2 is scheduled for tomorrow AND module 1 is
    // unfinished. Telling the member to finish module 1 would be advice that
    // does not open the module.
    const scheduled = moduleOf('m2', ['l2a'], at(24 * AN_HOUR));
    const course: LockCourse = {
      sequential: true,
      modules: [moduleOf('m1', ['l1a']), scheduled],
    };

    expect(service.evaluate(scheduled, course, NOTHING_COMPLETED, NOW)).toEqual(
      {
        locked: true,
        reason: 'not_released',
        unlocksAt: at(24 * AN_HOUR),
      },
    );
  });

  it('once the date passes, the sequential rule takes over rather than being skipped', () => {
    // The other half: a module whose release date has passed is not thereby
    // permanently unlocked.
    const released = moduleOf('m2', ['l2a'], at(-AN_HOUR));
    const course: LockCourse = {
      sequential: true,
      modules: [moduleOf('m1', ['l1a']), released],
    };

    expect(service.evaluate(released, course, NOTHING_COMPLETED, NOW)).toEqual({
      locked: true,
      reason: 'previous_module_incomplete',
      unlocksAt: null,
    });
  });
});

describe('the verdict contract', () => {
  it('every reason it can emit is in the shared LOCK_REASONS vocabulary', () => {
    // The UI matches on these machine values (Batch 6C's carried item 5). A
    // reason this service invented would render as an unhandled branch.
    const course: LockCourse = {
      sequential: true,
      modules: [
        moduleOf('m1', ['l1a']),
        moduleOf('m2', ['l2a'], at(AN_HOUR)),
        moduleOf('m3', ['l3a']),
      ],
    };

    const reasons = course.modules
      .map((m) => service.evaluate(m, course, NOTHING_COMPLETED, NOW).reason)
      .filter((r): r is NonNullable<typeof r> => r !== null);

    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(LOCK_REASONS).toContain(reason);
    }
  });

  it('carries BOTH reasons across the fixture set — neither branch is dead', () => {
    const course: LockCourse = {
      sequential: true,
      modules: [
        moduleOf('m1', ['l1a']),
        moduleOf('m2', ['l2a']),
        moduleOf('m3', ['l3a'], at(AN_HOUR)),
      ],
    };

    const reasons = new Set(
      course.modules.map(
        (m) => service.evaluate(m, course, NOTHING_COMPLETED, NOW).reason,
      ),
    );

    expect(reasons.size).toBe(3);
    expect(reasons).toContain(null);
    expect(reasons).toContain('not_released');
    expect(reasons).toContain('previous_module_incomplete');
  });

  it('`reason` is null exactly when `locked` is false', () => {
    const course: LockCourse = {
      sequential: true,
      modules: [
        moduleOf('m1', []),
        moduleOf('m2', ['l2a']),
        moduleOf('m3', ['l3a'], at(AN_HOUR)),
      ],
    };

    for (const m of course.modules) {
      const verdict = service.evaluate(m, course, NOTHING_COMPLETED, NOW);
      expect(verdict.locked).toBe(verdict.reason !== null);
    }
  });

  it('`unlocksAt` is non-null ONLY for not_released', () => {
    const course: LockCourse = {
      sequential: true,
      modules: [
        moduleOf('m1', ['l1a']),
        moduleOf('m2', ['l2a']),
        moduleOf('m3', ['l3a'], at(AN_HOUR)),
      ],
    };

    for (const m of course.modules) {
      const verdict = service.evaluate(m, course, NOTHING_COMPLETED, NOW);
      if (verdict.unlocksAt !== null) {
        expect(verdict.reason).toBe('not_released');
      }
    }
  });

  it('the unlocked verdict cannot be mutated by a mapper', () => {
    // It is returned by reference from a frozen constant. A mapper writing
    // `verdict.locked = true` would otherwise lock every module in the course
    // at once.
    const course = courseOf(false);
    const verdict = service.evaluate(
      moduleAt(course, 0),
      course,
      NOTHING_COMPLETED,
      NOW,
    );

    expect(Object.isFrozen(verdict)).toBe(true);
  });
});

describe('it is a pure function over data already fetched', () => {
  it('issues no query and reads no clock — `now` is a parameter', () => {
    // The property that keeps `CourseReadService` inside its query budget: a
    // service that fetched the predecessor's lessons itself would be an N+1
    // with an @Injectable() on it. Asserted by evaluating the same tree at two
    // instants and getting two different answers.
    const scheduled = moduleOf('m1', ['l1a'], at(AN_HOUR));
    const course: LockCourse = { sequential: false, modules: [scheduled] };

    expect(
      service.evaluate(scheduled, course, NOTHING_COMPLETED, NOW).locked,
    ).toBe(true);
    expect(
      service.evaluate(scheduled, course, NOTHING_COMPLETED, at(2 * AN_HOUR))
        .locked,
    ).toBe(false);
  });

  it('is deterministic — the same inputs give the same verdict', () => {
    const course = courseOf(true);
    const first = service.evaluate(
      moduleAt(course, 1),
      course,
      NOTHING_COMPLETED,
      NOW,
    );
    const second = service.evaluate(
      moduleAt(course, 1),
      course,
      NOTHING_COMPLETED,
      NOW,
    );

    expect(first).toEqual(second);
  });

  it('THROWS for a module that is not in the supplied course', () => {
    // Returning "no predecessor" would silently UNLOCK it, which is the failure
    // direction that leaks content. A programming error should look like one.
    const course = courseOf(true);

    expect(() =>
      service.evaluate(
        moduleOf('from-another-course', ['x']),
        course,
        NOTHING_COMPLETED,
        NOW,
      ),
    ).toThrow(/not in the supplied course/);
  });

  it('evaluates a whole course in one pass, without touching the lesson set per module', () => {
    // The shape `CourseReadService` uses: one completion set, one `now`, N
    // verdicts. If this needed anything per module the outline would be an N+1.
    const course = courseOf(true);
    const completed = new Set(['l1a', 'l1b']);

    const verdicts = course.modules.map((m) =>
      service.evaluate(m, course, completed, NOW),
    );

    expect(verdicts.map((v) => v.locked)).toEqual([false, false, true]);
  });
});
