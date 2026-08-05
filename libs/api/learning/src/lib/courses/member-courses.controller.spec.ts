// ⚠️ FIRST IMPORT — the progress DTOs carry `class-validator` decorators and
// this lib has no jest `setupFiles`.
import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { Request } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MemberGuard, type MemberContext } from '@ptah-api/membership';

import {
  ROUTE_PARAMTYPES,
  handlersOf,
  routeArgs,
  routeOf,
  unifies,
} from '../../testing/controller-reflection';
import { MemberLessonCommentsController } from '../comments/member-lesson-comments.controller';
import { SetCompletionDto } from '../progress/dto/set-completion.dto';
import { UpdateProgressDto } from '../progress/dto/update-progress.dto';
import type { ProgressService } from '../progress/progress.service';

import type { CourseReadService } from './course-read.service';
import { MemberCoursesController } from './member-courses.controller';

/**
 * `MemberCoursesController` — §3.4's member curriculum surface.
 *
 * The properties this file exists for:
 *
 *   RI-1 — `v1/members/courses` and `v1/members/lesson-comments` are DISJOINT
 *          literal depth-3 siblings, and neither parameterises segment 3
 *          (AD-12's payoff; RISK-B cannot recur).
 *   PRE-1 — both bodies bind `dtoPipe`, and there is no `@Query()` at all, so
 *          this controller cannot move `NAMED_PRIMITIVE_PARAM_COUNT`.
 *   🔴 §4.6.6 — `UpdateProgressDto` has EXACTLY ONE property and a client-sent
 *          `completed` flag is REJECTED, not ignored. Exit-gate clause 2.
 *   🔴 The two progress routes compose the module-lock `403` through the SAME
 *          decision the lesson read uses. Exit-gate clause 1, at the unit level;
 *          Task 9.17 proves it live.
 */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

function memberRequest(): Request {
  return {
    memberContext: CTX,
    method: 'PUT',
    path: '/api/v1/members/courses/foundations/lessons/intro/progress',
  } as unknown as Request;
}

/**
 * A request with NO `memberContext` — the removed-guard tripwire.
 *
 * ⚠️ A SEPARATE FUNCTION, NOT `memberRequest(undefined)`. A default parameter
 * FIRES on an explicitly-passed `undefined`, so `function memberRequest(ctx =
 * CTX)` would hand the happy-path context to every "guard removed" case and each
 * of them would assert the opposite of its name. That bug has already happened
 * twice in this task.
 */
function unguardedRequest(): Request {
  return {
    method: 'GET',
    path: '/api/v1/members/courses',
  } as unknown as Request;
}

interface Harness {
  controller: MemberCoursesController;
  courses: {
    listCourses: jest.Mock;
    getCourse: jest.Mock;
    getLesson: jest.Mock;
    resolveWritableLesson: jest.Mock;
  };
  progress: { updateProgress: jest.Mock; setCompletion: jest.Mock };
}

/**
 * Collaborator doubles here, and REAL services in
 * `course-read.service.spec.ts` / `progress.service.spec.ts`.
 *
 * ⚠️ THE DIVISION IS DELIBERATE. What this file can assert that nothing else can
 * is the CONTROLLER's own behaviour: the route table, the guard chain, the pipe
 * bindings, and the COMPOSITION ORDER of the two progress routes. Whether the
 * lock verdict itself is right is `module-lock.service.spec.ts`'s job, and
 * re-deriving it here would be a second, weaker copy of that suite.
 */
function createHarness(): Harness {
  const courses = {
    listCourses: jest.fn().mockResolvedValue([]),
    getCourse: jest.fn().mockResolvedValue({}),
    getLesson: jest.fn().mockResolvedValue({}),
    resolveWritableLesson: jest.fn().mockResolvedValue({ lessonId: 'l-1' }),
  };
  const progress = {
    updateProgress: jest.fn().mockResolvedValue({}),
    setCompletion: jest.fn().mockResolvedValue({}),
  };

  const controller = new MemberCoursesController(
    courses as unknown as CourseReadService,
    progress as unknown as ProgressService,
  );

  return { controller, courses, progress };
}

