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
