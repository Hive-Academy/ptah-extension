// ⚠️ FIRST IMPORT — the lesson DTOs carry `class-validator` decorators and this
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
import type { YouTubeMetadataProvider } from '@ptah-api/youtube';

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
import { LessonVideoService } from '../lessons/lesson-video.service';

import { AdminLessonsController } from './admin-lessons.controller';
import { CoursesService } from './courses.service';
import { ReorderService } from './reorder.service';

/**
 * `AdminLessonsController` — §3.4's lesson surface, R2.2, R8.8, ASSUMPTION-6,
 * ASSUMPTION-9.
 *
 * Four properties this file exists for:
 *
 *   RI-3   — `PATCH reorder` before `PATCH :id`, and they genuinely unify;
 *            `POST refresh-metadata` and `POST :id/refresh-metadata` do NOT
 *            unify, and that is asserted too so the ordering claim about the
 *            first pair is not quietly generalised to the second.
 *   R2.2.4 — the video is resolved BEFORE the transaction, and the whole lesson
 *            lands in ONE write.
 *   R2.2.6 — with the integration OFF (ASSUMPTION-6: the live state of this
 *            workspace) a save proceeds with `videoMetadataSource: 'manual'`
 *            and NOTHING 500s — exit-gate clause 3.
 *   PRE-6  — the audit row rides the mutation's own `tx`.
 *
 * ⚠️ NO REAL YOUTUBE REQUEST IS MADE HERE OR ANYWHERE IN THIS BATCH. The
 * provider is a double whose `fetchVideo` returns real `YouTubeFetchResult`
 * values (ASSUMPTION-6(b)).
 */

const ADMIN_REQUEST = {
  user: { id: 'admin-user-1', email: 'admin@example.com' },
  ip: '203.0.113.7',
  get: (header: string) => (header === 'user-agent' ? 'jest' : undefined),
  method: 'POST',
  path: '/api/v1/admin/lessons',
} as unknown as Request;

const VIDEO_ID = 'dQw4w9WgXcQ';

interface Harness {
  controller: AdminLessonsController;
  prisma: MockLearningPrisma;
  audit: { write: jest.Mock };
  fetchVideo: jest.Mock;
  isEnabled: jest.Mock;
}

/**
 * The REAL `CoursesService`, `ReorderService` and `LessonVideoService` over the
 * shared Prisma double, with only the YouTube PROVIDER stubbed.
 *
 * `enabled: false` is the DEFAULT because it is this workspace's live state
 * (`YOUTUBE_API_KEY` is present and empty — ASSUMPTION-6), so the ordinary case
 * in this file is the one that actually runs in production here.
 */
function createHarness(enabled = false): Harness {
  const prisma = createMockPrisma();
  const audit = { write: jest.fn().mockResolvedValue('audit-row-1') };
  const isEnabled = jest.fn().mockReturnValue(enabled);
  const fetchVideo = jest.fn().mockResolvedValue(
    enabled
      ? {
          ok: true,
          video: {
            videoId: VIDEO_ID,
            title: 'From YouTube',
            durationSeconds: 300,
            thumbnailUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
            privacyStatus: 'unlisted',
            embeddable: true,
          },
        }
      : { ok: false, skipped: true },
  );

  const provider = {
    isEnabled,
    fetchVideo,
  } as unknown as YouTubeMetadataProvider;

  const controller = new AdminLessonsController(
    new CoursesService(asPrismaService(prisma)),
    new ReorderService(asPrismaService(prisma)),
    new LessonVideoService(asPrismaService(prisma), provider),
    audit as unknown as AuditLogService,
  );

  return { controller, prisma, audit, fetchVideo, isEnabled };
}

function lessonRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l-1',
    moduleId: 'm-1',
    slug: 'intro',
    title: 'Intro',
    bodyMarkdown: '# Intro',
    sortOrder: 100,
    youtubeVideoId: null,
    videoTitle: null,
    videoDurationSeconds: null,
    videoThumbnailUrl: null,
    videoMetadataFetchedAt: null,
    videoMetadataSource: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

/** Everything `createLesson` reads before it writes. */
function primeCreate(harness: Harness): void {
  harness.prisma.courseModule.findFirst.mockResolvedValue({
    id: 'm-1',
    courseId: 'c-1',
  });
  harness.prisma.lesson.findMany.mockResolvedValue([]);
  harness.prisma.lesson.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
  harness.prisma.lesson.create.mockResolvedValue(lessonRow());
}

