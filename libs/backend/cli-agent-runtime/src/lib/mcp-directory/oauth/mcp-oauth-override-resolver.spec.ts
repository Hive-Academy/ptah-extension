import { McpOAuthOverrideResolver } from './mcp-oauth-override-resolver';
import type { McpOAuthInstalledManifestStore } from './mcp-oauth-installed-manifest';
import type { McpOAuthConnectedRecord } from '@ptah-extension/shared';

function fakeManifest(
  records: McpOAuthConnectedRecord[],
): McpOAuthInstalledManifestStore {
  return { list: () => records } as unknown as McpOAuthInstalledManifestStore;
}

const record: McpOAuthConnectedRecord = {
  serverKey: 'oauth-mcp.example.com-mcp',
  name: 'Example',
  serverUrl: 'https://mcp.example.com/mcp',
  connectedAt: '2026-01-01T00:00:00.000Z',
};

describe('McpOAuthOverrideResolver', () => {
  it('returns an empty map when the manifest is empty', async () => {
    const resolver = new McpOAuthOverrideResolver({
      manifest: fakeManifest([]),
      service: { getFreshAccessToken: async () => 'tok' },
    });
    expect(await resolver.buildOverrides()).toEqual({});
  });

  it('rebuilds an HTTP override with a bearer header', async () => {
    const resolver = new McpOAuthOverrideResolver({
      manifest: fakeManifest([record]),
      service: { getFreshAccessToken: async () => 'access-abc' },
    });
    const overrides = await resolver.buildOverrides();
    expect(overrides[record.serverKey]).toEqual({
      type: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer access-abc' },
    });
  });

  it('skips records with no valid token (never throws)', async () => {
    const resolver = new McpOAuthOverrideResolver({
      manifest: fakeManifest([record]),
      service: { getFreshAccessToken: async () => null },
    });
    expect(await resolver.buildOverrides()).toEqual({});
  });

  it('isolates a failing record and still resolves the others', async () => {
    const second: McpOAuthConnectedRecord = {
      ...record,
      serverKey: 'oauth-second',
      serverUrl: 'https://second.example.com/mcp',
    };
    const resolver = new McpOAuthOverrideResolver({
      manifest: fakeManifest([record, second]),
      service: {
        getFreshAccessToken: async (key: string) => {
          if (key === record.serverKey) throw new Error('boom');
          return 'ok-token';
        },
      },
    });
    const overrides = await resolver.buildOverrides();
    expect(overrides[record.serverKey]).toBeUndefined();
    expect(overrides['oauth-second']).toEqual({
      type: 'http',
      url: 'https://second.example.com/mcp',
      headers: { Authorization: 'Bearer ok-token' },
    });
  });
});
