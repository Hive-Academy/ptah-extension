import 'reflect-metadata';
import * as fs from 'fs';
import * as nodeOs from 'os';
import * as path from 'path';

import { PtahFileSettingsManager } from '@ptah-extension/platform-core';
import type { IDisposable } from '@ptah-extension/platform-core';

import type { ISettingsStore } from '../ports/settings-store.interface';
import type { IActiveWorkspaceSource } from './active-workspace-source';
import { WorkspaceScopeResolver } from './workspace-scope-resolver';

const WORKSPACE_PREFIX = 'workspace';

function makeMemoryStore(seed: Record<string, unknown> = {}): ISettingsStore & {
  data: Record<string, unknown>;
  writeCalls: Array<{ key: string; value: unknown }>;
} {
  const data: Record<string, unknown> = { ...seed };
  const writeCalls: Array<{ key: string; value: unknown }> = [];
  return {
    data,
    writeCalls,
    readGlobal<T>(key: string): T | undefined {
      return data[key] as T | undefined;
    },
    async writeGlobal<T>(key: string, value: T): Promise<void> {
      writeCalls.push({ key, value });
      if (value === undefined) {
        delete data[key];
        return;
      }
      data[key] = value;
    },
    readSecret(): Promise<string | undefined> {
      return Promise.resolve(undefined);
    },
    writeSecret(): Promise<void> {
      return Promise.resolve();
    },
    deleteSecret(): Promise<void> {
      return Promise.resolve();
    },
    watchGlobal(): IDisposable {
      return { dispose: () => undefined };
    },
    watchSecret(): IDisposable {
      return { dispose: () => undefined };
    },
    flushSync(): void {
      return undefined;
    },
  };
}

function makeSource(activePath: string | undefined): IActiveWorkspaceSource {
  return {
    getActivePath: () => activePath,
    onDidChange: () => ({ dispose: () => undefined }),
  };
}

