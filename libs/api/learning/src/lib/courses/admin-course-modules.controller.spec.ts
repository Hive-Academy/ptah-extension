// ⚠️ FIRST IMPORT — the module DTOs carry `class-validator` decorators and this
// lib has no jest `setupFiles`.
import 'reflect-metadata';

import { HttpException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import type { AuditLogService } from '@ptah-api/audit';
import {
  AdminGuard,
  AdminThrottlerGuard,
  JwtAuthGuard,
} from '@ptah-api/identity';

import {
  ROUTE_PARAMTYPES,
  handlersOf,
  paramCount,
  routeArgs,
  routeOf,
  unifies,
} from '../../testing/controller-reflection';
import {
  asPrismaService,
  createMockPrisma,
  type MockLearningPrisma,
} from '../../testing/mock-learning-prisma';

import { AdminCourseModulesController } from './admin-course-modules.controller';
import { CourseScheduleService } from './course-schedule.service';
import { CoursesService } from './courses.service';
import {
  ApplyModuleScheduleDto,
  PreviewModuleScheduleDto,
} from './dto/schedule-modules.dto';
import { ReorderService } from './reorder.service';

/**
 * `AdminCourseModulesController` — §3.4's module surface, R2.4.1, R8.8.
 *
 * The two properties this file exists for:
 *
 *   RI-3 — `PATCH reorder` before `PATCH :id`, and they genuinely unify.
 *   R2.4.1 — `releaseAt`'s TRI-STATE survives the wire→domain conversion:
 *            `undefined` = leave alone, `null` = unschedule, a string =
 *            reschedule. Collapsing any two of them is a silent change to when
 *            a module opens.
 */

const ADMIN_REQUEST = {
  user: { id: 'admin-user-1', email: 'admin@example.com' },
  ip: '203.0.113.7',
  get: (header: string) => (header === 'user-agent' ? 'jest' : undefined),
  method: 'POST',
  path: '/api/v1/admin/course-modules',
} as unknown as Request;

interface Harness {
  controller: AdminCourseModulesController;
  prisma: MockLearningPrisma;
  audit: { write: jest.Mock };
}

/** The REAL services over the shared Prisma double — see the courses spec. */
function createHarness(): Harness {
  const prisma = createMockPrisma();
  const audit = { write: jest.fn().mockResolvedValue('audit-row-1') };

  const controller = new AdminCourseModulesController(
    new CoursesService(asPrismaService(prisma)),
    new ReorderService(asPrismaService(prisma)),
    new CourseScheduleService(asPrismaService(prisma)),
    audit as unknown as AuditLogService,
  );

  return { controller, prisma, audit };
}

/** C4 — a course with `count` live modules, in day order, all unscheduled. */
function scheduleHarness(count: number): Harness {
  const harness = createHarness();
  harness.prisma.course.findFirst.mockResolvedValue({
    id: 'c-1',
    slug: 'ptah-builders-cohort-1',
  });
  harness.prisma.courseModule.findMany.mockResolvedValue(
    Array.from({ length: count }, (_, index) => ({
      id: `m-${index + 1}`,
      slug: `day-${String(index + 1).padStart(2, '0')}`,
      title: `Module ${index + 1}`,
      sortOrder: (index + 1) * 100,
      releaseAt: null,
    })),
  );
  harness.prisma.courseModule.update.mockResolvedValue(moduleRow());
  return harness;
}

/** The founder's cohort-1 inputs (`context.md` C3). */
const PREVIEW_PAYLOAD = {
  courseId: 'c-1',
  startDate: '2026-09-01',
  timeOfDay: '09:00',
  timeZone: 'UTC',
} as const;

/** The same, plus the two echoes. Day 10 is Monday 14 September 2026. */
const APPLY_PAYLOAD = {
  ...PREVIEW_PAYLOAD,
  confirmModuleCount: 10,
  confirmLastReleaseDate: '2026-09-14',
} as const;

/**
 * Run a payload through the pipe a handler actually binds, and report whether
 * it was accepted.
 *
 * ⚠️ THIS EXERCISES THE REAL `ValidationPipe`, not a reimplementation of the
 * whitelist rules — `dtoPipe` sets `whitelist` and `forbidNonWhitelisted`, and
 * the point of the two cases below is precisely that those flags do what the
 * DTO docblock claims on the WIRE.
 */
async function accepts(
  pipe: ValidationPipe,
  expectedType: unknown,
  payload: object,
): Promise<{ ok: boolean; message: string }> {
  try {
    await pipe.transform(payload, {
      type: 'body',
      metatype: expectedType as never,
    });
    return { ok: true, message: '' };
  } catch (error: unknown) {
    // ⚠️ NOT `error.message` — a `BadRequestException` from `ValidationPipe`
    // carries the generic string "Bad Request Exception" there, and the actual
    // per-property constraint failures live in the RESPONSE BODY. Asserting on
    // `.message` would make every one of these cases pass for the wrong reason.
    const response =
      error instanceof HttpException ? error.getResponse() : String(error);
    return { ok: false, message: JSON.stringify(response) };
  }
}

/** The `ValidationPipe` bound to one handler's `@Body()`. */
function bodyPipeOf(handler: string): ValidationPipe {
  const body = routeArgs(AdminCourseModulesController, handler).find(
    (arg) => arg.paramtype === ROUTE_PARAMTYPES.BODY,
  );
  const pipe = body?.pipes.find(
    (candidate) => candidate instanceof ValidationPipe,
  );
  if (!pipe) throw new Error(`No ValidationPipe bound to ${handler}'s @Body()`);
  return pipe as ValidationPipe;
}

/** The `expectedType` a handler's `@Body()` pipe carries. */
function expectedTypeOf(handler: string): unknown {
  return (bodyPipeOf(handler) as ValidationPipe & { expectedType?: unknown })
    .expectedType;
}

function moduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    courseId: 'c-1',
    slug: 'getting-started',
    title: 'Getting started',
    description: null,
    sortOrder: 100,
    releaseAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AdminCourseModulesController', () => {
  describe('🔴 RI-3 — reorder is declared BEFORE :id', () => {
    it('orders the two PATCH handlers correctly', () => {
      const handlers = handlersOf(AdminCourseModulesController);
      const patches = handlers.filter(
        (h) => routeOf(AdminCourseModulesController, h).verb === 'PATCH',
      );

      expect(patches).toEqual(['reorder', 'update']);
    });

    it('the two PATCH paths GENUINELY UNIFY — so the ordering is load-bearing', () => {
      const reorder = routeOf(AdminCourseModulesController, 'reorder').path;
      const update = routeOf(AdminCourseModulesController, 'update').path;

      expect(unifies(reorder, update)).toBe(true);
      expect(paramCount(reorder)).toBe(0);
      expect(paramCount(update)).toBe(1);
    });
  });

  describe('G1 — the class-level guard chain', () => {
    it('declares JwtAuthGuard then AdminGuard at CLASS level, in that order', () => {
      const guards =
        (Reflect.getMetadata(
          GUARDS_METADATA,
          AdminCourseModulesController,
        ) as unknown[]) ?? [];

      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(AdminGuard),
      );
    });

    it('throttles every handler — this controller declares only writes', () => {
      const handlers = handlersOf(AdminCourseModulesController);
      const throttled = handlers.filter((handler) => {
        const fn = Object.getOwnPropertyDescriptor(
          AdminCourseModulesController.prototype,
          handler,
        )?.value as object;
        return (
          (Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[]) ?? []
        ).includes(AdminThrottlerGuard);
      });

      expect(throttled.sort()).toEqual(handlers.sort());
    });
  });

  describe('the route table', () => {
    it('is exactly the §3.4 admin module surface — and has no GET', () => {
      const routes = handlersOf(AdminCourseModulesController)
        .map((handler) => {
          const { verb, path } = routeOf(AdminCourseModulesController, handler);
          return `${verb} ${path}`;
        })
        .sort();

      expect(routes).toEqual([
        'DELETE v1/admin/course-modules/:id',
        'PATCH v1/admin/course-modules/:id',
        'PATCH v1/admin/course-modules/reorder',
        'POST v1/admin/course-modules',
        // TASK_2026_202 C4 — cohort scheduling, preview then apply.
        'POST v1/admin/course-modules/schedule',
        'POST v1/admin/course-modules/schedule/preview',
      ]);
      // The absence is a decision, not an omission: a module is always authored
      // in the context of its course, and `GET /v1/admin/courses/:id` carries
      // `moduleCount`. See the class docblock.
      expect(routes.some((route) => route.startsWith('GET '))).toBe(false);
    });
  });

  describe('PRE-1 — payload params', () => {
    const payloadParams = handlersOf(AdminCourseModulesController).flatMap(
      (handler) =>
        routeArgs(AdminCourseModulesController, handler)
          .filter(
            (arg) =>
              arg.paramtype === ROUTE_PARAMTYPES.BODY ||
              arg.paramtype === ROUTE_PARAMTYPES.QUERY,
          )
          .map((arg) => ({ handler, ...arg })),
    );

    it('has exactly five bodies: create, reorder, update, and the two schedule routes', () => {
      expect(payloadParams.map((p) => p.handler).sort()).toEqual([
        'applySchedule',
        'create',
        'previewSchedule',
        'reorder',
        'update',
      ]);
    });

    it('binds all five, and none is a named primitive (RISK-I)', () => {
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
  });

  describe('🔴 R2.4.1 — releaseAt survives the wire→domain conversion as a TRI-STATE', () => {
    async function patchWith(
      releaseAt: string | null | undefined,
    ): Promise<Record<string, unknown>> {
      const harness = createHarness();
      harness.prisma.courseModule.findFirst.mockResolvedValue({
        id: 'm-1',
        courseId: 'c-1',
      });
      harness.prisma.courseModule.update.mockResolvedValue(moduleRow());
      harness.prisma.lesson.count.mockResolvedValue(0);

      await harness.controller.update(ADMIN_REQUEST, 'm-1', { releaseAt });

      return harness.prisma.courseModule.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
    }

    it('an OMITTED releaseAt writes nothing — the schedule is left alone', async () => {
      const data = await patchWith(undefined);
      expect('releaseAt' in data).toBe(false);
    });

    it('an explicit NULL writes null — "unschedule this module, open it now"', async () => {
      // The reason `UpdateModuleDto.releaseAt` is one of this lib's three
      // `EXPECTED_NULLABLE_OPTIONALS` entries. Collapsed into the case above, a
      // module scheduled by mistake could never be opened.
      const data = await patchWith(null);
      expect(data['releaseAt']).toBeNull();
    });

    it('an ISO string writes a Date, not a string', async () => {
      // `CourseModule.releaseAt` is a `DateTime?` column and
      // `ModuleLockService` compares `.getTime()`. A string here would be a
      // runtime error deep inside the lock rule rather than a `400`.
      const data = await patchWith('2026-12-25T09:00:00.000Z');
      expect(data['releaseAt']).toBeInstanceOf(Date);
      expect((data['releaseAt'] as Date).toISOString()).toBe(
        '2026-12-25T09:00:00.000Z',
      );
    });

    it('on CREATE, omitted stays omitted and a string becomes a Date', async () => {
      const harness = createHarness();
      harness.prisma.course.findFirst.mockResolvedValue({ id: 'c-1' });
      harness.prisma.courseModule.findMany.mockResolvedValue([]);
      harness.prisma.courseModule.aggregate.mockResolvedValue({
        _max: { sortOrder: 0 },
      });
      harness.prisma.courseModule.create.mockResolvedValue(moduleRow());
      harness.prisma.lesson.count.mockResolvedValue(0);

      await harness.controller.create(ADMIN_REQUEST, {
        courseId: 'c-1',
        title: 'Getting started',
        releaseAt: '2026-12-25T09:00:00.000Z',
      });

      const data = harness.prisma.courseModule.create.mock.calls[0][0]
        .data as Record<string, unknown>;
      expect(data['releaseAt']).toBeInstanceOf(Date);
    });
  });

  describe('🔴 PRE-6 — the audit row rides the mutation transaction', () => {
    it('create: ONE transaction, and write() receives THAT tx', async () => {
      const harness = createHarness();
      harness.prisma.course.findFirst.mockResolvedValue({ id: 'c-1' });
      harness.prisma.courseModule.findMany.mockResolvedValue([]);
      harness.prisma.courseModule.aggregate.mockResolvedValue({
        _max: { sortOrder: 0 },
      });
      harness.prisma.courseModule.create.mockResolvedValue(moduleRow());
      harness.prisma.lesson.count.mockResolvedValue(0);

      await harness.controller.create(ADMIN_REQUEST, {
        courseId: 'c-1',
        title: 'Getting started',
      });

      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(harness.audit.write.mock.calls[0][0]).toMatchObject({
        action: 'learning.module.create',
        targetType: 'CourseModule',
        targetId: 'm-1',
        tx: harness.prisma,
      });
    });

    it('reorder: one row, no targetId, the mutation tx', async () => {
      const harness = createHarness();
      harness.prisma.course.findFirst.mockResolvedValue({ id: 'c-1' });
      harness.prisma.courseModule.findMany.mockResolvedValue([
        { id: 'm-1' },
        { id: 'm-2' },
      ]);
      harness.prisma.courseModule.update.mockResolvedValue(moduleRow());

      await harness.controller.reorder(ADMIN_REQUEST, {
        courseId: 'c-1',
        ids: ['m-2', 'm-1'],
      });

      const params = harness.audit.write.mock.calls[0][0] as {
        action: string;
        targetId?: unknown;
        tx: unknown;
      };
      expect(params.action).toBe('learning.module.reorder');
      expect(params.targetId).toBeUndefined();
      expect(params.tx).toBe(harness.prisma);
    });

    it('delete: audits inside the transaction — CourseModule has no deletedBy', async () => {
      const harness = createHarness();
      harness.prisma.courseModule.findFirst.mockResolvedValue({
        id: 'm-1',
        courseId: 'c-1',
      });
      harness.prisma.courseModule.update.mockResolvedValue(moduleRow());

      await harness.controller.remove(ADMIN_REQUEST, 'm-1');

      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(harness.audit.write.mock.calls[0][0]).toMatchObject({
        action: 'learning.module.delete',
        targetType: 'CourseModule',
        targetId: 'm-1',
        tx: harness.prisma,
      });
    });

    it('a create against a MISSING course audits nothing', async () => {
      const harness = createHarness();
      harness.prisma.course.findFirst.mockResolvedValue(null);

      await expect(
        harness.controller.create(ADMIN_REQUEST, {
          courseId: 'gone',
          title: 'Getting started',
        }),
      ).rejects.toThrow();

      expect(harness.audit.write).not.toHaveBeenCalled();
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 C4 — cohort scheduling, preview then apply', () => {
    describe('declaration order and routing (RI-3)', () => {
      it('declares schedule/preview BEFORE schedule', () => {
        const handlers = handlersOf(AdminCourseModulesController);
        expect(handlers.indexOf('previewSchedule')).toBeLessThan(
          handlers.indexOf('applySchedule'),
        );
      });

      it('but the pair does NOT unify — so the ordering is free, not load-bearing', () => {
        // Five literal segments against four. No concrete request can match
        // both, so unlike the `PATCH reorder` / `PATCH :id` pair above this
        // creates no RI-3 obligation. The order is kept anyway at zero cost,
        // mirroring the `POST v1/admin/lessons/refresh-metadata` precedent.
        const preview = routeOf(
          AdminCourseModulesController,
          'previewSchedule',
        ).path;
        const apply = routeOf(
          AdminCourseModulesController,
          'applySchedule',
        ).path;

        expect(unifies(preview, apply)).toBe(false);
        expect(paramCount(preview)).toBe(0);
        expect(paramCount(apply)).toBe(0);
      });

      it('and neither contests POST v1/admin/course-modules', () => {
        const create = routeOf(AdminCourseModulesController, 'create').path;
        const preview = routeOf(
          AdminCourseModulesController,
          'previewSchedule',
        ).path;
        const apply = routeOf(
          AdminCourseModulesController,
          'applySchedule',
        ).path;

        expect(unifies(create, preview)).toBe(false);
        expect(unifies(create, apply)).toBe(false);
      });
    });

    describe('🔴 the two DTOs are genuinely DISTINCT on the wire', () => {
      it('each handler binds dtoPipe with its OWN expectedType', () => {
        expect(expectedTypeOf('previewSchedule')).toBe(
          PreviewModuleScheduleDto,
        );
        expect(expectedTypeOf('applySchedule')).toBe(ApplyModuleScheduleDto);
      });

      it('an APPLY payload sent to /preview is a 400 — two non-whitelisted keys', async () => {
        // 🔴 THIS IS WHY `ApplyModuleScheduleDto` EXTENDS the preview DTO
        // instead of one class carrying optional confirms. With one class,
        // `forbidNonWhitelisted` would ACCEPT these two keys here — a request
        // naming a guard the endpoint ignores, which looks honoured and is not.
        const result = await accepts(
          bodyPipeOf('previewSchedule'),
          PreviewModuleScheduleDto,
          APPLY_PAYLOAD,
        );

        expect(result.ok).toBe(false);
        expect(result.message).toContain('confirmModuleCount');
        expect(result.message).toContain('confirmLastReleaseDate');
      });

      it('a PREVIEW payload sent to /schedule is a 400 — two missing required keys', async () => {
        // The other direction, and the one that matters most: an apply that was
        // never rehearsed cannot even be EXPRESSED.
        const result = await accepts(
          bodyPipeOf('applySchedule'),
          ApplyModuleScheduleDto,
          PREVIEW_PAYLOAD,
        );

        expect(result.ok).toBe(false);
        expect(result.message).toContain('confirmModuleCount');
        expect(result.message).toContain('confirmLastReleaseDate');
      });

      it('each payload IS accepted by its own endpoint — the rejections are not vacuous', async () => {
        await expect(
          accepts(
            bodyPipeOf('previewSchedule'),
            PreviewModuleScheduleDto,
            PREVIEW_PAYLOAD,
          ),
        ).resolves.toMatchObject({ ok: true });
        await expect(
          accepts(
            bodyPipeOf('applySchedule'),
            ApplyModuleScheduleDto,
            APPLY_PAYLOAD,
          ),
        ).resolves.toMatchObject({ ok: true });
      });

      it('a start date carrying a TIME is rejected rather than silently truncated', async () => {
        // `@Matches(/^\d{4}-\d{2}-\d{2}$/)`, not `@IsISO8601()`: the latter
        // accepts a datetime whose time-of-day `timeOfDay` would then override.
        const result = await accepts(
          bodyPipeOf('previewSchedule'),
          PreviewModuleScheduleDto,
          { ...PREVIEW_PAYLOAD, startDate: '2026-09-01T17:00:00.000Z' },
        );
        expect(result.ok).toBe(false);
        expect(result.message).toContain('startDate');
      });
    });

    describe('🔴 the preview writes nothing and audits nothing', () => {
      it('returns applied: false, issues zero updates and zero audit rows', async () => {
        const harness = scheduleHarness(10);

        const result = await harness.controller.previewSchedule(
          ADMIN_REQUEST,
          PREVIEW_PAYLOAD,
        );

        expect(result.applied).toBe(false);
        expect(result.moduleCount).toBe(10);
        expect(result.lastReleaseDate).toBe('2026-09-14');
        expect(harness.prisma.courseModule.update).not.toHaveBeenCalled();
        // A log full of rehearsals is a log nobody reads.
        expect(harness.audit.write).not.toHaveBeenCalled();
      });
    });

    describe('the apply audits once, inside the mutation transaction (PRE-6)', () => {
      it('writes ONE row with action learning.module.schedule and no targetId', async () => {
        const harness = scheduleHarness(10);

        const result = await harness.controller.applySchedule(
          ADMIN_REQUEST,
          APPLY_PAYLOAD,
        );

        expect(result.applied).toBe(true);
        expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(harness.audit.write).toHaveBeenCalledTimes(1);

        const params = harness.audit.write.mock.calls[0][0] as {
          action: string;
          targetType: string;
          targetId?: unknown;
          tx: unknown;
        };
        expect(params.action).toBe('learning.module.schedule');
        expect(params.targetType).toBe('CourseModule');
        // No single target row — the same shape as a reorder.
        expect(params.targetId).toBeUndefined();
        // 🔴 THE ROW RIDES THE MUTATION'S OWN TRANSACTION.
        expect(params.tx).toBe(harness.prisma);
      });

      it('🔴 the metadata carries { slug, from, to } per changed module', async () => {
        // `CourseModule` has no column holding a previous `releaseAt`, so this
        // is the only record of what the old dates were — and therefore the
        // only thing that makes a wrong re-schedule recoverable.
        const harness = scheduleHarness(10);

        await harness.controller.applySchedule(ADMIN_REQUEST, APPLY_PAYLOAD);

        const metadata = (
          harness.audit.write.mock.calls[0][0] as {
            metadata: {
              courseId: string;
              startDate: string;
              timeZone: string;
              changedCount: number;
              changed: { slug: string; from: string | null; to: string }[];
            };
          }
        ).metadata;

        expect(metadata.courseId).toBe('c-1');
        expect(metadata.startDate).toBe('2026-09-01');
        expect(metadata.timeZone).toBe('UTC');
        expect(metadata.changedCount).toBe(10);
        expect(metadata.changed).toHaveLength(10);
        expect(metadata.changed[0]).toEqual({
          slug: 'day-01',
          from: null,
          to: '2026-09-01T09:00:00.000Z',
        });
        expect(metadata.changed[9]).toEqual({
          slug: 'day-10',
          from: null,
          to: '2026-09-14T09:00:00.000Z',
        });
      });

      it('a REFUSED apply — wrong confirmLastReleaseDate — audits nothing', async () => {
        const harness = scheduleHarness(10);

        await expect(
          harness.controller.applySchedule(ADMIN_REQUEST, {
            ...APPLY_PAYLOAD,
            confirmLastReleaseDate: '2026-09-11',
          }),
        ).rejects.toThrow();

        expect(harness.prisma.courseModule.update).not.toHaveBeenCalled();
        expect(harness.audit.write).not.toHaveBeenCalled();
      });

      it('a REFUSED apply — wrong confirmModuleCount — audits nothing', async () => {
        const harness = scheduleHarness(12);

        await expect(
          harness.controller.applySchedule(ADMIN_REQUEST, APPLY_PAYLOAD),
        ).rejects.toThrow();

        expect(harness.prisma.courseModule.update).not.toHaveBeenCalled();
        expect(harness.audit.write).not.toHaveBeenCalled();
      });
    });
  });
});
