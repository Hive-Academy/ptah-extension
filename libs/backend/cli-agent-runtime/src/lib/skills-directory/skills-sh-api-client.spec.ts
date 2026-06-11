import 'reflect-metadata';

import { SkillsShApiClient, SkillsApiError } from './skills-sh-api-client';
import { SECRET_KEY } from './skills-sh-api.schema';

class StubLogger {
  debug = jest.fn();
  info = jest.fn();
  warn = jest.fn();
  error = jest.fn();
}

class StubSecretStorage {
  readonly store_ = new Map<string, string>();
  get = jest.fn(async (key: string) => this.store_.get(key));
  store = jest.fn(async (key: string, value: string) => {
    this.store_.set(key, value);
  });
  delete = jest.fn(async (key: string) => {
    this.store_.delete(key);
  });
  onDidChange = jest.fn();
}

function makeClient(opts: { key?: string } = {}): {
  client: SkillsShApiClient;
  logger: StubLogger;
  secrets: StubSecretStorage;
} {
  const logger = new StubLogger();
  const secrets = new StubSecretStorage();
  if (opts.key !== undefined) secrets.store_.set(SECRET_KEY, opts.key);
  const client = new SkillsShApiClient(
    logger as unknown as never,
    secrets as unknown as never,
  );
  return { client, logger, secrets };
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

  describe('hasKey', () => {
    it('returns false when no key is configured', async () => {
      const { client } = makeClient();
      expect(await client.hasKey()).toBe(false);
    });

    it('returns true when a non-blank key is configured', async () => {
      const { client } = makeClient({ key: 'sk_live_abc' });
      expect(await client.hasKey()).toBe(true);
    });

    it('treats a whitespace-only key as missing', async () => {
      const { client } = makeClient({ key: '   ' });
      expect(await client.hasKey()).toBe(false);
    });
  });

  describe('search', () => {
    it('returns [] for queries shorter than two characters without calling fetch', async () => {
      const { client } = makeClient({ key: 'sk_live_abc' });
      const fetchMock = jest.fn();
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      expect(await client.search('a')).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps API skills to SkillShEntry and caches the result', async () => {
      const { client } = makeClient({ key: 'sk_live_abc' });
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 'id-1',
              slug: 'react-best-practices',
              name: 'React Best Practices',
              source: 'vercel-labs/agent-skills',
              installs: 1000,
              sourceType: 'github',
              url: 'https://skills.sh/x',
            },
          ],
        }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      const first = await client.search('react');
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        source: 'vercel-labs/agent-skills',
        skillId: 'react-best-practices',
        name: 'React Best Practices',
        installs: 1000,
        isInstalled: false,
      });

      const second = await client.search('react');
      expect(second).toBe(first);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('throws SkillsApiError when no key is configured', async () => {
      const { client } = makeClient();
      await expect(client.search('react')).rejects.toBeInstanceOf(
        SkillsApiError,
      );
    });

    it('throws SkillsApiError on a non-ok response', async () => {
      const { client } = makeClient({ key: 'sk_live_abc' });
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      }) as unknown as typeof globalThis.fetch;

      await expect(client.search('react')).rejects.toBeInstanceOf(
        SkillsApiError,
      );
    });
  });

  describe('invalidateInstallCaches', () => {
    it('drops the popular cache so the next call refetches', async () => {
      const { client } = makeClient({ key: 'sk_live_abc' });
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

      await client.getPopular();
      client.invalidateInstallCaches();
      await client.getPopular();

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
