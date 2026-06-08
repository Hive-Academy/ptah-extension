import { SmitheryConnectionResolver } from './smithery-connection-resolver';
import {
  SmitheryConfigInvalidError,
  SmitheryKeyMissingError,
} from './smithery-errors';
import type { SmitheryRegistrySource } from './smithery-registry.source';
import type { McpRegistryEntry } from '@ptah-extension/shared';

describe('SmitheryConnectionResolver', () => {
  const detailWithSchema = (
    schema?: Record<string, unknown>,
  ): McpRegistryEntry => ({
    name: '@owner/server',
    source: 'smithery',
    connections: schema
      ? [{ type: 'http', configSchema: schema }]
      : [{ type: 'http' }],
  });

  const makeRegistry = (
    detail: McpRegistryEntry | null,
  ): SmitheryRegistrySource =>
    ({
      getServerDetails: jest.fn().mockResolvedValue(detail),
    }) as unknown as SmitheryRegistrySource;

  it('throws SmitheryKeyMissingError when no key', async () => {
    const resolver = new SmitheryConnectionResolver(
      async () => null,
      makeRegistry(detailWithSchema()),
    );
    await expect(
      resolver.resolve({ qualifiedName: '@owner/server', config: {} }),
    ).rejects.toBeInstanceOf(SmitheryKeyMissingError);
  });

  it('builds an http config URL per the documented format', async () => {
    const resolver = new SmitheryConnectionResolver(
      async () => 'my-key',
      makeRegistry(detailWithSchema()),
    );

    const result = await resolver.resolve({
      qualifiedName: '@owner/server',
      config: { token: 'abc' },
      profile: 'prof-1',
    });

    expect(result.type).toBe('http');
    expect(result.url).toContain(
      'https://server.smithery.ai/%40owner/server/mcp',
    );
    expect(result.url).toContain('api_key=my-key');
    expect(result.url).toContain('profile=prof-1');

    const parsed = new URL(result.url);
    const decoded = JSON.parse(
      Buffer.from(parsed.searchParams.get('config') ?? '', 'base64').toString(
        'utf-8',
      ),
    );
    expect(decoded).toEqual({ token: 'abc' });
  });

  it('validates config against the connection configSchema (required missing)', async () => {
    const resolver = new SmitheryConnectionResolver(
      async () => 'k',
      makeRegistry(
        detailWithSchema({
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string' } },
        }),
      ),
    );

    await expect(
      resolver.resolve({ qualifiedName: '@owner/server', config: {} }),
    ).rejects.toBeInstanceOf(SmitheryConfigInvalidError);
  });

  it('validates config type mismatch against schema', async () => {
    const resolver = new SmitheryConnectionResolver(
      async () => 'k',
      makeRegistry(
        detailWithSchema({
          type: 'object',
          properties: { count: { type: 'number' } },
        }),
      ),
    );

    await expect(
      resolver.resolve({
        qualifiedName: '@owner/server',
        config: { count: 'not-a-number' },
      }),
    ).rejects.toBeInstanceOf(SmitheryConfigInvalidError);
  });

  it('passes when config satisfies the schema', async () => {
    const resolver = new SmitheryConnectionResolver(
      async () => 'k',
      makeRegistry(
        detailWithSchema({
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string' } },
        }),
      ),
    );

    const result = await resolver.resolve({
      qualifiedName: '@owner/server',
      config: { token: 'present' },
    });
    expect(result.type).toBe('http');
  });

  it('honors an overridden connection host', async () => {
    const resolver = new SmitheryConnectionResolver(
      async () => 'k',
      makeRegistry(detailWithSchema()),
      { connectionHost: 'https://spike.example.com' },
    );

    const result = await resolver.resolve({
      qualifiedName: '@owner/server',
      config: {},
    });
    expect(result.url).toContain(
      'https://spike.example.com/%40owner/server/mcp',
    );
  });

  it('never logs the key or built URL', async () => {
    const logSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => undefined);
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const errorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const resolver = new SmitheryConnectionResolver(
      async () => 'leak-me-not',
      makeRegistry(detailWithSchema()),
    );
    await resolver.resolve({
      qualifiedName: '@owner/server',
      config: { token: 'x' },
    });

    const all = JSON.stringify([
      logSpy.mock.calls,
      warnSpy.mock.calls,
      errorSpy.mock.calls,
    ]);
    expect(all).not.toContain('leak-me-not');
    expect(all).not.toContain('api_key=');

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
