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
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ skills: [] }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await client.search('react');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://skills.sh/api/search?q=react&limit=50');
      expect(init.headers).not.toHaveProperty('Authorization');
    });

    it('maps API skills to SkillShEntry and caches the result', async () => {
      const { client } = makeClient();
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ skills: [apiSkill] }),
      });
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
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('caps the limit at 50', async () => {
      const { client } = makeClient();
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ skills: [] }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await client.search('react', 200);

      expect(fetchMock.mock.calls[0][0]).toContain('limit=50');
    });

    it('throws SkillsApiError on a non-ok response', async () => {
      const { client } = makeClient();
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
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
  });

  describe('invalidateInstallCaches', () => {
    it('drops the search cache so the next call refetches', async () => {
      const { client } = makeClient();
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ skills: [] }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await client.search('react');
      client.invalidateInstallCaches();
      await client.search('react');

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
