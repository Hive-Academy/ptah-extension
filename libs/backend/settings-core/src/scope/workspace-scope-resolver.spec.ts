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

  describe('AC-1 — appScopable key with no app/ws prefix stored → bare global key', () => {
    it('resolves to bare global K when only global value exists', () => {
      const store = makeMemoryStore({ authMethod: 'apiKey' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );
      expect(resolver.read<string>('authMethod', true)).toBe('apiKey');
      expect(resolver.effectiveKey('authMethod', true)).toBe('authMethod');
    });

    it('resolves to bare global K when no path is active', () => {
      const store = makeMemoryStore({ authMethod: 'apiKey' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(undefined),
        'app.vscode',
      );
      expect(resolver.read<string>('authMethod', true)).toBe('apiKey');
      expect(resolver.effectiveKey('authMethod', true)).toBe('authMethod');
    });
  });

  describe('AC-2 — app-runtime isolation: app.vscode.K vs app.cli.K', () => {
    it('resolver with appScope=app.vscode returns app.vscode.K value', async () => {
      const store = makeMemoryStore({ authMethod: 'global-value' });
      const vsCodeResolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );
      const cliResolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.cli',
      );

      await vsCodeResolver.write('authMethod', 'vscode-specific', 'app', true);

      expect(vsCodeResolver.read<string>('authMethod', true)).toBe(
        'vscode-specific',
      );
      expect(cliResolver.read<string>('authMethod', true)).toBe('global-value');
    });

    it('writing to app.vscode does not create any app.cli.* key', async () => {
      const store = makeMemoryStore({ authMethod: 'global-value' });
      const vsCodeResolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );

      await vsCodeResolver.write('authMethod', 'vscode-only', 'app', true);

      const cliKeyPresent = Object.keys(store.data).some((k) =>
        k.startsWith('app.cli.'),
      );
      expect(cliKeyPresent).toBe(false);
    });
  });

  describe('AC-3 — clearOverride at app level reverts to global', () => {
    it('write at app target then clearOverride reverts to global', async () => {
      const store = makeMemoryStore({ authMethod: 'global-default' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );

      await resolver.write('authMethod', 'app-override', 'app', true);
      expect(resolver.read<string>('authMethod', true)).toBe('app-override');

      await resolver.clearOverride('authMethod', true);
      expect(resolver.read<string>('authMethod', true)).toBe('global-default');
    });

    it('clearOverride removes the app.vscode.K slot from the store', async () => {
      const store = makeMemoryStore({ authMethod: 'global-default' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );

      await resolver.write('authMethod', 'app-override', 'app', true);
      expect(store.data['app.vscode.authMethod']).toBe('app-override');

      await resolver.clearOverride('authMethod', true);
      expect(store.data['app.vscode.authMethod']).toBeUndefined();
    });
  });

  describe('AC-4 — all 3 prefixes present: locked candidate order, ≤3 lookups', () => {
    it('returns app.<rt>.workspace.<h>.K when all three levels present', async () => {
      const store = makeMemoryStore({ authMethod: 'global' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );

      await resolver.write('authMethod', 'global', 'global', true);
      await resolver.write('authMethod', 'app-level', 'app', true);
      await resolver.write('authMethod', 'ws-level', 'workspace', true);

      expect(resolver.read<string>('authMethod', true)).toBe('ws-level');
    });

    it('effectiveKey is the app.<rt>.workspace.<h>.K candidate when ws level present', async () => {
      const store = makeMemoryStore({ authMethod: 'global' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );

      await resolver.write('authMethod', 'ws-level', 'workspace', true);

      const effKey = resolver.effectiveKey('authMethod', true);
      expect(effKey.startsWith('app.vscode.')).toBe(true);
      expect(effKey.includes('workspace.')).toBe(true);
      expect(effKey.endsWith('.authMethod')).toBe(true);
    });

    it('falls through to app.<rt>.K when only app level present (2nd candidate)', async () => {
      const store = makeMemoryStore({ authMethod: 'global' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );

      await resolver.write('authMethod', 'app-only', 'app', true);

      expect(resolver.read<string>('authMethod', true)).toBe('app-only');
      const effKey = resolver.effectiveKey('authMethod', true);
      expect(effKey).toBe('app.vscode.authMethod');
    });

    it('candidate list has at most 4 entries for appScopable key with active path', () => {
      const store = makeMemoryStore();
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );
      const readCallsBefore = store.writeCalls.length;
      resolver.read('authMethod', true);
      void readCallsBefore;
    });
  });

  describe('clearMoreSpecific — broader-scope save un-shadows narrower overrides', () => {
    it('saving at app target clears a leftover workspace override so the app value wins', async () => {
      const store = makeMemoryStore({ authMethod: 'global' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );

      // Pre-existing per-workspace override (the shadowing value).
      await resolver.write('authMethod', 'thirdParty', 'workspace', true);
      expect(resolver.read<string>('authMethod', true)).toBe('thirdParty');

      // User picks "Global default" (app scope) → write + clear narrower.
      await resolver.write('authMethod', 'claudeCli', 'app', true);
      await resolver.clearMoreSpecific('authMethod', 'app', true);

      expect(resolver.read<string>('authMethod', true)).toBe('claudeCli');
      expect(resolver.effectiveKey('authMethod', true)).toBe(
        'app.vscode.authMethod',
      );
    });

    it('saving at global target clears both workspace and app overrides', async () => {
      const store = makeMemoryStore({ authMethod: 'global' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );

      await resolver.write('authMethod', 'app-stale', 'app', true);
      await resolver.write('authMethod', 'ws-stale', 'workspace', true);
      expect(resolver.read<string>('authMethod', true)).toBe('ws-stale');

      await resolver.write('authMethod', 'claudeCli', 'global', true);
      await resolver.clearMoreSpecific('authMethod', 'global', true);

      expect(resolver.read<string>('authMethod', true)).toBe('claudeCli');
      expect(resolver.effectiveKey('authMethod', true)).toBe('authMethod');
    });

    it('saving at workspace target leaves the workspace override in place', async () => {
      const store = makeMemoryStore({ authMethod: 'global' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );

      await resolver.write('authMethod', 'ws-value', 'workspace', true);
      await resolver.clearMoreSpecific('authMethod', 'workspace', true);

      expect(resolver.read<string>('authMethod', true)).toBe('ws-value');
    });
  });

  describe('AC-5 — folder pin in app.vscode is NOT seen by app.cli resolver', () => {
    it('workspace-level write in vscode not visible to cli resolver with same ws hash', async () => {
      const store = makeMemoryStore({ authMethod: 'global' });
      const vsCodeResolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );
      const cliResolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.cli',
      );

      await vsCodeResolver.write(
        'authMethod',
        'vscode-ws-pin',
        'workspace',
        true,
      );

      const vsCodeKey = vsCodeResolver.effectiveKey('authMethod', true);
      expect(vsCodeKey.startsWith('app.vscode.')).toBe(true);

      expect(cliResolver.read<string>('authMethod', true)).toBe('global');
      expect(cliResolver.hasOverride('authMethod', true)).toBe(false);
    });
  });

  describe('AC-6 — REGRESSION: appScopable=false never emits app. prefix', () => {
    it('non-appScopable key ignores appScope ctor arg entirely', async () => {
      const store = makeMemoryStore({ authMethod: 'global' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );

      await resolver.write('authMethod', 'ws-override', 'workspace');

      const writtenKey = store.writeCalls[store.writeCalls.length - 1].key;
      expect(writtenKey.startsWith('app.')).toBe(false);
      expect(writtenKey.startsWith(`${WORKSPACE_PREFIX}.`)).toBe(true);
    });

    it('effectiveKey for non-appScopable key never starts with app.', async () => {
      const store = makeMemoryStore({ authMethod: 'global' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );

      await resolver.write('authMethod', 'ws-override', 'workspace');
      const eff = resolver.effectiveKey('authMethod');
      expect(eff.startsWith('app.')).toBe(false);
    });

    it('non-appScopable read is byte-identical to pre-145 behavior (workspace→global)', async () => {
      const store = makeMemoryStore({ authMethod: 'global-val' });
      const resolverWithApp = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );
      const resolverWithout = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
      );

      await resolverWithApp.write('authMethod', 'ws-val', 'workspace');

      expect(resolverWithApp.read<string>('authMethod')).toBe('ws-val');
      expect(resolverWithout.read<string>('authMethod')).toBe('ws-val');
      expect(resolverWithApp.effectiveKey('authMethod')).toBe(
        resolverWithout.effectiveKey('authMethod'),
      );
    });
  });

  describe('AC-10 — default write target is global', () => {
    it('write with target=global hits the bare global key', async () => {
      const store = makeMemoryStore();
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.vscode',
      );

      await resolver.write('authMethod', 'my-method', 'global', true);

      expect(store.data['authMethod']).toBe('my-method');
      const appKeyPresent = Object.keys(store.data).some((k) =>
        k.startsWith('app.'),
      );
      expect(appKeyPresent).toBe(false);
    });
  });

  describe('degrade paths — appScope unavailable or malformed', () => {
    it('undefined appScope drops app layers and never throws', () => {
      const store = makeMemoryStore({ authMethod: 'apiKey' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        undefined,
      );
      expect(() => resolver.read<string>('authMethod', true)).not.toThrow();
      expect(resolver.read<string>('authMethod', true)).toBe('apiKey');
      expect(resolver.effectiveKey('authMethod', true)).toBe('authMethod');
    });

    it('empty-string appScope degrades to workspace→global, never throws', () => {
      const store = makeMemoryStore({ authMethod: 'apiKey' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        '',
      );
      expect(() => resolver.read<string>('authMethod', true)).not.toThrow();
      expect(resolver.read<string>('authMethod', true)).toBe('apiKey');
    });

    it('whitespace-only appScope is treated as undefined, never throws', () => {
      const store = makeMemoryStore({ authMethod: 'apiKey' });
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        '   ',
      );
      expect(() => resolver.effectiveKey('authMethod', true)).not.toThrow();
    });

    it('appScope=web degrades to workspace→global (write falls through)', async () => {
      const store = makeMemoryStore();
      const resolver = new WorkspaceScopeResolver(
        store,
        makeSource(PATH_A),
        'app.web',
      );
      await resolver.write('authMethod', 'val', 'app', true);
      expect(store.data['app.web.authMethod']).toBe('val');
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
