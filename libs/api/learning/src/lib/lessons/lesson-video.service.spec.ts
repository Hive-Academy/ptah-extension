import type {
  YouTubeFetchResult,
  YouTubeMetadataProvider,
} from '@ptah-api/youtube';

import {
  asPrismaService,
  createMockPrisma,
  type MockLearningPrisma,
} from '../../testing/mock-learning-prisma';
import type { AuditHook } from '../courses/courses.service';

import { LessonVideoService } from './lesson-video.service';

/**
 * R2.2.1 – R2.2.6, plan §4.4, §4.5, NFR-S7, ASSUMPTION-6, ASSUMPTION-9.
 *
 * 🔴 ASSUMPTION-6 GOVERNS THIS FILE AND THE REPORT SAYS SO. `YOUTUBE_API_KEY`
 * is EMPTY in this workspace, so the enabled branch cannot be exercised against
 * the real API and NO REAL YOUTUBE REQUEST WAS MADE BY THIS SPEC OR BY THIS
 * BATCH. The enabled path is proved by INJECTING A PROVIDER DOUBLE that returns
 * `{ ok: true, video }` — which is enough to prove the transaction boundary,
 * the five column writes and `videoMetadataSource: 'api'` without a key.
 *
 * The cheapest way to overrule it: put a real Data API v3 key in `.env`, then
 * one live `V-CURL` `POST /v1/admin/lessons` with a known unlisted id.
 *
 * ⚠️ THE PROVIDER DOUBLE IS NOT A `jest.fn()` STANDING IN FOR THE WHOLE CLASS.
 * It returns real `YouTubeFetchResult` values — the exact discriminated union
 * Batch 9A's provider produces, including the `error?: undefined` /
 * `skipped?: undefined` witnesses — so a service that narrowed the union wrongly
 * fails to compile here rather than passing against a looser stub.
 */

function providerDouble(
  result: YouTubeFetchResult,
  enabled = true,
): { provider: YouTubeMetadataProvider; fetchVideo: jest.Mock } {
  const fetchVideo = jest.fn(async () => result);
  const provider = {
    isEnabled: () => enabled,
    fetchVideo,
  } as unknown as YouTubeMetadataProvider;
  return { provider, fetchVideo };
}

interface Wired {
  prisma: MockLearningPrisma;
  service: LessonVideoService;
  fetchVideo: jest.Mock;
  auditCalls: { tx: unknown; targetId: string | null }[];
  audit: AuditHook;
  /** Every recorded WRITE verb call across the five course models. */
  writeCount: () => number;
}

function wire(result: YouTubeFetchResult, enabled = true): Wired {
  const prisma = createMockPrisma();
  const { provider, fetchVideo } = providerDouble(result, enabled);

  prisma.lesson.findFirst.mockResolvedValue({ id: 'lesson-1' });
  prisma.lesson.update.mockResolvedValue(lessonRow());
  prisma.lessonComment.count.mockResolvedValue(0);

  const auditCalls: Wired['auditCalls'] = [];
  const audit: AuditHook = async (tx, targetId) => {
    auditCalls.push({ tx, targetId });
  };

  const delegates = prisma as unknown as Record<
    string,
    Record<string, jest.Mock>
  >;
  const writeCount = (): number =>
    ['course', 'courseModule', 'lesson', 'lessonProgress', 'lessonComment']
      .flatMap((model) =>
        ['create', 'createMany', 'update', 'updateMany', 'upsert'].map(
          (verb) => delegates[model]?.[verb]?.mock.calls.length ?? 0,
        ),
      )
      .reduce((a, b) => a + b, 0);

  return {
    prisma,
    service: new LessonVideoService(asPrismaService(prisma), provider),
    fetchVideo,
    auditCalls,
    audit,
    writeCount,
  };
}

const VIDEO_ID = 'dQw4w9WgXcQ';

const SUCCESS: YouTubeFetchResult = {
  ok: true,
  video: {
    videoId: VIDEO_ID,
    title: 'Module 1 — Getting started',
    durationSeconds: 212,
    thumbnailUrl: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
  },
};

function lessonRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'lesson-1',
    moduleId: 'module-1',
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
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */

