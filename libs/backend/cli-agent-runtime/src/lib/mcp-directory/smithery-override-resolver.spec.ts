import {
  SmitheryOverrideResolver,
  SMITHERY_NAMESPACE_OVERRIDE_KEY,
} from './smithery-override-resolver';
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
  namespaceImpl?: (namespace: string) => Promise<McpHttpConfig>,
): SmitheryConnectionResolver {
  return {
    resolve: jest.fn(impl),
    resolveNamespace: jest.fn(
      namespaceImpl ??
        (async (namespace: string) => ({
          type: 'http' as const,
          url: `https://mcp.smithery.run/${namespace}`,
          headers: { Authorization: 'Bearer ns-key' },
        })),
    ),
  } as unknown as SmitheryConnectionResolver;
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

  // ── Connections API namespace override (TASK_2026_375 B2.4) ──────────────

  const connectionsRecord = (
    over: Partial<SmitheryInstalledRecord> = {},
  ): SmitheryInstalledRecord =>
    record({
      namespace: 'abdallah',
      connectionId: 'hubspot',
      qualifiedName: 'hubspot',
      serverKey: 'smithery_hubspot',
      ...over,
    });

  it('emits ONE override keyed "smithery" for Connections-API records', async () => {
    const resolver = makeResolver(async () => ({
      type: 'http',
      url: 'legacy',
    }));
    const r = new SmitheryOverrideResolver({
      manifest: makeManifest([connectionsRecord()]),
      resolver,
    });

    const overrides = await r.buildOverrides();

    expect(Object.keys(overrides)).toEqual([SMITHERY_NAMESPACE_OVERRIDE_KEY]);
    expect(overrides['smithery']).toEqual({
      type: 'http',
      url: 'https://mcp.smithery.run/abdallah',
      headers: { Authorization: 'Bearer ns-key' },
    });
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('collapses several Connections-API records into the same single override', async () => {
    const r = new SmitheryOverrideResolver({
      manifest: makeManifest([
        connectionsRecord(),
        connectionsRecord({
          connectionId: 'sentry',
          serverKey: 'smithery_sentry',
          qualifiedName: 'sentry',
        }),
      ]),
      resolver: makeResolver(async () => ({ type: 'http', url: 'legacy' })),
    });

    expect(Object.keys(await r.buildOverrides())).toEqual([
      SMITHERY_NAMESPACE_OVERRIDE_KEY,
    ]);
  });

  it('keeps the legacy per-server override for records without a namespace', async () => {
    const r = new SmitheryOverrideResolver({
      manifest: makeManifest([
        connectionsRecord(),
        record({ qualifiedName: '@old/one', serverKey: 'smithery_old_one' }),
      ]),
      resolver: makeResolver(async () => ({
        type: 'http',
        url: 'https://server.smithery.ai/@old/one/mcp?api_key=k',
      })),
    });

    const overrides = await r.buildOverrides();

    expect(Object.keys(overrides).sort()).toEqual([
      'smithery',
      'smithery_old_one',
    ]);
    expect(overrides['smithery_old_one'].url).toContain('server.smithery.ai');
  });

  it('treats a record with a namespace but no connectionId as legacy', async () => {
    const r = new SmitheryOverrideResolver({
      manifest: makeManifest([
        record({ namespace: 'abdallah', serverKey: 'half' }),
      ]),
      resolver: makeResolver(async () => ({ type: 'http', url: 'https://ok' })),
    });

    expect(Object.keys(await r.buildOverrides())).toEqual(['half']);
  });

  it('takes the first namespace and warns when records disagree', async () => {
    const warnings: unknown[] = [];
    const r = new SmitheryOverrideResolver({
      manifest: makeManifest([
        connectionsRecord({ namespace: 'first' }),
        connectionsRecord({
          namespace: 'second',
          connectionId: 'other',
          serverKey: 'smithery_other',
        }),
      ]),
      resolver: makeResolver(async () => ({ type: 'http', url: 'legacy' })),
      logger: {
        debug: () => undefined,
        warn: (m: string, c?: Record<string, unknown>) => warnings.push([m, c]),
      },
    });

    const overrides = await r.buildOverrides();

    expect(overrides['smithery'].url).toBe('https://mcp.smithery.run/first');
    expect(JSON.stringify(warnings)).toContain('more than one namespace');
  });

  it('contributes no namespace override when the API key is missing', async () => {
    const r = new SmitheryOverrideResolver({
      manifest: makeManifest([connectionsRecord()]),
      resolver: makeResolver(
        async () => ({ type: 'http', url: 'legacy' }),
        async () => {
          throw new SmitheryKeyMissingError();
        },
      ),
    });

    await expect(r.buildOverrides()).resolves.toEqual({});
  });

  it('never logs the Authorization header or the namespace URL secret', async () => {
    const logged: unknown[] = [];
    const r = new SmitheryOverrideResolver({
      manifest: makeManifest([connectionsRecord()]),
      resolver: makeResolver(
        async () => ({ type: 'http', url: 'legacy' }),
        async (namespace) => ({
          type: 'http',
          url: `https://mcp.smithery.run/${namespace}`,
          headers: { Authorization: 'Bearer LEAKME' },
        }),
      ),
      logger: {
        debug: (m: string, c?: Record<string, unknown>) => logged.push([m, c]),
        warn: (m: string, c?: Record<string, unknown>) => logged.push([m, c]),
      },
    });

    await r.buildOverrides();
    expect(JSON.stringify(logged)).not.toContain('LEAKME');
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
