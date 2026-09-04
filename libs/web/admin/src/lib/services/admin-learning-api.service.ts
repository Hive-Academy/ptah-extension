import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { z } from 'zod';

import {
  VISIBILITIES,
  type AdminCourse,
  type AdminCourseModule,
  type AdminCourseModuleWithLessons,
  type AdminCourseOutline,
  type AdminLesson,
  type AdminModuleSchedule,
  type AdminModuleScheduleEntry,
} from '@ptah-contracts/community';
import { validate } from '@ptah-web/core';

/**
 * AdminLearningApiService — HTTP client for the §3.4 course authoring surface
 * (`/api/v1/admin/courses`, `/api/v1/admin/course-modules`,
 * `/api/v1/admin/lessons`).
 *
 * A SEPARATE FILE FROM `admin-builders-api.service.ts` ON PURPOSE
 * (TASK_2026_377 D-A3). That service already owns packs, calendar sessions,
 * community moderation and the cohort drill-down; courses are a fourth concern
 * and would push it past every reasonable ceiling. The conventions are
 * identical and deliberately so: relative URLs only (`apiInterceptor` prepends
 * `environment.apiBaseUrl` and sets `withCredentials: true`), Zod at the HTTP
 * boundary through the shared `validate()` helper, every method returns an
 * `Observable<T>`, and the service is stateless.
 *
 * ⚠️ THREE DISJOINT LITERAL PREFIXES, NOT ONE TREE. `…/course-modules` is NOT
 * a typo for `…/courses/modules` and must never be "tidied" into it — the
 * nested form would make one controller prefix a segment-wise path prefix of
 * another, which the server's own `route-map.spec.ts` (RI-1) fails the build
 * on. Every URL below is built from one of the three literals.
 *
 * ⚠️ THE RESPONSE TYPES COME FROM `@ptah-contracts/community`; THE SCHEMAS ARE
 * DECLARED HERE. `admin-course.contract.ts` ships types only and says why:
 * member schemas exist because the member panel parses them, while "the admin
 * surface in `libs/web/admin` carries its own response envelopes". This file is
 * that surface. Each schema is bound with `satisfies z.ZodType<T>`, which is a
 * compile-time proof that the runtime parse and the wire type agree — renaming
 * a contract field breaks the build here instead of yielding `undefined` in a
 * template.
 *
 * ⚠️ {@link getCourseOutline} IS THE ONE MODULE AND LESSON READ. `…/course-modules`
 * and `…/lessons` still expose writes only — they carry no `@Get()` — so
 * `GET /admin/courses/:id/modules` is the only path to a course's children and
 * every screen reads them through it. {@link previewModuleSchedule} also
 * enumerates modules, and it is a SCHEDULING rehearsal, not a read: use it only
 * where an admin supplied the schedule inputs it answers about.
 */

/* -------------------------------------------------------------------------- */
/* Client-side validation mirrors (defense in depth, never the real boundary)  */
/* -------------------------------------------------------------------------- */

/**
 * `MemberGroup.key` shape, mirroring the `@Matches(...)` on
 * `CreateCourseDto.cohortKeys`. A UX guard so the form can refuse a bad key
 * before the round-trip; the server validates the keys against real
 * `MemberGroup` rows independently, and that check is the one that counts.
 */
export const COHORT_KEY_REGEX = /^[a-z0-9-]{2,40}$/;

/** `YYYY-MM-DD`, mirroring `PreviewModuleScheduleDto.startDate`. */
export const SCHEDULE_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** 24-hour `HH:mm`, mirroring `PreviewModuleScheduleDto.timeOfDay`. */
export const SCHEDULE_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/* -------------------------------------------------------------------------- */
/* Request shapes (outbound — not validated)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Body for `POST /api/v1/admin/courses`.
 *
 * ⚠️ THERE IS NO `published` FIELD AND ADDING ONE IS A `400`. A course is
 * created as a draft whatever the caller sends, and `forbidNonWhitelisted`
 * rejects the key outright. Publishing is {@link setCoursePublished}, which
 * carries its own audit action — creating something member-visible in the same
 * request that creates it removes the step where an admin checks their work.
 *
 * ⚠️ AND NO `slug`. The server derives it from the title and resolves
 * collisions with a `-2` suffix; the allocated slug arrives on the response.
 */