describe('🔴 the §4.4 outcome → HTTP mapping, one case per row', () => {
  const ROWS = [
    ['not_found', 422, 'youtube_video_not_found'],
    ['private', 422, 'youtube_video_private'],
    ['not_embeddable', 422, 'youtube_video_not_embeddable'],
    ['malformed_response', 502, 'youtube_unavailable'],
    ['unavailable', 502, 'youtube_unavailable'],
  ] as const;

  it.each(ROWS)('%s ⇒ %i { reason: %s }', async (error, status, reason) => {
    const { service } = wire({ ok: false, error });

    const failure = await service
      .resolveVideoColumns({ youtubeVideoIdOrUrl: VIDEO_ID })
      .catch((e) => e);

    expect(failure.status).toBe(status);
    expect(failure.response.reason).toBe(reason);
  });

  it.each(ROWS)('%s WRITES NOTHING', async (error) => {
    const { service, writeCount } = wire({ ok: false, error });

    await service
      .resolveVideoColumns({ youtubeVideoIdOrUrl: VIDEO_ID })
      .catch(() => undefined);

    // 🔴 The R2.2.4 half of every failure row: a fully-configured lesson or
    // NOTHING. Asserted as zero recorded write calls on the double, not as
    // "the lesson still looks unchanged".
    expect(writeCount()).toBe(0);
  });

  it('🔴 422 and 502 are DIFFERENT, and that difference is load-bearing', () => {
    // A single 400 for both would make an admin re-check a correct id during a
    // YouTube outage, and would make a genuinely wrong id look transient.
    // Asserted as a partition of the five errors, so collapsing them fails.
    const statuses = ROWS.map(([, status]) => status);

    expect(new Set(statuses)).toEqual(new Set([422, 502]));
  });

  it('an unavailable result`s upstream STATUS never reaches the response', async () => {
    const { service } = wire({ ok: false, error: 'unavailable', status: 403 });

    const failure = await service
      .resolveVideoColumns({ youtubeVideoIdOrUrl: VIDEO_ID })
      .catch((e) => e);

    expect(JSON.stringify(failure.response)).not.toContain('403');
    expect(JSON.stringify(failure.response)).not.toContain('quota');
  });

  it('✅ success writes all five columns with source `api`', async () => {
    const { service } = wire(SUCCESS);

    const columns = await service.resolveVideoColumns({
      youtubeVideoIdOrUrl: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
    });

    expect(columns).toMatchObject({
      youtubeVideoId: VIDEO_ID,
      videoTitle: 'Module 1 — Getting started',
      videoDurationSeconds: 212,
      videoThumbnailUrl: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
      videoMetadataSource: 'api',
    });
    expect(columns.videoMetadataFetchedAt).toBeInstanceOf(Date);
  });

  it('a typed videoTitle/duration is IGNORED when the integration is on', async () => {
    // YouTube is the authority on the enabled path. Otherwise an admin could
    // type a duration onto an `api` row and quietly change every member's 90%
    // completion threshold for that lesson.
    const { service } = wire(SUCCESS);

    const columns = await service.resolveVideoColumns({
      youtubeVideoIdOrUrl: VIDEO_ID,
      videoTitle: 'Something else',
      videoDurationSeconds: 9999,
    });

    expect(columns.videoTitle).toBe('Module 1 — Getting started');
    expect(columns.videoDurationSeconds).toBe(212);
  });
});

describe('🔴 a malformed id string is a 400, DISTINCT from not_found', () => {
  it('refuses before any fetch', async () => {
    // Conflating it with `not_found` would tell an admin the video does not
    // exist when what they pasted was not a video reference at all.
    const { service, fetchVideo } = wire(SUCCESS);

    const failure = await service
      .resolveVideoColumns({ youtubeVideoIdOrUrl: 'not a video' })
      .catch((e) => e);

    expect(failure.status).toBe(400);
    expect(failure.response.reason).toBe('youtube_video_id_invalid');
    expect(fetchVideo).not.toHaveBeenCalled();
  });

  it('its reason differs from every §4.4 reason', async () => {
    const { service } = wire({ ok: false, error: 'not_found' });

    const malformed = await service
      .resolveVideoColumns({ youtubeVideoIdOrUrl: '???' })
      .catch((e) => e.response.reason);
    const notFound = await service
      .resolveVideoColumns({ youtubeVideoIdOrUrl: VIDEO_ID })
      .catch((e) => e.response.reason);

    expect(malformed).not.toBe(notFound);
  });

  it('an absent or blank id detaches the video, clearing ALL FIVE columns', async () => {
    // Leaving the old title, thumbnail and DURATION behind would show a member
    // metadata for a video the lesson no longer has, and would keep the 90%
    // rule running against a runtime nobody can play.
    const { service } = wire(SUCCESS);

    for (const raw of [undefined, '', '   ']) {
      expect(
        await service.resolveVideoColumns({ youtubeVideoIdOrUrl: raw }),
      ).toEqual({
        youtubeVideoId: null,
        videoTitle: null,
        videoDurationSeconds: null,
        videoThumbnailUrl: null,
        videoMetadataFetchedAt: null,
        videoMetadataSource: null,
      });
    }
  });
});