describe('MemberCoursesController', () => {
  describe('RI-1 — disjoint literal depth-3 member prefixes', () => {
    it('the two learning member prefixes are siblings, not nested', () => {
      const prefixes = [
        MemberCoursesController,
        MemberLessonCommentsController,
      ].map((c) => Reflect.getMetadata(PATH_METADATA, c) as string);

      expect(prefixes).toEqual([
        'v1/members/courses',
        'v1/members/lesson-comments',
      ]);

      for (const a of prefixes) {
        for (const b of prefixes) {
          if (a === b) continue;
          expect(b.startsWith(`${a}/`)).toBe(false);
        }
      }
    });

    it('segment 3 is a LITERAL on both — RISK-B cannot recur', () => {
      // AD-12 moved `MembersController` off the bare `v1/members` for exactly
      // this reason. A parameterised segment 3 here would make this controller a
      // wildcard over every other member surface.
      for (const controller of [
        MemberCoursesController,
        MemberLessonCommentsController,
      ]) {
        const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
        const segments = prefix.split('/');

        expect(segments).toHaveLength(3);
        expect(segments[2]?.startsWith(':')).toBe(false);
      }
    });
  });

  describe('the guard chain', () => {
    it('declares JwtAuthGuard then MemberGuard at CLASS level, in that order', () => {
      // Class level, so a handler added later is guarded by default. Order,
      // because `JwtAuthGuard` populates `req.user` before `MemberGuard` reads
      // it to resolve entitlement.
      const guards =
        (Reflect.getMetadata(
          GUARDS_METADATA,
          MemberCoursesController,
        ) as unknown[]) ?? [];

      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(MemberGuard);
      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(MemberGuard),
      );
    });

    it('refuses loudly when the guard has been removed', async () => {
      const harness = createHarness();

      await expect(
        harness.controller.list(unguardedRequest()),
      ).rejects.toThrow();
      // …and it refused BEFORE reaching the read model, so no ungated query ran.
      expect(harness.courses.listCourses).not.toHaveBeenCalled();
    });
  });

  describe('the route table', () => {
    it('is exactly the §3.4 member course surface', () => {
      const routes = handlersOf(MemberCoursesController)
        .map((handler) => {
          const { verb, path } = routeOf(MemberCoursesController, handler);
          return `${verb} ${path}`;
        })
        .sort();

      expect(routes).toEqual([
        'GET v1/members/courses',
        'GET v1/members/courses/:slug',
        'GET v1/members/courses/:slug/lessons/:lessonSlug',
        'PUT v1/members/courses/:slug/lessons/:lessonSlug/completion',
        'PUT v1/members/courses/:slug/lessons/:lessonSlug/progress',
      ]);
    });

    it('no two same-verb routes unify, so RI-3 has nothing to arbitrate here', () => {
      // The honest statement. `GET ''` / `GET :slug` / `GET :slug/lessons/:x`
      // all have different segment counts; the two `PUT`s have the SAME count
      // but differ in a LITERAL at segment 7, so no concrete request matches
      // both. Claiming an ordering requirement that does not exist would be a
      // false assertion, and a false assertion reads as coverage.
      const routes = handlersOf(MemberCoursesController).map((handler) =>
        routeOf(MemberCoursesController, handler),
      );

      const collisions: string[] = [];
      for (const a of routes) {
        for (const b of routes) {
          if (a === b) continue;
          if (a.verb !== b.verb) continue;
          if (unifies(a.path, b.path)) collisions.push(`${a.path} ~ ${b.path}`);
        }
      }

      expect(collisions).toEqual([]);
    });

    it('the two PUT paths have the same segment count — the check above is not free', () => {
      // Anti-vacuity: if the two `PUT`s had different lengths, `unifies` would
      // return false for a trivial reason and the assertion above would say
      // nothing about the literal-vs-literal case it exists for.
      const progress = routeOf(MemberCoursesController, 'updateProgress').path;
      const completion = routeOf(MemberCoursesController, 'setCompletion').path;

      expect(progress.split('/')).toHaveLength(completion.split('/').length);
      expect(unifies(progress, completion)).toBe(false);
    });
  });

  describe('PRE-1 — payload params', () => {
    const payloadParams = handlersOf(MemberCoursesController).flatMap(
      (handler) =>
        routeArgs(MemberCoursesController, handler)
          .filter(
            (arg) =>
              arg.paramtype === ROUTE_PARAMTYPES.BODY ||
              arg.paramtype === ROUTE_PARAMTYPES.QUERY,
          )
          .map((arg) => ({ handler, ...arg })),
    );

    it('has exactly two bodies: updateProgress, setCompletion', () => {
      expect(payloadParams.map((p) => p.handler).sort()).toEqual([
        'setCompletion',
        'updateProgress',
      ]);
    });

    it('binds both, and neither is a named primitive (RISK-I)', () => {
      for (const param of payloadParams) {
        expect({
          handler: param.handler,
          named: param.data !== undefined,
          bound: param.pipes.some(
            (pipe) =>
              pipe instanceof ValidationPipe &&
              (pipe as ValidationPipe & { expectedType?: unknown })
                .expectedType !== undefined,
          ),
        }).toEqual({ handler: param.handler, named: false, bound: true });
      }
    });

    it('declares no @Query() at all', () => {
      const queries = payloadParams.filter(
        (p) => p.paramtype === ROUTE_PARAMTYPES.QUERY,
      );
      expect(queries).toEqual([]);
    });
  });

  describe('🔴 §4.6.6 / exit-gate clause 2 — the client never sends a completion flag', () => {
    it('UpdateProgressDto has EXACTLY ONE property, and it is positionSeconds', () => {
      // Read from class-validator's own metadata rather than from a hand-written
      // list, so a field added without a validator is caught too: an undecorated
      // property is stripped by `whitelist: true` and would be invisible to a
      // key count on an instance.
      const instance = plainToInstance(UpdateProgressDto, {
        positionSeconds: 12,
      });
      expect(Object.keys(instance)).toEqual(['positionSeconds']);
    });

    it('a client-sent `completed` flag is REJECTED, not ignored', () => {
      // 🔴 THE CLAUSE AS THE GATE WORDS IT. `dtoPipe` runs with
      // `forbidNonWhitelisted: true`, so the unknown property is a `400` — not a
      // `200` that silently dropped it, which would leave a client author
      // believing the field works.
      const instance = plainToInstance(UpdateProgressDto, {
        positionSeconds: 12,
        completed: true,
      });
      const errors = validateSync(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      expect(errors.map((e) => e.property)).toContain('completed');
    });

    it('…and the same for completionSource and completedAt', () => {
      const instance = plainToInstance(UpdateProgressDto, {
        positionSeconds: 12,
        completionSource: 'manual',
        completedAt: '2026-01-01T00:00:00.000Z',
      });
      const errors = validateSync(instance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      expect(errors.map((e) => e.property).sort()).toEqual([
        'completedAt',
        'completionSource',
      ]);
    });

    it('a NEGATIVE position is a 400 at the boundary', () => {
      const errors = validateSync(
        plainToInstance(UpdateProgressDto, { positionSeconds: -1 }),
      );
      expect(errors.map((e) => e.property)).toEqual(['positionSeconds']);
    });

    it('SetCompletionDto is the OTHER endpoint and carries only `complete`', () => {
      // The distinction the design rests on: a member MAY declare completion
      // (R2.3.3) — on its own route, recorded as `completionSource: 'manual'`.
      // What is forbidden is a verdict riding along with a POSITION report.
      const errors = validateSync(
        plainToInstance(SetCompletionDto, {
          complete: true,
          positionSeconds: 12,
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      );

      expect(errors.map((e) => e.property)).toEqual(['positionSeconds']);
    });

    it('the service signature makes a flag UNREPRESENTABLE, not merely ignored', async () => {
      // The second, independent mechanism. `updateProgress(ctx, lessonId,
      // positionSeconds)` takes a PLAIN NUMBER, so even a controller bug has no
      // object in which to smuggle a verdict.
      const harness = createHarness();

      await harness.controller.updateProgress(
        memberRequest(),
        'foundations',
        'intro',
        { positionSeconds: 240 },
      );

      expect(harness.progress.updateProgress).toHaveBeenCalledWith(
        CTX,
        'l-1',
        240,
      );
      expect(harness.progress.updateProgress.mock.calls[0]).toHaveLength(3);
    });
  });

  describe('🔴 the module-lock 403 is COMPOSED on both progress routes', () => {
    it('progress: the lock is resolved BEFORE the write', async () => {
      const harness = createHarness();
      const order: string[] = [];
      harness.courses.resolveWritableLesson.mockImplementation(async () => {
        order.push('resolve');
        return { lessonId: 'l-1' };
      });
      harness.progress.updateProgress.mockImplementation(async () => {
        order.push('write');
        return {};
      });

      await harness.controller.updateProgress(
        memberRequest(),
        'foundations',
        'intro',
        { positionSeconds: 240 },
      );

      expect(order).toEqual(['resolve', 'write']);
      expect(harness.courses.resolveWritableLesson).toHaveBeenCalledWith(
        CTX,
        'foundations',
        'intro',
      );
    });

    it('progress: a LOCKED module refuses and NOTHING is written', async () => {
      const harness = createHarness();
      harness.courses.resolveWritableLesson.mockRejectedValue(
        new Error('locked'),
      );

      await expect(
        harness.controller.updateProgress(
          memberRequest(),
          'foundations',
          'intro',
          { positionSeconds: 240 },
        ),
      ).rejects.toThrow();

      expect(harness.progress.updateProgress).not.toHaveBeenCalled();
    });

    it('completion: the same composition, in the same order', async () => {
      const harness = createHarness();
      const order: string[] = [];
      harness.courses.resolveWritableLesson.mockImplementation(async () => {
        order.push('resolve');
        return { lessonId: 'l-1' };
      });
      harness.progress.setCompletion.mockImplementation(async () => {
        order.push('write');
        return {};
      });

      await harness.controller.setCompletion(
        memberRequest(),
        'foundations',
        'intro',
        { complete: true },
      );

      expect(order).toEqual(['resolve', 'write']);
      expect(harness.progress.setCompletion).toHaveBeenCalledWith(
        CTX,
        'l-1',
        true,
      );
    });

    it('completion: a LOCKED module refuses and NOTHING is written', async () => {
      const harness = createHarness();
      harness.courses.resolveWritableLesson.mockRejectedValue(
        new Error('locked'),
      );

      await expect(
        harness.controller.setCompletion(
          memberRequest(),
          'foundations',
          'intro',
          { complete: true },
        ),
      ).rejects.toThrow();

      expect(harness.progress.setCompletion).not.toHaveBeenCalled();
    });
  });

  describe('the reads pass the context through untouched (R7.3)', () => {
    it('list, get and getLesson all delegate with the guard-resolved ctx', async () => {
      const harness = createHarness();
      const req = memberRequest();

      await harness.controller.list(req);
      await harness.controller.get(req, 'foundations');
      await harness.controller.getLesson(req, 'foundations', 'intro');

      expect(harness.courses.listCourses).toHaveBeenCalledWith(CTX);
      expect(harness.courses.getCourse).toHaveBeenCalledWith(
        CTX,
        'foundations',
      );
      expect(harness.courses.getLesson).toHaveBeenCalledWith(
        CTX,
        'foundations',
        'intro',
      );
    });
  });
});
