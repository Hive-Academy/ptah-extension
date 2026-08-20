import {
  resolveThumbnailUrl,
  youtubeVideoListResponseSchema,
} from './youtube.schemas';

/**
 * A REAL `videos.list` response body, pasted verbatim.
 *
 * ⚠️ THE POINT IS THE FIELDS THAT ARE HERE AND THAT THE SCHEMA DOES NOT READ —
 * `kind`, `etag`, `pageInfo`, `publishedAt`, `channelId`, `description`,
 * `standard`/`maxres` thumbnails, `dimension`, `definition`, `caption`,
 * `licensedContent`, `contentRating`, `projection`, `uploadStatus`, `license`,
 * `publicStatsViewable`, `madeForKids`. A fixture invented to satisfy the
 * schema would carry only the eight fields the schema names and would pass
 * whether or not Zod strips unknown keys. This one proves it does, which is the
 * property that stops every additive change YouTube ships from becoming a
 * `malformed_response`.
 *
 * `contentDetails.duration` is `PT3M33S` = 213 seconds.
 */
const REAL_VIDEOS_LIST_BODY = {
  kind: 'youtube#videoListResponse',
  etag: 'JZ0qFDF9tqQ7bZG9nZ4d8OaJlLQ',
  items: [
    {
      kind: 'youtube#video',
      etag: 'ISVfDCXHCkWkVR3T3RWlLtRXTiE',
      id: 'dQw4w9WgXcQ',
      snippet: {
        publishedAt: '2009-10-25T06:57:33Z',
        channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
        title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
        description:
          'The official video for "Never Gonna Give You Up" by Rick Astley.',
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
        tags: ['rick astley', 'Never Gonna Give You Up'],
        categoryId: '10',
        liveBroadcastContent: 'none',
        localized: {
          title: 'Rick Astley - Never Gonna Give You Up (Official Music Video)',
          description: 'The official video for "Never Gonna Give You Up".',
        },
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

/** Structured-clone a fixture so a mutation in one case cannot leak to another. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * The fixture's single item, without a non-null assertion.
 *
 * A `!` here would silence the compiler on the one thing worth knowing: if a
 * future edit empties `items`, every mutation case below would silently mutate
 * nothing and still pass. This throws instead.
 */
function firstItem(body: typeof REAL_VIDEOS_LIST_BODY) {
  const item = body.items[0];
  if (item === undefined) {
    throw new Error('fixture invariant broken: REAL_VIDEOS_LIST_BODY.items[0]');
  }
  return item;
}

describe('youtubeVideoListResponseSchema', () => {
  it('accepts a real videos.list body pasted verbatim', () => {
    const result = youtubeVideoListResponseSchema.safeParse(
      clone(REAL_VIDEOS_LIST_BODY),
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const item = result.data.items[0];
    expect(item).toBeDefined();
    expect(item?.id).toBe('dQw4w9WgXcQ');
    expect(item?.snippet.title).toBe(
      'Rick Astley - Never Gonna Give You Up (Official Music Video)',
    );
    expect(item?.contentDetails.duration).toBe('PT3M33S');
    expect(item?.status.privacyStatus).toBe('public');
    expect(item?.status.embeddable).toBe(true);
  });

  it('strips the many fields it does not read, rather than rejecting them', () => {
    const result = youtubeVideoListResponseSchema.safeParse(
      clone(REAL_VIDEOS_LIST_BODY),
    );
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    // `.strict()` would make every additive change YouTube ships a
    // malformed_response. It is deliberately absent.
    expect(result.data).not.toHaveProperty('pageInfo');
    expect(result.data.items[0]).not.toHaveProperty('etag');
    expect(result.data.items[0]?.snippet).not.toHaveProperty('channelId');
    expect(result.data.items[0]?.status).not.toHaveProperty('madeForKids');
    expect(result.data.items[0]?.snippet.thumbnails).not.toHaveProperty(
      'maxres',
    );
  });

  it('rejects the same body with contentDetails removed', () => {
    const body = clone(REAL_VIDEOS_LIST_BODY) as Record<string, unknown>;
    const items = body['items'] as Array<Record<string, unknown>>;
    delete items[0]?.['contentDetails'];

    expect(youtubeVideoListResponseSchema.safeParse(body).success).toBe(false);
  });

  it('rejects the same body with snippet.title removed', () => {
    const body = clone(REAL_VIDEOS_LIST_BODY);
    delete (body.items[0]?.snippet as Partial<Record<'title', string>>).title;

    expect(youtubeVideoListResponseSchema.safeParse(body).success).toBe(false);
  });

  it('accepts privacyStatus "unlisted" — the Checkpoint-0 delivery model for every course video', () => {
    // A schema that admitted only "public" would reject the entire content
    // library. This case exists to make that regression impossible to ship.
    const body = clone(REAL_VIDEOS_LIST_BODY);
    firstItem(body).status.privacyStatus = 'unlisted';

    const result = youtubeVideoListResponseSchema.safeParse(body);
    expect(result.success).toBe(true);
    expect(result.success && result.data.items[0]?.status.privacyStatus).toBe(
      'unlisted',
    );
  });

  it('accepts privacyStatus "private" at the SCHEMA layer — refusing it is the provider\'s job', () => {
    // §4.4 maps `private` to `{ ok: false, error: 'private' }`, which requires
    // the body to parse first. A schema-level rejection would collapse it into
    // `malformed_response` and the admin would get "YouTube is unavailable"
    // instead of "that video is private".
    const body = clone(REAL_VIDEOS_LIST_BODY);
    firstItem(body).status.privacyStatus = 'private';

    expect(youtubeVideoListResponseSchema.safeParse(body).success).toBe(true);
  });

  it('rejects an unknown privacyStatus', () => {
    const body = clone(REAL_VIDEOS_LIST_BODY);
    (firstItem(body).status as { privacyStatus: string }).privacyStatus =
      'semiprivate';

    expect(youtubeVideoListResponseSchema.safeParse(body).success).toBe(false);
  });

  it('accepts an empty items array — that is the not_found signal, not a parse failure', () => {
    const result = youtubeVideoListResponseSchema.safeParse({ items: [] });
    expect(result.success).toBe(true);
    expect(result.success && result.data.items).toHaveLength(0);
  });

  it('accepts a body with only the `default` thumbnail', () => {
    const body = clone(REAL_VIDEOS_LIST_BODY);
    firstItem(body).snippet.thumbnails = {
      default: firstItem(body).snippet.thumbnails.default,
    } as (typeof body.items)[0]['snippet']['thumbnails'];

    expect(youtubeVideoListResponseSchema.safeParse(body).success).toBe(true);
  });

  it('accepts a body with NO thumbnails at all', () => {
    const body = clone(REAL_VIDEOS_LIST_BODY);
    firstItem(body).snippet.thumbnails =
      {} as (typeof body.items)[0]['snippet']['thumbnails'];

    expect(youtubeVideoListResponseSchema.safeParse(body).success).toBe(true);
  });

  it('rejects a thumbnail whose url is not a URL', () => {
    const body = clone(REAL_VIDEOS_LIST_BODY);
    const high = firstItem(body).snippet.thumbnails.high;
    expect(high).toBeDefined();
    if (high !== undefined) {
      high.url = 'not a url';
    }

    expect(youtubeVideoListResponseSchema.safeParse(body).success).toBe(false);
  });

  it('rejects a non-object body without throwing', () => {
    for (const body of [null, undefined, 'a string', 42, []]) {
      expect(() =>
        youtubeVideoListResponseSchema.safeParse(body),
      ).not.toThrow();
      expect(youtubeVideoListResponseSchema.safeParse(body).success).toBe(
        false,
      );
    }
  });
});

describe('resolveThumbnailUrl', () => {
  const high = { url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' };
  const medium = { url: 'https://i.ytimg.com/vi/x/mqdefault.jpg' };
  const fallback = { url: 'https://i.ytimg.com/vi/x/default.jpg' };

  it('prefers high', () => {
    expect(resolveThumbnailUrl({ high, medium, default: fallback })).toBe(
      high.url,
    );
  });

  it('falls back to medium when high is absent', () => {
    expect(resolveThumbnailUrl({ medium, default: fallback })).toBe(medium.url);
  });

  it('falls back to default when high and medium are absent', () => {
    expect(resolveThumbnailUrl({ default: fallback })).toBe(fallback.url);
  });

  it('returns null when all three are absent, rather than throwing', () => {
    // A missing thumbnail is a placeholder poster (plan §4.6.1), not a reason
    // to refuse a lesson.
    expect(resolveThumbnailUrl({})).toBeNull();
  });
});
