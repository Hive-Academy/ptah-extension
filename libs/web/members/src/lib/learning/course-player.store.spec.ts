import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpErrorResponse } from '@angular/common/http';
import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import * as ts from 'typescript';

import type { MemberLessonProgress } from '@ptah-contracts/community';

import { MemberLearningApiService } from '../services/member-learning-api.service';
import { CoursePlayerStore } from './course-player.store';
import { lessonProgress } from './learning-fixtures';

/**
 * The store's source with COMMENTS REMOVED — the docblock legitimately
 * discusses the threshold rule it must not implement.
 */
const CODE = ts.transpileModule(
  readFileSync(join(__dirname, 'course-player.store.ts'), 'utf8'),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: true,
      experimentalDecorators: true,
    },
    reportDiagnostics: false,
  },
).outputText;

interface ProgressCall {
  readonly courseSlug: string;
  readonly lessonSlug: string;
  readonly positionSeconds: number;
  readonly subject: Subject<MemberLessonProgress>;
}

/**
 * A recording double for the one method that costs a request.
 *
 * ⚠️ IT RECORDS THE CALLS RATHER THAN RESOLVING THEM, so every test asserts the
 * WRITE COUNT. A store that wrote on every tick passes a values-only test
 * perfectly — the count is the only assertion that catches it.
 */
class ApiDouble {
  public readonly progressCalls: ProgressCall[] = [];
  public readonly completionCalls: { complete: boolean }[] = [];
  public failNext = false;

  public putProgress(
    courseSlug: string,
    lessonSlug: string,
    positionSeconds: number,
  ) {
    if (this.failNext) {
      this.failNext = false;
      this.progressCalls.push({
        courseSlug,
        lessonSlug,
        positionSeconds,
        subject: new Subject<MemberLessonProgress>(),
      });
      return throwError(() => new Error('network down'));
    }
    const subject = new Subject<MemberLessonProgress>();
    this.progressCalls.push({
      courseSlug,
      lessonSlug,
      positionSeconds,
      subject,
    });
    return subject.asObservable();
  }

  public putCompletion(
    _courseSlug: string,
    _lessonSlug: string,
    complete: boolean,
  ) {
    this.completionCalls.push({ complete });
    // Emitted SYNCHRONOUSLY: fake timers make microtask draining ambiguous,
    // and the ordering is not what these cases are about.
    return of(
      lessonProgress({
        completedAt: complete ? '2026-08-05T09:00:00.000Z' : null,
        completionSource: complete ? 'manual' : null,
      }),
    );
  }
}

