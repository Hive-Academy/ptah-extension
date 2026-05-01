import { McpRegistryProvider } from './mcp-registry.provider';

describe('McpRegistryProvider response shape handling', () => {
  let provider: McpRegistryProvider;
  let originalFetch: typeof globalThis.fetch;

  const mockFetchOnce = (body: unknown) => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    } as unknown as Response);
  };

  beforeEach(() => {
    provider = new McpRegistryProvider();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('parses the current envelope shape ({ servers: [{ server, _meta }] })', async () => {
    mockFetchOnce({
      servers: [
        {
          server: {
            name: 'io.github.acme/server-a',
            description: 'Server A',
          },
          _meta: { 'io.modelcontextprotocol.registry/official': {} },
        },
        {
          server: {
            name: 'io.github.acme/server-b',
            description: 'Server B',
          },
          _meta: {},
        },
      ],
      metadata: { next_cursor: 'cursor-xyz' },
    });

    const result = await provider.listServers();

    expect(result.servers).toHaveLength(2);
    expect(result.servers[0]?.name).toBe('io.github.acme/server-a');
    expect(result.servers[0]?.description).toBe('Server A');
    expect(result.next_cursor).toBe('cursor-xyz');
  });

  it('still parses the legacy flat shape ({ servers: [{ name, description }] })', async () => {
    mockFetchOnce({
      servers: [{ name: 'io.github.acme/legacy', description: 'Legacy entry' }],
      next_cursor: 'top-level-cursor',
    });

    const result = await provider.listServers();

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('io.github.acme/legacy');
    expect(result.next_cursor).toBe('top-level-cursor');
  });

  it('drops entries that lack a usable name instead of rendering blanks', async () => {
    mockFetchOnce({
      servers: [
        { server: { description: 'no name here' } },
        null,
        { server: { name: '', description: 'empty name' } },
        { server: { name: 'io.github.acme/ok', description: 'ok' } },
      ],
    });

    const result = await provider.listServers();

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]?.name).toBe('io.github.acme/ok');
  });

  it('unwraps server details from { server: {...} } envelope', async () => {
    mockFetchOnce({
      server: {
        name: 'io.github.acme/details',
        description: 'Details entry',
      },
      _meta: {},
    });

    const detail = await provider.getServerDetails('io.github.acme/details');
    expect(detail?.name).toBe('io.github.acme/details');
  });
});