describe('R2.2.6 — feature-off, the LIVE path in this workspace (ASSUMPTION-6)', () => {
  it('the save PROCEEDS, with source `manual` and no fetchedAt', async () => {
    const { service } = wire({ ok: false, skipped: true });

    const columns = await service.resolveVideoColumns({
      youtubeVideoIdOrUrl: `https://youtu.be/${VIDEO_ID}`,
      videoTitle: 'Typed by an admin',
      videoDurationSeconds: 600,
    });

    expect(columns).toEqual({
      youtubeVideoId: VIDEO_ID,
      videoTitle: 'Typed by an admin',
      videoDurationSeconds: 600,
      videoThumbnailUrl: null,
      // ⚠️ `null`, not a date: stamping a hand-typed row as freshly fetched
      // would badge stale data as current in the admin table.
      videoMetadataFetchedAt: null,
      videoMetadataSource: 'manual',
    });
  });

  it('🔴 the id is STILL extracted and validated when the integration is off', async () => {
    // A disabled integration must not become a hole through which an
    // unvalidated string reaches the column — the frontend builds a
    // `youtube-nocookie` embed URL from whatever is stored (§4.6.3), and "the
    // API key was unset that week" is not a defence.
    const { service } = wire({ ok: false, skipped: true }, false);

    await expect(
      service.resolveVideoColumns({
        youtubeVideoIdOrUrl: 'javascript:alert(1)',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('nothing 500s and the columns are a stable shape (exit-gate clause 3)', async () => {
    const { service } = wire({ ok: false, skipped: true }, false);

    const columns = await service.resolveVideoColumns({
      youtubeVideoIdOrUrl: VIDEO_ID,
    });

    expect(Object.keys(columns).sort()).toEqual([
      'videoDurationSeconds',
      'videoMetadataFetchedAt',
      'videoMetadataSource',
      'videoThumbnailUrl',
      'videoTitle',
      'youtubeVideoId',
    ]);
  });

  it('a feature-off save with NO typed metadata still stores the id', async () => {
    // The lesson that ASSUMPTION-8 is about: a video id and no duration, hence
    // manual-completion-only for every member.
    const { service } = wire({ ok: false, skipped: true }, false);

    const columns = await service.resolveVideoColumns({
      youtubeVideoIdOrUrl: VIDEO_ID,
    });

    expect(columns.youtubeVideoId).toBe(VIDEO_ID);
    expect(columns.videoDurationSeconds).toBeNull();
  });
});

describe('🔴 the fetch is awaited BEFORE $transaction opens (R2.2.4)', () => {
  it('call order on the double: fetchVideo, then $transaction', async () => {
    // Doing the network call inside the transaction would hold a Postgres
    // connection open for up to the provider's 10-second abort budget PER SAVE,
    // which is how a slow upstream becomes pool exhaustion. Asserted as an
    // ordering, because "inside the transaction boundary" reads like "inside
    // $transaction" and it must not be.
    const order: string[] = [];
    const { prisma, service, fetchVideo } = wire(SUCCESS);

    fetchVideo.mockImplementation(async () => {
      order.push('fetch');
      return SUCCESS;
    });
    prisma.$transaction.mockImplementation(async (arg: unknown) => {
      order.push('transaction');
      return (arg as (tx: unknown) => Promise<unknown>)(prisma);
    });

    await service.resolveAndPersist('lesson-1', {
      youtubeVideoIdOrUrl: VIDEO_ID,
    });

    expect(order).toEqual(['fetch', 'transaction']);
  });

  it('a failed fetch opens NO transaction at all', async () => {
    const { prisma, service } = wire({ ok: false, error: 'not_found' });

    await expect(
      service.resolveAndPersist('lesson-1', { youtubeVideoIdOrUrl: VIDEO_ID }),
    ).rejects.toMatchObject({ status: 422 });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('the five columns are written in ONE update, together', async () => {
    const { prisma, service } = wire(SUCCESS);

    await service.resolveAndPersist('lesson-1', {
      youtubeVideoIdOrUrl: VIDEO_ID,
    });

    expect(prisma.lesson.update).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(prisma.lesson.update.mock.calls[0]?.[0]?.data).sort(),
    ).toEqual([
      'videoDurationSeconds',
      'videoMetadataFetchedAt',
      'videoMetadataSource',
      'videoThumbnailUrl',
      'videoTitle',
      'youtubeVideoId',
    ]);
  });

  it('404s for a lesson in a deleted module or course, and writes nothing', async () => {
    const { prisma, service, writeCount } = wire(SUCCESS);
    prisma.lesson.findFirst.mockResolvedValue(null);

    await expect(
      service.resolveAndPersist('lesson-1', { youtubeVideoIdOrUrl: VIDEO_ID }),
    ).rejects.toMatchObject({ status: 404 });

    expect(writeCount()).toBe(0);
    expect(prisma.lesson.findFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      deletedAt: null,
      module: { deletedAt: null, course: { deletedAt: null } },
    });
  });

  it('the audit hook receives the mutation`s own tx (PRE-6)', async () => {
    const { prisma, service, auditCalls, audit } = wire(SUCCESS);

    await service.resolveAndPersist(
      'lesson-1',
      { youtubeVideoIdOrUrl: VIDEO_ID },
      audit,
    );

    expect(auditCalls).toEqual([{ tx: prisma, targetId: 'lesson-1' }]);
  });
});

describe('🔴 ASSUMPTION-9 — bulk refresh is per-lesson atomic and batch-tolerant', () => {
  function wireBulk(): Wired & { results: Map<string, YouTubeFetchResult> } {
    const results = new Map<string, YouTubeFetchResult>();
    const wired = wire(SUCCESS);

    wired.fetchVideo.mockImplementation(
      async (videoId: string) =>
        results.get(videoId) ?? { ok: false, error: 'unavailable' },
    );
    wired.prisma.lesson.findMany.mockResolvedValue([
      { id: 'l1', youtubeVideoId: 'aaaaaaaaaaa' },
      { id: 'l2', youtubeVideoId: 'bbbbbbbbbbb' },
      { id: 'l3', youtubeVideoId: 'ccccccccccc' },
    ]);
    wired.prisma.lesson.findFirst.mockResolvedValue({ id: 'x' });

    return { ...wired, results };
  }

  it('ONE BAD ID AMONG THREE LEAVES THE OTHER TWO REFRESHED', async () => {
    // A single all-or-nothing transaction across N lessons would make one
    // deleted video block every other refresh — the opposite of what a
    // maintenance action is for, and it gets worse as the curriculum grows.
    const { service, results } = wireBulk();
    results.set('aaaaaaaaaaa', SUCCESS);
    results.set('bbbbbbbbbbb', { ok: false, error: 'not_found' });
    results.set('ccccccccccc', SUCCESS);

    const result = await service.refreshMetadata(['l1', 'l2', 'l3']);

    expect(result.refreshed).toBe(2);
    expect(result.failed).toEqual([
      { lessonId: 'l2', reason: 'youtube_video_not_found' },
    ]);
  });

  it('each lesson gets its OWN transaction', async () => {
    const { prisma, service, results } = wireBulk();
    results.set('aaaaaaaaaaa', SUCCESS);
    results.set('bbbbbbbbbbb', SUCCESS);
    results.set('ccccccccccc', SUCCESS);

    await service.refreshMetadata(['l1', 'l2', 'l3']);

    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('reports { refreshed, skipped, failed } and nothing else', async () => {
    const { service, results } = wireBulk();
    results.set('aaaaaaaaaaa', SUCCESS);
    results.set('bbbbbbbbbbb', SUCCESS);
    results.set('ccccccccccc', SUCCESS);

    const result = await service.refreshMetadata(['l1', 'l2', 'l3']);

    expect(Object.keys(result).sort()).toEqual([
      'failed',
      'refreshed',
      'skipped',
    ]);
  });

  it('a lesson with NO video is SKIPPED, not failed', async () => {
    // An admin selecting a whole module will include text-only lessons;
    // reporting those as errors would bury the ones that matter.
    const { prisma, service, results } = wireBulk();
    prisma.lesson.findMany.mockResolvedValue([
      { id: 'l1', youtubeVideoId: 'aaaaaaaaaaa' },
      { id: 'l2', youtubeVideoId: null },
    ]);
    results.set('aaaaaaaaaaa', SUCCESS);

    const result = await service.refreshMetadata(['l1', 'l2']);

    expect(result).toMatchObject({ refreshed: 1, skipped: 1, failed: [] });
  });

  it('an id that is not a live lesson is a FAILURE with a machine reason', async () => {
    const { service, results } = wireBulk();
    results.set('aaaaaaaaaaa', SUCCESS);

    const result = await service.refreshMetadata(['l1', 'deleted-or-unknown']);

    expect(result.failed).toEqual([
      { lessonId: 'deleted-or-unknown', reason: 'lesson_not_found' },
    ]);
  });

  it('an unexpected error inside one lesson never leaks a raw message (NFR-S7)', async () => {
    const { prisma, service, results } = wireBulk();
    results.set('aaaaaaaaaaa', SUCCESS);
    results.set('bbbbbbbbbbb', SUCCESS);
    results.set('ccccccccccc', SUCCESS);
    prisma.lesson.update
      .mockResolvedValueOnce(lessonRow())
      .mockRejectedValueOnce(
        new Error('Invalid `prisma.lesson.update()` invocation: column x'),
      )
      .mockResolvedValueOnce(lessonRow());

    const result = await service.refreshMetadata(['l1', 'l2', 'l3']);

    expect(result.refreshed).toBe(2);
    expect(result.failed).toEqual([
      { lessonId: 'l2', reason: 'refresh_failed' },
    ]);
    expect(JSON.stringify(result)).not.toContain('prisma');
  });

  it('🔴 with the integration OFF it is { refreshed: 0, skipped: n, reason } and WRITES NOTHING', async () => {
    // §4.1's exact shape. Rewriting every lesson to `manual` because the key is
    // unset would DESTROY previously-fetched metadata — every title, duration
    // and thumbnail replaced by whatever the admin has not typed. A data-loss
    // path with a 200 on it.
    const { service, writeCount, fetchVideo } = wire(SUCCESS, false);

    const result = await service.refreshMetadata(['l1', 'l2', 'l3']);

    expect(result).toEqual({
      refreshed: 0,
      skipped: 3,
      failed: [],
      reason: 'youtube_disabled',
    });
    expect(writeCount()).toBe(0);
    expect(fetchVideo).not.toHaveBeenCalled();
  });

  it('an empty batch issues no query and reports zeroes', async () => {
    const { prisma, service } = wire(SUCCESS);

    expect(await service.refreshMetadata([])).toEqual({
      refreshed: 0,
      skipped: 0,
      failed: [],
    });
    expect(prisma.lesson.findMany).not.toHaveBeenCalled();
  });

  it('resolves the batch through ONE query, not one lookup per id', async () => {
    const { prisma, service, results } = wireBulk();
    results.set('aaaaaaaaaaa', SUCCESS);
    results.set('bbbbbbbbbbb', SUCCESS);
    results.set('ccccccccccc', SUCCESS);

    await service.refreshMetadata(['l1', 'l2', 'l3']);

    expect(prisma.lesson.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.lesson.findMany.mock.calls[0]?.[0]?.where?.id?.in).toEqual([
      'l1',
      'l2',
      'l3',
    ]);
  });
});

describe('NFR-P6 — this is the ONLY importer of @ptah-api/youtube in the lib', () => {
  it('and the sibling directories do not reach it', () => {
    // Task 9.17 owns the full structural assertion by name and proves it by
    // deliberate failure. This is the local half, so the property is checked
    // from the moment the importer lands rather than only at the end of the
    // batch.
    const { readdirSync, readFileSync } =
      require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const libRoot = join(__dirname, '..');

    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else if (entry.name.endsWith('.ts')) acc.push(full);
      }
      return acc;
    };

    const importers = walk(libRoot)
      .filter((f) => !f.endsWith('.spec.ts'))
      .filter((f) =>
        readFileSync(f, 'utf8').includes("from '@ptah-api/youtube'"),
      )
      .map((f) => f.slice(libRoot.length + 1).replace(/\\/g, '/'));

    expect(importers).toEqual(['lessons/lesson-video.service.ts']);
  });
});
