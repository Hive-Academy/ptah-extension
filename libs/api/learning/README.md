# api-learning

`@ptah-api/learning` — the native course platform (TASK_2026_177, Phase 3). It
owns **courses, modules, lessons, progress and lesson comments**, and nothing
else.

| Surface                                     | Guards                              |
| ------------------------------------------- | ----------------------------------- |
| `v1/members/courses`                        | `JwtAuthGuard`, `MemberGuard`       |
| `v1/members/lesson-comments`                | `JwtAuthGuard`, `MemberGuard`       |
| `v1/admin/{courses,course-modules,lessons}` | `AdminGuard`, `AdminThrottlerGuard` |

Wire types come from `@ptah-contracts/community` and are **not** re-declared or
re-exported here. Entitlement and cohort resolution come from
`@ptah-api/membership` and are **not** re-implemented here. YouTube metadata
comes from `@ptah-api/youtube` and is **not** re-implemented here.

## Dependencies

`type:feature` under `scope:api`, which
(`eslint.config.mjs`, `onlyDependOnLibsWithTags: ['type:feature',
'type:data-access', 'type:ui', 'type:util', 'type:core']`) permits depending on
`api-core`, `api-identity`, `api-audit`, `api-membership` and **`api-youtube`**
— all `["scope:api","type:util"]` — and on `api-contracts-community`
(`scope:api-contracts`). RISK-F constrains `type:util` SOURCES only and does not
bite here.

## 🔴 Exactly one file may import `@ptah-api/youtube` (NFR-P6)

`src/lib/lessons/lesson-video.service.ts`, the authoring-time fetch-and-persist
path. Nothing under `courses/`, `progress/` or `comments/` may import it.

The rule is not stylistic. YouTube metadata is fetched **once, when an admin
saves a lesson**, and persisted onto `Lesson` — _persistence is the cache_. A
member opening a lesson must issue **zero** third-party calls: no quota is
consumed by reading, and a YouTube outage cannot take the course pages down.
An import from a read-path file would not fail any test that renders nothing,
which is why it is asserted **structurally** (the importer pinned by name) as
well as **behaviourally** (the real member read path run against a provider
double whose `fetchVideo` throws).

## The four invariants this lib is responsible for

### 1. A locked module returns `403` from the API, not a CSS state (R2.4)

Date-based (`releaseAt` in the future) and sequential gating are both evaluated
**server-side** in `courses/module-lock.service.ts`. The lesson endpoint refuses
before it renders. A client-side lock is a rendering choice; this is an access
decision.

Note the deliberate asymmetry with the forum: an invisible _course_ is `404`
(R2.1.2 — a draft course must not be confirmed to exist), while a locked
_module_ is `403` (the member is allowed to know it exists and that it opens
later — that is the whole point of a release schedule).

### 2. Completion is derived, never asserted by the client (R2.3.2)

`furthestPositionSeconds >= 0.9 * videoDurationSeconds`, computed on the server.
The client never sends a `completed` flag; it sends a position, at most once per
15 s, and the server clamps monotonically (`max(stored, submitted)`), so seeking
backwards never regresses progress.

🔴 **Three mutually confusable units live in this lib**, and the schema carries
the same warning:

1. a **position** in seconds — `LessonProgress.furthestPositionSeconds`
2. a **duration** in seconds — `Lesson.videoDurationSeconds`
3. a **percentage** — derived from **lesson counts**
   (`completedLessons / totalLessons`), never from seconds

(1) and (2) are both `Int` and both end in `Seconds`, so they are
interchangeable at every call site **without a type error**. That is why the
comparison lives in exactly one named file, `progress/completion.ts`, and never
as a bare `* 0.9` at a call site. `Topic.postCount` vs `lastReadPostNumber` in
the forum was the same class of defect: "consistent with each other and all
wrong" across four sites, invisible to any single-site test.

A lesson with `videoDurationSeconds === null` is **manual-completion-only**,
even if it has a `youtubeVideoId` — that is the feature-off shape, where an
admin typed a title and no runtime, and it is the only reading that cannot
compute a threshold against `null`.

### 3. With `YOUTUBE_API_KEY` unset, nothing `500`s (R2.2.6)

An admin can still save a lesson: the video id is stored, whatever metadata the
admin typed is stored, and `videoMetadataSource` is `'manual'`. The provider
returns a `skipped` arm, not an error arm, precisely so this branch cannot be
folded into "that video is broken".

### 4. Soft delete is a filter the reader can see (AD-5)

`Course`, `CourseModule`, `Lesson` and `LessonComment` all carry `deletedAt`.
`NOT_DELETED` is one constant, spread at every member read site.
`common/soft-delete-filter.spec.ts` parses every service in **this** lib and
fails the build on an unfiltered read.

## Two structural specs, and they are copies rather than shared code

`common/soft-delete-filter.spec.ts` and `common/nullable-dto.spec.ts` are
re-rooted copies of their `libs/api/forum` siblings, **not** a widened version
of them. The forum specs set `LIB_ROOT = resolve(__dirname, '..')` and assert
`LIB_ROOT.endsWith('src/lib')`; they scan `libs/api/forum` and nothing else, so
this lib would otherwise ship four soft-deletable models with zero structural
coverage — a rule that stops at a lib boundary is a rule with a hole.

Why copies:

1. Widening the forum spec's root breaks its own `LIB_ROOT` self-check and makes
   `api-forum:test` depend on a foreign lib's source tree. A change here would
   then turn `api-forum` red — which is how a structural spec acquires a
   reputation for being flaky and gets deleted.
2. **The censuses must be per-lib.** Merging them would produce one list where
   "the number of places that can return a deleted row" stops being a property
   of one lib.
3. A shared analyser would have to live where both libs can import it, and the
   only candidate is `libs/api/core` — putting a Jest-only TypeScript AST walker
   in the lib every runtime imports is worse than the duplicated test code.

**The counter-argument, stated so it is visible:** two analysers can drift, and
a fix to one will not reach the other. Each file's docblock therefore carries a
one-line pointer at its sibling.

## What this lib deliberately does not do (RK-1)

No certificates, no quizzes, no discussion threads on modules, no course-level
enrolment table (entitlement + cohort already decide visibility), no YouTube
OAuth, no upload pipeline, no metadata refresh cron. `refresh-metadata` is a
**manual** admin action.
