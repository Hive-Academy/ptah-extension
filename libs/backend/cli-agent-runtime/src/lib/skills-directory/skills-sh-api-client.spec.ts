import 'reflect-metadata';

import { SkillsShApiClient, SkillsApiError } from './skills-sh-api-client';

class StubLogger {
  debug = jest.fn();
  info = jest.fn();
  warn = jest.fn();
  error = jest.fn();
}

function makeClient(): { client: SkillsShApiClient; logger: StubLogger } {
  const logger = new StubLogger();
  const client = new SkillsShApiClient(logger as unknown as never);
  return { client, logger };
}

const apiSkill = {
  id: 'vercel-labs/agent-skills/vercel-react-best-practices',
  skillId: 'vercel-react-best-practices',
  name: 'vercel-react-best-practices',
  installs: 471810,
  source: 'vercel-labs/agent-skills',
};

/** Requests the description enricher makes against raw.githubusercontent.com. */
function isEnrichmentCall(url: unknown): boolean {
  return typeof url === 'string' && url.startsWith('https://raw.github');
}

/** Calls the client made to the skills.sh API itself. */
function apiCalls(fetchMock: jest.Mock): unknown[][] {
  return fetchMock.mock.calls.filter((call) => !isEnrichmentCall(call[0]));
}

/**
 * Answer the skills.sh API from `body` and every enrichment probe with a 404,
 * so a test asserting on API traffic is not counting best-effort GitHub reads.
 */