describe('CoursePlayerStore (R2.3.1–R2.3.3, §4.6.4–§4.6.6, RISK-O)', () => {
  let api: ApiDouble;
  let store: CoursePlayerStore;
  let injector: Injector;
  let now: number;
  /** The player's clock, as the store sees it. */
  let position: number;

  beforeEach(() => {
    jest.useFakeTimers();
    now = 1_000_000;
    position = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);

    api = new ApiDouble();
    TestBed.configureTestingModule({
      providers: [
        CoursePlayerStore,
        { provide: MemberLearningApiService, useValue: api },
      ],
    });
    injector = TestBed.inject(Injector);
    store = TestBed.inject(CoursePlayerStore);
    store.bind(
      'operator',
      'reconcile',
      lessonProgress({
        furthestPositionSeconds: 0,
      }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** Advances both the fake clock and `Date.now()` by `seconds`, tick by tick. */
  function play(seconds: number): void {
    for (let i = 0; i < seconds; i += 1) {
      position += 1;
      now += 1_000;
      jest.advanceTimersByTime(1_000);
    }
  }

  function attach(): void {
    store.attachClock(() => position);
  }

  /** Resolves the n-th in-flight write with the server's answer. */
  function respond(index: number, progress?: Partial<MemberLessonProgress>) {
    const call = api.progressCalls[index];
    call.subject.next(
      lessonProgress({
        furthestPositionSeconds: call.positionSeconds,
        ...progress,
      }),
    );
    call.subject.complete();
  }

  /* ---------------------------------------------------------------------- */
  /* 🔴 THE WRITE COUNT                                                      */
  /* ---------------------------------------------------------------------- */

  describe('🔴 the cadence — at most one write per 15 s', () => {
    it('60 s of playback at 1 s ticks produces EXACTLY 4 writes', () => {
      attach();
      for (let i = 0; i < 60; i += 1) {
        play(1);
        // Resolve whatever is in flight so the next window is not blocked.
        for (let n = 0; n < api.progressCalls.length; n += 1) {
          const call = api.progressCalls[n];
          if (!call.subject.closed) respond(n);
        }
      }

      expect(api.progressCalls).toHaveLength(4);
      expect(api.progressCalls.map((c) => c.positionSeconds)).toEqual([
        15, 30, 45, 60,
      ]);
    });

    it('writes NOTHING in the first 14 s', () => {
      attach();
      play(14);
      expect(api.progressCalls).toHaveLength(0);
    });

    it('sends the LATEST position, not every one it saw', () => {
      attach();
      play(15);
      expect(api.progressCalls).toHaveLength(1);
      expect(api.progressCalls[0].positionSeconds).toBe(15);
    });

    it('addresses the write to the bound course and lesson', () => {
      attach();
      play(15);
      expect(api.progressCalls[0].courseSlug).toBe('operator');
      expect(api.progressCalls[0].lessonSlug).toBe('reconcile');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Flushes                                                                 */
  /* ---------------------------------------------------------------------- */

  describe('flush on pause / ended / teardown', () => {
    it('a pause at 7 s produces exactly ONE write', () => {
      attach();
      play(7);
      expect(api.progressCalls).toHaveLength(0);

      store.flush();
      expect(api.progressCalls).toHaveLength(1);
      expect(api.progressCalls[0].positionSeconds).toBe(7);
    });

    it('ended produces exactly one write', () => {
      attach();
      play(3);
      store.flush();
      expect(api.progressCalls).toHaveLength(1);
    });

    it('🔴 a pause IMMEDIATELY after a scheduled write does not double-write', () => {
      attach();
      play(15);
      expect(api.progressCalls).toHaveLength(1);
      respond(0);

      // The queue was cleared by the successful write, so there is nothing
      // pending for the flush to send.
      store.flush();
      expect(api.progressCalls).toHaveLength(1);
    });

    it('flushing with nothing pending is a no-op', () => {
      attach();
      store.flush();
      store.flush();
      expect(api.progressCalls).toHaveLength(0);
    });

    it('DestroyRef teardown flushes once AND clears the interval', () => {
      // A leaked poll is how five open lessons end up with five pollers.
      const scoped = runInInjectionContext(injector, () =>
        TestBed.runInInjectionContext(() => store),
      );
      void scoped;

      attach();
      play(5);
      const clearSpy = jest.spyOn(globalThis, 'clearInterval');

      TestBed.resetTestingModule();

      expect(api.progressCalls).toHaveLength(1);
      expect(api.progressCalls[0].positionSeconds).toBe(5);
      expect(clearSpy).toHaveBeenCalled();

      // …and no further tick can fire.
      const before = api.progressCalls.length;
      play(60);
      expect(api.progressCalls).toHaveLength(before);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Failure handling                                                        */
  /* ---------------------------------------------------------------------- */

  describe('a failed PUT keeps the position', () => {
    it('retains it and retries with the LATEST value only', () => {
      attach();
      api.failNext = true;
      play(15);
      expect(api.progressCalls).toHaveLength(1);
      expect(api.progressCalls[0].positionSeconds).toBe(15);

      // Fifteen more seconds of playback: the retry carries 30, not 15, and
      // there is exactly ONE retry rather than a queue of two.
      play(15);
      expect(api.progressCalls).toHaveLength(2);
      expect(api.progressCalls[1].positionSeconds).toBe(30);
    });

    it('does not queue unboundedly across several failures', () => {
      attach();
      for (let i = 0; i < 4; i += 1) {
        api.failNext = true;
        play(15);
      }
      // One write per window, never a backlog replay.
      expect(api.progressCalls).toHaveLength(4);
      expect(api.progressCalls.map((c) => c.positionSeconds)).toEqual([
        15, 30, 45, 60,
      ]);
    });

    it('🔴 a locked-module 403 is TERMINAL — it stops writing entirely', () => {
      attach();
      jest.spyOn(api, 'putProgress').mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 403,
              error: { reason: 'not_released', unlocksAt: null },
            }),
        ),
      );

      play(15);
      const afterLock = (api.putProgress as jest.Mock).mock.calls.length;
      expect(afterLock).toBe(1);

      play(60);
      expect((api.putProgress as jest.Mock).mock.calls.length).toBe(afterLock);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Seeking                                                                 */
  /* ---------------------------------------------------------------------- */

  describe('seeking', () => {
    it('🔴 seeking BACKWARDS writes nothing', () => {
      attach();
      play(15);
      expect(api.progressCalls).toHaveLength(1);
      respond(0);

      // Rewind to the start and let two full write windows pass. Nothing is
      // pending, because every tick since the rewind read a LOWER position.
      position = 2;
      for (let i = 0; i < 40; i += 1) {
        now += 1_000;
        jest.advanceTimersByTime(1_000);
      }

      expect(api.progressCalls).toHaveLength(1);
    });

    it('resumes writing once the member passes the previous high-water mark', () => {
      attach();
      play(15);
      respond(0);

      position = 2;
      for (let i = 0; i < 20; i += 1) {
        now += 1_000;
        jest.advanceTimersByTime(1_000);
      }
      expect(api.progressCalls).toHaveLength(1);

      position = 40;
      now += 1_000;
      jest.advanceTimersByTime(1_000);
      expect(api.progressCalls).toHaveLength(2);
      expect(api.progressCalls[1].positionSeconds).toBe(40);
    });

    it('seeds the high-water mark from the SERVER progress, not from zero', () => {
      // A member returning to a lesson at 0:00 must not re-write positions the
      // server already holds.
      store.bind(
        'operator',
        'reconcile',
        lessonProgress({ furthestPositionSeconds: 120 }),
      );
      attach();
      play(30);
      expect(api.progressCalls).toHaveLength(0);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Rebinding                                                               */
  /* ---------------------------------------------------------------------- */

  describe('a slug change RESETS the store', () => {
    it('flushes the old lesson, then writes nothing under the new slug', () => {
      attach();
      play(5);
      expect(api.progressCalls).toHaveLength(0);

      store.bind(
        'operator',
        'managing-state',
        lessonProgress({
          furthestPositionSeconds: 0,
        }),
      );

      // The unwritten 5 s went to the OLD lesson.
      expect(api.progressCalls).toHaveLength(1);
      expect(api.progressCalls[0].lessonSlug).toBe('reconcile');
      expect(api.progressCalls[0].positionSeconds).toBe(5);
    });

    it('detaches the old clock so the previous poll cannot keep writing', () => {
      attach();
      play(5);
      store.bind('operator', 'managing-state', lessonProgress());
      const before = api.progressCalls.length;

      play(60);
      expect(api.progressCalls).toHaveLength(before);
    });

    it('replaces the progress signal wholesale', () => {
      store.bind(
        'operator',
        'managing-state',
        lessonProgress({
          furthestPositionSeconds: 9,
          completedAt: '2026-08-05T09:00:00.000Z',
          completionSource: 'manual',
        }),
      );
      expect(store.progress().furthestPositionSeconds).toBe(9);
      expect(store.completed()).toBe(true);
      expect(store.completionSource()).toBe('manual');
    });
  });

  /* ---------------------------------------------------------------------- */
  /* 🔴 The server owns completion                                           */
  /* ---------------------------------------------------------------------- */

  describe('🔴 completion is the SERVER’s answer', () => {
    it('reconciles wholesale from the progress response, never merging', () => {
      attach();
      play(15);
      respond(0, {
        completedAt: '2026-08-05T09:08:11.872Z',
        completionSource: 'auto',
      });

      expect(store.completed()).toBe(true);
      expect(store.completionSource()).toBe('auto');
    });

    it('setCompletion sends the boolean and takes the response as truth', () => {
      store.setCompletion(true);
      expect(api.completionCalls).toEqual([{ complete: true }]);

      expect(store.completed()).toBe(true);
      expect(store.completionSource()).toBe('manual');
    });

    it('un-completing clears the verdict and leaves the position alone', () => {
      store.bind(
        'operator',
        'reconcile',
        lessonProgress({ furthestPositionSeconds: 47 }),
      );
      store.setCompletion(false);

      expect(store.completed()).toBe(false);
      expect(store.progress().furthestPositionSeconds).toBe(47);
    });

    it('🔴 NO THRESHOLD ARITHMETIC APPEARS ANYWHERE IN THE FILE', () => {
      // RISK-O's frontend shape. The moment this client computes a percentage
      // of a duration there are two implementations of R2.3.2. Asserted against
      // the COMMENT-STRIPPED source, because the docblock above legitimately
      // explains the rule it must not implement.
      expect(CODE).not.toContain('0.9');
      expect(CODE).not.toMatch(/\b90\b/);
      expect(CODE).not.toContain('threshold');
      expect(CODE).not.toContain('Threshold');
      // …and it never reads a DURATION at all, which is the stronger statement.
      expect(CODE).not.toContain('videoDurationSeconds');
      expect(CODE).not.toContain('durationSeconds');

      // ANTI-VACUITY: the stripper kept the code.
      expect(CODE).toContain('CoursePlayerStore');
      expect(CODE).toContain('putProgress');
      expect(CODE).toContain('15_000');
    });

    it('🔴 sends no completion flag on the progress path', () => {
      // The service asserts the wire body; this asserts the store never asks
      // for one. `putProgress` takes three positional arguments and there is no
      // object in which a verdict could be smuggled.
      attach();
      play(15);
      const call = api.progressCalls[0];
      expect(typeof call.positionSeconds).toBe('number');
      expect(Object.keys(call)).toEqual([
        'courseSlug',
        'lessonSlug',
        'positionSeconds',
        'subject',
      ]);
    });
  });
});
