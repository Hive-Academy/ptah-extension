import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';
import { z } from 'zod';

import {
  LOCK_REASONS,
  memberCourseDetailSchema,
  memberCourseSummarySchema,
  memberLessonCommentSchema,
  memberLessonDetailSchema,
  memberLessonProgressSchema,
  type LockReason,
  type MemberCourseDetail,
  type MemberCourseSummary,
  type MemberLessonComment,
  type MemberLessonDetail,
  type MemberLessonProgress,
} from '@ptah-contracts/community';
import { validate } from '@ptah-web/core';

/**
 * MemberLearningApiService — the whole §3.4 member course surface as one HTTP
 * client (`/api/v1/members/courses/*` and `/api/v1/members/lesson-comments/*`).
 *
 * ⚠️ PURE DATA ACCESS, exactly as `member-community-api.service.ts` is. No
 * signals, no cached state, no routing. State lives in the pages and in
 * `CoursePlayerStore`; a service that also held it would give two surfaces two
 * different ideas of the current lesson.
 *
 * ⚠️ EVERY RESPONSE IS PARSED WITH A SCHEMA EXPORTED BY
 * `@ptah-contracts/community`. A second copy of the wire type on the client is
 * exactly the drift the contracts lib exists to remove. `z.object()` STRIPS
 * unknown keys, so a client schema that omits a field tolerates a server that
 * sends it — but NOT the other way round, which is why Batch 10 follows Batch 9
 * rather than running beside it. The only locally-declared schemas are the two
 * small envelopes the contracts lib does not model: `{ deleted }` and the
 * `403 { reason, unlocksAt }` lock body.
 *
 * ── 🔴 THE THREE UNITS, NAMED AT EVERY SIGNATURE (RISK-O) ───────────────────
 *
 *   A POSITION IN SECONDS  — `positionSeconds` in / `furthestPositionSeconds`
 *                            out. How far this member has watched.
 *   A DURATION IN SECONDS  — `videoDurationSeconds` / `durationSeconds`. How
 *                            long the video IS. Read-only here.
 *   A PERCENTAGE           — `MemberCourseSummary.percent`. Derived server-side
 *                            FROM LESSON COUNTS, never from seconds, and never
 *                            recomputed in this client.
 *
 * The first two are both non-negative integers ending in `Seconds` and swap at
 * a call site without a type error. B6.1's whole finding was that four sites
 * were consistently wrong and no single-site test could see it.
 *
 * ⚠️ `putProgress` SENDS EXACTLY `{ positionSeconds }` AND NOTHING ELSE
 * (§4.6.6). No `completed`, no `completionSource`, no duration. Completion is
 * computed server-side from the PERSISTED duration and the client never sends a
 * flag — sending one is not ignored, it is a `400`, measured live:
 *
 *   PUT …/progress {"positionSeconds":5,"completed":true}
 *     -> 400 {"message":["property completed should not exist"], …}
 *
 * The member's explicit control is a DIFFERENT route ({@link putCompletion}),
 * which records `completionSource: 'manual'` so the stored row can tell
 * "watched it" from "ticked it".
 *
 * ⚠️ `403` AND `404` ARE DIFFERENT ANSWERS AND THIS SERVICE KEEPS THEM APART.
 *   · `404` — the course or lesson is ABSENT **or invisible**, indistinguishably
 *     (R1.1.3, R2.1.2). A draft course is a `404`. It propagates as an error.
 *   · `403 { reason, unlocksAt }` — a LOCKED MODULE. Visible but not yet
 *     available, and a first-class expected outcome rather than a failure, so
 *     {@link getLesson} returns it as a TYPED RESULT the page renders. Making
 *     the page catch an `HttpErrorResponse` and re-interpret the body is how a
 *     lock ends up rendered as "something went wrong".
 *   · `403 { reason: 'membership_required' }` — the entitlement gate, and a
 *     COMPLETELY different disposition (bounce to `/pricing`). It is recognised
 *     by `isMembershipRequiredError()` from `@ptah-web/core`, which is REUSED
 *     rather than re-implemented and deliberately not re-exported here — a
 *     re-export gives one symbol two import paths.
 *
 * ⚠️ NO PAGING EXISTS ON THIS SURFACE AT ALL, so there is no `pageParams()` and
 * no `RangeError` guard. `MemberCoursesController` and
 * `MemberLessonCommentsController` declare NO `@Query()` parameter between them
 * — verified in their source and live: the course list is unpaged (a curriculum
 * is tens of courses), the outline is nested in the detail, and comments arrive
 * inside `MemberLessonDetail.comments`. A `pageParams()` here would be a guard
 * for a parameter no endpoint accepts.
 *
 * URLs stay relative — `apiInterceptor` prepends `environment.apiBaseUrl` and
 * sets `withCredentials: true`, so the `ptah_auth` COOKIE is attached. The
 * server's `JwtAuthGuard` reads that cookie and never looks at an
 * `Authorization` header.
 */

