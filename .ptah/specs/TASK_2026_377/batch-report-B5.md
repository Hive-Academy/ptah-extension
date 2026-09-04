# TASK_2026_377 — Batch B5 report

**Lane** A (ptah-extension admin portal) · **Scope** admin course-outline read ·
**Executor** codex · **Status** complete.

## Result

`GET v1/admin/courses/:id/modules` now returns the complete live authoring
outline for a live course. The class-level `JwtAuthGuard` and `AdminGuard` apply
to the route. It is read-only, so it uses the global throttle and writes no
audit row.

The service deliberately applies no `published` or member-visibility predicate:
admins can read draft courses and all live modules and lessons. The course,
modules, lessons, and lesson comments used for counts are all filtered with the
lib's `NOT_DELETED` idiom. A missing or soft-deleted course returns `404 Course
not found`. `EXPECTED_EXEMPTIONS` remains `[]`.

Modules and lessons use the shared `DETERMINISTIC_ORDER_BY` tuple:
`sortOrder ASC`, then `createdAt ASC`, then `id ASC`. The service performs at
most four fixed queries (course, modules, lessons, comments), with no N+1.

## Exact response contract

```ts
interface AdminCourseOutline {
  modules: Array<
    AdminCourseModule & {
      lessons: AdminLesson[];
    }
  >;
}

interface AdminCourseModule {
  id: string;
  courseId: string;
  slug: string;
  title: string;
  description: string | null;
  sortOrder: number;
  releaseAt: string | null;
  lessonCount: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AdminLesson {
  id: string;
  moduleId: string;
  slug: string;
  title: string;
  bodyMarkdown: string;
  sortOrder: number;
  youtubeVideoId: string | null;
  videoTitle: string | null;
  videoDurationSeconds: number | null;
  videoThumbnailUrl: string | null;
  videoMetadataFetchedAt: string | null;
  videoMetadataSource: 'api' | 'manual' | null;
  commentCount: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

`AdminCourseModuleWithLessons` names the intersection in the contract library.
Production composition calls the existing `toAdminCourseModule` and
`toAdminLesson` mappers, so module and lesson fields are identical to the write
handler responses. The envelope intentionally contains only `modules`; it does
not duplicate the course row.

## Files changed

- `libs/api/learning/src/lib/courses/admin-courses.controller.ts` — added the
  guarded read handler and route-ordering comment.
- `libs/api/learning/src/lib/courses/courses.service.ts` — added the fixed-query
  admin outline read using existing mappers.
- `libs/api/learning/src/lib/courses/admin-courses.controller.spec.ts` — route,
  guard/throttle posture, draft visibility, 404, filtering, ordering, projection,
  and no-audit coverage.
- `libs/api/learning/src/lib/courses/courses.service.spec.ts` — service projection,
  counts, filters, ordering, 404, and empty-outline coverage.
- `libs/api-contracts/community/src/lib/admin/admin-course.contract.ts` — added
  `AdminCourseModuleWithLessons` and `AdminCourseOutline`.
- `libs/api-contracts/community/src/index.ts` — exported both new contract types
  while preserving B1's existing topic-contract edits.
- `apps/ptah-license-server/src/common/route-map.spec.ts` — added the route to
  `EXPECTED_ROUTES`, updated the total to 142, and preserved B1's route addition.

No member controller, `libs/api/membership`, or `libs/web/**` file was touched.
No `includeDeleted` parameter or AD-5 exemption was added. Nothing was staged or
committed.

## Tests and verification

Seven B5 regression cases were added across the existing controller and service
specs. The mandated gate passed:

```text
NX Running targets typecheck, test for 3 projects:
- api-learning
- api-contracts-community
- ptah-license-server

api-learning:             22 suites, 555 tests passed
api-contracts-community:   2 suites,  33 tests passed
ptah-license-server:       7 suites, 172 tests passed
Total:                    31 suites, 760 tests passed

NX Successfully ran targets typecheck, test for 3 projects
```

The separate lint gate also named all three projects and completed successfully:

```text
NX Running target eslint:lint for 3 projects:
- api-learning
- api-contracts-community
- ptah-license-server

0 errors, 2 warnings
NX Successfully ran target eslint:lint for 3 projects
```

Both warnings are pre-existing unused `eslint-disable` directives in
`apps/ptah-license-server/jest.config.ts` and
`apps/ptah-license-server/src/instrument.ts`; neither file is part of B5. Jest
also printed its existing forced worker-exit warning after the contracts tests
had passed.

## Gaps / handoff

No B5 backend gap remains. B6 must switch `CourseDetail.loadModules()` from the
schedule-preview workaround to this route and remove the session-only lesson
notice. Deleted curriculum remains intentionally undiscoverable because this
batch did not add `?includeDeleted`.

WROTE: batch-report-B5.md
