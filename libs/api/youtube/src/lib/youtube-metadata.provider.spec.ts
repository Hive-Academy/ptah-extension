import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { YouTubeMetadataProvider } from './youtube-metadata.provider';

/**
 * 🔴 EVERY CASE HERE RUNS AGAINST A STUBBED `fetch`. NO REAL YOUTUBE REQUEST
 * IS MADE BY THIS SUITE, and none can be made in this workspace: `.env:259`
 * reads `YOUTUBE_API_KEY=` with no value, so `isEnabled()` is `false` here and
 * the feature-off branch is the live path (ASSUMPTION-6).
 *
 * That is a fact about the environment, not a licence to skip the happy path.
 * The success case's stub body is a REAL `videos.list` response pasted
 * verbatim, so the schema and the mapping are exercised against the shape
 * YouTube actually emits rather than one invented to satisfy them.
 *
 * To overrule this and test live: put a real Data API v3 key in `.env` and add
 * one live check against a known unlisted video id. One line of `.env`.
 */

const VIDEO_ID = 'dQw4w9WgXcQ';
const API_KEY = 'AIzaSyTEST_KEY_NEVER_REAL_0123456789abc';

/**
 * A REAL `videos.list` response body, pasted verbatim — the same fixture
 * `youtube.schemas.spec.ts` uses. It carries the ~18 fields the schema does
 * not read (`kind`, `etag`, `pageInfo`, `publishedAt`, `channelId`,
 * `standard`/`maxres` thumbnails, `dimension`, `licensedContent`,
 * `uploadStatus`, `madeForKids`, …), which is the half an invented fixture
 * would omit. `duration` is `PT3M33S` = 213 seconds.
 */
