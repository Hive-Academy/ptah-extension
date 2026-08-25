import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { dtoPipe } from '@ptah-api/core';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MemberGuard } from '@ptah-api/membership';
import type {
  MemberCourseDetail,
  MemberCourseSummary,
  MemberLessonDetail,
  MemberLessonProgress,
} from '@ptah-contracts/community';

import { requireMemberContext } from '../common/member-context';
import { SetCompletionDto } from '../progress/dto/set-completion.dto';
import { UpdateProgressDto } from '../progress/dto/update-progress.dto';
import { ProgressService } from '../progress/progress.service';

import { CourseReadService } from './course-read.service';

/**
 * Throttle budgets, §3.1 / NFR-S9, as named constants rather than repeated
 * literals.
 *
 * ⚠️ `PROGRESS_WRITES` IS 60/min AND THAT NUMBER IS LOAD-BEARING, NOT A ROUND
 * ONE. A member watching a lesson emits one position report per 15 seconds PLUS
 * a flush on pause, on `ended` and on teardown — roughly 5–6 writes a minute in
 * ordinary playback, more when they scrub. §3.1's `CONTENT_CREATION` tier of
 * 10/min would rate-limit somebody simply watching a video, and the failure
 * would present as "my progress stopped saving", which is the hardest kind of
 * bug to attribute. §3.1 names progress writes as their own tier for exactly
 * this reason; this reads it literally (B6C's D-6.12g).
 *
 * Reads inherit the global 100/min. §3.1 does not name them and a course list is
 * not an expensive query.
 */
const PROGRESS_WRITES = { default: { limit: 60, ttl: 60_000 } } as const;

/**
 * `MemberCoursesController` — the whole §3.4 member curriculum surface, mounted
 * at `/api/v1/members/courses/*`.
 *
 * ── THE PREFIX IS A DEPTH-3 LITERAL, AND NO ROUTE HERE MAY EVER PARAMETERISE
 *    SEGMENT 3 ─────────────────────────────────────────────────────────────────
 * `v1/members/{entitlement,hub,sessions,community,search,courses,lesson-comments}`
 * are seven DISJOINT literal siblings. RI-1 in `route-map.spec.ts` fails the
 * build the moment one controller's prefix becomes a path-prefix of another's —
 * which is what AD-12 was done to remove, and why `MembersController` moved from
 * `@Controller('v1/members')` + `@Get('sessions')` to
 * `@Controller('v1/members/sessions')`. `PREFIX_EXCEPTIONS` holds one
 * pre-existing entry and `KNOWN_PREFIX_DEBT` is `[]`; **add nothing to either.**
 *
 * ── WHY LESSON COMMENTS ARE A DIFFERENT CONTROLLER ─────────────────────────
 * plan §3.4: "separate, to avoid contesting `courses/:slug`". A comment surface
 * hung off this prefix would put literal segments beside `:slug` at the same
 * depth, which is precisely the contest RI-2 exists to forbid.
 *
 * ── GUARD ORDER IS LOAD-BEARING ───────────────────────────────────────────────
 * `@UseGuards(JwtAuthGuard, MemberGuard)` at CLASS level, in that order.
 * `JwtAuthGuard` populates `req.user` (401 without a valid session);
 * `MemberGuard` then resolves entitlement + cohort keys ONCE and attaches
 * `req.memberContext` (403 `{ reason: 'membership_required' }`). Declared at
 * class level so a handler added later is guarded by default — a method-only
 * `@UseGuards` leaves every FUTURE handler open.
 *
 * ── R7.3: `memberContext` IS READ, NEVER RE-DERIVED ──────────────────────────
 * Nothing in this controller and nothing in the services below it injects
 * `MembershipService` or `CohortResolver`. Entitlement and cohort keys are
 * resolved exactly once per request, by the guard. A second derivation would be
 * a second definition of who a member is (RISK-A), and the two would disagree
 * the first time either changed.
 *
 * ── PRE-1: EVERY `@Body()` BINDS `dtoPipe(TheDto)` ──────────────────────────
 * This app is bundled by esbuild, which does not implement
 * `emitDecoratorMetadata`, so Nest cannot infer a parameter's DTO class and the
 * global `ValidationPipe` short-circuits on `if (!metatype) return value;`. A
 * bare `@Body() dto: X` is SILENTLY UNVALIDATED. See
 * `libs/api/core/src/lib/common/dto-validation.pipe.ts`.
 *
 * ⚠️ AND THERE IS NO `@Query()` ON THIS CONTROLLER AT ALL. The course list is
 * unpaged by design — a curriculum is tens of courses, not thousands — so there
 * is no query payload to validate and nothing here can move
 * `NAMED_PRIMITIVE_PARAM_COUNT`, which is an EXACT-EQUALITY assertion at 6
 * (RISK-I). `@Param('slug')` is not a payload param and does not count.
 *
 * ── 🔴 `404` FOR INVISIBLE, `403` FOR LOCKED — AND THEY ARE NOT UNIFIED ──────
 * A DRAFT course (R2.1.2) and an out-of-cohort course are **404**: the
 * visibility clause is part of the SQL `WHERE`, so no code path here ever learns
 * they exist, and answering `403` would confirm the existence of content the
 * member is not supposed to know about. A VISIBLE course whose module is locked
 * (R2.4.1 `releaseAt`, R2.4.2 sequential) is **403 `{ reason, unlocksAt }`** —
 * the member can see it in the outline, so hiding it would be theatre, and the
 * client needs the machine `reason` to render "opens Tuesday" rather than a
 * generic error. **This is exit-gate clause 1: a locked module is refused by the
 * API, not by a CSS class.**
 *
 * ── THIS CONTROLLER COMPOSES; IT DOES NOT DECIDE ────────────────────────────
 * Visibility, the lock verdict, prev/next traversal, the 90% completion rule and
 * the course percentage are all decided below it. The one composition it owns is
 * the pair of progress routes: `ProgressService` deliberately does not evaluate
 * the module lock (Batch 9B, Task 9.13), so each write first calls
 * `CourseReadService.resolveWritableLesson`, which runs the SAME
 * `ModuleLockService` over the SAME course tree `getLesson` runs it over. That is
 * a composition of one decision, not a second copy of it.
 */
