/**
 * `@ptah-api/learning` — courses, modules, lessons, progress and lesson
 * comments (TASK_2026_177, Phase 3, plan §2.6, R2 + R8 authoring).
 *
 * ⚠️ THE SERVICE SURFACE IS DELIBERATELY NARROW (plan §2.6). Exactly TWO
 * services leave this lib:
 *
 *   - `CourseReadService` — the member read model `member-hub` composes the
 *                           hub's `learning` section from.
 *   - `ProgressService`   — the completion/resume source. Nothing composes it
 *                           today: `LearningSection` derives everything it needs
 *                           from `CourseReadService`, which already computes the
 *                           counts inside its own query budget, and a second
 *                           injection would be a duplicate derivation of one
 *                           number — which is how a card and a feed start
 *                           disagreeing (Batch 6C's D-6.15a). §2.6 fixes the
 *                           surface at two, and Batch 14's notification badge is
 *                           the obvious second reader.
 *
 * Not `CoursesService`, not `ReorderService`, not `LessonVideoService`, not
 * `LessonCommentsService`, not `ModuleLockService`, and none of `common/`. Those
 * carry the WRITE paths, the YouTube authoring path, the visibility
 * where-builder, the `NOT_DELETED` constant and the lock evaluation, and they
 * are reachable only through this lib's own controllers — i.e. only behind
 * `JwtAuthGuard` + `MemberGuard` (member) or `JwtAuthGuard` + `AdminGuard`
 * (admin). Exporting one would let a future consumer call a curriculum
 * mutation, or hand-build a `where` and read past every visibility clause and
 * every soft-delete filter, having passed through none of that chain: the guard
 * chain would still exist and would simply not be on the path taken.
 * `learning.module.spec.ts` asserts this surface by exact array equality, so
 * widening it is a failing test rather than an import.
 *
 * ⚠️ THE FIVE CONTROLLER CLASSES ARE EXPORTED, AND THAT IS NOT A WIDENING OF
 * THE RULE ABOVE. PRE-2 requires every controller in the server to appear in
 * `apps/ptah-license-server/src/testing/controller-registry.ts` — the shared
 * ledger consumed by `route-map.spec.ts` (RI-1/RI-2/RI-3) and
 * `controller-validation.spec.ts` (the `dtoPipe` census). That registry imports
 * each class BY PACKAGE NAME, so a controller this barrel hides is a controller
 * that cannot be registered, and the census assertion — which scans
 * every api lib's `src` tree from disk — fails the build. (Written out rather
 * than as the obvious glob: that glob contains the two characters that close a
 * block comment, and pasting it here silently truncates this docblock into
 * syntax errors.) `admin-guards.spec.ts` G1 has
 * the same requirement. Every other api lib exports its controllers for exactly
 * this reason.
 *
 * It costs nothing the paragraph above protects. A controller class is inert
 * without an instance, and it cannot be constructed outside Nest: its
 * constructor dependencies are precisely the services this barrel does NOT
 * export. Its guards travel with the class as decorator metadata, so a
 * reflective consumer SEES the chain rather than bypassing it — which is
 * literally what `admin-guards.spec.ts` G1 does with three of these five.
 * (Batch 6C spent a dispatch discovering this; the resolution is reused rather
 * than rediscovered.)
 *
 * ⚠️ NOTHING UNDER `src/testing/` IS EXPORTED. A Prisma double and a set of
 * decorator readers are not part of a lib's public API; both files are excluded
 * by `tsconfig.lib.json`.
 *
 * ⚠️ WIRE TYPES ARE NOT RE-EXPORTED HERE. They live in
 * `@ptah-contracts/community` and both this server and the member panel import
 * them from there. Mirroring that barrel would give the frontend a second,
 * server-flavoured import path for the same declaration — the drift the
 * contracts lib exists to prevent.
 *
 * 🔴 NFR-P6 — EXACTLY ONE FILE IN THIS LIB IMPORTS `@ptah-api/youtube`, and it
 * is `src/lib/lessons/lesson-video.service.ts` (the authoring-time
 * fetch-and-persist path). No file under `courses/`, `progress/` or `comments/`
 * imports it, because a member lesson read must issue zero third-party calls —
 * every video field on `MemberLessonDetail` is a persisted column, written once
 * at authoring time (plan §4.5: persistence IS the cache).
 * `no-youtube-on-read.spec.ts` asserts the importer set by NAME, the way
 * `markdown-chokepoint.spec.ts` pins its importers, AND drives the real member
 * read path against a provider double whose `fetchVideo` throws.
 */

export * from './lib/learning.module';
export * from './lib/courses/course-read.service';
export * from './lib/progress/progress.service';

export * from './lib/courses/member-courses.controller';
export * from './lib/comments/member-lesson-comments.controller';
export * from './lib/courses/admin-courses.controller';
export * from './lib/courses/admin-course-modules.controller';
export * from './lib/courses/admin-lessons.controller';