const REAL_VIDEOS_LIST_BODY = {
  kind: 'youtube#videoListResponse',
  etag: 'JZ0qFDF9tqQ7bZG9nZ4d8OaJlLQ',
  items: [
    {
      kind: 'youtube#video',
      etag: 'ISVfDCXHCkWkVR3T3RWlLtRXTiE',
      id: VIDEO_ID,
      snippet: {
        publishedAt: '2009-10-25T06:57:33Z',
        channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
        title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
        description: 'The official video for "Never Gonna Give You Up".',
        thumbnails: {
          default: {
            url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg',
            width: 120,
            height: 90,
          },
          medium: {
            url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
            width: 320,
            height: 180,
          },
          high: {
            url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
            width: 480,
            height: 360,
          },
          standard: {
            url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg',
            width: 640,
            height: 480,
          },
          maxres: {
            url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
            width: 1280,
            height: 720,
          },
        },
        channelTitle: 'Rick Astley',
        tags: ['rick astley'],
        categoryId: '10',
        liveBroadcastContent: 'none',
        localized: { title: 'Never Gonna Give You Up', description: '' },
      },
      contentDetails: {
        duration: 'PT3M33S',
        dimension: '2d',
        definition: 'hd',
        caption: 'true',
        licensedContent: true,
        contentRating: {},
        projection: 'rectangular',
      },
      status: {
        uploadStatus: 'processed',
        privacyStatus: 'public',
        license: 'youtube',
        embeddable: true,
        publicStatsViewable: true,
        madeForKids: false,
      },
    },
  ],
  pageInfo: { totalResults: 1, resultsPerPage: 1 },
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The fixture's single item, without a non-null assertion — if a future edit
 * empties `items`, the mutation cases below would silently mutate nothing and
 * still pass. This throws instead.
 */
function firstItem(body: typeof REAL_VIDEOS_LIST_BODY) {
  const item = body.items[0];
  if (item === undefined) {
    throw new Error('fixture invariant broken: REAL_VIDEOS_LIST_BODY.items[0]');
  }
  return item;
}

/** A `ConfigService` double that answers exactly one key. */
function configWith(youtubeApiKey: string | undefined): ConfigService {
  return {
    get: (key: string): string | undefined =>
      key === 'YOUTUBE_API_KEY' ? youtubeApiKey : undefined,
  } as unknown as ConfigService;
}

/**
 * ⚠️ NO DEFAULT PARAMETER, DELIBERATELY. `key: string = API_KEY` would make
 * `providerWithKey(undefined)` — the feature-off case — silently construct an
 * ENABLED provider, because a JS default fires on an explicit `undefined`.
 * That turned four feature-off assertions green-then-red on the first run of
 * this suite; a default here would have made them pass against the wrong
 * provider.
 */
function providerWithKey(key: string | undefined) {
  return new YouTubeMetadataProvider(configWith(key));
}

/** The enabled path. */
function enabledProvider() {
  return providerWithKey(API_KEY);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('YouTubeMetadataProvider', () => {
  let fetchSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {
      /* silence */
    });
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {
      /* silence */
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // ---------------------------------------------------------------------
  // §4.4 row 7 — success
  // ---------------------------------------------------------------------

  describe('success', () => {
    it('maps a real videos.list body to persistable metadata', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(clone(REAL_VIDEOS_LIST_BODY)));

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(result).toEqual({
        ok: true,
        video: {
          videoId: VIDEO_ID,
          title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
          durationSeconds: 213,
          thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        },
      });
    });

    it('requests part=snippet,contentDetails,status for the given id', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(clone(REAL_VIDEOS_LIST_BODY)));

      await enabledProvider().fetchVideo(VIDEO_ID);

      const url = new URL(String(fetchSpy.mock.calls[0]?.[0]));
      expect(url.origin + url.pathname).toBe(
        'https://www.googleapis.com/youtube/v3/videos',
      );
      expect(url.searchParams.get('part')).toBe(
        'snippet,contentDetails,status',
      );
      expect(url.searchParams.get('id')).toBe(VIDEO_ID);
      expect(url.searchParams.get('key')).toBe(API_KEY);
    });

    it('accepts privacyStatus "unlisted" — the Checkpoint-0 delivery model', async () => {
      const body = clone(REAL_VIDEOS_LIST_BODY);
      firstItem(body).status.privacyStatus = 'unlisted';
      fetchSpy.mockResolvedValue(jsonResponse(body));

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(result.ok).toBe(true);
      expect(result.ok && result.video.durationSeconds).toBe(213);
    });

    it('falls back through the thumbnail sizes and to null', async () => {
      const body = clone(REAL_VIDEOS_LIST_BODY);
      firstItem(body).snippet.thumbnails =
        {} as (typeof body.items)[0]['snippet']['thumbnails'];
      fetchSpy.mockResolvedValue(jsonResponse(body));

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(result.ok).toBe(true);
      expect(result.ok && result.video.thumbnailUrl).toBeNull();
    });

    it('parses PT0S to a duration of 0 rather than failing', async () => {
      // A still-processing video. 0 is the honest parse; guarding the
      // 0-second completion threshold belongs to Task 9.13.
      const body = clone(REAL_VIDEOS_LIST_BODY);
      firstItem(body).contentDetails.duration = 'PT0S';
      fetchSpy.mockResolvedValue(jsonResponse(body));

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(result.ok).toBe(true);
      expect(result.ok && result.video.durationSeconds).toBe(0);
    });
  });

  // ---------------------------------------------------------------------
  // §4.4 rows 1-5 — the error arms
  // ---------------------------------------------------------------------

  describe('the §4.4 outcome table', () => {
    it('items: [] => not_found', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ items: [] }));

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(result).toEqual({ ok: false, error: 'not_found' });
    });

    it('privacyStatus "private" => private', async () => {
      const body = clone(REAL_VIDEOS_LIST_BODY);
      firstItem(body).status.privacyStatus = 'private';
      fetchSpy.mockResolvedValue(jsonResponse(body));

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(result).toEqual({ ok: false, error: 'private' });
    });

    it('embeddable false => not_embeddable', async () => {
      const body = clone(REAL_VIDEOS_LIST_BODY);
      firstItem(body).status.embeddable = false;
      fetchSpy.mockResolvedValue(jsonResponse(body));

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(result).toEqual({ ok: false, error: 'not_embeddable' });
    });

    it('a Zod failure => malformed_response', async () => {
      const body = clone(REAL_VIDEOS_LIST_BODY) as Record<string, unknown>;
      const items = body['items'] as Array<Record<string, unknown>>;
      delete items[0]?.['contentDetails'];
      fetchSpy.mockResolvedValue(jsonResponse(body));

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(result).toEqual({ ok: false, error: 'malformed_response' });
    });

    it('a 2xx body that is not JSON => malformed_response', async () => {
      fetchSpy.mockResolvedValue(
        new Response('<html>proxy error</html>', { status: 200 }),
      );

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(result).toEqual({ ok: false, error: 'malformed_response' });
    });

    it('a duration YouTube emits that we cannot convert => malformed_response, not a 0-second lesson', async () => {
      const body = clone(REAL_VIDEOS_LIST_BODY);
      firstItem(body).contentDetails.duration = 'P1Y';
      fetchSpy.mockResolvedValue(jsonResponse(body));

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(result).toEqual({ ok: false, error: 'malformed_response' });
    });

    it('HTTP 404 => unavailable with status 404', async () => {
      fetchSpy.mockResolvedValue(jsonResponse({ error: {} }, 404));

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(result).toEqual({
        ok: false,
        error: 'unavailable',
        status: 404,
      });
    });

    it('a transport failure => unavailable with no status', async () => {
      fetchSpy.mockRejectedValue(new TypeError('fetch failed: ENOTFOUND'));

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(result).toEqual({ ok: false, error: 'unavailable' });
    });

    it('never throws, for any upstream behaviour', async () => {
      const behaviours: Array<() => void> = [
        () => fetchSpy.mockRejectedValue(new Error('boom')),
        () => fetchSpy.mockRejectedValue('a non-Error rejection'),
        () => fetchSpy.mockResolvedValue(jsonResponse(null)),
        () => fetchSpy.mockResolvedValue(jsonResponse('a string')),
        () => fetchSpy.mockResolvedValue(new Response('', { status: 500 })),
        () => fetchSpy.mockResolvedValue(new Response(null, { status: 204 })),
      ];

      for (const behaviour of behaviours) {
        behaviour();
        const result = await enabledProvider().fetchVideo(VIDEO_ID);
        expect(result.ok).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------
  // NFR-S7 / RK-6 — nothing upstream and no key leaves this lib
  // ---------------------------------------------------------------------

  describe('sanitisation', () => {
    const QUOTA_BODY = {
      error: {
        code: 403,
        message:
          'The request cannot be completed because you have exceeded your <a href="/youtube/v3/getting-started#quota">quota</a>.',
        errors: [
          {
            message: 'UNIQUE_UPSTREAM_MARKER_9f3a2b quotaExceeded',
            domain: 'youtube.quota',
            reason: 'quotaExceeded',
          },
        ],
      },
    };

    it('a 403 quota body => unavailable with status 403 and NO upstream text in the result', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(QUOTA_BODY, 403));

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(result).toEqual({
        ok: false,
        error: 'unavailable',
        status: 403,
      });
      const serialised = JSON.stringify(result);
      expect(serialised).not.toContain('UNIQUE_UPSTREAM_MARKER_9f3a2b');
      expect(serialised).not.toContain('quotaExceeded');
      expect(serialised).not.toContain('quota');
    });

    it('surfaces no fabricated upstream error text in ANY error arm', async () => {
      const MARKER = 'FABRICATED_UPSTREAM_BODY_MARKER_7c1d';
      const arms: Array<() => void> = [
        () =>
          fetchSpy.mockResolvedValue(
            jsonResponse({ error: { message: MARKER } }, 500),
          ),
        () => fetchSpy.mockRejectedValue(new Error(MARKER)),
        () => fetchSpy.mockResolvedValue(new Response(MARKER, { status: 200 })),
        () => fetchSpy.mockResolvedValue(jsonResponse({ items: MARKER })),
      ];

      for (const arm of arms) {
        arm();
        const result = await enabledProvider().fetchVideo(VIDEO_ID);
        expect(JSON.stringify(result)).not.toContain(MARKER);
      }
    });

    it('the api key appears in no logger argument, even when upstream echoes it', async () => {
      // Google does not echo the key today. This asserts the guarantee does
      // not depend on that remaining true.
      fetchSpy.mockResolvedValue(
        jsonResponse(
          { error: { message: `Bad key: ${API_KEY} rejected` } },
          400,
        ),
      );

      await enabledProvider().fetchVideo(VIDEO_ID);

      const allArgs = [
        ...logSpy.mock.calls.flat(),
        ...warnSpy.mock.calls.flat(),
      ].map((argument) => String(argument));

      expect(allArgs.length).toBeGreaterThan(0);
      for (const argument of allArgs) {
        expect(argument).not.toContain(API_KEY);
      }
      expect(allArgs.some((a) => a.includes('[REDACTED]'))).toBe(true);
    });

    it('never logs the request URL, because the key is a query parameter on it', async () => {
      fetchSpy.mockRejectedValue(new Error('boom'));

      await enabledProvider().fetchVideo(VIDEO_ID);

      const allArgs = [
        ...logSpy.mock.calls.flat(),
        ...warnSpy.mock.calls.flat(),
      ].map((argument) => String(argument));

      for (const argument of allArgs) {
        expect(argument).not.toContain('googleapis.com');
        expect(argument).not.toContain('key=');
      }
    });

    it('never puts the api key in a successful result either', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(clone(REAL_VIDEOS_LIST_BODY)));

      const result = await enabledProvider().fetchVideo(VIDEO_ID);

      expect(JSON.stringify(result)).not.toContain(API_KEY);
    });
  });

  // ---------------------------------------------------------------------
  // §4.4 row 6 / R2.2.6 / NFR-R1 — feature-off
  // ---------------------------------------------------------------------

  describe('feature-off (ASSUMPTION-6: this is the live path in this workspace)', () => {
    it.each([
      ['undefined', undefined],
      ['the empty string', ''],
      ['whitespace only', '   '],
    ])('isEnabled() is false when the key is %s', (_label, key) => {
      expect(providerWithKey(key).isEnabled()).toBe(false);
    });

    it('isEnabled() is true for a configured key, and trims it', async () => {
      const provider = providerWithKey(`  ${API_KEY}  `);
      expect(provider.isEnabled()).toBe(true);

      fetchSpy.mockResolvedValue(jsonResponse(clone(REAL_VIDEOS_LIST_BODY)));
      await provider.fetchVideo(VIDEO_ID);
      const url = new URL(String(fetchSpy.mock.calls[0]?.[0]));
      expect(url.searchParams.get('key')).toBe(API_KEY);
    });

    it('returns { ok: false, skipped: true } and makes NO request', async () => {
      const result = await providerWithKey(undefined).fetchVideo(VIDEO_ID);

      expect(result).toEqual({ ok: false, skipped: true });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('the skipped arm carries no `error`, so a caller cannot mistake it for one', async () => {
      const result = await providerWithKey(undefined).fetchVideo(VIDEO_ID);

      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty('error');
      // The admin save proceeds on this arm with videoMetadataSource:'manual'
      // (R2.2.6) — exit-gate clause 3. `error` being absent is what makes that
      // branch unmissable at the call site.
      expect('skipped' in result && result.skipped).toBe(true);
    });

    it('logs the disabled notice EXACTLY ONCE across two calls', async () => {
      // A single-call assertion passes for a provider that logs every time,
      // which is the failure this test exists to catch: one line per lesson
      // save, forever.
      const provider = providerWithKey(undefined);

      await provider.fetchVideo(VIDEO_ID);
      await provider.fetchVideo(VIDEO_ID);
      await provider.fetchVideo('anotherIdXX');

      const disabledLines = logSpy.mock.calls
        .flat()
        .map((argument) => String(argument))
        .filter((line) => line.includes('YOUTUBE_API_KEY unset'));

      expect(disabledLines).toHaveLength(1);
    });

    it('does not log the disabled notice when the key IS configured', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(clone(REAL_VIDEOS_LIST_BODY)));

      await enabledProvider().fetchVideo(VIDEO_ID);

      const disabledLines = logSpy.mock.calls
        .flat()
        .map((argument) => String(argument))
        .filter((line) => line.includes('YOUTUBE_API_KEY unset'));

      expect(disabledLines).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------
  // §4.2 — the abort bound, asserted rather than assumed
  // ---------------------------------------------------------------------

  describe('the 10-second timeout', () => {
    it('aborts at exactly 10,000 ms and returns unavailable', async () => {
      jest.useFakeTimers();

      let capturedSignal: AbortSignal | undefined;
      fetchSpy.mockImplementation((_input: unknown, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(
              new DOMException('This operation was aborted', 'AbortError'),
            );
          });
        });
      });

      const pending = enabledProvider().fetchVideo(VIDEO_ID);

      // The signal exists and is NOT yet aborted one millisecond early. An
      // unexercised abort path is a 10-second hang in the authoring flow.
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal?.aborted).toBe(false);

      jest.advanceTimersByTime(9_999);
      expect(capturedSignal?.aborted).toBe(false);

      jest.advanceTimersByTime(1);
      expect(capturedSignal?.aborted).toBe(true);

      await expect(pending).resolves.toEqual({
        ok: false,
        error: 'unavailable',
      });
    });

    it('clears the timer on a fast success, so the process is not held open', async () => {
      jest.useFakeTimers();
      const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
      fetchSpy.mockResolvedValue(jsonResponse(clone(REAL_VIDEOS_LIST_BODY)));

      await enabledProvider().fetchVideo(VIDEO_ID);

      expect(clearSpy).toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
