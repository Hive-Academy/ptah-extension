import { SmitheryOverrideResolver } from './smithery-override-resolver';
import { SmitheryKeyMissingError } from './smithery-errors';
import type { SmitheryConnectionResolver } from './smithery-connection-resolver';
import type { SmitheryInstalledManifestStore } from './smithery-installed-manifest';
import type {
  McpHttpConfig,
  SmitheryInstalledRecord,
} from '@ptah-extension/shared';

function makeManifest(
  records: SmitheryInstalledRecord[],
  configs: Record<string, Record<string, unknown>> = {},
): SmitheryInstalledManifestStore {
  return {
    list: jest.fn().mockReturnValue(records),
    getConfig: jest.fn(async (serverKey: string) => configs[serverKey] ?? {}),
  } as unknown as SmitheryInstalledManifestStore;
}

function makeResolver(
  impl: (input: {
    qualifiedName: string;
    config: Record<string, unknown>;
    profile?: string;
  }) => Promise<McpHttpConfig>,
): SmitheryConnectionResolver {
  return { resolve: jest.fn(impl) } as unknown as SmitheryConnectionResolver;
}

const record = (
  over: Partial<SmitheryInstalledRecord> = {},
): SmitheryInstalledRecord => ({
  source: 'smithery',
  qualifiedName: '@owner/server',
  serverKey: 'smithery_owner_server',
  hasEncryptedConfig: true,
  installedAt: '2026-05-28T00:00:00.000Z',
  ...over,
});

describe('SmitheryOverrideResolver', () => {
  it('returns an empty map for an empty manifest (no contribution)', async () => {
    const r = new SmitheryOverrideResolver({
      manifest: makeManifest([]),
      resolver: makeResolver(async () => ({ type: 'http', url: 'x' })),
    });
    expect(await r.buildOverrides()).toEqual({});
  });

  it('builds an override keyed by serverKey from each record', async () => {
    const resolver = makeResolver(async (input) => ({
      type: 'http',
      url: `https://server.smithery.ai/${input.qualifiedName}/mcp?api_key=k&config=cc`,
      headers: { 'X-Test': '1' },
    }));
    const r = new SmitheryOverrideResolver({
      manifest: makeManifest([record()], {
        smithery_owner_server: { token: 'abc' },
      }),
      resolver,
    });

    const overrides = await r.buildOverrides();

    expect(Object.keys(overrides)).toEqual(['smithery_owner_server']);
    expect(overrides['smithery_owner_server']).toEqual({
      type: 'http',
      url: 'https://server.smithery.ai/@owner/server/mcp?api_key=k&config=cc',
      headers: { 'X-Test': '1' },
    });
    expect(resolver.resolve).toHaveBeenCalledWith({
      qualifiedName: '@owner/server',
      config: { token: 'abc' },
      profile: undefined,
    });
  });

  it('contributes nothing when the API key is missing (no throw)', async () => {
    const r = new SmitheryOverrideResolver({
      manifest: makeManifest([record()]),
      resolver: makeResolver(async () => {
        throw new SmitheryKeyMissingError();
      }),
    });
    await expect(r.buildOverrides()).resolves.toEqual({});
  });

  it('skips a record that fails to resolve but keeps the rest', async () => {
    const resolver = makeResolver(async (input) => {
      if (input.qualifiedName === '@bad/one') throw new Error('boom');
      return { type: 'http', url: 'https://ok/mcp' };
    });
    const r = new SmitheryOverrideResolver({
      manifest: makeManifest([
        record({ qualifiedName: '@bad/one', serverKey: 'bad' }),
        record({ qualifiedName: '@good/two', serverKey: 'good' }),
      ]),
      resolver,
    });

    const overrides = await r.buildOverrides();
    expect(Object.keys(overrides)).toEqual(['good']);
  });

  it('does not log the resolved URL or key', async () => {
    const logged: unknown[] = [];
    const logger = {
      debug: (m: string, c?: Record<string, unknown>) => logged.push([m, c]),
      warn: (m: string, c?: Record<string, unknown>) => logged.push([m, c]),
    };
    const r = new SmitheryOverrideResolver({
      manifest: makeManifest([record()], {
        smithery_owner_server: { token: 'abc' },
      }),
      resolver: makeResolver(async () => ({
        type: 'http',
        url: 'https://server.smithery.ai/x/mcp?api_key=LEAK&config=ZZ',
      })),
      logger,
    });

    await r.buildOverrides();
    const all = JSON.stringify(logged);
    expect(all).not.toContain('LEAK');
    expect(all).not.toContain('config=ZZ');
  });
});
