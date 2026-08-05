import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { isMembershipRequiredError } from '@ptah-web/core';

import {
  courseDetail,
  courseSummary,
  lessonComment,
  lessonDetail,
  lessonProgress,
} from '../learning/learning-fixtures';
import {
  MemberLearningApiService,
  isLockedModuleError,
} from './member-learning-api.service';

const COURSES = '/api/v1/members/courses';
const COMMENTS = '/api/v1/members/lesson-comments';

describe('MemberLearningApiService', () => {
  let service: MemberLearningApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MemberLearningApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /* ---------------------------------------------------------------------- */
  /* The boundary parse is LIVE, not decorative                              */
  /* ---------------------------------------------------------------------- */

  describe('the schema parse at the HTTP boundary', () => {
    it('a well-formed response parses', async () => {
      const promise = firstValueFrom(service.listCourses());
      http.expectOne(COURSES).flush([courseSummary()]);

      await expect(promise).resolves.toEqual([courseSummary()]);
    });

    it('a response MISSING a required field throws — the parse is live', async () => {
      // Without this case the schema could be `z.any()` and every other test
      // here would still pass.
      const withoutPercent: Record<string, unknown> = { ...courseSummary() };
      delete withoutPercent['percent'];
      const promise = firstValueFrom(service.listCourses());
      http.expectOne(COURSES).flush([withoutPercent]);

      await expect(promise).rejects.toThrow(/GET \/members\/courses/);
      await expect(promise).rejects.toThrow(/percent/);
    });

    it('an UNKNOWN extra field is stripped rather than rejected', async () => {
      // `z.object()` strips. That asymmetry is why a client schema may omit a
      // field the server sends, and why it may NEVER declare one the server
      // does not — RISK-C, and the reason Batch 10 follows Batch 9.
      const promise = firstValueFrom(service.listCourses());
      http
        .expectOne(COURSES)
        .flush([{ ...courseSummary(), somethingNew: 'from a later server' }]);

      const result = await promise;
      expect(result[0]).toEqual(courseSummary());
      expect('somethingNew' in result[0]).toBe(false);
    });

    it('a malformed lesson detail names the endpoint AND the field', async () => {
      const promise = firstValueFrom(
        service.getLesson('operator-design-patterns', 'reconcile'),
      );
      http
        .expectOne(`${COURSES}/operator-design-patterns/lessons/reconcile`)
        .flush({ ...lessonDetail(), progress: null });

      await expect(promise).rejects.toThrow(/lessons\/reconcile/);
      await expect(promise).rejects.toThrow(/progress/);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Courses                                                                 */
  /* ---------------------------------------------------------------------- */

  describe('listCourses', () => {
    it('issues ONE unpaged GET with no query parameters at all', async () => {
      // ⚠️ There is no `@Query()` on `MemberCoursesController`. A `?page=` here
      // would be a 400, and a `pageParams()` guard would be protecting a
      // parameter no endpoint accepts.
      const promise = firstValueFrom(service.listCourses());
      const request = http.expectOne(COURSES);

      expect(request.request.method).toBe('GET');
      expect(request.request.params.keys()).toEqual([]);
      expect(request.request.urlWithParams).toBe(COURSES);

      request.flush([]);
      await promise;
    });

    it('preserves the SERVER ORDER and re-sorts nothing', async () => {
      const wire = [
        courseSummary({ id: 'c3', slug: 'zeta', title: 'Zeta' }),
        courseSummary({ id: 'c1', slug: 'alpha', title: 'Alpha' }),
        courseSummary({ id: 'c2', slug: 'mid', title: 'Mid' }),
      ];
      const promise = firstValueFrom(service.listCourses());
      http.expectOne(COURSES).flush(wire);

      // Alphabetically wrong on purpose: a client-side sort would "fix" it and
      // silently reorder only the rows it happens to hold.
      expect((await promise).map((c) => c.slug)).toEqual([
        'zeta',
        'alpha',
        'mid',
      ]);
    });
  });

  describe('getCourse', () => {
    it('encodes the slug into the path', async () => {
      const promise = firstValueFrom(service.getCourse('a b/c'));
      http.expectOne(`${COURSES}/a%20b%2Fc`).flush(courseDetail());
      await promise;
    });

    it('returns the outline INCLUDING locked modules, and the resume target', async () => {
      const promise = firstValueFrom(service.getCourse('operator'));
      http.expectOne(`${COURSES}/operator`).flush(courseDetail());

      const detail = await promise;
      expect(detail.modules).toHaveLength(2);
      expect(detail.modules[1].locked).toBe(true);
      // R2.4.4 — a locked module's lesson TITLES are visible on purpose.
      expect(detail.modules[1].lessons).toHaveLength(1);
      expect(detail.resumeLesson?.slug).toBe('reconcile-loop-fundamentals');
    });

    it('a 404 (absent OR invisible) propagates as an error, not as a lock', async () => {
      const promise = firstValueFrom(service.getCourse('draft-course'));
      http
        .expectOne(`${COURSES}/draft-course`)
        .flush(
          { message: 'Course not found', statusCode: 404 },
          { status: 404, statusText: 'Not Found' },
        );

      await expect(promise).rejects.toBeInstanceOf(HttpErrorResponse);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* getLesson — the 403-as-a-result design                                  */
  /* ---------------------------------------------------------------------- */

  describe('getLesson', () => {
    const URL = `${COURSES}/operator/lessons/reconcile`;

    it('resolves an open lesson as { locked: false, lesson }', async () => {
      const promise = firstValueFrom(
        service.getLesson('operator', 'reconcile'),
      );
      http.expectOne(URL).flush(lessonDetail());

      const result = await promise;
      expect(result.locked).toBe(false);
      if (result.locked) throw new Error('narrowing failed');
      expect(result.lesson.youtubeVideoId).toBe('dQw4w9WgXcQ');
    });

    it('🔴 RESOLVES a locked module as a typed result — it does NOT throw', async () => {
      const promise = firstValueFrom(
        service.getLesson('operator', 'reconcile'),
      );
      http.expectOne(URL).flush(
        {
          reason: 'not_released',
          unlocksAt: '2027-12-25T09:00:00.000Z',
          message: 'This module is not open yet.',
        },
        { status: 403, statusText: 'Forbidden' },
      );

      const result = await promise;
      expect(result).toEqual({
        locked: true,
        reason: 'not_released',
        unlocksAt: '2027-12-25T09:00:00.000Z',
      });
    });

    it("carries unlocksAt: null for 'previous_module_incomplete'", async () => {
      const promise = firstValueFrom(
        service.getLesson('operator', 'reconcile'),
      );
      http.expectOne(URL).flush(
        {
          reason: 'previous_module_incomplete',
          unlocksAt: null,
          message: 'Finish the previous module first.',
        },
        { status: 403, statusText: 'Forbidden' },
      );

      const result = await promise;
      expect(result).toEqual({
        locked: true,
        reason: 'previous_module_incomplete',
        unlocksAt: null,
      });
    });

    it('a 404 still THROWS — absent is not a state with a reason to show', async () => {
      const promise = firstValueFrom(service.getLesson('operator', 'nope'));
      http
        .expectOne(`${COURSES}/operator/lessons/nope`)
        .flush(
          { message: 'Lesson not found' },
          { status: 404, statusText: 'Not Found' },
        );

      await expect(promise).rejects.toBeInstanceOf(HttpErrorResponse);
    });

    it('a 403 with an UNRECOGNISED reason throws rather than inventing a lock', async () => {
      // A future `403` this UI has no screen for must not be silently rendered
      // as "not released" — that would tell a member to come back on a date
      // that has nothing to do with why they were refused.
      const promise = firstValueFrom(
        service.getLesson('operator', 'reconcile'),
      );
      http
        .expectOne(URL)
        .flush(
          { reason: 'some_future_reason' },
          { status: 403, statusText: 'Forbidden' },
        );

      await expect(promise).rejects.toBeInstanceOf(HttpErrorResponse);
    });

    it('a 500 throws', async () => {
      const promise = firstValueFrom(
        service.getLesson('operator', 'reconcile'),
      );
      http
        .expectOne(URL)
        .flush({}, { status: 500, statusText: 'Server Error' });

      await expect(promise).rejects.toBeInstanceOf(HttpErrorResponse);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 The 403 taxonomy — membership vs lock                                */
  /* ---------------------------------------------------------------------- */

  describe('403 classification (RISK-T, B6C carried item 5)', () => {
    function error403(body: unknown): HttpErrorResponse {
      return new HttpErrorResponse({
        status: 403,
        statusText: 'Forbidden',
        error: body,
      });
    }

    it("the SHARED helper recognises 403 { reason: 'membership_required' }", () => {
      expect(
        isMembershipRequiredError(error403({ reason: 'membership_required' })),
      ).toBe(true);
    });

    it("🔴 the shared helper does NOT recognise 403 { reason: 'not_released' }", () => {
      // Conflating them would bounce a member to /pricing for opening a module
      // that unlocks next week.
      expect(
        isMembershipRequiredError(
          error403({ reason: 'not_released', unlocksAt: null }),
        ),
      ).toBe(false);
    });

    it('and the lock helper is the exact mirror of that', () => {
      expect(
        isLockedModuleError(
          error403({ reason: 'not_released', unlocksAt: null }),
        ),
      ).toBe(true);
      expect(
        isLockedModuleError(error403({ reason: 'membership_required' })),
      ).toBe(false);
    });

    it('isLockedModuleError is false for a 404, a 500 and a non-HTTP error', () => {
      expect(
        isLockedModuleError(
          new HttpErrorResponse({
            status: 404,
            error: { reason: 'not_released' },
          }),
        ),
      ).toBe(false);
      expect(
        isLockedModuleError(
          new HttpErrorResponse({ status: 500, error: null }),
        ),
      ).toBe(false);
      expect(isLockedModuleError(new Error('boom'))).toBe(false);
      expect(isLockedModuleError(null)).toBe(false);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 Progress — the one-key wire body                                     */
  /* ---------------------------------------------------------------------- */

  describe('putProgress', () => {
    const URL = `${COURSES}/operator/lessons/reconcile/progress`;

    it('🔴 the wire body has EXACTLY the key positionSeconds and no other', async () => {
      const promise = firstValueFrom(
        service.putProgress('operator', 'reconcile', 91),
      );
      const request = http.expectOne(URL);

      expect(request.request.method).toBe('PUT');
      // ⚠️ Asserted as the FULL key set, not as "does not contain completed".
      // A `toEqual` on the keys is what catches a `completionSource` or a
      // `duration` added later "for convenience" — and the server answers a
      // second key with a 400, not with a silent drop.
      expect(Object.keys(request.request.body as object)).toEqual([
        'positionSeconds',
      ]);
      expect(request.request.body).toEqual({ positionSeconds: 91 });

      request.flush(lessonProgress({ furthestPositionSeconds: 91 }));
      await promise;
    });

    it('returns the SERVER’s completion verdict, which the client never computes', async () => {
      const promise = firstValueFrom(
        service.putProgress('operator', 'reconcile', 191),
      );
      http.expectOne(URL).flush(
        lessonProgress({
          furthestPositionSeconds: 191,
          completedAt: '2026-08-05T09:08:11.872Z',
          completionSource: 'auto',
        }),
      );

      const progress = await promise;
      expect(progress.completionSource).toBe('auto');
      expect(progress.completedAt).not.toBeNull();
    });

    it('a locked lesson answers 403 on the WRITE path too, and it classifies', async () => {
      const promise = firstValueFrom(
        service.putProgress('operator', 'locked', 10),
      );
      http
        .expectOne(`${COURSES}/operator/lessons/locked/progress`)
        .flush(
          { reason: 'not_released', unlocksAt: '2027-12-25T09:00:00.000Z' },
          { status: 403, statusText: 'Forbidden' },
        );

      await expect(promise).rejects.toBeInstanceOf(HttpErrorResponse);
      // ⚠️ The write path's 403 must classify EXACTLY as the read path's does,
      // so `CoursePlayerStore` can treat it as terminal instead of retrying a
      // request that can never succeed.
      await promise.catch((error: unknown) => {
        expect(isLockedModuleError(error)).toBe(true);
      });
    });
  });

  describe('putCompletion', () => {
    const URL = `${COURSES}/operator/lessons/reconcile/completion`;

    it('sends exactly { complete } — a DIFFERENT route from progress', async () => {
      const promise = firstValueFrom(
        service.putCompletion('operator', 'reconcile', true),
      );
      const request = http.expectOne(URL);

      expect(Object.keys(request.request.body as object)).toEqual(['complete']);
      request.flush(
        lessonProgress({
          completedAt: '2026-08-05T09:32:18.462Z',
          completionSource: 'manual',
        }),
      );

      expect((await promise).completionSource).toBe('manual');
    });

    it('is reversible and leaves the POSITION untouched (R2.3.3)', async () => {
      const promise = firstValueFrom(
        service.putCompletion('operator', 'reconcile', false),
      );
      http.expectOne(URL).flush(
        lessonProgress({
          furthestPositionSeconds: 47,
          completedAt: null,
          completionSource: null,
        }),
      );

      const progress = await promise;
      expect(progress.completedAt).toBeNull();
      // ⚠️ RISK-O: un-completing clears the verdict, never the position.
      expect(progress.furthestPositionSeconds).toBe(47);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Comments                                                                */
  /* ---------------------------------------------------------------------- */

  describe('lesson comments', () => {
    it('omits parentId from the wire for a top-level comment', async () => {
      const promise = firstValueFrom(
        service.createComment({ lessonId: 'les_1', bodyMarkdown: 'Hi' }),
      );
      const request = http.expectOne(COMMENTS);

      expect(Object.keys(request.request.body as object).sort()).toEqual([
        'bodyMarkdown',
        'lessonId',
      ]);
      request.flush(lessonComment());
      await promise;
    });

    it('omits parentId when the caller passes an explicit null', async () => {
      // A caller holding `MemberLessonComment.parentId` (typed `string | null`)
      // must not have to convert. `@MinLength(1)` makes a literal null a 400.
      const promise = firstValueFrom(
        service.createComment({
          lessonId: 'les_1',
          bodyMarkdown: 'Hi',
          parentId: null,
        }),
      );
      const request = http.expectOne(COMMENTS);

      expect('parentId' in (request.request.body as object)).toBe(false);
      request.flush(lessonComment());
      await promise;
    });

    it('sends parentId when there is one', async () => {
      const promise = firstValueFrom(
        service.createComment({
          lessonId: 'les_1',
          bodyMarkdown: 'Reply',
          parentId: 'cmt_1',
        }),
      );
      const request = http.expectOne(COMMENTS);

      expect(request.request.body).toEqual({
        lessonId: 'les_1',
        bodyMarkdown: 'Reply',
        parentId: 'cmt_1',
      });
      request.flush(lessonComment({ id: 'cmt_2', parentId: 'cmt_1' }));
      await promise;
    });

    it('trusts the RETURNED parentId — depth 3 is repaired to depth 2', async () => {
      // Measured live: posting with a reply's id as the parent returned 201
      // carrying the TOP-LEVEL comment's id. Splicing the requested parentId
      // into the list would draw a tree the server does not have.
      const promise = firstValueFrom(
        service.createComment({
          lessonId: 'les_1',
          bodyMarkdown: 'Depth three attempt',
          parentId: 'cmt_reply',
        }),
      );
      http
        .expectOne(COMMENTS)
        .flush(lessonComment({ id: 'cmt_3', parentId: 'cmt_top' }));

      expect((await promise).parentId).toBe('cmt_top');
    });

    it('updateComment PATCHes exactly { bodyMarkdown }', async () => {
      const promise = firstValueFrom(service.updateComment('cmt_1', 'edited'));
      const request = http.expectOne(`${COMMENTS}/cmt_1`);

      expect(request.request.method).toBe('PATCH');
      expect(request.request.body).toEqual({ bodyMarkdown: 'edited' });
      request.flush(lessonComment({ bodyMarkdown: 'edited' }));
      await promise;
    });

    it('deleteComment returns the { deleted } envelope', async () => {
      const promise = firstValueFrom(service.deleteComment('cmt_1'));
      const request = http.expectOne(`${COMMENTS}/cmt_1`);

      expect(request.request.method).toBe('DELETE');
      request.flush({ deleted: true });

      await expect(promise).resolves.toEqual({ deleted: true });
    });

    it('setCommentAnswered PUTs exactly { answered } (A-8, not a reaction)', async () => {
      const promise = firstValueFrom(service.setCommentAnswered('cmt_1', true));
      const request = http.expectOne(`${COMMENTS}/cmt_1/answered`);

      expect(request.request.method).toBe('PUT');
      expect(Object.keys(request.request.body as object)).toEqual(['answered']);
      request.flush(lessonComment({ answered: true }));

      expect((await promise).answered).toBe(true);
    });

    it('a tombstone parses with its placeholder body and null author', async () => {
      const promise = firstValueFrom(
        service.getLesson('operator', 'reconcile'),
      );
      http.expectOne(`${COURSES}/operator/lessons/reconcile`).flush(
        lessonDetail({
          comments: [
            lessonComment({
              deleted: true,
              authorName: null,
              bodyMarkdown: 'This comment was removed.',
            }),
          ],
        }),
      );

      const result = await promise;
      if (result.locked) throw new Error('narrowing failed');
      expect(result.lesson.comments[0].deleted).toBe(true);
      // ⚠️ NOT `''`. Batch 7 found an empty body renders as a blank row that
      // reads as a rendering bug rather than as a removal.
      expect(result.lesson.comments[0].bodyMarkdown).not.toBe('');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Structural — what this service must NOT grow                            */
  /* ---------------------------------------------------------------------- */

  describe('the service stays pure data access', () => {
    it('exposes exactly the §3.4 methods and no state', () => {
      const methods = Object.getOwnPropertyNames(
        MemberLearningApiService.prototype,
      )
        .filter((name) => name !== 'constructor')
        .sort();

      expect(methods).toEqual([
        'createComment',
        'deleteComment',
        'getCourse',
        'getLesson',
        'listCourses',
        'putCompletion',
        'putProgress',
        'setCommentAnswered',
        'updateComment',
      ]);
    });

    it('A-8 — there is no reaction method on this surface', () => {
      const names = Object.getOwnPropertyNames(
        MemberLearningApiService.prototype,
      ).join(' ');
      expect(names.toLowerCase()).not.toContain('reaction');
    });
  });
});
