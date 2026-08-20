/**
 * `VscodeSettingsAdapter` — the hybrid store, the secret path, and the watches.
 *
 * The sibling spec (`vscode-settings-adapter.tasks-routing.spec.ts`) pins the
 * routing decision for `tasks.*` against a hostile `vscode` double. This one
 * covers the rest of the surface with a *stateful* double, because the
 * behaviours that matter here are round trips, not refusals:
 *
 *  - a non-file-based key must actually reach `vscode.workspace` config,
 *  - a secret must survive encryption and come back byte-identical, and must
 *    be unreadable as plaintext on disk,
 *  - the master key must be fetched ONCE and cached (it is an OS keychain hit),
 *  - `flushSync` must be a no-op when no secret was ever touched, because the
 *    cache is the only thing that can supply the key synchronously,
 *  - a watch must fire for the store the key actually lives in, and for no
 *    other key.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  PtahFileSettingsManager,
  FILE_BASED_SETTINGS_DEFAULTS,
} from '@ptah-extension/platform-core';
import type { IMasterKeyProvider } from '@ptah-extension/platform-core';
import { SecretsFileStore } from '@ptah-extension/settings-core';

import {
  VscodeSettingsAdapter,
  type VscodeApiSlice,
} from './vscode-settings-adapter';
import type { VscodeWorkspaceProvider } from '../implementations/vscode-workspace-provider';

/** A key that is NOT in FILE_BASED_SETTINGS_KEYS, so it routes to vscode. */
const VSCODE_KEY = 'someRegularSetting';
/** A key that IS in FILE_BASED_SETTINGS_KEYS, so it routes to the file store. */
const FILE_KEY = 'authMethod';

type ConfigListener = (e: {
  affectsConfiguration(section: string): boolean;
}) => void;

/**
 * A stateful stand-in for the slice of `vscode` the adapter uses.
 *
 * `update` writes into a map keyed by the FULL `ptah.<key>` name and fires the
 * configuration event, exactly as VS Code does — so a watch registered by the
 * adapter observes a real write rather than a hand-fired event.
 */
function createVscodeDouble(): {
  api: VscodeApiSlice;
  store: Map<string, unknown>;
  updateCalls: Array<{ key: string; value: unknown; target: unknown }>;
  listenerCount(): number;
} {
  const store = new Map<string, unknown>();
  const listeners = new Set<ConfigListener>();
  const updateCalls: Array<{ key: string; value: unknown; target: unknown }> =
    [];

  return {
    store,
    updateCalls,
    listenerCount: () => listeners.size,
    api: {
      workspace: {
        getConfiguration: (section: string) => ({
          get: <T>(key: string): T | undefined =>
            store.get(`${section}.${key}`) as T | undefined,
          update: async (key: string, value: unknown, target: unknown) => {
            updateCalls.push({ key, value, target });
            store.set(`${section}.${key}`, value);
            const full = `${section}.${key}`;
            for (const l of [...listeners]) {
              l({ affectsConfiguration: (s: string) => s === full });
            }
          },
        }),
        onDidChangeConfiguration: (listener: ConfigListener) => {
          listeners.add(listener);
          return { dispose: () => listeners.delete(listener) };
        },
      },
      ConfigurationTarget: { Global: 1 },
    },
  };
}