function stubApi(body: unknown): jest.Mock {
  return jest.fn(async (url: unknown) => {
    if (isEnrichmentCall(url)) {
      return { ok: false, status: 404, text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => body };
  });
}

describe('SkillsShApiClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('search', () => {
    it('returns [] for queries shorter than two characters without calling fetch', async () => {
      const { client } = makeClient();
      const fetchMock = jest.fn();
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      expect(await client.search('a')).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('calls the public endpoint without an Authorization header', async () => {
      const { client } = makeClient();
      const fetchMock = stubApi({ skills: [] });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await client.search('react');

      const [url, init] = apiCalls(fetchMock)[0] as [string, RequestInit];
      expect(url).toBe('https://skills.sh/api/search?q=react&limit=50');
      expect(init.headers).not.toHaveProperty('Authorization');
    });

    it('maps API skills to SkillShEntry and caches the result', async () => {
      const { client } = makeClient();
      const fetchMock = stubApi({ skills: [apiSkill] });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const first = await client.search('react');
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        source: 'vercel-labs/agent-skills',
        skillId: 'vercel-react-best-practices',
        name: 'Vercel React Best Practices',
        installs: 471810,
        isInstalled: false,
        url: 'https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices',
      });

      const second = await client.search('react');
      expect(second).toBe(first);
      expect(apiCalls(fetchMock)).toHaveLength(1);
    });

    it('caps the limit at the upstream 200-row ceiling', async () => {
      const { client } = makeClient();
      const fetchMock = stubApi({ skills: [] });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      // 50 was OUR cap and was indistinguishable from the marketplace's, so
      // every response looked like a complete answer of exactly 50.
      await client.search('react', 1000);

      expect(apiCalls(fetchMock)[0][0]).toContain('limit=200');
    });

    it('throws SkillsApiError on a non-ok response', async () => {
      const { client } = makeClient();
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({}),
      }) as unknown as typeof globalThis.fetch;

      await expect(client.search('react')).rejects.toBeInstanceOf(
        SkillsApiError,
      );
    });

    it('throws SkillsApiError on a schema mismatch', async () => {
      const { client, logger } = makeClient();
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [apiSkill] }),
      }) as unknown as typeof globalThis.fetch;

      await expect(client.search('react')).rejects.toBeInstanceOf(
        SkillsApiError,
      );
      expect(logger.warn).toHaveBeenCalled();
    });

    // -------------------------------------------------------------------
    // Retry. A single transient failure used to surface as a hard error the
    // caller then turned into an empty result set, so the same query answered
    // "nothing exists" and "50 skills" minutes apart.
    // -------------------------------------------------------------------

    it('retries a 5xx and succeeds on a later attempt', async () => {
      const { client } = makeClient();
      let attempt = 0;
      const fetchMock = jest.fn(async (url: unknown) => {
        if (isEnrichmentCall(url)) {
          return { ok: false, status: 404, text: async () => '' };
        }
        attempt++;
        if (attempt === 1)
          return { ok: false, status: 503, json: async () => ({}) };
        return {
          ok: true,
          status: 200,
          json: async () => ({ skills: [apiSkill] }),
        };
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const skills = await client.search('react');

      expect(skills).toHaveLength(1);
      expect(apiCalls(fetchMock)).toHaveLength(2);
    });

    it('does not retry a 4xx — the request itself is wrong', async () => {
      const { client } = makeClient();
      const fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await expect(client.search('react')).rejects.toBeInstanceOf(
        SkillsApiError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('gives up after three attempts and throws rather than returning []', async () => {
      const { client } = makeClient();
      const fetchMock = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await expect(client.search('react')).rejects.toThrow(/ECONNRESET/);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    // -------------------------------------------------------------------
    // Descriptions. The search API returns none, so every marketplace row
    // arrived blank and install count was the only signal an agent had.
    // -------------------------------------------------------------------

    it('fills a blank description from the skill SKILL.md frontmatter', async () => {
      const { client } = makeClient();
      const fetchMock = jest.fn(async (url: unknown) => {
        if (isEnrichmentCall(url)) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              '---\nname: x\ndescription: Performance rules for React apps.\n---\n\n# Body',
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ skills: [apiSkill] }),
        };
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const [skill] = await client.search('react');

      expect(skill.description).toBe('Performance rules for React apps.');
    });

    it('leaves the description blank when the frontmatter probe fails', async () => {
      const { client } = makeClient();
      const fetchMock = jest.fn(async (url: unknown) => {
        if (isEnrichmentCall(url)) throw new Error('offline');
        return {
          ok: true,
          status: 200,
          json: async () => ({ skills: [apiSkill] }),
        };
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const [skill] = await client.search('react');

      expect(skill.description).toBe('');
    });

    it('prefers a description the API supplies over probing GitHub', async () => {
      const { client } = makeClient();
      const fetchMock = stubApi({
        skills: [{ ...apiSkill, description: 'Straight from the API.' }],
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const [skill] = await client.search('react');

      expect(skill.description).toBe('Straight from the API.');
      expect(
        fetchMock.mock.calls.filter((c) => isEnrichmentCall(c[0])),
      ).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // Paging. `/api/search` accepts no offset, page or cursor — it ACCEPTS and
  // IGNORES all three — but its ranking is prefix-stable and its limit is
  // arbitrary up to 200, so the window is taken client-side over an over-fetch.
  // -------------------------------------------------------------------

  describe('searchPage', () => {
    /** `count` ranked rows named skill-0 … skill-(count-1). */
    function rankedApi(available: number): jest.Mock {
      return jest.fn(async (url: unknown) => {
        if (isEnrichmentCall(url)) {
          return { ok: false, status: 404, text: async () => '' };
        }
        const limit = Number(/limit=(\d+)/.exec(String(url))?.[1] ?? '0');
        const rows = Array.from(
          { length: Math.min(limit, available) },
          (_, i) => ({
            ...apiSkill,
            id: `owner/repo/skill-${i}`,
            skillId: `skill-${i}`,
          }),
        );
        return { ok: true, status: 200, json: async () => ({ skills: rows }) };
      });
    }

    it('requests one row past the window so hasMore is observed, not guessed', async () => {
      const { client } = makeClient();
      const fetchMock = rankedApi(100);
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const page = await client.searchPage('react', 10, 20);

      expect(apiCalls(fetchMock)[0][0]).toContain('limit=31');
      expect(page.skills.map((s) => s.skillId)).toEqual([
        'skill-20',
        'skill-21',
        'skill-22',
        'skill-23',
        'skill-24',
        'skill-25',
        'skill-26',
        'skill-27',
        'skill-28',
        'skill-29',
      ]);
      expect(page).toMatchObject({ offset: 20, limit: 10, hasMore: true });
      expect(page.total).toBeUndefined();
    });

    it('reports a total only once the upstream ran out', async () => {
      const { client } = makeClient();
      globalThis.fetch = rankedApi(7) as unknown as typeof globalThis.fetch;

      const page = await client.searchPage('react', 10);

      expect(page.skills).toHaveLength(7);
      expect(page.hasMore).toBe(false);
      expect(page.total).toBe(7);
      expect(page.limitedByUpstream).toBe(false);
    });

    it('flags the 200-row upstream ceiling and withholds a total there', async () => {
      const { client } = makeClient();
      const fetchMock = rankedApi(1000);
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const page = await client.searchPage('react', 25, 175);

      // Clamped to the measured ceiling rather than asking for 201.
      expect(apiCalls(fetchMock)[0][0]).toContain('limit=200');
      expect(page.skills).toHaveLength(25);
      expect(page.limitedByUpstream).toBe(true);
      expect(page.total).toBeUndefined();
    });

    it('returns an empty exhausted page for a query below the minimum length', async () => {
      const { client } = makeClient();
      const fetchMock = jest.fn();
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const page = await client.searchPage('a', 10);

      expect(page).toMatchObject({ skills: [], total: 0, hasMore: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('clamps a negative offset and a zero limit rather than returning junk', async () => {
      const { client } = makeClient();
      globalThis.fetch = rankedApi(5) as unknown as typeof globalThis.fetch;

      const page = await client.searchPage('react', 0, -10);

      expect(page).toMatchObject({ offset: 0, limit: 1 });
      expect(page.skills).toHaveLength(1);
    });

    it('search() is the first window of searchPage()', async () => {
      const { client } = makeClient();
      globalThis.fetch = rankedApi(80) as unknown as typeof globalThis.fetch;

      const skills = await client.search('react', 10);

      expect(skills.map((s) => s.skillId)).toEqual(
        Array.from({ length: 10 }, (_, i) => `skill-${i}`),
      );
    });
  });

  describe('invalidateInstallCaches', () => {
    it('drops the search cache so the next call refetches', async () => {
      const { client } = makeClient();
      const fetchMock = stubApi({ skills: [] });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await client.search('react');
      client.invalidateInstallCaches();
      await client.search('react');

      expect(apiCalls(fetchMock)).toHaveLength(2);
    });
  });
});
