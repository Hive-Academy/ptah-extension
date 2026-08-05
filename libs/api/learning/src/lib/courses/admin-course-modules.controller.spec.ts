// ⚠️ FIRST IMPORT — the module DTOs carry `class-validator` decorators and this
// lib has no jest `setupFiles`.
import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
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
import { CoursesService } from './courses.service';
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
    audit as unknown as AuditLogService,
  );

  return { controller, prisma, audit };
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

    it('has exactly three bodies: create, reorder, update', () => {
      expect(payloadParams.map((p) => p.handler).sort()).toEqual([
        'create',
        'reorder',
        'update',
      ]);
    });

    it('binds all three, and none is a named primitive (RISK-I)', () => {
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
});