describe('VscodeSettingsAdapter', () => {
  let ptahDir: string;
  let fileSettings: PtahFileSettingsManager;
  let vscodeDouble: ReturnType<typeof createVscodeDouble>;
  let getMasterKey: jest.Mock<Promise<Buffer>, []>;
  let secretsStore: SecretsFileStore;
  let adapter: VscodeSettingsAdapter;

  const MASTER_KEY = Buffer.alloc(32, 7);

  beforeEach(() => {
    ptahDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-settings-adapter-'));
    fileSettings = new PtahFileSettingsManager(
      FILE_BASED_SETTINGS_DEFAULTS,
      ptahDir,
    );
    vscodeDouble = createVscodeDouble();
    getMasterKey = jest.fn(async () => MASTER_KEY);
    secretsStore = new SecretsFileStore(ptahDir);
    adapter = new VscodeSettingsAdapter(
      { fileSettings } as unknown as VscodeWorkspaceProvider,
      vscodeDouble.api,
      { getMasterKey } as unknown as IMasterKeyProvider,
      secretsStore,
    );
  });

  afterEach(() => {
    fs.rmSync(ptahDir, { recursive: true, force: true });
  });

  describe('global settings routing', () => {
    it('writes a non-file-based key to VS Code config at Global scope', async () => {
      await adapter.writeGlobal(VSCODE_KEY, 'from-vscode');

      expect(vscodeDouble.updateCalls).toEqual([
        { key: VSCODE_KEY, value: 'from-vscode', target: 1 },
      ]);
      expect(adapter.readGlobal(VSCODE_KEY)).toBe('from-vscode');
      // and nothing leaked into ~/.ptah/settings.json
      expect(fs.existsSync(path.join(ptahDir, 'settings.json'))).toBe(false);
    });

    it('writes a file-based key to ~/.ptah/settings.json and never to VS Code', async () => {
      await adapter.writeGlobal(FILE_KEY, 'oauth');

      expect(vscodeDouble.updateCalls).toEqual([]);
      expect(vscodeDouble.store.has(`ptah.${FILE_KEY}`)).toBe(false);
      expect(adapter.readGlobal(FILE_KEY)).toBe('oauth');
    });

    it('returns undefined for a VS Code key that was never written', () => {
      expect(adapter.readGlobal('never.written')).toBeUndefined();
    });
  });

  describe('secrets', () => {
    it('round-trips a secret and leaves no plaintext on disk', async () => {
      await adapter.writeSecret('provider.apiKey', 'sk-super-secret-value');

      expect(await adapter.readSecret('provider.apiKey')).toBe(
        'sk-super-secret-value',
      );

      const onDisk = fs.readFileSync(
        path.join(ptahDir, 'secrets.enc.json'),
        'utf8',
      );
      expect(onDisk).not.toContain('sk-super-secret-value');
      expect(onDisk).toContain('provider.apiKey');
    });

    it('returns undefined for a secret that was never written', async () => {
      expect(await adapter.readSecret('absent')).toBeUndefined();
    });

    it('deletes a secret so a later read misses', async () => {
      await adapter.writeSecret('gone', 'value');
      await adapter.deleteSecret('gone');

      expect(await adapter.readSecret('gone')).toBeUndefined();
    });

    it('fetches the master key exactly once across many secret operations', async () => {
      await adapter.writeSecret('a', '1');
      await adapter.writeSecret('b', '2');
      await adapter.readSecret('a');
      await adapter.readSecret('b');

      // Each call is an OS keychain hit; caching is the whole point.
      expect(getMasterKey).toHaveBeenCalledTimes(1);
    });

    it('does not need the master key to delete', async () => {
      await adapter.deleteSecret('never-existed');

      expect(getMasterKey).not.toHaveBeenCalled();
    });
  });

  describe('flushSync', () => {
    it('flushes file settings even when no secret was ever touched', () => {
      adapter.flushSync();

      // No key was cached, so the secrets file must not have been created —
      // flushSync cannot encrypt without one and must not write garbage.
      expect(fs.existsSync(path.join(ptahDir, 'secrets.enc.json'))).toBe(false);
    });

    it('persists a secret written earlier in the process', async () => {
      await adapter.writeSecret('flushed', 'value');
      fs.rmSync(path.join(ptahDir, 'secrets.enc.json'));

      adapter.flushSync();

      // The cached key from the async write is what makes this possible.
      expect(fs.existsSync(path.join(ptahDir, 'secrets.enc.json'))).toBe(true);
      const reopened = new SecretsFileStore(ptahDir);
      await expect(reopened.read('flushed', MASTER_KEY)).resolves.toBe('value');
    });
  });

  describe('watchGlobal', () => {
    it('fires with the new value when a VS Code key changes', async () => {
      const seen: unknown[] = [];
      const sub = adapter.watchGlobal(VSCODE_KEY, (v) => seen.push(v));

      await adapter.writeGlobal(VSCODE_KEY, 'changed');
      sub.dispose();

      expect(seen).toEqual(['changed']);
    });

    it('ignores changes to a different VS Code key', async () => {
      const seen: unknown[] = [];
      const sub = adapter.watchGlobal(VSCODE_KEY, (v) => seen.push(v));

      await adapter.writeGlobal('someOtherSetting', 'irrelevant');
      sub.dispose();

      expect(seen).toEqual([]);
    });

    it('stops firing and releases the vscode listener after dispose', async () => {
      const seen: unknown[] = [];
      const sub = adapter.watchGlobal(VSCODE_KEY, (v) => seen.push(v));
      expect(vscodeDouble.listenerCount()).toBe(1);

      sub.dispose();
      await adapter.writeGlobal(VSCODE_KEY, 'after-dispose');

      expect(seen).toEqual([]);
      expect(vscodeDouble.listenerCount()).toBe(0);
    });

    it('routes a file-based key to the file settings watcher, not to vscode', async () => {
      const seen: unknown[] = [];
      const sub = adapter.watchGlobal(FILE_KEY, (v) => seen.push(v));

      // No vscode listener was registered at all for this key.
      expect(vscodeDouble.listenerCount()).toBe(0);

      await adapter.writeGlobal(FILE_KEY, 'apiKey');
      sub.dispose();

      expect(seen).toEqual(['apiKey']);
    });
  });

  describe('watchSecret', () => {
    it('returns a disposable that is safe to dispose', () => {
      const sub = adapter.watchSecret('any', () => undefined);

      expect(() => sub.dispose()).not.toThrow();
    });
  });
});