/* -------------------------------------------------------------------------- */
/* Locked modules — a result, not an error                                     */
/* -------------------------------------------------------------------------- */

/**
 * The `403` body a locked module answers with.
 *
 * ⚠️ THE UI MATCHES ON `reason`, NEVER ON `message`. `LOCK_REASONS` is the
 * stable machine vocabulary; the sentence is copy and may be edited without a
 * deploy note. `message` is parsed here only so the shape is fully described —
 * nothing renders it.
 */
const lockedModuleSchema = z.object({
  reason: z.enum(LOCK_REASONS),
  unlocksAt: z.string().nullable(),
});

/** A locked module, as the lesson page renders it. */
export interface LockedLesson {
  readonly locked: true;
  readonly reason: LockReason;
  /** ISO 8601 — non-null only for `'not_released'`. */
  readonly unlocksAt: string | null;
}

/** An open lesson, in full. */
export interface OpenLesson {
  readonly locked: false;
  readonly lesson: MemberLessonDetail;
}

/**
 * What {@link MemberLearningApiService.getLesson} resolves to.
 *
 * ⚠️ A DISCRIMINATED UNION, NOT A NULLABLE LESSON. `locked` is the discriminant
 * so the page cannot read `lesson` without narrowing, and cannot render a lock
 * notice without a `reason` to render it from.
 */
export type LessonResult = OpenLesson | LockedLesson;

/**
 * True when `error` is a locked-module `403` — the WRITE-path counterpart of
 * {@link LessonResult}.
 *
 * `PUT …/progress` and `PUT …/completion` on a locked lesson answer with the
 * same body (measured live), and `CoursePlayerStore` needs to tell that from a
 * transient failure: a lock is TERMINAL and retrying it forever would burn the
 * member's 60/min write budget on a request that can never succeed.
 *
 * ⚠️ IT IS NOT `isMembershipRequiredError` AND MUST NOT BE CONFLATED WITH IT. A
 * `membership_required` 403 sends a member to `/pricing`; a `not_released` 403
 * means "come back on Tuesday". Bouncing someone to a checkout page for opening
 * next week's module is the concrete cost of merging them.
 */
export function isLockedModuleError(error: unknown): boolean {
  return readLockBody(error) !== null;
}