@Controller('v1/members/courses')
@UseGuards(JwtAuthGuard, MemberGuard)
export class MemberCoursesController {
  private readonly logger = new Logger(MemberCoursesController.name);

  constructor(
    @Inject(CourseReadService) private readonly courses: CourseReadService,
    @Inject(ProgressService) private readonly progress: ProgressService,
  ) {}

  /**
   * `GET` → every course this member may see, with their progress (R2.1.1,
   * R2.3.5).
   *
   * TWO QUERIES for the whole list, regardless of how many courses or lessons
   * exist — the N+1 signature is asserted in `course-read.service.spec.ts` with
   * 40 lessons.
   */
  @Get()
  async list(@Req() req: Request): Promise<MemberCourseSummary[]> {
    return this.courses.listCourses(this.context(req));
  }

  /**
   * `GET :slug` → one course with its whole outline (R2.1.4, R2.4.4).
   *
   * Declared AFTER `GET ''` — both are `GET`, but `[…courses]` and
   * `[…courses, :param]` have different segment counts and cannot unify, so this
   * is readability rather than a routing requirement.
   *
   * ⚠️ `:slug`, NOT `:id`. The slug is the course's stable public identifier and
   * a title edit never changes it (`UpdateCourseDto` has no `slug` field); the
   * URL a member bookmarks is the slug.
   *
   * ⚠️ LOCKED MODULES ARE PRESENT IN THE OUTLINE, NOT OMITTED (R2.4.4). They
   * carry `locked`, `lockReason` and `unlocksAt`, and their lessons carry titles
   * and no bodies — the redaction is a property of `MemberLessonSummary`'s TYPE
   * rather than of a per-row mapper branch, so it cannot be forgotten for one
   * module.
   */
  @Get(':slug')
  async get(
    @Req() req: Request,
    @Param('slug') slug: string,
  ): Promise<MemberCourseDetail> {
    return this.courses.getCourse(this.context(req), slug);
  }

  /**
   * `GET :slug/lessons/:lessonSlug` → the lesson (R2.1.5, R2.4.5, R2.5).
   *
   * 🔴 **THIS RESPONSE MAKES ZERO YOUTUBE REQUESTS** (NFR-P6, exit-gate clause
   * 4). Every video field on it is a PERSISTED column, written once at authoring
   * time — persistence IS the cache (plan §4.5), because there is no read-path
   * call to cache. `no-youtube-on-read.spec.ts` asserts that structurally (the
   * only file in this lib importing `@ptah-api/youtube` is
   * `lessons/lesson-video.service.ts`, by name) and behaviourally (this path run
   * against a provider double whose `fetchVideo` throws, over a lesson that HAS
   * a video id and full metadata).
   *
   * ⚠️ THE `403` FIRES BEFORE THE BODY AND THE COMMENTS ARE READ, so no withheld
   * text is even fetched for a locked module.
   *
   * ⚠️ A COURSE-SCOPED LESSON SLUG IS AMBIGUOUS IN THE SCHEMA, AND THE WRITE PATH
   * MITIGATES IT (Batch 9B's F-2). `@@unique([moduleId, slug])` scopes a lesson
   * slug to its MODULE while this route is scoped to the COURSE, so two modules
   * in one course could legally both hold `intro`. `CoursesService.createLesson`
   * therefore allocates lesson slugs against a COURSE-WIDE taken set — a
   * superset of the module-wide one, so the unique index still decides and the
   * API's own writes are unambiguous. It does not close the hole for a direct
   * database insert; the recommendation (a `@@unique([courseId, slug])` via a
   * denormalisation, or a module-scoped route) belongs to migration 4.
   */
  @Get(':slug/lessons/:lessonSlug')
  async getLesson(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Param('lessonSlug') lessonSlug: string,
  ): Promise<MemberLessonDetail> {
    return this.courses.getLesson(this.context(req), slug, lessonSlug);
  }

