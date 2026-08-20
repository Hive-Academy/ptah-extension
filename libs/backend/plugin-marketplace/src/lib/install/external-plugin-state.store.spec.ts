/**
 * The store IS the allowlist, so these tests are about one question:
 * under what circumstances does `isInstalled` say yes?
 *
 * The answer must be "only when a consent record exists" — never because a
 * directory turned up, never because the file was unreadable and we guessed.
 */

import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ExternalPluginStateStore } from './external-plugin-state.store';
import { externalPluginDir } from './external-plugin-id';

const PLUGIN_ID = 'external:dotnet/skills/dotnet-test';

function record(overrides: Record<string, unknown> = {}) {
  return {
    pluginId: PLUGIN_ID,
    source: 'dotnet/skills',
    plugin: 'dotnet-test',
    displayName: 'Dotnet Test',
    version: '1.0.0',
    installedAt: '2026-08-17T00:00:00.000Z',
    consentToken: 'a'.repeat(64),
    files: ['skills/run-tests/SKILL.md'],
    skippedBinaryFiles: [],
    mcpServers: [],
    ...overrides,
  };
}

describe('ExternalPluginStateStore', () => {
  let tmpDir: string;
  let pluginsBasePath: string;
  let store: ExternalPluginStateStore;

  beforeEach(async () => {
    tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'ptah-store-'));
    pluginsBasePath = path.join(tmpDir, 'plugins');
    await fsPromises.mkdir(pluginsBasePath, { recursive: true });
    store = new ExternalPluginStateStore();
    store.initialize(pluginsBasePath);
  });

  afterEach(async () => {
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  });

  describe('the allowlist', () => {
    it('says no for an id that was never installed', () => {
      expect(store.isInstalled(PLUGIN_ID)).toBe(false);
    });

    it('says yes only after a record is written', async () => {
      await store.recordInstall(record());

      expect(store.isInstalled(PLUGIN_ID)).toBe(true);
    });

    it('says no again after the record is removed', async () => {
      await store.recordInstall(record());
      await store.removeInstall(PLUGIN_ID);

      expect(store.isInstalled(PLUGIN_ID)).toBe(false);
    });

    it('IGNORES a directory that appears without a record', async () => {
      // The whole point. Anything that can drop files into ~/.ptah/plugins —
      // a half-finished install, an unpacked archive, another tool — must not
      // thereby become loadable plugin code.
      const dir = externalPluginDir(pluginsBasePath, {
        owner: 'dotnet',
        repo: 'skills',
        plugin: 'dotnet-test',
      });
      await fsPromises.mkdir(path.join(dir, 'skills', 'evil'), {
        recursive: true,
      });
      await fsPromises.writeFile(
        path.join(dir, 'skills', 'evil', 'SKILL.md'),
        '---\nname: evil\n---\n',
        'utf-8',
      );

      expect(store.isInstalled(PLUGIN_ID)).toBe(false);
      expect(store.listInstalled()).toEqual([]);
    });

    it('rejects a structurally invalid id even if one were persisted', async () => {
      await store.recordInstall(
        record({ pluginId: 'external:dotnet/skills/..' }),
      );

      expect(store.isInstalled('external:dotnet/skills/..')).toBe(false);
    });

    it('reports nothing at all before initialize', () => {
      const uninitialized = new ExternalPluginStateStore();

      expect(uninitialized.isInstalled(PLUGIN_ID)).toBe(false);
      expect(uninitialized.listInstalled()).toEqual([]);
      expect(uninitialized.listMarketplaces()).toEqual([]);
    });
  });

  describe('fails closed on a damaged state file', () => {
    async function writeStateFile(contents: string): Promise<void> {
      const filePath = store.stateFilePath;
      if (!filePath) throw new Error('store not initialized');
      await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
      await fsPromises.writeFile(filePath, contents, 'utf-8');
    }

    it.each([
      ['malformed JSON', '{ not json'],
      [
        'wrong schema version',
        '{"version":9,"marketplaces":[],"installed":[]}',
      ],
      ['missing installed array', '{"version":1,"marketplaces":[]}'],
      [
        'installed is not an array',
        '{"version":1,"marketplaces":[],"installed":{}}',
      ],
      ['empty file', ''],
    ])('denies everything when the file is %s', async (_label, contents) => {
      await writeStateFile(contents);

      expect(store.isInstalled(PLUGIN_ID)).toBe(false);
      expect(store.listInstalled()).toEqual([]);
    });
  });

  describe('marketplaces', () => {
    const marketplace = {
      source: 'dotnet/skills',
      name: 'dotnet-agent-skills',
      owner: 'dotnet',
      pluginCount: 16,
      addedAt: '2026-08-17T00:00:00.000Z',
    };

    it('round-trips through the file', async () => {
      await store.upsertMarketplace(marketplace);

      expect(store.findMarketplace('dotnet/skills')).toMatchObject({
        name: 'dotnet-agent-skills',
        pluginCount: 16,
      });
    });

    it('replaces rather than duplicates on re-add', async () => {
      await store.upsertMarketplace(marketplace);
      await store.upsertMarketplace({ ...marketplace, pluginCount: 17 });

      expect(store.listMarketplaces()).toHaveLength(1);
      expect(store.listMarketplaces()[0].pluginCount).toBe(17);
    });

    it('keeps installed plugins when a marketplace is deregistered', async () => {
      // Removing a catalogue must not silently revoke consent the user gave
      // per-plugin — otherwise "remove marketplace" is a destructive action
      // wearing the label of a bookkeeping one.
      await store.upsertMarketplace(marketplace);
      await store.recordInstall(record());

      await expect(store.removeMarketplace('dotnet/skills')).resolves.toBe(
        true,
      );

      expect(store.listMarketplaces()).toEqual([]);
      expect(store.isInstalled(PLUGIN_ID)).toBe(true);
    });

    it('reports false when removing something that was not registered', async () => {
      await expect(store.removeMarketplace('nobody/nothing')).resolves.toBe(
        false,
      );
    });

    it('serializes concurrent writes without losing any', async () => {
      await Promise.all([
        store.upsertMarketplace({ ...marketplace, source: 'a/one' }),
        store.upsertMarketplace({ ...marketplace, source: 'b/two' }),
        store.upsertMarketplace({ ...marketplace, source: 'c/three' }),
      ]);

      expect(
        store
          .listMarketplaces()
          .map((m) => m.source)
          .sort(),
      ).toEqual(['a/one', 'b/two', 'c/three']);
    });
  });
});
