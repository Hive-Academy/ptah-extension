import type {
  MemberCourseDetail,
  MemberCourseSummary,
  MemberLessonComment,
  MemberLessonDetail,
  MemberLessonProgress,
  MemberLessonSummary,
  MemberModuleSummary,
} from '@ptah-contracts/community';

/**
 * Fixture builders for the Phase-3 learning surfaces.
 *
 * ⚠️ THE SHAPES HERE WERE READ OFF THE LIVE SERVER, NOT INVENTED. Every default
 * below matches a real response captured against `http://localhost:3000` on
 * 2026-08-05 for the `b10-probe-course` fixture — including the two that would
 * otherwise be guessed wrongly: `videoThumbnailUrl` is `null` (the
 * `YOUTUBE_API_KEY`-unset path, ASSUMPTION-6, which is the only path this
 * workspace can take) and a locked module's `lessons` array is POPULATED, not
 * empty (R2.4.4 — titles are deliberately visible).
 *
 * ⚠️ IT IS A `.ts`, NOT A `.spec.ts`, so it is inside the chokepoint specs'
 * scan. That is deliberate: a fixture file is exactly where a stray
 * `youtube.com` literal or an `innerHTML` would hide from a scanner that
 * excluded specs. It carries neither.
 *
 * ⚠️ 🔴 THE THREE UNITS ARE KEPT VISIBLY DISTINCT IN THE DEFAULTS (RISK-O), and
 * the numbers are deliberately NOT round or equal: `durationSeconds: 212`,
 * `furthestPositionSeconds: 47`, `percent: 33`. A fixture where the position
 * and the duration were both `100` would let a component swap them and every
 * assertion would still pass.
 */

export function lessonSummary(
  overrides: Partial<MemberLessonSummary> = {},
): MemberLessonSummary {
  return {
    id: 'les_1',
    slug: 'reconcile-loop-fundamentals',
    title: 'Reconcile loop fundamentals',
    sortOrder: 0,
    completed: false,
    // A DURATION. How long the video is — never a position.
    durationSeconds: 212,
    ...overrides,
  };
}

export function moduleSummary(
  overrides: Partial<MemberModuleSummary> = {},
): MemberModuleSummary {
  return {
    id: 'mod_1',
    slug: 'foundations',
    title: 'Foundations',
    description: 'Where the curriculum starts.',
    sortOrder: 0,
    locked: false,
    lockReason: null,
    unlocksAt: null,
    lessons: [lessonSummary()],
    ...overrides,
  };
}

/** A module locked by R2.4.1's date rule. `unlocksAt` is non-null. */
export function lockedByDateModule(
  overrides: Partial<MemberModuleSummary> = {},
): MemberModuleSummary {
  return moduleSummary({
    id: 'mod_locked',
    slug: 'advanced-patterns',
    title: 'Advanced patterns',
    sortOrder: 1,
    locked: true,
    lockReason: 'not_released',
    unlocksAt: '2027-12-25T09:00:00.000Z',
    lessons: [
      lessonSummary({
        id: 'les_locked',
        slug: 'finalizer-logic',
        title: 'Finalizer logic',
        durationSeconds: null,
      }),
    ],
    ...overrides,
  });
}

/**
 * A module locked by R2.4.2's sequential rule.
 *
 * ⚠️ `unlocksAt` IS `null` AND THAT IS THE CONTRACT, NOT A GAP. It unlocks on
 * an ACTION, not on a clock, so inventing a timestamp would render a countdown
 * to a moment that means nothing.
 */
export function lockedBySequenceModule(
  overrides: Partial<MemberModuleSummary> = {},
): MemberModuleSummary {
  return moduleSummary({
    id: 'mod_seq',
    slug: 'core-controllers',
    title: 'Core controllers',
    sortOrder: 2,
    locked: true,
    lockReason: 'previous_module_incomplete',
    unlocksAt: null,
    lessons: [
      lessonSummary({
        id: 'les_seq',
        slug: 'controller-runtime',
        title: 'Controller runtime',
      }),
    ],
    ...overrides,
  });
}

export function courseSummary(
  overrides: Partial<MemberCourseSummary> = {},
): MemberCourseSummary {
  return {
    id: 'crs_1',
    slug: 'operator-design-patterns',
    title: 'Operator design patterns',
    description: 'Build a Kubernetes operator end to end.',
    coverImageUrl: null,
    // COUNTS. `percent` is derived from these SERVER-SIDE and is not a function
    // of any number of seconds anywhere on the wire.
    completedLessons: 1,
    totalLessons: 3,
    percent: 33,
    ...overrides,
  };
}

export function courseDetail(
  overrides: Partial<MemberCourseDetail> = {},
): MemberCourseDetail {
  return {
    ...courseSummary(),
    modules: [moduleSummary(), lockedByDateModule()],
    resumeLesson: {
      slug: 'reconcile-loop-fundamentals',
      title: 'Reconcile loop fundamentals',
      moduleTitle: 'Foundations',
    },
    ...overrides,
  };
}

export function lessonProgress(
  overrides: Partial<MemberLessonProgress> = {},
): MemberLessonProgress {
  return {
    // A POSITION. How far this member watched — never a duration.
    furthestPositionSeconds: 47,
    completedAt: null,
    completionSource: null,
    ...overrides,
  };
}

export function lessonComment(
  overrides: Partial<MemberLessonComment> = {},
): MemberLessonComment {
  return {
    id: 'cmt_1',
    lessonId: 'les_1',
    parentId: null,
    bodyMarkdown: 'How do you handle **race conditions** here?',
    authorName: 'Jane Doe',
    answered: false,
    deleted: false,
    createdAt: '2026-08-01T10:00:00.000Z',
    editedAt: null,
    ...overrides,
  };
}

export function lessonDetail(
  overrides: Partial<MemberLessonDetail> = {},
): MemberLessonDetail {
  return {
    id: 'les_1',
    slug: 'reconcile-loop-fundamentals',
    title: 'Reconcile loop fundamentals',
    bodyMarkdown: '# Reconcile loops\n\nThe **desired state** is the spec.',
    youtubeVideoId: 'dQw4w9WgXcQ',
    videoTitle: 'Reconcile loop fundamentals',
    videoDurationSeconds: 212,
    // ⚠️ `null` IS THE LIVE VALUE IN THIS WORKSPACE (ASSUMPTION-6): with
    // `YOUTUBE_API_KEY` unset no thumbnail is ever fetched, so the poster
    // renders a token-styled fallback and NO `<img>` — which is also why the
    // NFR-S3 network assertion sees no `i.ytimg.com` request here.
    videoThumbnailUrl: null,
    progress: lessonProgress(),
    previous: null,
    next: {
      slug: 'managing-state',
      title: 'Managing state with CRDs',
      moduleTitle: 'Foundations',
    },
    comments: [],
    ...overrides,
  };
}