export interface CreateCourseRequest {
  /** 3–200 characters. */
  title: string;
  /** 1–5 000 characters. */
  description: string;
  /** Up to 2 048 characters. Omit for none — `null` is rejected on create. */
  coverImageUrl?: string;
  visibility: (typeof VISIBILITIES)[number];
  /** Up to 20 keys. Meaningful only when `visibility` is `'cohort'`. */
  cohortKeys?: string[];
  sequential?: boolean;
  sortOrder?: number;
}

/**
 * Body for `PATCH /api/v1/admin/courses/:id`. Only the supplied keys are
 * written.
 *
 * ⚠️ NO `slug` AND NO `published`, for the reasons above. `coverImageUrl: null`
 * genuinely clears the column — it is the one field here where `null` and
 * `undefined` mean different things.
 */
export interface UpdateCourseRequest {
  title?: string;
  description?: string;
  coverImageUrl?: string | null;
  visibility?: (typeof VISIBILITIES)[number];
  cohortKeys?: string[];
  sequential?: boolean;
  sortOrder?: number;
}

/** Body for `POST /api/v1/admin/course-modules`. */
export interface CreateModuleRequest {
  courseId: string;
  /** 3–200 characters. */
  title: string;
  /** Up to 2 000 characters. */
  description?: string;
  /** ISO 8601. A future value locks the module and its lessons (R2.4.1). */
  releaseAt?: string;
  sortOrder?: number;
}

/**
 * Body for `PATCH /api/v1/admin/course-modules/:id`.
 *
 * ⚠️ `releaseAt: null` OPENS THE MODULE IMMEDIATELY and is distinct from
 * omitting the key, which leaves the current date alone. `description: null`
 * clears the text. Both are deliberate `null`s, not sloppy optionals.
 */
export interface UpdateModuleRequest {
  title?: string;
  description?: string | null;
  releaseAt?: string | null;
  sortOrder?: number;
}

/**
 * Body for `POST /api/v1/admin/course-modules/schedule/preview`.
 *
 * `timeZone` is an IANA zone (`UTC` or `Area/Location`); the dates are local to
 * it and it is echoed back on the response rather than inferred.
 */
export interface PreviewModuleScheduleRequest {
  courseId: string;
  /** `YYYY-MM-DD` — Day 1's local date. */
  startDate: string;
  /** `HH:mm` — the local wall-clock release time. */
  timeOfDay: string;
  timeZone: string;
}

/**
 * Body for `POST /api/v1/admin/course-modules/schedule`.
 *
 * 🔴 THE TWO `confirm*` FIELDS ARE THE GUARD, NOT PAPERWORK. The apply is a
 * TOTAL re-schedule that overwrites hand-set dates, and neither value can be
 * produced without having read a preview. Every plausible mis-typing of the
 * start date moves `confirmLastReleaseDate`, so a wrong one is refused with a
 * `400` instead of silently shifting every member-visible date.
 */
export interface ApplyModuleScheduleRequest extends PreviewModuleScheduleRequest {
  /** Must equal the preview's `moduleCount`. */
  confirmModuleCount: number;
  /** Must equal the preview's `lastReleaseDate`, `YYYY-MM-DD`. */
  confirmLastReleaseDate: string;
}

/**
 * Body for `POST /api/v1/admin/lessons`.
 *
 * ⚠️ `youtubeVideoIdOrUrl` ACCEPTS EITHER FORM and the server extracts the
 * 11-character id. With `YOUTUBE_API_KEY` unset the lesson is stored with
 * `videoMetadataSource: 'manual'` and whatever title and duration were typed
 * (R2.2.6); a missing duration makes the lesson manual-completion-only.
 */
export interface CreateLessonRequest {
  moduleId: string;
  /** 3–200 characters. */
  title: string;
  /** 1–50 000 characters. */
  bodyMarkdown: string;
  youtubeVideoIdOrUrl?: string;
  videoTitle?: string;
  /** A DURATION in seconds, never a playback position. */
  videoDurationSeconds?: number;
  sortOrder?: number;
}

/**
 * Body for `PATCH /api/v1/admin/lessons/:id`.
 *
 * ⚠️ THE VIDEO IS TOUCHED ONLY IF THE REQUEST MENTIONS IT. Omitting all three
 * video keys leaves all five video columns alone; sending
 * `youtubeVideoIdOrUrl: ''` DETACHES the video and clears them. That tri-state
 * is why no field here is nullable.
 */
