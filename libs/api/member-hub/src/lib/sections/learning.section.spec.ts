import { Logger } from '@nestjs/common';
import type { PrismaService } from '@ptah-api/core';
import type { CourseReadService } from '@ptah-api/learning';
import type { MemberContext } from '@ptah-api/membership';
import type {
  MemberCourseDetail,
  MemberCourseSummary,
} from '@ptah-contracts/community';

import { MemberHubService } from '../member-hub.service';
import { CohortBadgesService } from '../cohort-badges.service';
import { CommunitySection } from './community.section';
import { LearningSection } from './learning.section';
import { NotificationsSection } from './notifications.section';
import { PacksSection } from './packs.section';
import { SessionsSection } from './sessions.section';

/**
 * The hub's `learning` section — Task 9.17, R6.1, R6.2, R6.4, R2.3.6, AD-4.
 *
 * Four things are asserted here and nowhere else:
 *
 *   R6.6  — `'empty'` → `'ok'` with the ENVELOPE UNCHANGED. The composer gains
 *           no line and the response still carries two top-level keys and five
 *           section keys.
 *   R6.4  — `'empty'` and `'unavailable'` stay DISTINCT, and the second is
 *           reached by the section THROWING into the real composer's
 *           `Promise.allSettled` rather than by catching here.
 *   R6.2  — `listCourses` and the resume lookup are each called EXACTLY ONCE per
 *           hub request.
 *   NFR-S4/S5 — the card DROPS fields rather than spreading, so a field added to
 *           `MemberCourseSummary` cannot land in the hub by accident.
 */

function memberContext(overrides: Partial<MemberContext> = {}): MemberContext {
  return {
    userId: 'user-1',
    email: 'member@example.com',
    entitled: true,
    cohortKeys: [],
    isAdmin: false,
    ...overrides,
  };
}

function summary(
  overrides: Partial<MemberCourseSummary> = {},
): MemberCourseSummary {
  return {
    id: 'c-1',
    slug: 'foundations',
    title: 'Foundations',
    description: 'The basics.',
    coverImageUrl: null,
    completedLessons: 3,
    totalLessons: 5,
    percent: 60,
    ...overrides,
  };
}

function detail(
  overrides: Partial<MemberCourseDetail> = {},
): MemberCourseDetail {
  return {
    ...summary(),
    modules: [
      {
        id: 'm-1',
        slug: 'getting-started',
        title: 'Getting started',
        description: null,
        sortOrder: 100,
        locked: false,
        lockReason: null,
        unlocksAt: null,
        lessons: [
          {
            id: 'l-4',
            slug: 'fourth',
            title: 'Fourth',
            sortOrder: 400,
            completed: false,
            durationSeconds: 300,
          },
        ],
      },
    ],
    resumeLesson: {
      slug: 'fourth',
      title: 'Fourth',
      moduleTitle: 'Getting started',
    },
    ...overrides,
  };
}

/** A learning lib that answers with real shapes. */
function learning(
  summaries: MemberCourseSummary[],
  courseDetail: MemberCourseDetail = detail(),
): {
  service: CourseReadService;
  listCourses: jest.Mock;
  getCourse: jest.Mock;
} {
  const listCourses = jest.fn().mockResolvedValue(summaries);
  const getCourse = jest.fn().mockResolvedValue(courseDetail);

  return {
    service: { listCourses, getCourse } as unknown as CourseReadService,
    listCourses,
    getCourse,
  };
}

