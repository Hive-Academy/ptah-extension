import { PulseMcpRegistrySource } from './pulsemcp-registry.source';

describe('PulseMcpRegistrySource', () => {
  let originalFetch: typeof globalThis.fetch;

  const makeSource = (registryBase = 'https://api.pulsemcp.com/v0beta') =>
    new PulseMcpRegistrySource({ registryBase });

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

  it('hits api.pulsemcp.com with query + offset params (no API key)', async () => {
    const fetchMock = mockFetchOnce({
      servers: [
        {
          name: 'autodesk-mcp',
          short_description: 'Autodesk Platform Services MCP',
          source_code_url: 'https://github.com/acme/autodesk-mcp',
          package_registry: 'npm',
          package_name: '@acme/autodesk-mcp',
          github_stars: 42,
        },
      ],
      total_count: 1,
    });

    const source = makeSource();
    const result = await source.listServers({ query: 'autodesk', limit: 5 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('https://api.pulsemcp.com/v0beta/servers?');
    expect(url).toContain('query=autodesk');
    expect(url).toContain('count_per_page=5');
    expect(url).toContain('offset=0');
    // No API key / Authorization header on this source.
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['User-Agent']).toBe('ptah-extension/1.0');

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('autodesk-mcp');
    expect(result.servers[0]?.description).toBe(
      'Autodesk Platform Services MCP',
    );
    expect(result.servers[0]?.source).toBe('pulsemcp');
    // package_registry + source_code_url present → verified heuristic = true.
    expect(result.servers[0]?.verified).toBe(true);
    expect(result.servers[0]?.repository?.url).toBe(
      'https://github.com/acme/autodesk-mcp',
    );
  });

  it('falls back to EXPERIMENTAL_ai_generated_description and marks unverified', async () => {
    mockFetchOnce({
      servers: [
        {
          name: 'community-thing',
          EXPERIMENTAL_ai_generated_description: 'AI-written summary',
        },
      ],
      total_count: 1,
    });

    const source = makeSource();
    const result = await source.listServers({ query: 'thing' });
    expect(result.servers[0]?.description).toBe('AI-written summary');
    // No package_registry / source_code_url → not verified.
    expect(result.servers[0]?.verified).toBe(false);
    expect(result.servers[0]?.repository).toBeUndefined();
  });

  it('encodes offset-based pagination into the opaque cursor', async () => {
    const fetchMock = mockFetchOnce({
      servers: [{ name: 'p1' }, { name: 'p2' }],
      total_count: 10,
    });

    const source = makeSource();
    // limit 2, offset 0 → 0+2 < 10 → next cursor "2".
    const first = await source.listServers({ limit: 2 });
    expect(fetchMock.mock.calls[0]?.[0] as string).toContain('offset=0');
    expect(first.next_cursor).toBe('2');

    // Now request the next page using the returned cursor.
    mockFetchOnce({
      servers: [{ name: 'p3' }, { name: 'p4' }],
      total_count: 10,
    });
    const second = await source.listServers({ limit: 2, cursor: '2' });
    expect(
      (globalThis.fetch as jest.Mock).mock.calls[0]?.[0] as string,
    ).toContain('offset=2');
    expect(second.next_cursor).toBe('4');
  });

  it('uses the server-provided `next` marker to emit a cursor', async () => {
    mockFetchOnce({
      servers: [{ name: 'a' }],
      next: 'https://api.pulsemcp.com/v0beta/servers?offset=20',
    });
    const source = makeSource();
    const result = await source.listServers({ limit: 20 });
    expect(result.next_cursor).toBe('20');
  });

  it('returns no next_cursor on the last page (offset+page >= total)', async () => {
    mockFetchOnce({
      servers: [{ name: 'only' }],
      total_count: 1,
    });
    const source = makeSource();
    const result = await source.listServers({ limit: 20 });
    expect(result.next_cursor).toBeUndefined();
  });

  it('tolerates unknown fields via passthrough and drops nameless entries', async () => {
    mockFetchOnce({
      servers: [
        { name: 'ok-server', brandNewField: 'ignored', nested: { a: 1 } },
        { short_description: 'no name' },
        null,
        42,
      ],
      total_count: 1,
    });

    const source = makeSource();
    const result = await source.listServers();
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('ok-server');
  });

  it('treats HTTP 429 on list as a transient graceful empty result', async () => {
    mockFetchOnce({}, 429);
    const source = makeSource();
    const result = await source.listServers();
    expect(result.servers).toEqual([]);
  });

  it('returns empty list when body has no servers field', async () => {
    mockFetchOnce({});
    const source = makeSource();
    const result = await source.listServers();
    expect(result.servers).toEqual([]);
    expect(result.next_cursor).toBeUndefined();
  });

  it('throws on non-200/404/429 list responses', async () => {
    mockFetchOnce({}, 500);
    const source = makeSource();
    await expect(source.listServers()).rejects.toThrow(
      /PulseMCP registry request failed: 500/,
    );
  });

  it('getServerDetails best-effort returns the matching list entry', async () => {
    mockFetchOnce({
      servers: [
        { name: 'other' },
        { name: 'wanted', short_description: 'the one' },
      ],
      total_count: 2,
    });
    const source = makeSource();
    const detail = await source.getServerDetails('wanted');
    expect(detail?.name).toBe('wanted');
    expect(detail?.description).toBe('the one');
  });

  it('getServerDetails returns null when no entry matches', async () => {
    mockFetchOnce({ servers: [{ name: 'other' }], total_count: 1 });
    const source = makeSource();
    const detail = await source.getServerDetails('missing');
    expect(detail).toBeNull();
  });

  it('getServerDetails returns null gracefully on fetch error', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('boom'));
    const source = makeSource();
    const detail = await source.getServerDetails('whatever');
    expect(detail).toBeNull();
  });

  it('caches popular results for the TTL window', async () => {
    const fetchMock = mockFetchOnce({
      servers: [{ name: 'popular' }],
      total_count: 1,
    });

    const source = makeSource();
    const first = await source.getPopular();
    const second = await source.getPopular();
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    source.clearCache();
    await source.getPopular();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