describe('WorkspaceScopeResolver', () => {
  const PATH_A = path.resolve(
    process.platform === 'win32' ? 'C:\\wsA' : '/wsA',
  );
  const PATH_B = path.resolve(
    process.platform === 'win32' ? 'C:\\wsB' : '/wsB',
  );

  describe('read fallback and override precedence', () => {
    it('returns the global value when no active path is set', () => {
      const store = makeMemoryStore({ authMethod: 'apiKey' });
      const resolver = new WorkspaceScopeResolver(store, makeSource(undefined));
      expect(resolver.read<string>('authMethod')).toBe('apiKey');
    });

    it('returns the global value when the active folder has no override', () => {
      const store = makeMemoryStore({ authMethod: 'apiKey' });
      const resolver = new WorkspaceScopeResolver(store, makeSource(PATH_A));
      expect(resolver.read<string>('authMethod')).toBe('apiKey');
    });

    it('returns the workspace override when present', async () => {
      const store = makeMemoryStore({ authMethod: 'apiKey' });
      const resolver = new WorkspaceScopeResolver(store, makeSource(PATH_A));
      await resolver.write('authMethod', 'thirdParty', 'workspace');
      expect(resolver.read<string>('authMethod')).toBe('thirdParty');
      expect(store.data['authMethod']).toBe('apiKey');
    });
  });

  describe('write targeting', () => {
    it('write("global") hits the bare global key (non-breaking)', async () => {
      const store = makeMemoryStore();
      const resolver = new WorkspaceScopeResolver(store, makeSource(PATH_A));
      await resolver.write('authMethod', 'claudeCli', 'global');
      expect(store.data['authMethod']).toBe('claudeCli');
      expect(
        Object.keys(store.data).some((k) =>
          k.startsWith(`${WORKSPACE_PREFIX}.`),
        ),
      ).toBe(false);
    });

    it('write("workspace") degrades to the global key when no active path', async () => {
      const store = makeMemoryStore();
      const resolver = new WorkspaceScopeResolver(store, makeSource(undefined));
      await resolver.write('authMethod', 'thirdParty', 'workspace');
      expect(store.data['authMethod']).toBe('thirdParty');
    });
  });

  describe('hasOverride / effectiveKey', () => {
    it('reflects whether the active folder overrides the key', async () => {
      const store = makeMemoryStore({ authMethod: 'apiKey' });
      const resolver = new WorkspaceScopeResolver(store, makeSource(PATH_A));
      expect(resolver.hasOverride('authMethod')).toBe(false);
      await resolver.write('authMethod', 'thirdParty', 'workspace');
      expect(resolver.hasOverride('authMethod')).toBe(true);
    });

    it('effectiveKey returns the global key when no override, prefixed key otherwise', async () => {
      const store = makeMemoryStore({ authMethod: 'apiKey' });
      const resolver = new WorkspaceScopeResolver(store, makeSource(PATH_A));
      expect(resolver.effectiveKey('authMethod')).toBe('authMethod');
      await resolver.write('authMethod', 'thirdParty', 'workspace');
      const eff = resolver.effectiveKey('authMethod');
      expect(eff).not.toBe('authMethod');
      expect(eff.startsWith(`${WORKSPACE_PREFIX}.`)).toBe(true);
      expect(eff.endsWith('.authMethod')).toBe(true);
    });
  });

  describe('no cross-folder bleed', () => {
    it('folder B does not see folder A override; distinct hashes', async () => {
      const store = makeMemoryStore({ authMethod: 'apiKey' });
      const resolverA = new WorkspaceScopeResolver(store, makeSource(PATH_A));
      const resolverB = new WorkspaceScopeResolver(store, makeSource(PATH_B));

      await resolverA.write('authMethod', 'thirdParty', 'workspace');

      expect(resolverA.read<string>('authMethod')).toBe('thirdParty');
      expect(resolverB.read<string>('authMethod')).toBe('apiKey');

      const keyA = resolverA.effectiveKey('authMethod');
      await resolverB.write('authMethod', 'claudeCli', 'workspace');
      const keyB = resolverB.effectiveKey('authMethod');
      expect(keyA).not.toBe(keyB);
    });
  });

  describe('defensive path handling', () => {
    it('undefined active path → global key, no throw', () => {
      const store = makeMemoryStore({ authMethod: 'apiKey' });
      const resolver = new WorkspaceScopeResolver(store, makeSource(undefined));
      expect(() => resolver.effectiveKey('authMethod')).not.toThrow();
      expect(resolver.effectiveKey('authMethod')).toBe('authMethod');
      expect(resolver.hasOverride('authMethod')).toBe(false);
    });

    it('empty / whitespace active path → global key, no throw', () => {
      const store = makeMemoryStore({ authMethod: 'apiKey' });
      const resolverEmpty = new WorkspaceScopeResolver(store, makeSource(''));
      const resolverWs = new WorkspaceScopeResolver(store, makeSource('   '));
      expect(resolverEmpty.read<string>('authMethod')).toBe('apiKey');
      expect(resolverWs.read<string>('authMethod')).toBe('apiKey');
      expect(resolverEmpty.effectiveKey('authMethod')).toBe('authMethod');
    });
  });

  describe('hash properties', () => {
    it('the prefixed key is dot-free in its hash segment', async () => {
      const store = makeMemoryStore();
      const resolver = new WorkspaceScopeResolver(store, makeSource(PATH_A));
      await resolver.write('authMethod', 'thirdParty', 'workspace');
      const written = store.writeCalls[0].key;
      const parts = written.split('.');
      expect(parts[0]).toBe(WORKSPACE_PREFIX);
      expect(parts[1]).toMatch(/^[0-9a-f]{16}$/);
      expect(parts.slice(2).join('.')).toBe('authMethod');
    });

    it('hash is stable across trailing-separator variants', async () => {
      const store = makeMemoryStore();
      const base = process.platform === 'win32' ? 'C:\\wsHash' : '/wsHash';
      const r1 = new WorkspaceScopeResolver(store, makeSource(base));
      const r2 = new WorkspaceScopeResolver(store, makeSource(base + path.sep));
      await r1.write('k', 'v', 'workspace');
      const key1 = store.writeCalls[store.writeCalls.length - 1].key;
      await r2.write('k', 'v', 'workspace');
      const key2 = store.writeCalls[store.writeCalls.length - 1].key;
      expect(key1).toBe(key2);
    });

    it('hash is stable across win32 drive-letter case variants', async () => {
      if (process.platform !== 'win32') {
        return;
      }
      const store = makeMemoryStore();
      const lower = new WorkspaceScopeResolver(store, makeSource('c:\\wsCase'));
      const upper = new WorkspaceScopeResolver(store, makeSource('C:\\wsCase'));
      await lower.write('k', 'v', 'workspace');
      const keyLower = store.writeCalls[store.writeCalls.length - 1].key;
      await upper.write('k', 'v', 'workspace');
      const keyUpper = store.writeCalls[store.writeCalls.length - 1].key;
      expect(keyLower).toBe(keyUpper);
    });
  });

  describe('clearOverride — empirical writeGlobal(undefined) round-trip', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(
        path.join(nodeOs.tmpdir(), 'ptah-ws-scope-resolver-'),
      );
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    });

    function fileStore(manager: PtahFileSettingsManager): ISettingsStore {
      return {
        readGlobal<T>(key: string): T | undefined {
          return manager.get<T>(key);
        },
        async writeGlobal<T>(key: string, value: T): Promise<void> {
          await manager.set(key, value);
        },
        readSecret: () => Promise.resolve(undefined),
        writeSecret: () => Promise.resolve(),
        deleteSecret: () => Promise.resolve(),
        watchGlobal: () => ({ dispose: () => undefined }),
        watchSecret: () => ({ dispose: () => undefined }),
        flushSync: () => manager.flushSync(),
      };
    }

    it('writeGlobal(key, undefined) drops the slot on persist round-trip', async () => {
      const manager = new PtahFileSettingsManager({}, tmpDir);
      const store = fileStore(manager);
      const resolver = new WorkspaceScopeResolver(store, makeSource(PATH_A));

      await resolver.write('authMethod', 'thirdParty', 'workspace');
      expect(resolver.read<string>('authMethod')).toBe('thirdParty');

      await resolver.clearOverride('authMethod');

      const reloaded = new PtahFileSettingsManager({}, tmpDir);

      const raw = fs.readFileSync(manager.getFilePath(), 'utf-8');
      expect(raw).not.toContain('thirdParty');

      const reloadedStore = fileStore(reloaded);
      const reloadedResolver = new WorkspaceScopeResolver(
        reloadedStore,
        makeSource(PATH_A),
      );
      expect(reloadedResolver.hasOverride('authMethod')).toBe(false);
    });

    it('after clearOverride, read falls back to the global value', async () => {
      const manager = new PtahFileSettingsManager({}, tmpDir);
      const store = fileStore(manager);
      await store.writeGlobal('authMethod', 'apiKey');
      const resolver = new WorkspaceScopeResolver(store, makeSource(PATH_A));

      await resolver.write('authMethod', 'thirdParty', 'workspace');
      expect(resolver.read<string>('authMethod')).toBe('thirdParty');

      await resolver.clearOverride('authMethod');
      expect(resolver.read<string>('authMethod')).toBe('apiKey');
    });
  });
});