describe('AdminLessonsController', () => {
  describe('🔴 RI-3 — reorder before :id, and refresh-metadata does NOT unify', () => {
    it('orders the two PATCH handlers correctly', () => {
      const handlers = handlersOf(AdminLessonsController);
      const patches = handlers.filter(
        (h) => routeOf(AdminLessonsController, h).verb === 'PATCH',
      );

      expect(patches).toEqual(['reorder', 'update']);
    });

    it('the two PATCH paths GENUINELY UNIFY — so the ordering is load-bearing', () => {
      const reorder = routeOf(AdminLessonsController, 'reorder').path;
      const update = routeOf(AdminLessonsController, 'update').path;

      expect(unifies(reorder, update)).toBe(true);
      expect(paramCount(reorder)).toBe(0);
      expect(paramCount(update)).toBe(1);
    });

    it('the two refresh-metadata paths do NOT unify — different segment counts', () => {
      // The honest half. Task 9.15 says to declare the bulk one first anyway,
      // "for the same reason and at zero cost" — but claiming RI-3 protects this
      // pair would be false, and a false claim in a spec is worse than none.
      const bulk = routeOf(AdminLessonsController, 'refreshMetadataBulk').path;
      const single = routeOf(AdminLessonsController, 'refreshMetadataOne').path;

      expect(unifies(bulk, single)).toBe(false);
    });

    it('…and the bulk one is still declared first', () => {
      const handlers = handlersOf(AdminLessonsController);
      expect(handlers.indexOf('refreshMetadataBulk')).toBeLessThan(
        handlers.indexOf('refreshMetadataOne'),
      );
    });
  });

  describe('G1 — the class-level guard chain', () => {
    it('declares JwtAuthGuard then AdminGuard at CLASS level, in that order', () => {
      const guards =
        (Reflect.getMetadata(
          GUARDS_METADATA,
          AdminLessonsController,
        ) as unknown[]) ?? [];

      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(AdminGuard),
      );
    });

    it('throttles every handler — this controller declares only writes', () => {
      const handlers = handlersOf(AdminLessonsController);
      const throttled = handlers.filter((handler) => {
        const fn = Object.getOwnPropertyDescriptor(
          AdminLessonsController.prototype,
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
    it('is exactly the §3.4 admin lesson surface', () => {
      const routes = handlersOf(AdminLessonsController)
        .map((handler) => {
          const { verb, path } = routeOf(AdminLessonsController, handler);
          return `${verb} ${path}`;
        })
        .sort();

      expect(routes).toEqual([
        'DELETE v1/admin/lessons/:id',
        'PATCH v1/admin/lessons/:id',
        'PATCH v1/admin/lessons/reorder',
        'POST v1/admin/lessons',
        'POST v1/admin/lessons/:id/refresh-metadata',
        'POST v1/admin/lessons/refresh-metadata',
      ]);
    });
  });

  describe('PRE-1 — payload params', () => {
    const payloadParams = handlersOf(AdminLessonsController).flatMap(
      (handler) =>
        routeArgs(AdminLessonsController, handler)
          .filter(
            (arg) =>
              arg.paramtype === ROUTE_PARAMTYPES.BODY ||
              arg.paramtype === ROUTE_PARAMTYPES.QUERY,
          )
          .map((arg) => ({ handler, ...arg })),
    );

    it('has exactly four bodies — the single refresh has NO body', () => {
      expect(payloadParams.map((p) => p.handler).sort()).toEqual([
        'create',
        'refreshMetadataBulk',
        'reorder',
        'update',
      ]);
    });

    it('binds all four, and none is a named primitive (RISK-I)', () => {
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

  describe('🔴 R2.2.4 — the video is resolved BEFORE the transaction opens', () => {
    it('create: the fetch happens first, then ONE transaction', async () => {
      const harness = createHarness(true);
      primeCreate(harness);

      const order: string[] = [];
      harness.fetchVideo.mockImplementation(async () => {
        order.push('fetch');
        return {
          ok: true,
          video: {
            videoId: VIDEO_ID,
            title: 'From YouTube',
            durationSeconds: 300,
            thumbnailUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
            privacyStatus: 'public',
            embeddable: true,
          },
        };
      });
      const realTransaction =
        harness.prisma.$transaction.getMockImplementation();
      harness.prisma.$transaction.mockImplementation(async (arg: unknown) => {
        order.push('transaction');
        return realTransaction?.(arg);
      });

      await harness.controller.create(ADMIN_REQUEST, {
        moduleId: 'm-1',
        title: 'Intro',
        bodyMarkdown: '# Intro',
        youtubeVideoIdOrUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      });

      // The whole requirement, as an ORDER rather than as a comment. Doing the
      // network call inside `$transaction` would hold a Postgres connection for
      // the provider's 10-second abort budget on every save.
      expect(order).toEqual(['fetch', 'transaction']);
      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('create: all five video columns land in ONE create statement', async () => {
      const harness = createHarness(true);
      primeCreate(harness);

      await harness.controller.create(ADMIN_REQUEST, {
        moduleId: 'm-1',
        title: 'Intro',
        bodyMarkdown: '# Intro',
        youtubeVideoIdOrUrl: VIDEO_ID,
      });

      const data = harness.prisma.lesson.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data['youtubeVideoId']).toBe(VIDEO_ID);
      expect(data['videoTitle']).toBe('From YouTube');
      expect(data['videoDurationSeconds']).toBe(300);
      expect(data['videoMetadataSource']).toBe('api');
      expect(data['videoMetadataFetchedAt']).toBeInstanceOf(Date);
    });

    it('a FAILED fetch opens no transaction and writes nothing', async () => {
      const harness = createHarness(true);
      primeCreate(harness);
      harness.fetchVideo.mockResolvedValue({ ok: false, error: 'not_found' });

      await expect(
        harness.controller.create(ADMIN_REQUEST, {
          moduleId: 'm-1',
          title: 'Intro',
          bodyMarkdown: '# Intro',
          youtubeVideoIdOrUrl: VIDEO_ID,
        }),
      ).rejects.toThrow();

      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
      expect(harness.prisma.lesson.create).not.toHaveBeenCalled();
      expect(harness.audit.write).not.toHaveBeenCalled();
    });
  });

  describe('🔴 R2.2.6 / exit-gate clause 3 — with YOUTUBE_API_KEY unset', () => {
    it('an admin CAN save manual metadata, and nothing 500s', async () => {
      // ⚠️ THIS IS THE LIVE PATH IN THIS WORKSPACE (ASSUMPTION-6), not a
      // configured-off variant of it. The clause is nearly free here precisely
      // because the feature-off branch is the only branch that can run.
      const harness = createHarness(false);
      primeCreate(harness);

      const created = await harness.controller.create(ADMIN_REQUEST, {
        moduleId: 'm-1',
        title: 'Intro',
        bodyMarkdown: '# Intro',
        youtubeVideoIdOrUrl: VIDEO_ID,
        videoTitle: 'Typed by the admin',
        videoDurationSeconds: 612,
      });

      expect(created).toBeDefined();
      // ⚠️ `fetchVideo` IS still called, and that is correct: the feature-off
      // short-circuit lives INSIDE `YouTubeMetadataProvider`, which returns
      // `{ ok: false, skipped: true }` without issuing a request (Batch 9A
      // asserts that against a stubbed `fetch`). Asserting "the service never
      // calls the provider" would be asserting a different design. What matters
      // here is the RESULT: the save proceeds and the row is badged `'manual'`.
      expect(harness.fetchVideo).toHaveBeenCalledTimes(1);

      const data = harness.prisma.lesson.create.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data['youtubeVideoId']).toBe(VIDEO_ID);
      expect(data['videoTitle']).toBe('Typed by the admin');
      expect(data['videoDurationSeconds']).toBe(612);
      expect(data['videoMetadataSource']).toBe('manual');
      // The staleness signal §4.5 exists for: a hand-typed row is NOT badged as
      // freshly fetched.
      expect(data['videoMetadataFetchedAt']).toBeNull();
    });

    it('the id is STILL extracted and validated with the integration off', async () => {
      // A disabled integration must not become a hole through which an
      // unvalidated string reaches the column the frontend builds an embed URL
      // from (§4.6.3). "The API key was unset that week" is not a defence.
      const harness = createHarness(false);
      primeCreate(harness);

      await expect(
        harness.controller.create(ADMIN_REQUEST, {
          moduleId: 'm-1',
          title: 'Intro',
          bodyMarkdown: '# Intro',
          youtubeVideoIdOrUrl: 'javascript:alert(1)/watch?v=dQw4w9WgXcQ',
        }),
      ).rejects.toThrow();

      expect(harness.prisma.lesson.create).not.toHaveBeenCalled();
    });

    it('bulk refresh short-circuits and WRITES NOTHING (the data-loss path)', async () => {
      // Without the short-circuit the natural implementation would run every
      // lesson through the feature-off branch and rewrite each one to
      // `videoMetadataSource: 'manual'` with a null title, duration and
      // thumbnail — destroying every previously-fetched value, with a 200 on it.
      // In THIS workspace that is the only path this endpoint can take.
      const harness = createHarness(false);

      const result = await harness.controller.refreshMetadataBulk(
        ADMIN_REQUEST,
        { lessonIds: ['l-1', 'l-2'] },
      );

      expect(result).toEqual({
        refreshed: 0,
        skipped: 2,
        failed: [],
        reason: 'youtube_disabled',
      });
      expect(harness.prisma.lesson.update).not.toHaveBeenCalled();
      expect(harness.prisma.$transaction).not.toHaveBeenCalled();
      expect(harness.fetchVideo).not.toHaveBeenCalled();
    });

    it('the single refresh is the bulk implementation with a one-element list', async () => {
      const harness = createHarness(false);

      const result = await harness.controller.refreshMetadataOne(
        ADMIN_REQUEST,
        'l-1',
      );

      expect(result).toEqual({
        refreshed: 0,
        skipped: 1,
        failed: [],
        reason: 'youtube_disabled',
      });
    });
  });

  describe('🔴 PATCH :id — text and video land in ONE transaction', () => {
    function primeUpdate(harness: Harness): void {
      harness.prisma.lesson.findFirst.mockResolvedValue({ id: 'l-1' });
      harness.prisma.lesson.update.mockResolvedValue(lessonRow());
      harness.prisma.lessonComment.count.mockResolvedValue(0);
    }

    it('a title edit AND a video change are one update, not two', async () => {
      const harness = createHarness(false);
      primeUpdate(harness);

      await harness.controller.update(ADMIN_REQUEST, 'l-1', {
        title: 'Intro, revised',
        youtubeVideoIdOrUrl: VIDEO_ID,
        videoTitle: 'Typed',
      });

      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(harness.prisma.lesson.update).toHaveBeenCalledTimes(1);

      const data = harness.prisma.lesson.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data['title']).toBe('Intro, revised');
      expect(data['youtubeVideoId']).toBe(VIDEO_ID);
      expect(data['videoMetadataSource']).toBe('manual');
    });

    it('a request that MENTIONS no video field leaves all five columns alone', async () => {
      const harness = createHarness(false);
      primeUpdate(harness);

      await harness.controller.update(ADMIN_REQUEST, 'l-1', {
        title: 'Intro, revised',
      });

      const data = harness.prisma.lesson.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(Object.keys(data).sort()).toEqual(['title']);
    });

    it('🔴 an EMPTY youtubeVideoIdOrUrl DETACHES the video — all five cleared', async () => {
      // The reason `UpdateLessonDto` needs no `EXPECTED_NULLABLE_OPTIONALS`
      // entry: the tri-state is expressible without `null`.
      const harness = createHarness(false);
      primeUpdate(harness);

      await harness.controller.update(ADMIN_REQUEST, 'l-1', {
        youtubeVideoIdOrUrl: '',
      });

      const data = harness.prisma.lesson.update.mock.calls[0][0].data as Record<
        string,
        unknown
      >;
      expect(data['youtubeVideoId']).toBeNull();
      expect(data['videoTitle']).toBeNull();
      expect(data['videoDurationSeconds']).toBeNull();
      expect(data['videoThumbnailUrl']).toBeNull();
      expect(data['videoMetadataSource']).toBeNull();
    });
  });

  describe('🔴 PRE-6 — the audit row rides the mutation transaction', () => {
    it('create: write() receives the SAME tx the lesson was created on', async () => {
      const harness = createHarness(false);
      primeCreate(harness);

      await harness.controller.create(ADMIN_REQUEST, {
        moduleId: 'm-1',
        title: 'Intro',
        bodyMarkdown: '# Intro',
      });

      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(harness.audit.write.mock.calls[0][0]).toMatchObject({
        action: 'learning.lesson.create',
        targetType: 'Lesson',
        targetId: 'l-1',
        tx: harness.prisma,
      });
    });

    it('delete: audits inside the transaction — Lesson has no deletedBy', async () => {
      const harness = createHarness(false);
      harness.prisma.lesson.findFirst.mockResolvedValue({ id: 'l-1' });
      harness.prisma.lesson.update.mockResolvedValue(lessonRow());

      await harness.controller.remove(ADMIN_REQUEST, 'l-1');

      expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(harness.audit.write.mock.calls[0][0]).toMatchObject({
        action: 'learning.lesson.delete',
        targetType: 'Lesson',
        targetId: 'l-1',
        tx: harness.prisma,
      });
    });

    it('reorder: one row, no targetId, the mutation tx', async () => {
      const harness = createHarness(false);
      harness.prisma.courseModule.findFirst.mockResolvedValue({ id: 'm-1' });
      harness.prisma.lesson.findMany.mockResolvedValue([
        { id: 'l-1' },
        { id: 'l-2' },
      ]);
      harness.prisma.lesson.update.mockResolvedValue(lessonRow());

      await harness.controller.reorder(ADMIN_REQUEST, {
        moduleId: 'm-1',
        ids: ['l-2', 'l-1'],
      });

      const params = harness.audit.write.mock.calls[0][0] as {
        action: string;
        targetId?: unknown;
        tx: unknown;
      };
      expect(params.action).toBe('learning.lesson.reorder');
      expect(params.targetId).toBeUndefined();
      expect(params.tx).toBe(harness.prisma);
    });
  });
});