  /**
   * `PUT :slug/lessons/:lessonSlug/progress` → record how far this member has
   * watched (R2.3.1, R2.3.2).
   *
   * 🔴 **THE CLIENT NEVER SENDS A COMPLETION FLAG** (§4.6.6, exit-gate clause
   * 2). `UpdateProgressDto` has exactly one property, `dtoPipe`'s
   * `forbidNonWhitelisted` turns `{ completed: true }` into a `400`, and
   * `ProgressService.updateProgress` takes the position as a PLAIN NUMBER — so a
   * flag is unrepresentable on both sides rather than merely ignored. Completion
   * is derived server-side from `furthestPositionSeconds >= 0.9 *
   * videoDurationSeconds` against the PERSISTED duration (ASSUMPTION-8).
   *
   * ⚠️ `PUT`, NOT `POST` OR `PATCH`. The request expresses a desired end state
   * ("I have reached second 240"), so a retried or duplicated report converges
   * instead of accumulating. Monotonicity is then enforced by Postgres, in the
   * `where`, not by comparing two reads.
   *
   * ⚠️ THE `403` IS COMPOSED HERE. See the class docblock and
   * `CourseReadService.resolveWritableLesson`: without it a member could record
   * a watch position against a lesson they cannot open. The exposure would be
   * bounded (it discloses nothing and the read path still refuses them), but a
   * write that succeeds where the corresponding read fails is a contradiction
   * the API should not contain.
   */
  @Put(':slug/lessons/:lessonSlug/progress')
  @HttpCode(200)
  @Throttle(PROGRESS_WRITES)
  async updateProgress(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Param('lessonSlug') lessonSlug: string,
    @Body(dtoPipe(UpdateProgressDto)) dto: UpdateProgressDto,
  ): Promise<MemberLessonProgress> {
    const ctx = this.context(req);
    const { lessonId } = await this.courses.resolveWritableLesson(
      ctx,
      slug,
      lessonSlug,
    );

    return this.progress.updateProgress(ctx, lessonId, dto.positionSeconds);
  }

  /**
   * `PUT :slug/lessons/:lessonSlug/completion` → the member's EXPLICIT
   * mark-complete / mark-incomplete control (R2.3.3).
   *
   * ⚠️ THIS IS NOT THE FLAG THE PROGRESS ROUTE REFUSES — see
   * `SetCompletionDto`'s docblock. A lesson with no video, or one watched
   * elsewhere, has no other route to done, and the two arrive on two endpoints
   * so the stored `completionSource` can tell "watched it" from "ticked it".
   *
   * ⚠️ IT DOES NOT UNIFY WITH THE PROGRESS ROUTE. Both are `PUT` with the same
   * segment count, but segment 7 is a LITERAL on both sides and the two literals
   * differ, so no concrete request can match both. RI-3 has nothing to arbitrate
   * and the declaration order here is readability.
   */
  @Put(':slug/lessons/:lessonSlug/completion')
  @HttpCode(200)
  @Throttle(PROGRESS_WRITES)
  async setCompletion(
    @Req() req: Request,
    @Param('slug') slug: string,
    @Param('lessonSlug') lessonSlug: string,
    @Body(dtoPipe(SetCompletionDto)) dto: SetCompletionDto,
  ): Promise<MemberLessonProgress> {
    const ctx = this.context(req);
    const { lessonId } = await this.courses.resolveWritableLesson(
      ctx,
      slug,
      lessonSlug,
    );

    return this.progress.setCompletion(ctx, lessonId, dto.complete);
  }

  /* ---------------------------------------------------------------------- */

  /** @see requireMemberContext — the removed-guard tripwire, not a null check. */
  private context(req: Request) {
    return requireMemberContext(req, MemberCoursesController.name, this.logger);
  }
}
