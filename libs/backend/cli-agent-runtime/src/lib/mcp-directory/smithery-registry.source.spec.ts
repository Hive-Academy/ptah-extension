import { SmitheryRegistrySource } from './smithery-registry.source';
import { SmitheryKeyMissingError } from './smithery-errors';

describe('SmitheryRegistrySource', () => {
  let originalFetch: typeof globalThis.fetch;

  const makeSource = (
    apiKey: string | null,
    registryBase = 'https://registry.smithery.ai',
  ) =>
    new SmitheryRegistrySource({
      getApiKey: async () => apiKey,
      registryBase,
    });

  const mockFetchOnce = (body: unknown, status = 200) => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'OK',
      json: async () => body,
    } as unknown as Response);
    globalThis.fetch = fetchMock;
    return fetchMock;
  };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('throws SmitheryKeyMissingError when no key is configured (list)', async () => {
    const source = makeSource(null);
    await expect(source.listServers()).rejects.toBeInstanceOf(
      SmitheryKeyMissingError,
    );
  });

  it('throws SmitheryKeyMissingError when no key is configured (detail)', async () => {
    const source = makeSource(null);
    await expect(
      source.getServerDetails('@owner/server'),
    ).rejects.toBeInstanceOf(SmitheryKeyMissingError);
  });

  it('sends the Bearer key and 1-indexed page params, mapping fields', async () => {
    const fetchMock = mockFetchOnce({
      servers: [
        {
          qualifiedName: '@owner/server-a',
          displayName: 'Server A',
          description: 'desc a',
          iconUrl: 'https://icon/a.png',
          verified: true,
          useCount: 10,
          bySmithery: true,
          homepage: 'https://server-a.example',
        },
      ],
      pagination: { currentPage: 1, totalPages: 1 },
    });

    const source = makeSource('secret-key');
    const result = await source.listServers({ query: 'github', limit: 5 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://registry.smithery.ai/servers?');
    expect(url).toContain('q=github');
    expect(url).toContain('page=1');
    expect(url).toContain('pageSize=5');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer secret-key',
    );

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('@owner/server-a');
    // displayName is the friendly name; description is the raw description
    // (no longer concatenated into a single string).
    expect(result.servers[0]?.displayName).toBe('Server A');
    expect(result.servers[0]?.description).toBe('desc a');
    expect(result.servers[0]?.icons?.[0]?.src).toBe('https://icon/a.png');
    expect(result.servers[0]?.source).toBe('smithery');
    expect(result.servers[0]?.verified).toBe(true);
    expect(result.servers[0]?.useCount).toBe(10);
    expect(result.servers[0]?.bySmithery).toBe(true);
    expect(result.servers[0]?.homepage).toBe('https://server-a.example');
  });

  it('translates page <-> cursor (decodes cursor to page, encodes next page)', async () => {
    const fetchMock = mockFetchOnce({
      servers: [{ qualifiedName: '@owner/p2' }],
      pagination: { currentPage: 2, totalPages: 5 },
    });

    const source = makeSource('k');
    const result = await source.listServers({ cursor: '2' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('page=2');
    expect(result.next_cursor).toBe('3');
  });

  it('returns no next_cursor on the last page', async () => {
    mockFetchOnce({
      servers: [{ qualifiedName: '@owner/last' }],
      pagination: { currentPage: 5, totalPages: 5 },
    });

    const source = makeSource('k');
    const result = await source.listServers({ cursor: '5' });
    expect(result.next_cursor).toBeUndefined();
  });

  it('tolerates unknown fields via passthrough and drops nameless entries', async () => {
    mockFetchOnce({
      servers: [
        {
          qualifiedName: '@owner/ok',
          brandNewField: 'ignored',
          nested: { a: 1 },
        },
        { displayName: 'no qualifiedName' },
        null,
        42,
      ],
      pagination: { currentPage: 1, totalPages: 1 },
    });

    const source = makeSource('k');
    const result = await source.listServers();
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('@owner/ok');
  });

  it('treats HTTP 429 on list as a transient graceful empty result', async () => {
    mockFetchOnce({}, 429);
    const source = makeSource('k');
    const result = await source.listServers();
    expect(result.servers).toEqual([]);
  });

  it('treats HTTP 429 on detail as graceful null', async () => {
    mockFetchOnce({}, 429);
    const source = makeSource('k');
    const detail = await source.getServerDetails('@owner/server');
    expect(detail).toBeNull();
  });

  it('maps detail connections/configSchema and security.scanPassed', async () => {
    const fetchMock = mockFetchOnce({
      qualifiedName: '@owner/detailed',
      displayName: 'Detailed',
      description: 'A detailed server',
      verified: true,
      useCount: 42,
      bySmithery: false,
      homepage: 'https://detailed.example',
      security: { scanPassed: true },
      connections: [
        {
          type: 'http',
          deploymentUrl: 'https://server.smithery.ai/@owner/detailed/mcp',
          configSchema: {
            type: 'object',
            required: ['token'],
            properties: { token: { type: 'string' } },
          },
        },
      ],
    });

    const source = makeSource('k');
    const detail = await source.getServerDetails('@owner/detailed');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain('/servers/%40owner%2Fdetailed');
    expect(detail?.name).toBe('@owner/detailed');
    // displayName and description are mapped separately (not concatenated).
    expect(detail?.displayName).toBe('Detailed');
    expect(detail?.description).toBe('A detailed server');
    expect(detail?.scanPassed).toBe(true);
    expect(detail?.verified).toBe(true);
    expect(detail?.useCount).toBe(42);
    expect(detail?.bySmithery).toBe(false);
    expect(detail?.homepage).toBe('https://detailed.example');
    expect(detail?.connections?.[0]?.configSchema).toEqual({
      type: 'object',
      required: ['token'],
      properties: { token: { type: 'string' } },
    });
  });

  it('returns null on detail 404', async () => {
    mockFetchOnce({}, 404);
    const source = makeSource('k');
    const detail = await source.getServerDetails('@owner/missing');
    expect(detail).toBeNull();
  });

  it('throws on non-200/404/429 list responses', async () => {
    mockFetchOnce({}, 500);
    const source = makeSource('k');
    await expect(source.listServers()).rejects.toThrow(
      /Smithery registry request failed: 500/,
    );
  });

  it('never logs the api key or built url', async () => {
    const warn = jest.fn();
    mockFetchOnce({}, 429);
    const source = new SmitheryRegistrySource({
      getApiKey: async () => 'super-secret-key',
      logger: { warn },
    });

    await source.listServers({ query: 'x' });

    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain('super-secret-key');
  });

  it('caches popular results for the TTL window', async () => {
    const fetchMock = mockFetchOnce({
      servers: [{ qualifiedName: '@owner/popular' }],
      pagination: { currentPage: 1, totalPages: 1 },
    });

    const source = makeSource('k');
    const first = await source.getPopular();
    const second = await source.getPopular();
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    source.clearCache();
    await source.getPopular();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
