import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  SmitheryInstalledManifestStore,
  createSmitheryConfigSecretStore,
  SMITHERY_CONFIG_SECRET_PREFIX,
  type SmitheryConfigSecretStore,
} from './smithery-installed-manifest';

/** In-memory secret store stand-in (no encryption needed for round-trip). */
function makeSecretStore(): {
  store: SmitheryConfigSecretStore;
  slots: Map<string, string>;
} {
  const slots = new Map<string, string>();
  const store: SmitheryConfigSecretStore = {
    async setConfig(serverKey, configJson) {
      slots.set(serverKey, configJson);
    },
    async getConfig(serverKey) {
      return slots.get(serverKey) ?? null;
    },
    async deleteConfig(serverKey) {
      slots.delete(serverKey);
    },
  };
  return { store, slots };
}

describe('SmitheryInstalledManifestStore', () => {
  let tmpDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smithery-manifest-'));
    manifestPath = path.join(tmpDir, 'smithery-installed.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists only non-secret metadata to the plaintext manifest', async () => {
    const { store } = makeSecretStore();
    const manifest = new SmitheryInstalledManifestStore(store, manifestPath);

    await manifest.install({
      qualifiedName: '@owner/server',
      serverKey: 'smithery_owner_server',
      config: { apiToken: 'super-secret-token', region: 'us' },
      profile: 'prod',
    });

    const onDisk = fs.readFileSync(manifestPath, 'utf-8');
    expect(onDisk).not.toContain('super-secret-token');
    expect(onDisk).toContain('@owner/server');
    expect(onDisk).toContain('smithery_owner_server');

    const parsed = JSON.parse(onDisk);
    const record = parsed.servers['smithery_owner_server'];
    expect(record.source).toBe('smithery');
    expect(record.hasEncryptedConfig).toBe(true);
    expect(record.profile).toBe('prod');
    expect(record).not.toHaveProperty('config');
  });

  it('round-trips the config through the secret store, not the manifest', async () => {
    const { store, slots } = makeSecretStore();
    const manifest = new SmitheryInstalledManifestStore(store, manifestPath);

    await manifest.install({
      qualifiedName: '@owner/server',
      serverKey: 'k1',
      config: { apiToken: 'secret', n: 3, flag: true },
    });

    // Secret blob is in the secret store slot, not the manifest file.
    expect(slots.get('k1')).toContain('secret');

    const config = await manifest.getConfig('k1');
    expect(config).toEqual({ apiToken: 'secret', n: 3, flag: true });
  });

  it('reloads persisted records from disk in a new instance', async () => {
    const { store } = makeSecretStore();
    const first = new SmitheryInstalledManifestStore(store, manifestPath);
    await first.install({
      qualifiedName: '@a/b',
      serverKey: 'k',
      config: {},
    });

    const second = new SmitheryInstalledManifestStore(store, manifestPath);
    const list = second.list();
    expect(list).toHaveLength(1);
    expect(list[0].qualifiedName).toBe('@a/b');
    expect(list[0].hasEncryptedConfig).toBe(false);
  });

  it('uninstall removes the record and its secret slot', async () => {
    const { store, slots } = makeSecretStore();
    const manifest = new SmitheryInstalledManifestStore(store, manifestPath);
    await manifest.install({
      qualifiedName: '@a/b',
      serverKey: 'k',
      config: { secret: 'x' },
    });

    await manifest.uninstall('k');

    expect(manifest.list()).toHaveLength(0);
    expect(slots.has('k')).toBe(false);
  });

  it('getConfig returns empty object when no encrypted config', async () => {
    const { store } = makeSecretStore();
    const manifest = new SmitheryInstalledManifestStore(store, manifestPath);
    await manifest.install({
      qualifiedName: '@a/b',
      serverKey: 'k',
      config: {},
    });

    expect(await manifest.getConfig('k')).toEqual({});
    expect(await manifest.getConfig('missing')).toEqual({});
  });

  describe('Connections API fields (TASK_2026_375 B2)', () => {
    it('persists namespace + connectionId and reads them back through get()', async () => {
      const { store } = makeSecretStore();
      const manifest = new SmitheryInstalledManifestStore(store, manifestPath);

      await manifest.install({
        qualifiedName: 'hubspot',
        serverKey: 'smithery_hubspot',
        config: {},
        namespace: 'abdallah',
        connectionId: 'hubspot',
      });

      expect(manifest.get('smithery_hubspot')).toMatchObject({
        namespace: 'abdallah',
        connectionId: 'hubspot',
      });
    });

    it('leaves both fields undefined for a legacy install', async () => {
      const { store } = makeSecretStore();
      const manifest = new SmitheryInstalledManifestStore(store, manifestPath);

      await manifest.install({
        qualifiedName: '@old/one',
        serverKey: 'smithery_old_one',
        config: {},
      });

      const record = manifest.get('smithery_old_one');
      expect(record?.namespace).toBeUndefined();
      expect(record?.connectionId).toBeUndefined();
    });

    it('get() returns null for a serverKey that is not installed', () => {
      const { store } = makeSecretStore();
      const manifest = new SmitheryInstalledManifestStore(store, manifestPath);
      expect(manifest.get('never-installed')).toBeNull();
    });

    it('get() re-reads a record another instance wrote', async () => {
      const { store } = makeSecretStore();
      const reader = new SmitheryInstalledManifestStore(store, manifestPath);
      const writer = new SmitheryInstalledManifestStore(store, manifestPath);

      await writer.install({
        qualifiedName: 'hubspot',
        serverKey: 'smithery_hubspot',
        config: {},
        namespace: 'abdallah',
        connectionId: 'hubspot',
      });

      expect(reader.get('smithery_hubspot')?.namespace).toBe('abdallah');
    });
  });

  describe('freshness (TASK_2026_375 B1.1)', () => {
    it('sees a record another live instance wrote, without reconstruction', async () => {
      const { store } = makeSecretStore();
      const reader = new SmitheryInstalledManifestStore(store, manifestPath);
      const writer = new SmitheryInstalledManifestStore(store, manifestPath);

      // The reader was constructed BEFORE the write and is never rebuilt.
      expect(reader.list()).toHaveLength(0);

      await writer.install({
        qualifiedName: '@vendor/hubspot',
        serverKey: 'smithery_hubspot',
        config: {},
      });

      const list = reader.list();
      expect(list).toHaveLength(1);
      expect(list[0].serverKey).toBe('smithery_hubspot');
    });

    it('sees an uninstall performed by another live instance', async () => {
      const { store } = makeSecretStore();
      const writer = new SmitheryInstalledManifestStore(store, manifestPath);
      await writer.install({
        qualifiedName: '@a/b',
        serverKey: 'k',
        config: {},
      });

      const reader = new SmitheryInstalledManifestStore(store, manifestPath);
      expect(reader.list()).toHaveLength(1);

      await writer.uninstall('k');

      expect(reader.list()).toHaveLength(0);
    });

    it('does not clobber a record written by another instance', async () => {
      const { store } = makeSecretStore();
      const a = new SmitheryInstalledManifestStore(store, manifestPath);
      const b = new SmitheryInstalledManifestStore(store, manifestPath);

      await a.install({ qualifiedName: '@a/a', serverKey: 'ka', config: {} });
      await b.install({ qualifiedName: '@b/b', serverKey: 'kb', config: {} });

      expect(
        a
          .list()
          .map((r) => r.serverKey)
          .sort(),
      ).toEqual(['ka', 'kb']);
    });

    it('reads the encrypted config of a record written after construction', async () => {
      const { store } = makeSecretStore();
      const reader = new SmitheryInstalledManifestStore(store, manifestPath);
      const writer = new SmitheryInstalledManifestStore(store, manifestPath);

      await writer.install({
        qualifiedName: '@a/b',
        serverKey: 'k',
        config: { apiToken: 'secret' },
      });

      expect(await reader.getConfig('k')).toEqual({ apiToken: 'secret' });
    });

    it('yields an empty list after the manifest file is deleted', async () => {
      const { store } = makeSecretStore();
      const manifest = new SmitheryInstalledManifestStore(store, manifestPath);
      await manifest.install({
        qualifiedName: '@a/b',
        serverKey: 'k',
        config: {},
      });
      expect(manifest.list()).toHaveLength(1);

      fs.rmSync(manifestPath);

      expect(manifest.list()).toEqual([]);
    });

    it('yields an empty list for a corrupt manifest without throwing', async () => {
      const { store } = makeSecretStore();
      const manifest = new SmitheryInstalledManifestStore(store, manifestPath);
      await manifest.install({
        qualifiedName: '@a/b',
        serverKey: 'k',
        config: {},
      });

      fs.writeFileSync(manifestPath, '{ not json', 'utf-8');

      expect(() => manifest.list()).not.toThrow();
      expect(manifest.list()).toEqual([]);
    });

    it('re-parses when a same-millisecond write changed the file size', async () => {
      const { store } = makeSecretStore();
      const reader = new SmitheryInstalledManifestStore(store, manifestPath);

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
              source: 'smithery',
              qualifiedName: '@a/b',
              serverKey: 'k',
              hasEncryptedConfig: false,
              installedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        }),
      );

      expect(reader.list()).toHaveLength(1);
    });
  });

  it('createSmitheryConfigSecretStore routes config to per-server slots', async () => {
    const calls: Array<[string, string, string?]> = [];
    const store = createSmitheryConfigSecretStore({
      getProviderKey: async (id) => {
        calls.push(['get', id]);
        return undefined;
      },
      setProviderKey: async (id, value) => {
        calls.push(['set', id, value]);
      },
      deleteProviderKey: async (id) => {
        calls.push(['delete', id]);
      },
    });

    await store.setConfig('k1', '{"a":1}');
    await store.getConfig('k1');
    await store.deleteConfig('k1');

    const expectedSlot = `${SMITHERY_CONFIG_SECRET_PREFIX}k1`;
    expect(calls).toEqual([
      ['set', expectedSlot, '{"a":1}'],
      ['get', expectedSlot],
      ['delete', expectedSlot],
    ]);
  });
});
