import { Prisma } from '@ptah-api/core';
import type { YouTubeMetadataProvider } from '@ptah-api/youtube';

import {
  asPrismaService,
  createMockPrisma,
  type MockCommunityPrisma,
} from '../../testing/mock-community-prisma';

import { RESTORE_WINDOW_MS } from './common/soft-delete';
import {
  LiveSessionsService,
  metadataVideoOf,
  toAdminLiveSession,
  type LiveSessionRow,
} from './live-sessions.service';

/**
 * `LiveSessionsService` — R3.1, R3.2, R3.4, R8, R8.5, ASSUMPTION-6/-10/-13/-14,
 * PRE-6, NFR-S7, RISK-Y.
 *
 * ⚠️ THE YOUTUBE PROVIDER IS A DOUBLE AND NO REAL REQUEST IS MADE
 * (ASSUMPTION-10). `YOUTUBE_API_KEY` is unset in this workspace, so the
 * FEATURE-OFF branch is the live path and everything else is asserted against a
 * double returning the documented `YouTubeFetchResult` arms. The cheapest way to
 * overrule that: a real Data API v3 key in `.env` and one live save.
 *
 * ⚠️ PRE-6 IS ASSERTED ON THE `tx` IDENTITY, not merely on "the hook was
 * called". The mock's `$transaction(cb)` invokes `cb` with the SAME mock
 * instance, so an audit hook that received a different client would be visible.
 */

const NOW = new Date('2026-08-08T12:00:00.000Z');
const START = new Date('2026-08-10T18:00:00.000Z');

