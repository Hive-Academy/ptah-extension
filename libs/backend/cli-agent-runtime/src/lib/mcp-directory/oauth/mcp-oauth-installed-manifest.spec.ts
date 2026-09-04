import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpOAuthInstalledManifestStore } from './mcp-oauth-installed-manifest';

describe('McpOAuthInstalledManifestStore', () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-manifest-'));
    manifestPath = path.join(tmpDir, 'mcp-oauth-installed.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records and reads back non-secret metadata only', () => {
    const store = new McpOAuthInstalledManifestStore(manifestPath);
    store.record({
      serverKey: 'oauth-mcp.sentry',
      name: 'Sentry',
      serverUrl: 'https://mcp.sentry.dev/mcp',
    });

    const record = store.get('oauth-mcp.sentry');
    expect(record?.serverUrl).toBe('https://mcp.sentry.dev/mcp');
    expect(store.has('oauth-mcp.sentry')).toBe(true);
    expect(store.list()).toHaveLength(1);

    const onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(onDisk.servers['oauth-mcp.sentry']).not.toHaveProperty(
      'accessToken',
    );
  });

  it('remove deletes the record', () => {
    const store = new McpOAuthInstalledManifestStore(manifestPath);
    store.record({ serverKey: 'k', name: 'n', serverUrl: 'https://x/mcp' });
    store.remove('k');
    expect(store.list()).toEqual([]);
    expect(store.has('k')).toBe(false);
  });

  describe('freshness (TASK_2026_375 B1.1)', () => {
    it('sees a record another live instance wrote, without reconstruction', () => {
      const reader = new McpOAuthInstalledManifestStore(manifestPath);
      const writer = new McpOAuthInstalledManifestStore(manifestPath);

      // The reader was constructed BEFORE the write and is never rebuilt.
      expect(reader.list()).toHaveLength(0);

      writer.record({
        serverKey: 'oauth-mcp.hubspot',
        name: 'HubSpot',
        serverUrl: 'https://mcp.hubspot.com',
      });

      expect(reader.has('oauth-mcp.hubspot')).toBe(true);
      expect(reader.get('oauth-mcp.hubspot')?.name).toBe('HubSpot');
      expect(reader.list()).toHaveLength(1);
    });

    it('sees a removal performed by another live instance', () => {
      const writer = new McpOAuthInstalledManifestStore(manifestPath);
      writer.record({ serverKey: 'k', name: 'n', serverUrl: 'https://x/mcp' });

      const reader = new McpOAuthInstalledManifestStore(manifestPath);
      expect(reader.list()).toHaveLength(1);

      writer.remove('k');

      expect(reader.list()).toEqual([]);
      expect(reader.has('k')).toBe(false);
    });

    it('does not clobber a record written by another instance', () => {
      const a = new McpOAuthInstalledManifestStore(manifestPath);
      const b = new McpOAuthInstalledManifestStore(manifestPath);

      a.record({ serverKey: 'ka', name: 'a', serverUrl: 'https://a/mcp' });
      b.record({ serverKey: 'kb', name: 'b', serverUrl: 'https://b/mcp' });

      expect(
        a
          .list()
          .map((r) => r.serverKey)
          .sort(),
      ).toEqual(['ka', 'kb']);
    });

    it('yields an empty list after the manifest file is deleted', () => {
      const store = new McpOAuthInstalledManifestStore(manifestPath);
      store.record({ serverKey: 'k', name: 'n', serverUrl: 'https://x/mcp' });
      expect(store.list()).toHaveLength(1);

      fs.rmSync(manifestPath);

      expect(store.list()).toEqual([]);
      expect(store.get('k')).toBeUndefined();
    });

    it('yields an empty list for a corrupt manifest without throwing', () => {
      const store = new McpOAuthInstalledManifestStore(manifestPath);
      store.record({ serverKey: 'k', name: 'n', serverUrl: 'https://x/mcp' });

      fs.writeFileSync(manifestPath, '{ not json', 'utf-8');

      expect(() => store.list()).not.toThrow();
      expect(store.list()).toEqual([]);
    });

    it('re-parses when a same-millisecond write changed the file size', () => {
      const reader = new McpOAuthInstalledManifestStore(manifestPath);

      // Two writes with the SAME mtime: only the size tells them apart.
      const stamp = new Date(1_700_000_000_000);
      const write = (json: string) => {
        fs.writeFileSync(manifestPath, json, 'utf-8');
        fs.utimesSync(manifestPath, stamp, stamp);
      };
      write(JSON.stringify({ version: 1, servers: {} }));
      expect(reader.list()).toEqual([]);

      write(
        JSON.stringify({
          version: 1,
          servers: {
            k: {
              serverKey: 'k',
              name: 'n',
              serverUrl: 'https://x/mcp',
              connectedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }),
      );

      expect(reader.list()).toHaveLength(1);
    });
  });
});
