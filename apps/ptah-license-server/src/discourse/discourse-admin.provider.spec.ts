/**
 * Unit tests for `DiscourseAdminProvider.getLatestTopics` — the read path
 * backing `GET /api/v1/community/summary`.
 *
 * Focus (mirrors the provider's non-throwing guarantees):
 *   1. Feature-off (DISCOURSE_* unset) → [] with no network call.
 *   2. Happy path: a mocked /latest.json maps to the contract shape (capped at
 *      5, newest first) with category names resolved from /categories.json.
 *   3. Any Discourse error (transport reject or non-2xx) → [] (never throws).
 */

import { ConfigService } from '@nestjs/config';
import { DiscourseAdminProvider } from './discourse-admin.provider';

const ENABLED_CONFIG: Record<string, string> = {
  DISCOURSE_URL: 'https://forum.ptah.live',
  DISCOURSE_API_KEY: 'test-key',
  DISCOURSE_API_USERNAME: 'system',
};

function buildProvider(
  config: Record<string, string> = ENABLED_CONFIG,
): DiscourseAdminProvider {
  const configService = {
    get: (key: string): unknown => config[key],
  } as unknown as ConfigService;
  return new DiscourseAdminProvider(configService);
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Route a mocked fetch by URL suffix. */
function mockFetch(
  routes: Record<string, () => Promise<Response>>,
): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockImplementation(((input: unknown) => {
    const url = String(input);
    for (const [suffix, handler] of Object.entries(routes)) {
      if (url.includes(suffix)) {
        return handler();
      }
    }
    return Promise.resolve(jsonResponse({}, 404));
  }) as unknown as typeof fetch);
}

describe('DiscourseAdminProvider.getLatestTopics', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns [] when the admin API is not configured (feature-off)', async () => {
    const provider = buildProvider({});
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(provider.getLatestTopics()).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps the latest topics (capped at 5) and resolves category names', async () => {
    const provider = buildProvider();
    const latest = {
      topic_list: {
        topics: Array.from({ length: 7 }, (_, i) => ({
          id: i + 1,
          title: `Topic ${i + 1}`,
          slug: `topic-${i + 1}`,
          posts_count: i + 2,
          last_posted_at: '2026-07-20T10:00:00.000Z',
          category_id: 5,
        })),
      },
    };
    const categories = {
      category_list: { categories: [{ id: 5, name: 'Announcements' }] },
    };
    mockFetch({
      '/latest.json': () => Promise.resolve(jsonResponse(latest)),
      '/categories.json': () => Promise.resolve(jsonResponse(categories)),
    });

    const topics = await provider.getLatestTopics();

    expect(topics).toHaveLength(5);
    expect(topics[0]).toEqual({
      id: 1,
      title: 'Topic 1',
      slug: 'topic-1',
      postsCount: 2,
      lastPostedAt: '2026-07-20T10:00:00.000Z',
      categoryName: 'Announcements',
    });
  });

  it('maps a topic with no matching category to categoryName: null', async () => {
    const provider = buildProvider();
    mockFetch({
      '/latest.json': () =>
        Promise.resolve(
          jsonResponse({
            topic_list: {
              topics: [
                {
                  id: 42,
                  title: 'Uncategorized',
                  slug: 'uncategorized',
                  posts_count: 1,
                  last_posted_at: null,
                  category_id: 999,
                },
              ],
            },
          }),
        ),
      '/categories.json': () =>
        Promise.resolve(
          jsonResponse({
            category_list: { categories: [{ id: 5, name: 'X' }] },
          }),
        ),
    });

    const topics = await provider.getLatestTopics();

    expect(topics).toEqual([
      {
        id: 42,
        title: 'Uncategorized',
        slug: 'uncategorized',
        postsCount: 1,
        lastPostedAt: null,
        categoryName: null,
      },
    ]);
  });

  it('returns [] when topics are malformed (no valid topic survives mapping)', async () => {
    const provider = buildProvider();
    mockFetch({
      '/latest.json': () =>
        Promise.resolve(
          jsonResponse({ topic_list: { topics: [{ foo: 'bar' }] } }),
        ),
      '/categories.json': () =>
        Promise.resolve(jsonResponse({ category_list: { categories: [] } })),
    });

    await expect(provider.getLatestTopics()).resolves.toEqual([]);
  });

  it('returns [] when topic_list is missing entirely', async () => {
    const provider = buildProvider();
    mockFetch({
      '/latest.json': () => Promise.resolve(jsonResponse({ users: [] })),
    });

    await expect(provider.getLatestTopics()).resolves.toEqual([]);
  });

  it('orders topics newest-first (nulls last) regardless of Discourse order', async () => {
    const provider = buildProvider();
    mockFetch({
      '/latest.json': () =>
        Promise.resolve(
          jsonResponse({
            topic_list: {
              topics: [
                {
                  id: 1,
                  title: 'Old',
                  slug: 'old',
                  posts_count: 1,
                  last_posted_at: '2026-01-01T00:00:00.000Z',
                  category_id: null,
                },
                {
                  id: 2,
                  title: 'Null',
                  slug: 'null',
                  posts_count: 1,
                  last_posted_at: null,
                  category_id: null,
                },
                {
                  id: 3,
                  title: 'New',
                  slug: 'new',
                  posts_count: 1,
                  last_posted_at: '2026-07-01T00:00:00.000Z',
                  category_id: null,
                },
              ],
            },
          }),
        ),
      '/categories.json': () =>
        Promise.resolve(jsonResponse({ category_list: { categories: [] } })),
    });

    const topics = await provider.getLatestTopics();

    expect(topics.map((t) => t.id)).toEqual([3, 1, 2]);
  });

  it('returns [] when Discourse rejects the request (never throws)', async () => {
    const provider = buildProvider();
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED') as never);

    await expect(provider.getLatestTopics()).resolves.toEqual([]);
  });

  it('returns [] on a non-2xx response from /latest.json', async () => {
    const provider = buildProvider();
    mockFetch({ '/latest.json': () => Promise.resolve(jsonResponse({}, 500)) });

    await expect(provider.getLatestTopics()).resolves.toEqual([]);
  });
});