const ROW: LiveSessionRow = {
  id: 'live_1',
  title: 'Weekly build session',
  description: 'Bring what you shipped.',
  startsAt: START,
  endsAt: new Date(START.getTime() + 60 * 60 * 1000),
  visibility: 'member',
  cohortKeys: [],
  youtubeVideoId: null,
  replayYoutubeVideoId: null,
  videoTitle: null,
  videoDurationSeconds: null,
  videoThumbnailUrl: null,
  videoMetadataFetchedAt: null,
  videoMetadataSource: null,
  calendarEventId: null,
  createdBy: 'admin_1',
  deletedAt: null,
  deletedBy: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const row = (over: Partial<LiveSessionRow> = {}): LiveSessionRow => ({
  ...ROW,
  ...over,
});

const VIDEO = {
  videoId: 'dQw4w9WgXcQ',
  title: 'Week 1 — foundations',
  durationSeconds: 3600,
  thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
};

interface Harness {
  prisma: MockCommunityPrisma;
  youtube: { isEnabled: jest.Mock; fetchVideo: jest.Mock };
  service: LiveSessionsService;
  auditCalls: Array<{ tx: unknown; targetId: string | null }>;
  audit: (tx: unknown, targetId: string | null) => Promise<void>;
}

function wire(
  youtubeResult: unknown = { ok: false, skipped: true },
  enabled = false,
): Harness {
  const prisma = createMockPrisma();
  const youtube = {
    isEnabled: jest.fn().mockReturnValue(enabled),
    fetchVideo: jest.fn().mockResolvedValue(youtubeResult),
  };
  const auditCalls: Array<{ tx: unknown; targetId: string | null }> = [];

  const service = new LiveSessionsService(
    asPrismaService(prisma),
    youtube as unknown as YouTubeMetadataProvider,
  );

  return {
    prisma,
    youtube,
    service,
    auditCalls,
    audit: async (tx, targetId) => {
      auditCalls.push({ tx, targetId });
    },
  };
}

const CREATE_INPUT = {
  title: ROW.title,
  description: ROW.description,
  startsAt: START,
  endsAt: ROW.endsAt,
  visibility: 'member' as const,
  createdBy: 'admin_1',
};

describe('LiveSessionsService', () => {
  describe('create', () => {
    it('writes the row and calls the audit hook with the mutation OWN tx (PRE-6)', async () => {
      const h = wire();
      h.prisma.liveSession.create.mockResolvedValue(row());
      h.prisma.memberGroup.findMany.mockResolvedValue([]);

      await h.service.create(CREATE_INPUT, h.audit);

      expect(h.auditCalls).toHaveLength(1);
      // 🔴 THE SAME CLIENT the write went to — not merely "a defined tx".
      expect(h.auditCalls[0]?.tx).toBe(h.prisma);
      expect(h.auditCalls[0]?.targetId).toBe('live_1');
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown cohort key with a 400 and writes NOTHING (AD-10)', async () => {
      // A `String[]` column has no foreign key, so a typo saves cleanly and
      // produces a session visible to nobody — including the admin who made it.
      const h = wire();
      h.prisma.memberGroup.findMany.mockResolvedValue([{ key: 'founding' }]);

      await expect(
        h.service.create(
          {
            ...CREATE_INPUT,
            visibility: 'cohort',
            cohortKeys: ['founding', 'foundng'],
          },
          h.audit,
        ),
      ).rejects.toMatchObject({ status: 400 });

      expect(h.prisma.liveSession.create).not.toHaveBeenCalled();
      expect(h.auditCalls).toEqual([]);
    });

    it('FEATURE-OFF: stores the typed id with null metadata and never 500s (ASSUMPTION-6)', async () => {
      const h = wire({ ok: false, skipped: true }, false);
      h.prisma.liveSession.create.mockResolvedValue(row());
      h.prisma.memberGroup.findMany.mockResolvedValue([]);

      await h.service.create(
        {
          ...CREATE_INPUT,
          youtubeVideoIdOrUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          videoTitle: 'typed by hand',
          videoDurationSeconds: 1800,
        },
        h.audit,
      );

      const data = h.prisma.liveSession.create.mock.calls[0]?.[0]?.data;
      expect(data).toMatchObject({
        youtubeVideoId: 'dQw4w9WgXcQ',
        videoTitle: 'typed by hand',
        videoDurationSeconds: 1800,
        videoMetadataSource: 'manual',
        // ⚠️ NOT stamped as freshly fetched — that would badge hand-typed data
        // as current in the admin table.
        videoMetadataFetchedAt: null,
      });
    });

    it('ENABLED: persists what YouTube reported and ignores what the admin typed', async () => {
      // Otherwise an admin could type a duration onto an `api` row.
      const h = wire({ ok: true, video: VIDEO }, true);
      h.prisma.liveSession.create.mockResolvedValue(row());
      h.prisma.memberGroup.findMany.mockResolvedValue([]);

      await h.service.create(
        {
          ...CREATE_INPUT,
          youtubeVideoIdOrUrl: 'dQw4w9WgXcQ',
          videoTitle: 'typed by hand',
          videoDurationSeconds: 1,
        },
        h.audit,
      );

      const data = h.prisma.liveSession.create.mock.calls[0]?.[0]?.data;
      expect(data).toMatchObject({
        youtubeVideoId: VIDEO.videoId,
        videoTitle: VIDEO.title,
        videoDurationSeconds: VIDEO.durationSeconds,
        videoThumbnailUrl: VIDEO.thumbnailUrl,
        videoMetadataSource: 'api',
      });
      expect(data.videoMetadataFetchedAt).toBeInstanceOf(Date);
    });

    it('refuses a malformed video reference with a 400 BEFORE any fetch or write', async () => {
      const h = wire({ ok: true, video: VIDEO }, true);
      h.prisma.memberGroup.findMany.mockResolvedValue([]);

      await expect(
        h.service.create(
          { ...CREATE_INPUT, youtubeVideoIdOrUrl: 'not a video' },
          h.audit,
        ),
      ).rejects.toMatchObject({
        status: 400,
        response: { reason: 'youtube_video_id_invalid' },
      });

      expect(h.youtube.fetchVideo).not.toHaveBeenCalled();
      expect(h.prisma.liveSession.create).not.toHaveBeenCalled();
    });

    it.each([
      ['not_found', 422, 'youtube_video_not_found'],
      ['private', 422, 'youtube_video_private'],
      ['not_embeddable', 422, 'youtube_video_not_embeddable'],
      ['malformed_response', 502, 'youtube_unavailable'],
      ['unavailable', 502, 'youtube_unavailable'],
    ])(
      'maps a %s fetch failure to %i and writes nothing (§4.4)',
      async (error, status, reason) => {
        const h = wire({ ok: false, error }, true);
        h.prisma.memberGroup.findMany.mockResolvedValue([]);

        await expect(
          h.service.create(
            { ...CREATE_INPUT, youtubeVideoIdOrUrl: 'dQw4w9WgXcQ' },
            h.audit,
          ),
        ).rejects.toMatchObject({ status, response: { reason } });

        expect(h.prisma.liveSession.create).not.toHaveBeenCalled();
      },
    );

    it('fetches the REPLAY when one is supplied, and only ONE video per save', async () => {
      // The single `video*` block describes the replay when there is one —
      // duration and thumbnail are properties of a finished recording.
      const h = wire({ ok: true, video: VIDEO }, true);
      h.prisma.liveSession.create.mockResolvedValue(row());
      h.prisma.memberGroup.findMany.mockResolvedValue([]);

      await h.service.create(
        {
          ...CREATE_INPUT,
          youtubeVideoIdOrUrl: 'dQw4w9WgXcQ',
          replayYoutubeVideoIdOrUrl: 'aaaaaaaaaaa',
        },
        h.audit,
      );

      expect(h.youtube.fetchVideo).toHaveBeenCalledTimes(1);
      expect(h.youtube.fetchVideo).toHaveBeenCalledWith('aaaaaaaaaaa');
      const data = h.prisma.liveSession.create.mock.calls[0]?.[0]?.data;
      // …and BOTH ids are still stored. R3.4's whole point.
      expect(data).toMatchObject({
        youtubeVideoId: 'dQw4w9WgXcQ',
        replayYoutubeVideoId: 'aaaaaaaaaaa',
      });
    });

    it('maps a P2002 on calendar_event_id to a 409 with a machine reason (RISK-Y)', async () => {
      const h = wire();
      h.prisma.memberGroup.findMany.mockResolvedValue([]);
      h.prisma.liveSession.create.mockRejectedValue(prismaError('P2002'));

      const failure = await h.service
        .create({ ...CREATE_INPUT, calendarEventId: 'evt_1' }, h.audit)
        .catch((e: unknown) => e);

      expect(failure).toMatchObject({
        status: 409,
        response: { reason: 'calendar_event_already_claimed' },
      });
      // NFR-S7 — the constraint, the table and the column stay in the log.
      expect(JSON.stringify(failure)).not.toContain('calendar_event_id');
      expect(JSON.stringify(failure)).not.toContain('live_sessions');
    });

    it('never writes a `published` column — ASSUMPTION-13', async () => {
      const h = wire();
      h.prisma.liveSession.create.mockResolvedValue(row());
      h.prisma.memberGroup.findMany.mockResolvedValue([]);

      await h.service.create(CREATE_INPUT, h.audit);

      const data = h.prisma.liveSession.create.mock.calls[0]?.[0]?.data;
      expect(Object.keys(data)).not.toContain('published');
    });
  });

  describe('update', () => {
    it('leaves ALL SEVEN video columns untouched when the request says nothing about a video', async () => {
      const h = wire({ ok: true, video: VIDEO }, true);
      h.prisma.liveSession.findFirst.mockResolvedValue(
        row({ youtubeVideoId: 'dQw4w9WgXcQ', videoMetadataSource: 'api' }),
      );
      h.prisma.liveSession.update.mockResolvedValue(row());
      h.prisma.memberGroup.findMany.mockResolvedValue([]);

      await h.service.update('live_1', { title: 'Renamed' }, h.audit);

      expect(h.youtube.fetchVideo).not.toHaveBeenCalled();
      const data = h.prisma.liveSession.update.mock.calls[0]?.[0]?.data;
      expect(Object.keys(data)).toEqual(['title']);
    });

    it('attaching a replay KEEPS the stored stream id (R3.4)', async () => {
      // 🔴 The regression this exists for: re-resolving from the patch alone
      // would clear `youtubeVideoId`, because the patch did not mention it.
      const h = wire({ ok: true, video: VIDEO }, true);
      h.prisma.liveSession.findFirst.mockResolvedValue(
        row({ youtubeVideoId: 'dQw4w9WgXcQ' }),
      );
      h.prisma.liveSession.update.mockResolvedValue(row());
      h.prisma.memberGroup.findMany.mockResolvedValue([]);

      await h.service.update(
        'live_1',
        { replayYoutubeVideoIdOrUrl: 'aaaaaaaaaaa' },
        h.audit,
      );

      const data = h.prisma.liveSession.update.mock.calls[0]?.[0]?.data;
      expect(data).toMatchObject({
        youtubeVideoId: 'dQw4w9WgXcQ',
        replayYoutubeVideoId: 'aaaaaaaaaaa',
      });
    });

    it('an EMPTY string detaches the video and clears all seven columns', async () => {
      const h = wire({ ok: true, video: VIDEO }, true);
      h.prisma.liveSession.findFirst.mockResolvedValue(
        row({ youtubeVideoId: 'dQw4w9WgXcQ', videoMetadataSource: 'api' }),
      );
      h.prisma.liveSession.update.mockResolvedValue(row());
      h.prisma.memberGroup.findMany.mockResolvedValue([]);

      await h.service.update('live_1', { youtubeVideoIdOrUrl: '' }, h.audit);

      const data = h.prisma.liveSession.update.mock.calls[0]?.[0]?.data;
      expect(data).toMatchObject({
        youtubeVideoId: null,
        replayYoutubeVideoId: null,
        videoTitle: null,
        videoDurationSeconds: null,
        videoThumbnailUrl: null,
        videoMetadataFetchedAt: null,
        videoMetadataSource: null,
      });
      expect(h.youtube.fetchVideo).not.toHaveBeenCalled();
    });

    it('404s on a tombstone rather than writing to it', async () => {
      const h = wire();
      h.prisma.liveSession.findFirst.mockResolvedValue(null);

      await expect(
        h.service.update('gone', { title: 'x' }, h.audit),
      ).rejects.toMatchObject({ status: 404 });

      expect(h.prisma.liveSession.update).not.toHaveBeenCalled();
    });
  });

  describe('remove and restore — AD-5, R8.5, ASSUMPTION-14', () => {
    it('writes deletedAt AND deletedBy, and audits inside the same tx', async () => {
      const h = wire();
      h.prisma.liveSession.findFirst.mockResolvedValue(row());
      h.prisma.liveSession.update.mockResolvedValue(row());

      await h.service.remove('live_1', 'admin_7', h.audit);

      const data = h.prisma.liveSession.update.mock.calls[0]?.[0]?.data;
      expect(data.deletedBy).toBe('admin_7');
      expect(data.deletedAt).toBeInstanceOf(Date);
      expect(h.auditCalls[0]?.tx).toBe(h.prisma);
    });

    it("restores INSIDE the UPDATE's own where — no tombstone is ever read", async () => {
      // 🔴 This is what keeps EXPECTED_EXEMPTIONS at `[]`. A read-then-check
      // form would be an unfiltered read of a soft-deletable model on a WRITE
      // path.
      const h = wire();
      h.prisma.liveSession.updateMany.mockResolvedValue({ count: 1 });

      await h.service.restore('live_1', NOW, h.audit);

      const call = h.prisma.liveSession.updateMany.mock.calls[0]?.[0];
      expect(call.where).toMatchObject({
        id: 'live_1',
        deletedAt: {
          not: null,
          gte: new Date(NOW.getTime() - RESTORE_WINDOW_MS),
        },
      });
      // `deletedBy` is cleared with `deletedAt` — a restored row that still
      // names its deleter reads, in the admin table, as though it were deleted.
      expect(call.data).toEqual({ deletedAt: null, deletedBy: null });
      expect(h.prisma.liveSession.findFirst).not.toHaveBeenCalled();
    });

    it('succeeds at EXACTLY 30 days and 409s at 31 (R8.5 states a floor)', async () => {
      const h = wire();
      const deletedAt = new Date(NOW.getTime() - RESTORE_WINDOW_MS);

      // The window is enforced by Postgres, so the boundary is asserted on the
      // clause the service emits rather than on a JavaScript comparison.
      h.prisma.liveSession.updateMany.mockResolvedValue({ count: 1 });
      await h.service.restore('live_1', NOW, h.audit);
      const cutoff = h.prisma.liveSession.updateMany.mock.calls[0]?.[0].where
        .deletedAt.gte as Date;
      expect(deletedAt.getTime()).toBe(cutoff.getTime());

      h.prisma.liveSession.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        h.service.restore('live_1', NOW, h.audit),
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('refreshMetadata — R3.2, RK-6', () => {
    it('FEATURE-OFF: writes NOTHING and reports the reason in a 200', async () => {
      // 🔴 Rewriting the row to `manual` because the key is unset would DESTROY
      // previously-fetched metadata — a data-loss path with a 200 on it.
      const h = wire({ ok: false, skipped: true }, false);
      h.prisma.liveSession.findFirst.mockResolvedValue(
        row({ youtubeVideoId: 'dQw4w9WgXcQ', videoTitle: 'from the api' }),
      );
      h.prisma.memberGroup.findMany.mockResolvedValue([]);

      const result = await h.service.refreshMetadata('live_1', h.audit);

      expect(result).toMatchObject({
        refreshed: false,
        reason: 'youtube_disabled',
      });
      expect(h.prisma.liveSession.update).not.toHaveBeenCalled();
      expect(h.auditCalls).toEqual([]);
    });

    it('400s when the session has no video at all, rather than reporting success', async () => {
      const h = wire({ ok: true, video: VIDEO }, true);
      h.prisma.liveSession.findFirst.mockResolvedValue(row());

      await expect(
        h.service.refreshMetadata('live_1', h.audit),
      ).rejects.toMatchObject({
        status: 400,
        response: { reason: 'live_session_has_no_video' },
      });
      expect(h.prisma.liveSession.update).not.toHaveBeenCalled();
    });

    it('re-fetches the METADATA VIDEO and persists the fresh block', async () => {
      const h = wire({ ok: true, video: VIDEO }, true);
      h.prisma.liveSession.findFirst.mockResolvedValue(
        row({
          youtubeVideoId: 'dQw4w9WgXcQ',
          replayYoutubeVideoId: 'aaaaaaaaaaa',
        }),
      );
      h.prisma.liveSession.update.mockResolvedValue(row());
      h.prisma.memberGroup.findMany.mockResolvedValue([]);

      const result = await h.service.refreshMetadata('live_1', h.audit);

      expect(result.refreshed).toBe(true);
      expect(h.youtube.fetchVideo).toHaveBeenCalledWith('aaaaaaaaaaa');
      expect(h.auditCalls[0]?.tx).toBe(h.prisma);
    });
  });

  describe('listForAdmin — no N+1, no visibility filter', () => {
    it('resolves every cohort name in ONE query, whatever the row count', async () => {
      const h = wire();
      h.prisma.liveSession.findMany.mockResolvedValue([
        row({ id: 'a', cohortKeys: ['founding'] }),
        row({ id: 'b', cohortKeys: ['alumni'] }),
        row({ id: 'c', cohortKeys: ['founding', 'alumni'] }),
      ]);
      h.prisma.memberGroup.findMany.mockResolvedValue([
        { key: 'founding', name: 'Founding Members' },
        { key: 'alumni', name: 'Alumni' },
      ]);

      const listed = await h.service.listForAdmin();

      expect(h.prisma.memberGroup.findMany).toHaveBeenCalledTimes(1);
      expect(listed[2]?.cohortNames).toEqual(['Founding Members', 'Alumni']);
    });

    it('renders a stale key as "<key> (unknown group)" rather than dropping it', async () => {
      // A silently shorter array would make a stale key look like a key that
      // was never there — and a stale key means a session visible to nobody.
      const h = wire();
      h.prisma.liveSession.findMany.mockResolvedValue([
        row({ cohortKeys: ['founding', 'deleted-cohort'] }),
      ]);
      h.prisma.memberGroup.findMany.mockResolvedValue([
        { key: 'founding', name: 'Founding Members' },
      ]);

      const listed = await h.service.listForAdmin();

      expect(listed[0]?.cohortNames).toEqual([
        'Founding Members',
        'deleted-cohort (unknown group)',
      ]);
    });

    it('reads through NOT_DELETED and issues no member-group query for an empty list', async () => {
      const h = wire();
      h.prisma.liveSession.findMany.mockResolvedValue([]);

      expect(await h.service.listForAdmin()).toEqual([]);
      expect(
        h.prisma.liveSession.findMany.mock.calls[0]?.[0].where,
      ).toMatchObject({ deletedAt: null });
      expect(h.prisma.memberGroup.findMany).not.toHaveBeenCalled();
    });
  });

  describe('metadataVideoOf — the one place the two-ids/one-block rule is decided', () => {
    it('prefers the replay, falls back to the stream, and answers null for neither', () => {
      expect(
        metadataVideoOf({ youtubeVideoId: 's', replayYoutubeVideoId: 'r' }),
      ).toBe('r');
      expect(
        metadataVideoOf({ youtubeVideoId: 's', replayYoutubeVideoId: null }),
      ).toBe('s');
      expect(
        metadataVideoOf({ youtubeVideoId: null, replayYoutubeVideoId: null }),
      ).toBeNull();
    });
  });

  describe('toAdminLiveSession', () => {
    it('serialises every date as ISO and narrows an unrecognised metadata source to null', () => {
      const mapped = toAdminLiveSession(
        row({
          videoMetadataSource: 'scraped-by-hand',
          videoMetadataFetchedAt: NOW,
          deletedAt: NOW,
          deletedBy: 'admin_9',
        }),
        new Map([['founding', 'Founding Members']]),
      );

      expect(mapped.videoMetadataSource).toBeNull();
      expect(mapped.videoMetadataFetchedAt).toBe(NOW.toISOString());
      expect(mapped.startsAt).toBe(START.toISOString());
      expect(mapped.deletedBy).toBe('admin_9');
    });

    it('copies cohortKeys rather than aliasing the row', () => {
      const source = row({ cohortKeys: ['founding'] });
      const mapped = toAdminLiveSession(source, new Map());
      expect(mapped.cohortKeys).not.toBe(source.cohortKeys);
      expect(mapped.cohortKeys).toEqual(['founding']);
    });
  });
});

/**
 * A `PrismaClientKnownRequestError` the service's `instanceof` check accepts.
 *
 * Built by re-parenting a plain `Error` onto the real prototype, so the branch
 * under test is the real one rather than a duck-typed stand-in.
 *
 * 🔴 `Prisma` IS A STATIC IMPORT AT THE TOP OF THIS FILE, NOT A `require()`.
 * `libs/api/learning/src/lib/courses/courses.service.spec.ts:780` reached for
 * `require('@ptah-api/core')` here, and Nx classifies that as a LAZY LOAD of
 * `api-core` — which then makes every static `import` of `@ptah-api/core`
 * elsewhere in the same lib illegal under `@nx/enforce-module-boundaries`. That
 * is the whole of Batch 11's F-1: twelve lint errors from one `require`. Do not
 * reintroduce the shape here.
 */
function prismaError(code: string): Error {
  const error = Object.assign(
    new Error(
      'Unique constraint failed on the fields: (`calendar_event_id`) on table `live_sessions`',
    ),
    { code, clientVersion: '7.7.0' },
  );
  Object.setPrototypeOf(
    error,
    Prisma.PrismaClientKnownRequestError.prototype as object,
  );
  return error;
}
