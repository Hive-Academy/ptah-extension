import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '@ptah-api/audit';
import { PrismaModule } from '@ptah-api/core';
import {
  AdminGuard,
  AdminThrottlerGuard,
  IdentityModule,
} from '@ptah-api/identity';
import { MembershipModule } from '@ptah-api/membership';
import { YoutubeModule } from '@ptah-api/youtube';

import { LessonCommentsService } from './comments/lesson-comments.service';
import { MemberLessonCommentsController } from './comments/member-lesson-comments.controller';
import { AdminCourseModulesController } from './courses/admin-course-modules.controller';
import { AdminCoursesController } from './courses/admin-courses.controller';
import { AdminLessonsController } from './courses/admin-lessons.controller';
import { CourseReadService } from './courses/course-read.service';
import { CoursesService } from './courses/courses.service';
import { MemberCoursesController } from './courses/member-courses.controller';
import { ModuleLockService } from './courses/module-lock.service';
import { ReorderService } from './courses/reorder.service';
import { LessonVideoService } from './lessons/lesson-video.service';
import { ProgressService } from './progress/progress.service';

/**
 * `LearningModule` — courses, modules, lessons, progress and lesson comments
 * (plan §2.6, R2, R8 authoring).
 *
 * Five controllers: two member (`v1/members/{courses,lesson-comments}`) and
 * three admin (`v1/admin/{courses,course-modules,lessons}`). Seven services.
 *
 * ── ⚠️ `NotificationsModule` IS STILL ABSENT, AND SO IS ANY PRODUCER (RISK-L)
 *
 * 🔴 `libs/api/notifications` NOW EXISTS — Phase 5 (TASK_2026_177) built it —
 * and this module still imports nothing from it, for TWO independent reasons.
 * Both are stated because either alone would be enough and a reader who knows
 * only one will draw the wrong conclusion:
 *
 *   1. **This module writes no notification at all.** Phase 5's producer set is
 *      exactly four: `topic.reply`, `post.child_reply` and `post.accepted` in
 *      `ForumModule`, and `session_request.status` in `GoogleSessionsModule`.
 *      LESSON-COMMENT REPLIES ARE NOT IN IT. The temptation this paragraph was
 *      written for is therefore still live and now MORE plausible, because the
 *      import would resolve: a lesson-comment producer is a reasonable thing to
 *      want and is not in scope until someone specifies who receives it, what
 *      the route is, and whether an instructor gets one per comment.
 *   2. **Even a producer would not need the import.** `NotificationsModule` is
 *      `@Global()` and exports `NotificationsService`; `ForumModule` produces
 *      three kinds and imports nothing. See that module's docblock.
 *
 * `learning.module.spec.ts` asserts BOTH halves — that the import is absent AND
 * that no source file in this lib reaches `@ptah-api/notifications` — so a
 * producer added here without a spec update fails rather than ships silently.
 *
 * ── ⚠️ `AdminGuard` AND `AdminThrottlerGuard` ARE DECLARED LOCALLY ──────────
 * Not by importing `AdminModule`. That is the acyclicity idiom
 * `MemberGroupsModule` established and `ForumModule` follows: a guard with
 * constructor dependencies is instantiated in the CONSUMING module's injector,
 * so `@UseGuards(AdminGuard)` on a controller here requires `AdminGuard` to be
 * resolvable from THIS module. Importing `AdminModule` to get it would make a
 * feature module depend on the admin dashboard module for a stateless guard that
 * needs only `ConfigService` and the global throttler providers — and
 * `AdminModule` is a plausible future consumer of the curriculum, which is how a
 * cycle appears.
 *
 * `MemberGuard` needs no equivalent and MUST NOT be re-declared:
 * `MembershipModule` is `@Global()` and exports it, and a second declaration
 * would create a second instance resolving entitlement out of a different
 * injector. The asymmetry is real, not an oversight.
 *
 * ── ⚠️ `YoutubeModule` IS A NORMAL IMPORT, NOT `@Optional()` ────────────────
 * The feature-off posture lives INSIDE `YouTubeMetadataProvider`
 * (`isEnabled()` → `{ ok: false, skipped: true }`, logged once), so an unset
 * `YOUTUBE_API_KEY` is a supported runtime state and not a missing dependency.
 * A missing `YoutubeModule`, by contrast, is a WIRING MISTAKE and should fail at
 * boot rather than degrade authoring silently. `ForumModule`'s precedent for a
 * normal import applies here for the same reason `SessionsService`'s
 * `@Optional()` does not: learning is unconditionally part of the product.
 *
 * ⚠️ AND IT IS IMPORTED HERE RATHER THAN REGISTERED IN `app.module.ts`. A second
 * registration would create a second provider instance and therefore a second
 * `loggedDisabled` flag, which is how a "logged exactly once" guarantee becomes
 * "logged once per module that happened to touch it".
 *
 * ── ⚠️ `IdentityModule` IS NOT OPTIONAL ────────────────────────────────────
 * `JwtAuthGuard` is `@UseGuards`-referenced by all five controllers and has its
 * own constructor dependency (`AuthService`). Omitting this import fails at BOOT
 * with `Nest can't resolve dependencies of the JwtAuthGuard (?)` — not at
 * request time, and not in any unit test, because the controller specs construct
 * the classes directly and never exercise Nest's injector.
 * `app.module.spec.ts` is the test that would catch it.
 *
 * ── EXPORTS: TWO SERVICES, AND NOT ONE MORE (§2.6) ─────────────────────────
 * `CourseReadService` and `ProgressService` — the member read model and the
 * completion/resume source the hub's `learning` section composes (Task 9.17).
 * Everything else stays internal: `CoursesService`, `ReorderService`,
 * `LessonVideoService`, `LessonCommentsService` and `ModuleLockService` carry the
 * WRITE paths, the YouTube authoring path and the lock EVALUATION, and they are
 * reachable only through this module's own controllers — i.e. only behind
 * `JwtAuthGuard` + `MemberGuard`, or `JwtAuthGuard` + `AdminGuard`. Exporting
 * one would let a future consumer perform a curriculum mutation, or evaluate a
 * lock against a hand-built tree, having passed through none of that chain.
 *
 * ⚠️ THE FIVE CONTROLLER CLASSES **ARE** EXPORTED FROM THE BARREL, AND THAT IS
 * NOT A WIDENING OF THAT RULE. PRE-2 requires every controller to appear in
 * `apps/ptah-license-server/src/testing/controller-registry.ts`, which imports
 * each BY PACKAGE NAME; a controller the barrel hides cannot be registered and
 * the census assertion fails the build. A controller class is inert without an
 * instance and cannot be constructed outside Nest, because its constructor
 * dependencies are precisely the services the barrel does NOT export — so the
 * capability rule is preserved. `learning.module.spec.ts` asserts the SERVICE
 * export surface by exact array equality, which is what makes widening it a
 * failing test rather than an import (Batch 6C's C-2, resolved the same way).
 *
 * ── NOT `@Global()`, DELIBERATELY ──────────────────────────────────────────
 * `MemberHubModule` imports it explicitly. The global scope is reserved for the
 * cross-cutting definitions (`MembershipModule`, `MemberGroupsModule`,
 * `PrismaModule`, `AuditModule`) that genuinely span libs; a feature module that
 * makes itself global removes the one place a reader can see who depends on it.
 *
 * `ConfigModule`, `PrismaModule` and `AuditModule` are imported although all
 * three are already global in `app.module.ts`, so the module stays resolvable in
 * isolation under `Test.createTestingModule({ imports: [LearningModule] })` —
 * matching `MembershipModule`, `MemberGroupsModule`, `MemberHubModule` and
 * `ForumModule`.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    IdentityModule,
    MembershipModule,
    AuditModule,
    YoutubeModule,
  ],
  controllers: [
    MemberCoursesController,
    MemberLessonCommentsController,
    AdminCoursesController,
    AdminCourseModulesController,
    AdminLessonsController,
  ],
  providers: [
    CoursesService,
    CourseReadService,
    ReorderService,
    ModuleLockService,
    LessonVideoService,
    LessonCommentsService,
    ProgressService,
    AdminGuard,
    AdminThrottlerGuard,
  ],
  exports: [CourseReadService, ProgressService],
})
export class LearningModule {}