describe('LearningSection', () => {
  describe('R6.6 — the Phase-3 transition', () => {
    it('reports "ok" with a ContinueLearning card', async () => {
      const lib = learning([summary()]);
      const section = new LearningSection(lib.service);

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'ok',
        data: {
          courseSlug: 'foundations',
          courseTitle: 'Foundations',
          nextLesson: {
            slug: 'fourth',
            title: 'Fourth',
            moduleTitle: 'Getting started',
          },
          locked: false,
          completedLessons: 3,
          totalLessons: 5,
          percent: 60,
        },
      });
    });

    it('reports "empty" with a NULL payload when there is no visible course', async () => {
      // ⚠️ `null`, NOT `[]`. `ContinueLearning` is a single object and there is
      // no such thing as an empty one; the `[]`-in-every-status rule (R6.3)
      // applies to ARRAY sections.
      const lib = learning([]);
      const section = new LearningSection(lib.service);

      await expect(section.resolve(memberContext())).resolves.toEqual({
        status: 'empty',
        data: null,
      });
    });

    it('the "empty" case is now reached THROUGH A QUERY, not returned unconditionally', async () => {
      const lib = learning([]);
      await new LearningSection(lib.service).resolve(memberContext());

      expect(lib.listCourses).toHaveBeenCalledTimes(1);
      expect(lib.listCourses).toHaveBeenCalledWith(memberContext());
      // …and it does not go on to ask for a course detail it has no slug for.
      expect(lib.getCourse).not.toHaveBeenCalled();
    });
  });

  describe('🔴 R6.2 — each lookup happens exactly once per hub request', () => {
    it('listCourses once, getCourse once', async () => {
      const lib = learning([summary()]);
      await new LearningSection(lib.service).resolve(memberContext());

      expect(lib.listCourses).toHaveBeenCalledTimes(1);
      expect(lib.getCourse).toHaveBeenCalledTimes(1);
      expect(lib.getCourse).toHaveBeenCalledWith(
        memberContext(),
        'foundations',
      );
    });

    it('the cost does not grow with the number of visible courses', async () => {
      // The N+1 signature. A section that fetched a detail per course to decide
      // which one is "current" would pass every assertion above.
      const many = Array.from({ length: 12 }, (_, i) =>
        summary({ id: `c-${i}`, slug: `course-${i}` }),
      );
      const lib = learning(many);

      await new LearningSection(lib.service).resolve(memberContext());

      expect(lib.getCourse).toHaveBeenCalledTimes(1);
    });
  });

  describe('R2.3.6 — which course, and which lesson', () => {
    it('picks the first UNFINISHED course in course order', async () => {
      const lib = learning([
        summary({ slug: 'done', completedLessons: 5, totalLessons: 5 }),
        summary({ slug: 'in-progress', completedLessons: 1, totalLessons: 5 }),
        summary({ slug: 'later', completedLessons: 0, totalLessons: 5 }),
      ]);

      await new LearningSection(lib.service).resolve(memberContext());

      expect(lib.getCourse.mock.calls[0][1]).toBe('in-progress');
    });

    it('falls back to the FIRST course when everything is complete', async () => {
      // "You are done" and "there is no curriculum" are different messages, and
      // `'empty'` is the only status the section could report for the second.
      const lib = learning(
        [
          summary({
            slug: 'done',
            completedLessons: 5,
            totalLessons: 5,
            percent: 100,
          }),
        ],
        detail({
          completedLessons: 5,
          totalLessons: 5,
          percent: 100,
          resumeLesson: null,
        }),
      );

      const result = await new LearningSection(lib.service).resolve(
        memberContext(),
      );

      expect(result.status).toBe('ok');
      expect(result.data?.nextLesson).toBeNull();
      expect(result.data?.percent).toBe(100);
      expect(result.data?.locked).toBe(false);
    });

    it('a course with ZERO lessons is treated as unfinished, not skipped', async () => {
      // `0 < 0` is false, so an empty course shell is "complete" by the counting
      // rule. Pinned deliberately: the fallback still shows it rather than
      // reporting `'empty'`, and the card renders `percent: 0` with no next
      // lesson — which is the honest state of a course an admin has not filled
      // in yet.
      const lib = learning(
        [summary({ completedLessons: 0, totalLessons: 0, percent: 0 })],
        detail({
          completedLessons: 0,
          totalLessons: 0,
          percent: 0,
          modules: [],
          resumeLesson: null,
        }),
      );

      const result = await new LearningSection(lib.service).resolve(
        memberContext(),
      );

      expect(result.status).toBe('ok');
      expect(result.data?.percent).toBe(0);
      expect(result.data?.nextLesson).toBeNull();
    });
  });

  describe('🔴 R2.4 — `locked` reflects the resume lesson`s own module', () => {
    it('is true when the module holding the next lesson is locked', async () => {
      const lib = learning(
        [summary()],
        detail({
          modules: [
            {
              id: 'm-1',
              slug: 'getting-started',
              title: 'Getting started',
              description: null,
              sortOrder: 100,
              locked: true,
              lockReason: 'not_released',
              unlocksAt: '2026-12-25T09:00:00.000Z',
              lessons: [
                {
                  id: 'l-4',
                  slug: 'fourth',
                  title: 'Fourth',
                  sortOrder: 400,
                  completed: false,
                  durationSeconds: 300,
                },
              ],
            },
          ],
        }),
      );

      const result = await new LearningSection(lib.service).resolve(
        memberContext(),
      );

      expect(result.data?.locked).toBe(true);
      // ⚠️ AND `nextLesson` IS STILL POPULATED. `null` would mean "you finished
      // everything"; the contract distinguishes that from "the next module opens
      // on Tuesday" precisely through this flag.
      expect(result.data?.nextLesson).not.toBeNull();
    });

    it('is false when ANOTHER module is locked but the next lesson`s is not', async () => {
      // The negative control. Without it, `modules.some(m => m.locked)` — the
      // obvious wrong implementation — would pass the case above.
      const lib = learning(
        [summary()],
        detail({
          modules: [
            {
              id: 'm-1',
              slug: 'getting-started',
              title: 'Getting started',
              description: null,
              sortOrder: 100,
              locked: false,
              lockReason: null,
              unlocksAt: null,
              lessons: [
                {
                  id: 'l-4',
                  slug: 'fourth',
                  title: 'Fourth',
                  sortOrder: 400,
                  completed: false,
                  durationSeconds: 300,
                },
              ],
            },
            {
              id: 'm-2',
              slug: 'advanced',
              title: 'Advanced',
              description: null,
              sortOrder: 200,
              locked: true,
              lockReason: 'previous_module_incomplete',
              unlocksAt: null,
              lessons: [
                {
                  id: 'l-9',
                  slug: 'ninth',
                  title: 'Ninth',
                  sortOrder: 900,
                  completed: false,
                  durationSeconds: null,
                },
              ],
            },
          ],
        }),
      );

      const result = await new LearningSection(lib.service).resolve(
        memberContext(),
      );

      expect(result.data?.locked).toBe(false);
    });

    it('is false when there is no next lesson at all', async () => {
      const lib = learning([summary()], detail({ resumeLesson: null }));

      const result = await new LearningSection(lib.service).resolve(
        memberContext(),
      );

      expect(result.data?.locked).toBe(false);
    });
  });

  describe('🔴 NFR-S4 / S5 — the card DROPS fields rather than spreading', () => {
    it('carries exactly the seven ContinueLearning keys', async () => {
      const lib = learning([summary()]);
      const result = await new LearningSection(lib.service).resolve(
        memberContext(),
      );

      expect(Object.keys(result.data ?? {}).sort()).toEqual([
        'completedLessons',
        'courseSlug',
        'courseTitle',
        'locked',
        'nextLesson',
        'percent',
        'totalLessons',
      ]);
    });

    it('the summary/detail fields the hub does not render are ABSENT', async () => {
      // A `{ ...summary }` would put every one of these into the hub the moment
      // `MemberCourseSummary` grows a field. Serialised, so a nested leak is
      // caught too.
      const lib = learning([
        summary({ description: 'UNIQUE_DESCRIPTION_MARKER_7f21' }),
      ]);
      const result = await new LearningSection(lib.service).resolve(
        memberContext(),
      );

      const serialized = JSON.stringify(result.data);
      expect(serialized).not.toContain('UNIQUE_DESCRIPTION_MARKER_7f21');
      for (const absent of [
        'id',
        'description',
        'coverImageUrl',
        'modules',
        'resumeLesson',
      ]) {
        expect(Object.keys(result.data ?? {})).not.toContain(absent);
      }
    });

    it('passes `percent` THROUGH — it does not recompute it', async () => {
      // R2.3.5 / RISK-O: the percentage is derived from LESSON COUNTS inside
      // `CourseReadService`. Recomputing it here would be the second derivation
      // of one number that D-6.15a refused — and a hub that rounded differently
      // from the courses page is exactly the symptom.
      const lib = learning([
        summary({ completedLessons: 1, totalLessons: 3, percent: 33 }),
      ]);
      const result = await new LearningSection(lib.service).resolve(
        memberContext(),
      );

      // 1/3 rounds to 33; a naive re-derivation with `Math.round(x * 100)` would
      // also give 33, so the value is deliberately made INCONSISTENT below to
      // make the assertion meaningful.
      expect(result.data?.percent).toBe(33);

      const inconsistent = learning([
        summary({ completedLessons: 1, totalLessons: 3, percent: 99 }),
      ]);
      const echoed = await new LearningSection(inconsistent.service).resolve(
        memberContext(),
      );
      expect(echoed.data?.percent).toBe(99);
    });
  });

  describe('🔴 R6.4 / AD-4 — the fault path, through the REAL composer', () => {
    /** The real `MemberHubService`, with only the learning source failing. */
    function hubWith(learningService: CourseReadService): MemberHubService {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue(null) },
      } as unknown as PrismaService;

      return new MemberHubService(
        prisma,
        new CohortBadgesService(prisma),
        new LearningSection(learningService),
        new CommunitySection({
          listFeed: jest.fn().mockResolvedValue({
            items: [],
            page: 1,
            pageSize: 5,
            total: 0,
            hasMore: false,
          }),
        } as never),
        new SessionsSection(),
        new PacksSection(),
        new NotificationsSection(),
      );
    }

    beforeAll(() => {
      // The composer logs the sanitised failure; keep the suite output readable
      // without suppressing the assertion that it degraded.
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterAll(() => {
      jest.restoreAllMocks();
    });

    it('a failing learning query degrades ONE section and the hub still answers', async () => {
      const broken = {
        listCourses: jest.fn().mockRejectedValue(new Error('db is down')),
        getCourse: jest.fn(),
      } as unknown as CourseReadService;

      const response = await hubWith(broken).compose(memberContext());

      expect(response.sections.learning).toEqual({
        status: 'unavailable',
        data: null,
      });
      // …and the other four are intact, which is the whole of R6.4.
      expect(response.sections.community.status).toBe('empty');
      expect(response.sections.packs.status).toBe('empty');
      expect(response.sections.notifications.status).toBe('empty');
      expect(response.sections.sessions).toBeDefined();
      expect(response.member).toBeDefined();
    });

    it('the ENVELOPE is byte-identical whether learning works or fails', async () => {
      // R6.6's real claim: a phase changes WHICH sections report `'ok'`, never
      // the shape and never the request count.
      const working = await hubWith(learning([summary()]).service).compose(
        memberContext(),
      );
      const failing = await hubWith({
        listCourses: jest.fn().mockRejectedValue(new Error('db is down')),
        getCourse: jest.fn(),
      } as unknown as CourseReadService).compose(memberContext());

      expect(Object.keys(working).sort()).toEqual(['member', 'sections']);
      expect(Object.keys(working).sort()).toEqual(Object.keys(failing).sort());
      expect(Object.keys(working.sections).sort()).toEqual([
        'community',
        'learning',
        'notifications',
        'packs',
        'sessions',
      ]);
      expect(Object.keys(working.sections).sort()).toEqual(
        Object.keys(failing.sections).sort(),
      );
      expect(Object.keys(working.sections.learning).sort()).toEqual([
        'data',
        'status',
      ]);
      expect(Object.keys(failing.sections.learning).sort()).toEqual([
        'data',
        'status',
      ]);
    });

    it('"empty" and "unavailable" are NOT interchangeable', async () => {
      // A section that CAUGHT would report `'empty'` for the failure above, the
      // hub would look healthy, and nothing would be logged — which is exactly
      // the fault signal R6.4 exists to preserve.
      const empty = await hubWith(learning([]).service).compose(
        memberContext(),
      );
      const broken = await hubWith({
        listCourses: jest.fn().mockRejectedValue(new Error('db is down')),
        getCourse: jest.fn(),
      } as unknown as CourseReadService).compose(memberContext());

      expect(empty.sections.learning.status).toBe('empty');
      expect(broken.sections.learning.status).toBe('unavailable');
      expect(empty.sections.learning.status).not.toBe(
        broken.sections.learning.status,
      );
    });

    it('the section itself does NOT catch — the throw reaches the composer', async () => {
      const broken = {
        listCourses: jest.fn().mockRejectedValue(new Error('db is down')),
        getCourse: jest.fn(),
      } as unknown as CourseReadService;

      await expect(
        new LearningSection(broken).resolve(memberContext()),
      ).rejects.toThrow('db is down');
    });

    it('the sanitised failure carries no upstream detail to the client', async () => {
      // NFR-S7: a rejection's reason may name tables and connection strings. The
      // composer logs it and DROPS it; the wire contract has no error field.
      const broken = {
        listCourses: jest
          .fn()
          .mockRejectedValue(new Error('UNIQUE_UPSTREAM_MARKER_5b9c')),
        getCourse: jest.fn(),
      } as unknown as CourseReadService;

      const response = await hubWith(broken).compose(memberContext());

      expect(JSON.stringify(response)).not.toContain(
        'UNIQUE_UPSTREAM_MARKER_5b9c',
      );
    });
  });
});