export interface UpdateLessonRequest {
  title?: string;
  bodyMarkdown?: string;
  youtubeVideoIdOrUrl?: string;
  videoTitle?: string;
  videoDurationSeconds?: number;
  sortOrder?: number;
}

/* -------------------------------------------------------------------------- */
/* Response schemas (inbound — the runtime boundary)                           */
/* -------------------------------------------------------------------------- */

const adminCourseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  coverImageUrl: z.string().nullable(),
  visibility: z.enum(VISIBILITIES),
  /** `MemberGroup.key` values, ANY-match. Empty unless `visibility` is 'cohort'. */
  cohortKeys: z.array(z.string()),
  /**
   * Denormalised `MemberGroup.name` per key, SAME ORDER — resolved from
   * `MemberGroup`, not echoed from the keys. A key naming a renamed or deleted
   * group matches nobody, and this surface is the only one that can show it.
   */
  cohortNames: z.array(z.string()),
  /** `false` means invisible to every member endpoint (R2.1.2). */
  published: z.boolean(),
  sequential: z.boolean(),
  sortOrder: z.number().int(),
  createdBy: z.string().nullable(),
  /** Live (non-deleted) modules. Derived from rows, not from Prisma `_count`. */
  moduleCount: z.number().int(),
  /** Live (non-deleted) lessons across every module. */
  lessonCount: z.number().int(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<AdminCourse>;

const adminCourseModuleSchema = z.object({
  id: z.string(),
  courseId: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  /** A FUTURE value locks the module and its lessons (R2.4.1). */
  releaseAt: z.string().nullable(),
  lessonCount: z.number().int(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<AdminCourseModule>;

const adminModuleScheduleEntrySchema = z.object({
  moduleId: z.string(),
  slug: z.string(),
  title: z.string(),
  sortOrder: z.number().int(),
  /** 1-based position in day order — the order members read. */
  day: z.number().int(),
  /** `Mon`…`Fri`. Weekends are skipped, never shifted onto. */
  weekday: z.string(),
  localDate: z.string(),
  releaseAt: z.string(),
  /** What the row carries TODAY. The point of the preview. */
  currentReleaseAt: z.string().nullable(),
  changed: z.boolean(),
}) satisfies z.ZodType<AdminModuleScheduleEntry>;

const adminModuleScheduleSchema = z.object({
  courseId: z.string(),
  courseSlug: z.string(),
  timeZone: z.string(),
  startDate: z.string(),
  timeOfDay: z.string(),
  moduleCount: z.number().int(),
  lastReleaseDate: z.string(),
  changedCount: z.number().int(),
  entries: z.array(adminModuleScheduleEntrySchema),
  /** `false` from `/preview`, `true` from `/schedule`. */
  applied: z.boolean(),
}) satisfies z.ZodType<AdminModuleSchedule>;

const adminLessonSchema = z.object({
  id: z.string(),
  moduleId: z.string(),
  slug: z.string(),
  title: z.string(),
  bodyMarkdown: z.string(),
  sortOrder: z.number().int(),
  youtubeVideoId: z.string().nullable(),
  videoTitle: z.string().nullable(),
  /** A DURATION in seconds. `null` ⇒ manual completion only (ASSUMPTION-8). */
  videoDurationSeconds: z.number().int().nullable(),
  videoThumbnailUrl: z.string().nullable(),
  /** The staleness signal. Set on an `'api'` write only, never on a manual one. */
  videoMetadataFetchedAt: z.string().nullable(),
  videoMetadataSource: z.enum(['api', 'manual']).nullable(),
  commentCount: z.number().int(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<AdminLesson>;

/**
 * `GET /admin/courses` — a BARE ARRAY, not an envelope. The name is historical;
 * the schema is bound to `AdminCourse[]` so a contract rename breaks the build
 * here rather than yielding `undefined` in a table cell.
 */
const coursesEnvelopeSchema = z.array(adminCourseSchema) satisfies z.ZodType<
  AdminCourse[]
>;

/**
 * One module with its live lessons, as `GET /admin/courses/:id/modules` returns
 * it.
 *
 * ⚠️ BUILT BY EXTENDING THE MODULE SCHEMA, NOT BY RESTATING IT. The server
 * composes this response from the same `toAdminCourseModule` and `toAdminLesson`
 * mappers the write handlers use, so a module here is byte-for-byte a module
 * anywhere else. Restating the fields would let the two drift.
 */
const adminCourseModuleWithLessonsSchema = adminCourseModuleSchema.extend({
  lessons: z.array(adminLessonSchema),
}) satisfies z.ZodType<AdminCourseModuleWithLessons>;

/**
 * The outline envelope.
 *
 * ⚠️ IT CARRIES `modules` AND NOTHING ELSE — no copy of the course row. Callers
 * that need the course read it with {@link getCourse}.
 */
const adminCourseOutlineSchema = z.object({
  modules: z.array(adminCourseModuleWithLessonsSchema),
}) satisfies z.ZodType<AdminCourseOutline>;

/**
 * `{ reordered }` from any of the three reorder endpoints.
 *
 * ⚠️ DECLARED LOCALLY BECAUSE THE CONTRACT LIB DOES NOT SHIP IT. `ReorderResult`
 * lives in `libs/api/learning/.../reorder.service.ts`, which `libs/web/**` may
 * not import (the api ⇄ web wall; `libs/api-contracts` is the one bridge). The
 * shape is one integer and is asserted by the server's own spec.
 */
export interface ReorderResult {
  /** How many rows the transaction renumbered. */
  reordered: number;
}

const reorderResultSchema = z.object({
  reordered: z.number().int(),
}) satisfies z.ZodType<ReorderResult>;

/** `{ deleted }` from every soft delete on this surface. */
export interface DeletedResponse {
  deleted: boolean;
}

const deletedResponseSchema = z.object({
  deleted: z.boolean(),
}) satisfies z.ZodType<DeletedResponse>;

/** `{ restored }` from `POST /admin/courses/:id/restore`. */
export interface RestoredResponse {
  restored: boolean;
}

const restoredResponseSchema = z.object({
  restored: z.boolean(),
}) satisfies z.ZodType<RestoredResponse>;

/** One lesson the refresh could not complete. */
export interface RefreshFailure {
  lessonId: string;
  /** ⚠️ A MACHINE VOCABULARY, NEVER UPSTREAM TEXT. */
  reason: string;
}

/**
 * The outcome of a metadata refresh — ALSO DECLARED LOCALLY, and for the same
 * reason as {@link ReorderResult}: `RefreshMetadataResult` is exported from
 * `lesson-video.service.ts` inside `libs/api/learning` and has no contract
 * counterpart.
 *
 * ⚠️ `reason` IS PRESENT ONLY ON THE FEATURE-OFF SHORT-CIRCUIT. With
 * `YOUTUBE_API_KEY` unset the server writes NOTHING and answers
 * `{ refreshed: 0, skipped: n, failed: [], reason: 'youtube_disabled' }`. That
 * is a success shape, not an error, and the UI must say so — treating it as a
 * failure would send an admin hunting for a broken lesson.
 */
export interface RefreshMetadataResult {
  refreshed: number;
  /** Lessons with no video. A success, not an error. */
  skipped: number;
  failed: RefreshFailure[];
  reason?: string;
}

const refreshMetadataResultSchema = z.object({
  refreshed: z.number().int(),
  skipped: z.number().int(),
  failed: z.array(
    z.object({
      lessonId: z.string(),
      reason: z.string(),
    }),
  ),
  reason: z.string().optional(),
}) satisfies z.ZodType<RefreshMetadataResult>;

export type {
  AdminCourse,
  AdminCourseModule,
  AdminCourseModuleWithLessons,
  AdminCourseOutline,
  AdminLesson,
  AdminModuleSchedule,
  AdminModuleScheduleEntry,
};

@Injectable({ providedIn: 'root' })
export class AdminLearningApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/admin';

  /* ------------------------------------------------------------------ */
  /* Courses — `v1/admin/courses`                                        */
  /* ------------------------------------------------------------------ */

  /**
   * `GET /admin/courses` — every live course, drafts included, in `sortOrder`
   * then title order.
   *
   * ⚠️ TOMBSTONES ARE EXCLUDED AND THERE IS NO `includeDeleted`. A soft-deleted
   * course is invisible to this list and to `getCourse`, but
   * {@link restoreCourse} still works from an id held elsewhere (it evaluates
   * the 30-day window inside the `UPDATE`'s own `WHERE`).
   *
   * ⚠️ THE RESPONSE IS A BARE ARRAY, NOT AN ENVELOPE — unlike
   * `GET /admin/community/categories`. Do not add a `.courses` unwrap.
   */
  public listCourses(): Observable<AdminCourse[]> {
    return this.http
      .get<unknown>(`${this.base}/courses`)
      .pipe(map(validate(coursesEnvelopeSchema, 'GET /admin/courses')));
  }

  /** `GET /admin/courses/:id` — one live course. `404` for a tombstone. */
  public getCourse(id: string): Observable<AdminCourse> {
    return this.http
      .get<unknown>(`${this.base}/courses/${id}`)
      .pipe(map(validate(adminCourseSchema, `GET /admin/courses/${id}`)));
  }

  /**
   * `GET /admin/courses/:id/modules` — the whole authoring outline: every live
   * module of the course, each with its live lessons, in the server's order
   * (`sortOrder`, then `createdAt`, then `id`).
   *
   * ⚠️ THIS IS THE ONLY ADMIN READ FOR MODULES AND LESSONS, AND IT IS THE ONE
   * SOURCE OF TRUTH FOR BOTH. It applies no `published` and no member
   * visibility predicate, so drafts are included — which is most of what an
   * author looks at. Soft-deleted rows are excluded at every level and there is
   * no `includeDeleted`, so a tombstoned module or lesson is not discoverable
   * here.
   *
   * ⚠️ RE-READ IT AFTER EVERY MODULE OR LESSON WRITE RATHER THAN PATCHING A
   * LOCAL COPY. Ordering, `lessonCount` and `commentCount` are all derived
   * server-side, and a create or a reorder moves values a client cannot
   * recompute correctly.
   *
   * A course with no live modules answers `{ modules: [] }`, not an error.
   * `404` for a missing or soft-deleted course.
   */
  public getCourseOutline(courseId: string): Observable<AdminCourseOutline> {
    return this.http
      .get<unknown>(`${this.base}/courses/${courseId}/modules`)
      .pipe(
        map(
          validate(
            adminCourseOutlineSchema,
            `GET /admin/courses/${courseId}/modules`,
          ),
        ),
      );
  }

  /**
   * `POST /admin/courses` — always creates a DRAFT. `409` on a slug collision
   * the server could not resolve, `400` for an unknown `cohortKey`.
   */
  public createCourse(body: CreateCourseRequest): Observable<AdminCourse> {
    return this.http
      .post<unknown>(`${this.base}/courses`, body)
      .pipe(map(validate(adminCourseSchema, 'POST /admin/courses')));
  }

  /**
   * `PATCH /admin/courses/reorder` — R8.8.
   *
   * ⚠️ `ids` MUST BE EXACTLY THE CURRENT LIVE COURSE SET, checked inside the
   * transaction. A partial list, a duplicate or a foreign id is a `400` with no
   * writes, and the refusal reports a COUNT rather than which ids were real —
   * echoing that would turn a reorder into an existence probe. So a caller
   * sends the whole list in its new order, never a pair being swapped.
   */
  public reorderCourses(ids: readonly string[]): Observable<ReorderResult> {
    return this.http
      .patch<unknown>(`${this.base}/courses/reorder`, { ids })
      .pipe(map(validate(reorderResultSchema, 'PATCH /admin/courses/reorder')));
  }

  /** `PATCH /admin/courses/:id` — only the supplied keys are written. */
  public updateCourse(
    id: string,
    body: UpdateCourseRequest,
  ): Observable<AdminCourse> {
    return this.http
      .patch<unknown>(`${this.base}/courses/${id}`, body)
      .pipe(map(validate(adminCourseSchema, `PATCH /admin/courses/${id}`)));
  }

  /**
   * `DELETE /admin/courses/:id` — soft delete (AD-5), reversible for 30 days.
   *
   * ⚠️ THE TOMBSTONE DOES NOT CASCADE. Every member read composes visibility
   * through `module.course`, so one write hides the whole subtree; the modules
   * and lessons stay live rows and reappear intact on a restore.
   */
  public deleteCourse(id: string): Observable<DeletedResponse> {
    return this.http
      .delete<unknown>(`${this.base}/courses/${id}`)
      .pipe(
        map(validate(deletedResponseSchema, `DELETE /admin/courses/${id}`)),
      );
  }

  /** `POST /admin/courses/:id/restore` — R8.5's undo, within 30 days. */
  public restoreCourse(id: string): Observable<RestoredResponse> {
    return this.http
      .post<unknown>(`${this.base}/courses/${id}/restore`, {})
      .pipe(
        map(
          validate(restoredResponseSchema, `POST /admin/courses/${id}/restore`),
        ),
      );
  }

  /**
   * `PUT /admin/courses/:id/published` — R2.1.2, the member-visibility gate.
   *
   * ⚠️ ONE ENDPOINT AND A BOOLEAN, NOT TWO VERBS. The request states a desired
   * end state, so a retry converges. Both directions share one audit action,
   * with the direction in the metadata.
   */
  public setCoursePublished(
    id: string,
    published: boolean,
  ): Observable<AdminCourse> {
    return this.http
      .put<unknown>(`${this.base}/courses/${id}/published`, { published })
      .pipe(
        map(validate(adminCourseSchema, `PUT /admin/courses/${id}/published`)),
      );
  }

  /* ------------------------------------------------------------------ */
  /* Modules — `v1/admin/course-modules`                                 */
  /* ------------------------------------------------------------------ */

  /** `POST /admin/course-modules` — create a module in a course. */
  public createModule(
    body: CreateModuleRequest,
  ): Observable<AdminCourseModule> {
    return this.http
      .post<unknown>(`${this.base}/course-modules`, body)
      .pipe(
        map(validate(adminCourseModuleSchema, 'POST /admin/course-modules')),
      );
  }

  /**
   * `POST /admin/course-modules/schedule/preview` — C4's rehearsal. Writes
   * nothing, audits nothing, and returns EVERY live module of the course.
   *
   * ⚠️ IT IS NOT A MODULE READ. Use {@link getCourseOutline} for that. This
   * route answers about a PROPOSED schedule, so call it only where an admin
   * supplied the start date, time and zone it is describing, and answer with
   * its dates only there.
   *
   * ⚠️ `400` WHEN THE COURSE HAS NO LIVE MODULES ("This course has no live
   * modules to schedule.").
   *
   * ⚠️ IT IS A `POST` BECAUSE IT TAKES THE SAME BODY AS THE APPLY. A `GET` with
   * a query-shaped DTO would drift from the apply the first time either
   * changed, and a preview that no longer describes the apply defends nothing.
   */
  public previewModuleSchedule(
    body: PreviewModuleScheduleRequest,
  ): Observable<AdminModuleSchedule> {
    return this.http
      .post<unknown>(`${this.base}/course-modules/schedule/preview`, body)
      .pipe(
        map(
          validate(
            adminModuleScheduleSchema,
            'POST /admin/course-modules/schedule/preview',
          ),
        ),
      );
  }

  /**
   * `POST /admin/course-modules/schedule` — C4's apply.
   *
   * 🔴 A TOTAL RE-SCHEDULE THAT OVERWRITES MANUAL DATES. Only the rows whose
   * date actually moves are written, so a second identical apply reports
   * `changedCount: 0`. The audit row carries the previous date per changed
   * module and is the only record of them — no column keeps a former
   * `releaseAt`. Callers MUST show the preview and get an explicit
   * confirmation before invoking this.
   */
  public applyModuleSchedule(
    body: ApplyModuleScheduleRequest,
  ): Observable<AdminModuleSchedule> {
    return this.http
      .post<unknown>(`${this.base}/course-modules/schedule`, body)
      .pipe(
        map(
          validate(
            adminModuleScheduleSchema,
            'POST /admin/course-modules/schedule',
          ),
        ),
      );
  }

  /**
   * `PATCH /admin/course-modules/reorder` — the full live sibling set of ONE
   * course, in its new order.
   *
   * ⚠️ `courseId` IS SENT EXPLICITLY, NOT INFERRED FROM THE FIRST ID. Inferring
   * it would make a request that mixes two courses' modules look valid for
   * whichever course the first id belonged to, and would renumber a course the
   * admin was not editing.
   */
  public reorderModules(
    courseId: string,
    ids: readonly string[],
  ): Observable<ReorderResult> {
    return this.http
      .patch<unknown>(`${this.base}/course-modules/reorder`, { courseId, ids })
      .pipe(
        map(
          validate(reorderResultSchema, 'PATCH /admin/course-modules/reorder'),
        ),
      );
  }

  /** `PATCH /admin/course-modules/:id` — only the supplied keys are written. */
  public updateModule(
    id: string,
    body: UpdateModuleRequest,
  ): Observable<AdminCourseModule> {
    return this.http
      .patch<unknown>(`${this.base}/course-modules/${id}`, body)
      .pipe(
        map(
          validate(
            adminCourseModuleSchema,
            `PATCH /admin/course-modules/${id}`,
          ),
        ),
      );
  }

  /** `DELETE /admin/course-modules/:id` — soft delete (AD-5). */
  public deleteModule(id: string): Observable<DeletedResponse> {
    return this.http
      .delete<unknown>(`${this.base}/course-modules/${id}`)
      .pipe(
        map(
          validate(deletedResponseSchema, `DELETE /admin/course-modules/${id}`),
        ),
      );
  }

  /* ------------------------------------------------------------------ */
  /* Lessons — `v1/admin/lessons`                                        */
  /* ------------------------------------------------------------------ */

  /** `POST /admin/lessons` — create a lesson in a module. */
  public createLesson(body: CreateLessonRequest): Observable<AdminLesson> {
    return this.http
      .post<unknown>(`${this.base}/lessons`, body)
      .pipe(map(validate(adminLessonSchema, 'POST /admin/lessons')));
  }

  /**
   * `PATCH /admin/lessons/reorder` — the full live sibling set of ONE module.
   * `moduleId` is explicit for the same reason `courseId` is on
   * {@link reorderModules}.
   */
  public reorderLessons(
    moduleId: string,
    ids: readonly string[],
  ): Observable<ReorderResult> {
    return this.http
      .patch<unknown>(`${this.base}/lessons/reorder`, { moduleId, ids })
      .pipe(map(validate(reorderResultSchema, 'PATCH /admin/lessons/reorder')));
  }

  /**
   * `POST /admin/lessons/refresh-metadata` — re-fetch YouTube metadata for
   * 1–100 lessons.
   *
   * ⚠️ A LESSON WITH NO VIDEO IS `skipped`, NOT `failed`. An admin refreshing a
   * whole module includes text-only lessons, and reporting those as errors
   * would bury the ones that matter.
   */
  public refreshLessonMetadata(
    lessonIds: readonly string[],
  ): Observable<RefreshMetadataResult> {
    return this.http
      .post<unknown>(`${this.base}/lessons/refresh-metadata`, { lessonIds })
      .pipe(
        map(
          validate(
            refreshMetadataResultSchema,
            'POST /admin/lessons/refresh-metadata',
          ),
        ),
      );
  }

  /** `PATCH /admin/lessons/:id` — text and, only if mentioned, the video. */
  public updateLesson(
    id: string,
    body: UpdateLessonRequest,
  ): Observable<AdminLesson> {
    return this.http
      .patch<unknown>(`${this.base}/lessons/${id}`, body)
      .pipe(map(validate(adminLessonSchema, `PATCH /admin/lessons/${id}`)));
  }

  /**
   * `DELETE /admin/lessons/:id` — soft delete (AD-5).
   *
   * ⚠️ A DELETED LESSON LEAVES THE SEQUENTIAL CHAIN. It can never be completed,
   * so the server excludes it from the unlock rule; leaving it in would lock the
   * next module for everybody, forever.
   */
  public deleteLesson(id: string): Observable<DeletedResponse> {
    return this.http
      .delete<unknown>(`${this.base}/lessons/${id}`)
      .pipe(
        map(validate(deletedResponseSchema, `DELETE /admin/lessons/${id}`)),
      );
  }

  /**
   * `POST /admin/lessons/:id/refresh-metadata` — the single form.
   *
   * It is the bulk implementation with a one-element list and returns the SAME
   * shape, so one outcome renderer serves both.
   */
  public refreshLessonMetadataOne(
    id: string,
  ): Observable<RefreshMetadataResult> {
    return this.http
      .post<unknown>(`${this.base}/lessons/${id}/refresh-metadata`, {})
      .pipe(
        map(
          validate(
            refreshMetadataResultSchema,
            `POST /admin/lessons/${id}/refresh-metadata`,
          ),
        ),
      );
  }
}