/** The parsed lock body, or `null` when this is not a locked-module `403`. */
function readLockBody(error: unknown): LockedLesson | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 403) {
    return null;
  }
  const parsed = lockedModuleSchema.safeParse(error.error);
  if (!parsed.success) return null;
  return {
    locked: true,
    reason: parsed.data.reason,
    unlocksAt: parsed.data.unlocksAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Request shapes and acknowledgement envelopes                                */
/* -------------------------------------------------------------------------- */

/**
 * Body for `POST lesson-comments`.
 *
 * ⚠️ A `parentId` POINTING TWO LEVELS DEEP IS REPAIRED SERVER-SIDE TO DEPTH 2,
 * NOT REJECTED (R2.5.2 → R1.3.3, RK-12) — measured live: posting with the
 * reply's id as the parent returned `201` carrying the top-level comment's id
 * as `parentId`. So the response is authoritative about where a comment landed
 * and the caller must not splice its own request's `parentId` into the list.
 */
export interface CreateLessonCommentRequest {
  lessonId: string;
  bodyMarkdown: string;
  parentId?: string | null;
}

const deletedAckSchema = z.object({ deleted: z.boolean() });

const COURSES = '/api/v1/members/courses';
const COMMENTS = '/api/v1/members/lesson-comments';

@Injectable({ providedIn: 'root' })
export class MemberLearningApiService {
  private readonly http = inject(HttpClient);

  /* ---------------------------------------------------------------------- */
  /* Courses                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * `GET courses` (R2.1.1) — every published course visible to this member.
   *
   * ⚠️ ALREADY FILTERED AND ALREADY ORDERED SERVER-SIDE. Draft courses (R2.1.2)
   * and courses whose cohort gate excludes the caller are simply ABSENT, by the
   * same `where` clause; there is no `published` or `visibility` field to
   * re-filter on and there must not be. The order is R2.1.4's
   * `(sortOrder, createdAt, id)`, computed in SQL — **nothing is re-sorted
   * client-side**, because a client sort reorders only the current page.
   *
   * ⚠️ UNPAGED, AND THAT IS THE SERVER'S SHAPE. The response is a bare JSON
   * array, not a `Paged<…>` envelope.
   */
  public listCourses(): Observable<MemberCourseSummary[]> {
    return this.http
      .get<unknown>(COURSES)
      .pipe(
        map(
          validate(z.array(memberCourseSummarySchema), 'GET /members/courses'),
        ),
      );
  }

  /**
   * `GET courses/:slug` — one course with its whole outline (R2.1.3, R2.1.4).
   *
   * ⚠️ `:slug`, NOT `:id`. A course slug is stable for the life of the course
   * (`UpdateCourseDto` has no `slug` field), so a bookmarked URL keeps working.
   *
   * ⚠️ LOCKED MODULES ARE PRESENT IN THE OUTLINE, NOT OMITTED (R2.4.4), and
   * `resumeLesson` is the SERVER's answer to R2.3.6. Do not re-derive the
   * resume target by scanning `modules` in the browser: the hub card and this
   * page would eventually disagree, and the server already computes it once.
   *
   * A draft or invisible course is a `404` and propagates as an error.
   */
  public getCourse(slug: string): Observable<MemberCourseDetail> {
    return this.http
      .get<unknown>(`${COURSES}/${encodeURIComponent(slug)}`)
      .pipe(
        map(validate(memberCourseDetailSchema, `GET /members/courses/${slug}`)),
      );
  }

  /* ---------------------------------------------------------------------- */
  /* Lessons                                                                 */
  /* ---------------------------------------------------------------------- */

  /**
   * `GET courses/:slug/lessons/:lessonSlug` (R2.1.5, R2.4.5).
   *
   * 🔴 A LOCKED MODULE RESOLVES SUCCESSFULLY AS `{ locked: true, … }` RATHER
   * THAN ERRORING. The `403` is an expected member-facing state with its own
   * screen, and turning it into a rejected observable would make every caller
   * re-parse the body to tell it from a real failure. A `404` still errors —
   * "this does not exist" is not a state with a reason to show.
   *
   * ⚠️ THE LOCKED BRANCH CARRIES NO LESSON CONTENT AND CANNOT. The server
   * refuses before reading the body or the comments, so there is no redacted
   * variant of `MemberLessonDetail` to handle — proven live: a locked lesson's
   * seeded body marker appears zero times in the `403` response.
   */
  public getLesson(slug: string, lessonSlug: string): Observable<LessonResult> {
    const url = `${COURSES}/${encodeURIComponent(slug)}/lessons/${encodeURIComponent(lessonSlug)}`;

    return this.http.get<unknown>(url).pipe(
      map(
        (raw): LessonResult => ({
          locked: false,
          lesson: validate(
            memberLessonDetailSchema,
            `GET /members/courses/${slug}/lessons/${lessonSlug}`,
          )(raw),
        }),
      ),
      catchError((error: unknown) => {
        const locked = readLockBody(error);
        return locked ? [locked] : throwError(() => error);
      }),
    );
  }

  /**
   * `PUT courses/:slug/lessons/:lessonSlug/progress` (R2.3.1, §4.6.4).
   *
   * 🔴 THE WIRE BODY HAS EXACTLY ONE KEY: `positionSeconds`. Not a convenience —
   * the server runs `forbidNonWhitelisted` and a second key is a `400`.
   * Completion is derived from the PERSISTED duration (R2.3.2) and the response
   * is authoritative about it.
   *
   * ⚠️ MONOTONIC SERVER-SIDE: the stored value only ever advances, so seeking
   * backwards cannot regress progress and a caller may post the furthest point
   * it has seen without first reading what was stored.
   *
   * @param positionSeconds A POSITION, not a duration (RISK-O).
   */
  public putProgress(
    slug: string,
    lessonSlug: string,
    positionSeconds: number,
  ): Observable<MemberLessonProgress> {
    const url = `${COURSES}/${encodeURIComponent(slug)}/lessons/${encodeURIComponent(lessonSlug)}/progress`;

    return this.http
      .put<unknown>(url, { positionSeconds })
      .pipe(
        map(
          validate(
            memberLessonProgressSchema,
            `PUT /members/courses/${slug}/lessons/${lessonSlug}/progress`,
          ),
        ),
      );
  }

  /**
   * `PUT courses/:slug/lessons/:lessonSlug/completion` (R2.3.3).
   *
   * The member's EXPLICIT completion control, and it is REVERSIBLE. Reversing
   * clears `completedAt` and `completionSource` while leaving
   * `furthestPositionSeconds` untouched: where someone watched to is a
   * different fact from what they claim to have finished. Both directions
   * verified live.
   *
   * ⚠️ A SEPARATE ROUTE FROM `putProgress`, ON PURPOSE. One route taking both
   * would be the "client sends a completed flag" shape §4.6.6 forbids; two
   * routes let the stored row record WHICH happened (`'auto'` vs `'manual'`).
   */
  public putCompletion(
    slug: string,
    lessonSlug: string,
    complete: boolean,
  ): Observable<MemberLessonProgress> {
    const url = `${COURSES}/${encodeURIComponent(slug)}/lessons/${encodeURIComponent(lessonSlug)}/completion`;

    return this.http
      .put<unknown>(url, { complete })
      .pipe(
        map(
          validate(
            memberLessonProgressSchema,
            `PUT /members/courses/${slug}/lessons/${lessonSlug}/completion`,
          ),
        ),
      );
  }

  /* ---------------------------------------------------------------------- */
  /* Lesson comments — R2.5                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * `POST lesson-comments` → `201 MemberLessonComment`.
   *
   * ⚠️ A `null` `parentId` IS OMITTED FROM THE WIRE RATHER THAN SENT AS `null`.
   * `CreateCommentDto.parentId` is `@IsOptional() @IsString() @MinLength(1)`,
   * so an explicit empty-ish value is a `400` — and "no parent" and "parent
   * unspecified" are the same statement, which `undefined` is how JSON says.
   * The signature still ACCEPTS `null` because a caller holding
   * `MemberLessonComment.parentId` (typed `string | null`) should not have to
   * convert; this is the one place that conversion belongs. The community
   * service makes the identical call for the identical reason.
   *
   * ⚠️ 🔴 THE RESPONSE'S `authorName` IS `null` EVEN FOR A LIVE COMMENT — a
   * SERVER DEFECT, reported and NOT worked around. Measured 2026-08-05 against
   * the running stack: `POST`, `PATCH` and `PUT :id/answered` all return
   * `authorName: null` while `GET …/lessons/:lessonSlug` returns the real name
   * for the same rows. `null` has a defined meaning on this contract (a
   * tombstone, or an account that was removed), so the write responses assert
   * something false. Callers here RE-READ the lesson after a write rather than
   * splicing this object into the list — which they must do anyway, because the
   * depth-2 repair means the returned `parentId` can differ from the requested
   * one. So nothing compensates for the defect; it is simply reported.
   */
  public createComment(
    body: CreateLessonCommentRequest,
  ): Observable<MemberLessonComment> {
    const payload: {
      lessonId: string;
      bodyMarkdown: string;
      parentId?: string;
    } =
      body.parentId == null
        ? { lessonId: body.lessonId, bodyMarkdown: body.bodyMarkdown }
        : {
            lessonId: body.lessonId,
            bodyMarkdown: body.bodyMarkdown,
            parentId: body.parentId,
          };

    return this.http
      .post<unknown>(COMMENTS, payload)
      .pipe(
        map(
          validate(memberLessonCommentSchema, 'POST /members/lesson-comments'),
        ),
      );
  }

  /** `PATCH lesson-comments/:id` — author-only, inside the edit window. */
  public updateComment(
    id: string,
    bodyMarkdown: string,
  ): Observable<MemberLessonComment> {
    return this.http
      .patch<unknown>(`${COMMENTS}/${encodeURIComponent(id)}`, { bodyMarkdown })
      .pipe(
        map(
          validate(
            memberLessonCommentSchema,
            `PATCH /members/lesson-comments/${id}`,
          ),
        ),
      );
  }

  /**
   * `DELETE lesson-comments/:id` — a TOMBSTONE, not a removal (R2.5.4, AD-5).
   *
   * The row stays in the list with its children attached, carrying a stated
   * placeholder body (`"This comment was removed."`, observed live) and
   * `authorName: null`. The renderer must show the placeholder rather than
   * passing it to the markdown component — Batch 7 found an empty render reads
   * as a rendering bug rather than as a removal.
   */
  public deleteComment(id: string): Observable<{ deleted: boolean }> {
    return this.http
      .delete<unknown>(`${COMMENTS}/${encodeURIComponent(id)}`)
      .pipe(
        map(
          validate(deletedAckSchema, `DELETE /members/lesson-comments/${id}`),
        ),
      );
  }

  /**
   * `PUT lesson-comments/:id/answered` (R2.5.3) — the "Answered" mark, set by an
   * admin or the lesson's author.
   *
   * ⚠️ A-8: THIS IS THE REPLACEMENT FOR REACTIONS, NOT AN ADDITION TO THEM.
   * There is no reaction endpoint on this surface, no `REACTION_TYPES` import in
   * this file, and none may be added "for consistency" with the forum.
   */
  public setCommentAnswered(
    id: string,
    answered: boolean,
  ): Observable<MemberLessonComment> {
    return this.http
      .put<unknown>(`${COMMENTS}/${encodeURIComponent(id)}/answered`, {
        answered,
      })
      .pipe(
        map(
          validate(
            memberLessonCommentSchema,
            `PUT /members/lesson-comments/${id}/answered`,
          ),
        ),
      );
  }
}
