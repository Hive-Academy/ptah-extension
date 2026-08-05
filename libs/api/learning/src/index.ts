/**
 * `@ptah-api/learning` — courses, modules, lessons, progress and lesson
 * comments (TASK_2026_177, Phase 3, plan §2.6, R2 + R8 authoring).
 *
 * ⚠️ THIS BARREL IS INTENTIONALLY EMPTY UNTIL BATCH 9B/9C LAND. The
 * `export {}` keeps this file a MODULE rather than a script — without it TS
 * treats an empty `index.ts` as a global script, and the first consumer to
 * `import type` from it gets a confusing "is not a module" error rather than an
 * empty-surface one. (Batch 6A's D-2 idiom.)
 *
 * Intended end state:
 *
 *   `LearningModule`
 *   `CourseReadService`   — the member read model `member-hub` composes for the
 *                           hub's `learning` section.
 *   `ProgressService`     — the completion/resume source `member-hub` composes.
 *   The controller classes — exported ONLY because PRE-2 requires every
 *                           controller to appear in
 *                           `apps/ptah-license-server/src/testing/controller-registry.ts`,
 *                           which imports each BY PACKAGE NAME. A controller
 *                           this barrel hides is a controller that cannot be
 *                           registered, and the census assertion fails the
 *                           build. This is not a widening of the rule below: a
 *                           controller class is inert without an instance and
 *                           cannot be constructed outside Nest, because its
 *                           constructor dependencies are precisely the services
 *                           this barrel does NOT export.
 *
 * ⚠️ WHAT MUST NEVER BE EXPORTED, and the reason, stated now so that the
 * decision is on record before there is anything to export:
 *
 *   - `CoursesService`, `LessonsService`, `LessonCommentsService`,
 *     `ReorderService`, `ModuleLockService`, `LessonVideoService` — these carry
 *     the WRITE paths and the lock evaluation, and the only sanctioned route to
 *     them is this lib's own controllers, i.e. only behind
 *     `JwtAuthGuard` + `MemberGuard` or `JwtAuthGuard` + `AdminGuard`.
 *     Exporting one offers a path that never enters that chain — which is worse
 *     than removing the chain, because the guards still look present in review.
 *   - Anything under `src/lib/common/` — the visibility where-builder and the
 *     `NOT_DELETED` constant. A consumer that can reach them can hand-build a
 *     `where` and read past every visibility clause and every soft-delete
 *     filter. This is the rule `forum.module.spec.ts` asserts for
 *     `@ptah-api/forum`, and it is load-bearing there for the same reason.
 *   - Anything under `src/testing/` — a test double is not part of a lib's
 *     public API.
 *
 * ⚠️ WIRE TYPES ARE NOT RE-EXPORTED HERE. They live in
 * `@ptah-contracts/community` and both this server and the member panel import
 * them from there. Mirroring that barrel would give the frontend a second,
 * server-flavoured import path for the same declaration — the drift the
 * contracts lib exists to prevent.
 *
 * 🔴 NFR-P6 — EXACTLY ONE FILE IN THIS LIB MAY IMPORT `@ptah-api/youtube`, and
 * it is `src/lib/lessons/lesson-video.service.ts` (the authoring-time
 * fetch-and-persist path). No file under `courses/`, `progress/` or
 * `comments/` may import it, because a member lesson read must issue zero
 * third-party calls. Task 9.17 asserts this by NAME, the way
 * `markdown-chokepoint.spec.ts` pins its three importers.
 */

export {};
