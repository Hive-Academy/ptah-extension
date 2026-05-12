/**
 * WP-2T Batch 2 validation — settings-core comprehensive test suite.
 *
 * TC-1  through TC-14: settings-core lib internals.
 * TC-18: isolation guarantee (zero call sites outside the lib).
 *
 * TC-15 / TC-16 for PtahFileSettingsManager.watch() live in
 *   libs/backend/platform-core/src/file-settings-manager.spec.ts.
 * TC-17 for adapter Phase-4 sentinels lives in
 *   libs/backend/platform-electron/src/settings/file-settings-store.spec.ts.
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as nodeOs from 'os';
import * as path from 'path';
import { ZodError } from 'zod';

// ---------------------------------------------------------------------------
// Sandbox homedir for migration tests that touch the filesystem.
// ---------------------------------------------------------------------------

const mockTestHome = fs.mkdtempSync(
  path.join(nodeOs.tmpdir(), 'ptah-settings-core-spec-'),
);

afterAll(() => {
  try {
    fs.rmSync(mockTestHome, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import { defineSetting } from './schema/definition';
import { SETTINGS_SCHEMA } from './schema/index';
import { AUTH_METHOD_DEF } from './schema/auth-schema';
import { ReactiveSettingsStore } from './reactive/reactive-settings-store';
import { BaseSettingsRepository } from './repositories/base-repository';
import { ComputedSettingHandle } from './repositories/computed-setting-handle';
import { MigrationRunner } from './migrations/runner';
import { runV2Migration } from './migrations/v2-migration';
import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import type { ISettingsStore } from './ports/settings-store.interface';
import type { IDisposable } from '@ptah-extension/platform-core';
import { providerSelectedModelDef } from './schema/provider-schema';

// ---------------------------------------------------------------------------
// Shared mock store — avoids TS generic overload issues by using a hand-built
// object that conforms to ISettingsStore without jest.Mocked<> complications.
// ---------------------------------------------------------------------------

interface MockStore extends ISettingsStore {
  _fire(key: string, value: unknown): void;
  _writeGlobalCalls: Array<{ key: string; value: unknown }>;
}

function makeMockStore(globalData: Record<string, unknown> = {}): MockStore {
  const data = { ...globalData };
  const watchers = new Map<string, Set<(v: unknown) => void>>();
  const writeGlobalCalls: Array<{ key: string; value: unknown }> = [];

  const store: MockStore = {
    _writeGlobalCalls: writeGlobalCalls,

    readGlobal<T>(key: string): T | undefined {
      return data[key] as T | undefined;
    },

    async writeGlobal<T>(key: string, value: T): Promise<void> {
      data[key] = value;
      writeGlobalCalls.push({ key, value: value as unknown });
      watchers.get(key)?.forEach((cb) => cb(value as unknown));
    },

    readSecret(_key: string): Promise<string | undefined> {
      throw new Error('Phase 4');
    },

    writeSecret(_key: string, _ciphertext: string): Promise<void> {
      throw new Error('Phase 4');
    },

    deleteSecret(_key: string): Promise<void> {
      throw new Error('Phase 4');
    },

    watchGlobal(key: string, cb: (value: unknown) => void): IDisposable {
      if (!watchers.has(key)) watchers.set(key, new Set());
      watchers.get(key)!.add(cb);
      return {
        dispose: () => {
          watchers.get(key)?.delete(cb);
        },
      };
    },

    watchSecret(_key: string, _cb: () => void): IDisposable {
      return { dispose: () => {} };
    },

    flushSync(): void {
      // no-op for tests
    },

    _fire(key: string, value: unknown): void {
      data[key] = value;
      watchers.get(key)?.forEach((cb) => cb(value));
    },
  };

  return store;
}

// ---------------------------------------------------------------------------
// TC-1: Schema sanity — every definition has required fields, no duplicate keys
// ---------------------------------------------------------------------------

describe('TC-1: SETTINGS_SCHEMA sanity', () => {
  const requiredFields = [
    'key',
    'scope',
    'sensitivity',
    'schema',
    'default',
    'sinceVersion',
  ];

  it('every definition has all required fields', () => {
    expect(SETTINGS_SCHEMA.length).toBeGreaterThan(0);
    for (const def of SETTINGS_SCHEMA) {
      for (const field of requiredFields) {
        expect(def).toHaveProperty(field);
      }
    }
  });

  it('no duplicate keys in SETTINGS_SCHEMA', () => {
    const keys = (SETTINGS_SCHEMA as Array<{ key: string }>).map((d) => d.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it('all scope values are valid', () => {
    const validScopes = new Set(['global', 'secret', 'session']);
    for (const def of SETTINGS_SCHEMA as Array<{ scope: string }>) {
      expect(validScopes.has(def.scope)).toBe(true);
    }
  });

  it('all sensitivity values are valid', () => {
    const validSensitivities = new Set(['plain', 'encrypted', 'secret']);
    for (const def of SETTINGS_SCHEMA as Array<{ sensitivity: string }>) {
      expect(validSensitivities.has(def.sensitivity)).toBe(true);
    }
  });

  it('sinceVersion is a positive integer for all definitions', () => {
    for (const def of SETTINGS_SCHEMA as Array<{ sinceVersion: unknown }>) {
      expect(typeof def.sinceVersion).toBe('number');
      expect(def.sinceVersion as number).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-2: defineSetting produces frozen definitions
// ---------------------------------------------------------------------------

describe('TC-2: defineSetting returns frozen objects', () => {
  it('Object.isFrozen returns true for AUTH_METHOD_DEF', () => {
    expect(Object.isFrozen(AUTH_METHOD_DEF)).toBe(true);
  });

  it('a custom definition produced by defineSetting is also frozen', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { z } = require('zod') as typeof import('zod');
    const def = defineSetting({
      key: 'test.frozen',
      scope: 'global',
      sensitivity: 'plain',
      schema: z.string(),
      default: 'default-value',
      sinceVersion: 1,
    });
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('frozen definition throws when mutation is attempted in strict mode', () => {
    expect(() => {
      (AUTH_METHOD_DEF as unknown as Record<string, unknown>)['key'] =
        'mutated';
    }).toThrow();
    expect(AUTH_METHOD_DEF.key).toBe('authMethod');
  });
});

// ---------------------------------------------------------------------------
// TC-3: ReactiveSettingsStore fires listeners on write
// ---------------------------------------------------------------------------

describe('TC-3: ReactiveSettingsStore fires listeners on writeGlobal', () => {
  it('watcher callback is called with the written value', async () => {
    const backend = makeMockStore();
    const store = new ReactiveSettingsStore(backend);

    const received: unknown[] = [];
    store.watchGlobal('foo', (v) => received.push(v));

    await store.writeGlobal('foo', 'bar');

    expect(received).toEqual(['bar']);
  });
});

// ---------------------------------------------------------------------------
// TC-4: ReactiveSettingsStore — watchers only fire for the watched key
// ---------------------------------------------------------------------------

describe('TC-4: ReactiveSettingsStore listener isolation', () => {
  it('only the watcher for the written key fires', async () => {
    const backend = makeMockStore();
    const store = new ReactiveSettingsStore(backend);

    const receivedFoo: unknown[] = [];
    const receivedBaz: unknown[] = [];
    store.watchGlobal('foo', (v) => receivedFoo.push(v));
    store.watchGlobal('baz', (v) => receivedBaz.push(v));

    await store.writeGlobal('foo', 'updated');

    expect(receivedFoo).toEqual(['updated']);
    expect(receivedBaz).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TC-5: SettingHandle.get() returns schema default when store is empty
// ---------------------------------------------------------------------------

describe('TC-5: SettingHandle.get() returns definition default for empty store', () => {
  it('returns the AUTH_METHOD_DEF default ("apiKey") when nothing is stored', () => {
    class TestRepo extends BaseSettingsRepository {
      public readonly handle = this.handleFor(AUTH_METHOD_DEF);
    }
    const testRepo = new TestRepo(makeMockStore({}));
    expect(testRepo.handle.get()).toBe('apiKey');
  });
});

// ---------------------------------------------------------------------------
// TC-6: SettingHandle.set() validates via Zod — throws ZodError for invalid value
// ---------------------------------------------------------------------------

describe('TC-6: SettingHandle.set() throws ZodError for invalid enum value', () => {
  it('rejects an invalid auth method value before reaching the store', async () => {
    const backend = makeMockStore();
    class TestRepo extends BaseSettingsRepository {
      public readonly handle = this.handleFor(AUTH_METHOD_DEF);
    }
    const repo = new TestRepo(backend);

    await expect(
      repo.handle.set('invalid-enum-value' as 'apiKey'),
    ).rejects.toThrow(ZodError);

    // writeGlobal must NOT have been called.
    expect(backend._writeGlobalCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TC-7: ComputedSettingHandle.get() resolves via authMethod + providerId
// ---------------------------------------------------------------------------

describe('TC-7: ComputedSettingHandle.get() resolves through auth context', () => {
  it('returns the provider-scoped value when store has the computed key', () => {
    const backend = makeMockStore({
      authMethod: 'thirdParty',
      anthropicProviderId: 'openrouter',
      'provider.thirdParty.openrouter.selectedModel': 'mistral-7b',
    });

    const resolveKey = () => {
      const authMethod = backend.readGlobal<string>('authMethod') ?? 'apiKey';
      const providerId =
        backend.readGlobal<string>('anthropicProviderId') ?? '';
      const authKey = resolveAuthProviderKey(authMethod, providerId);
      return `provider.${authKey}.selectedModel`;
    };

    const handle = new ComputedSettingHandle(
      backend,
      providerSelectedModelDef('apiKey'),
      resolveKey,
      'authMethod',
      'anthropicProviderId',
    );

    expect(handle.get()).toBe('mistral-7b');
  });
});

// ---------------------------------------------------------------------------
// TC-8: ComputedSettingHandle.set() writes to the correct provider-scoped key
// ---------------------------------------------------------------------------

describe('TC-8: ComputedSettingHandle.set() writes to provider-scoped key', () => {
  it('calls writeGlobal with the resolved provider key', async () => {
    const backend = makeMockStore({
      authMethod: 'thirdParty',
      anthropicProviderId: 'openrouter',
    });

    const resolveKey = () => {
      const authMethod = backend.readGlobal<string>('authMethod') ?? 'apiKey';
      const providerId =
        backend.readGlobal<string>('anthropicProviderId') ?? '';
      const authKey = resolveAuthProviderKey(authMethod, providerId);
      return `provider.${authKey}.selectedModel`;
    };

    const handle = new ComputedSettingHandle(
      backend,
      providerSelectedModelDef('apiKey'),
      resolveKey,
      'authMethod',
      'anthropicProviderId',
    );

    await handle.set('claude-3');

    expect(backend._writeGlobalCalls).toContainEqual({
      key: 'provider.thirdParty.openrouter.selectedModel',
      value: 'claude-3',
    });
  });
});

// ---------------------------------------------------------------------------
// TC-9: ComputedSettingHandle.get() falls back when no value stored
// ---------------------------------------------------------------------------

describe('TC-9: ComputedSettingHandle.get() falls back to definition default', () => {
  it('returns the definition default when the resolved key has no stored value', () => {
    const backend = makeMockStore({
      authMethod: 'thirdParty',
      anthropicProviderId: 'openrouter',
      // No provider.thirdParty.openrouter.selectedModel stored
    });

    const def = providerSelectedModelDef('apiKey'); // default = ''

    const resolveKey = () => {
      const authMethod = backend.readGlobal<string>('authMethod') ?? 'apiKey';
      const providerId =
        backend.readGlobal<string>('anthropicProviderId') ?? '';
      const authKey = resolveAuthProviderKey(authMethod, providerId);
      return `provider.${authKey}.selectedModel`;
    };

    const handle = new ComputedSettingHandle(
      backend,
      def,
      resolveKey,
      'authMethod',
      'anthropicProviderId',
    );

    expect(handle.get()).toBe(''); // definition default for selectedModel
  });
});

// ---------------------------------------------------------------------------
// TC-10: ComputedSettingHandle.watch() fires on auth change (key re-subscription)
// ---------------------------------------------------------------------------

describe('TC-10: ComputedSettingHandle.watch() re-subscribes on auth change', () => {
  it('fires the callback and re-subscribes when authMethod changes', () => {
    // Build a live-reference store so that mutations to `liveData` are immediately
    // visible to readGlobal() — makeMockStore copies the initial data, so we build
    // a minimal store directly here instead.
    const liveData: Record<string, unknown> = {
      authMethod: 'apiKey',
      anthropicProviderId: '',
      'provider.apiKey.selectedModel': 'claude-initial',
    };
    const watchers = new Map<string, Set<(v: unknown) => void>>();

    const backend: ISettingsStore = {
      readGlobal<T>(key: string): T | undefined {
        return liveData[key] as T | undefined;
      },
      async writeGlobal<T>(key: string, value: T): Promise<void> {
        liveData[key] = value as unknown;
      },
      readSecret: () => Promise.reject(new Error('Phase 4')),
      writeSecret: () => Promise.reject(new Error('Phase 4')),
      deleteSecret: () => Promise.reject(new Error('Phase 4')),
      watchGlobal(key: string, cb: (v: unknown) => void): IDisposable {
        if (!watchers.has(key)) watchers.set(key, new Set());
        watchers.get(key)!.add(cb);
        return {
          dispose: () => {
            watchers.get(key)?.delete(cb);
          },
        };
      },
      watchSecret(_key: string, _cb: () => void): IDisposable {
        return { dispose: () => {} };
      },
      flushSync(): void {},
    };

    const fireWatcher = (key: string, value: unknown) => {
      liveData[key] = value;
      watchers.get(key)?.forEach((cb) => cb(value));
    };

    const resolveKey = () => {
      const authMethod = backend.readGlobal<string>('authMethod') ?? 'apiKey';
      const providerId =
        backend.readGlobal<string>('anthropicProviderId') ?? '';
      const authKey = resolveAuthProviderKey(authMethod, providerId);
      return `provider.${authKey}.selectedModel`;
    };

    const handle = new ComputedSettingHandle(
      backend,
      providerSelectedModelDef('apiKey'),
      resolveKey,
      'authMethod',
      'anthropicProviderId',
    );

    const received: unknown[] = [];
    const sub = handle.watch((v) => received.push(v));

    // Immediate fire with current value.
    expect(received).toEqual(['claude-initial']);

    // Simulate auth method change → thirdParty.openrouter.
    // Update liveData BEFORE firing so resolveKey() sees the new context.
    liveData['authMethod'] = 'thirdParty';
    liveData['anthropicProviderId'] = 'openrouter';
    liveData['provider.thirdParty.openrouter.selectedModel'] = 'mistral-7b';
    fireWatcher('authMethod', 'thirdParty');

    // Should have re-fired (auth change triggers cb(this.get()) in resubscribe).
    expect(received.length).toBeGreaterThanOrEqual(2);

    // Now fire the new key watcher — handle must be re-subscribed to it.
    fireWatcher('provider.thirdParty.openrouter.selectedModel', 'gpt-4o');
    expect(received[received.length - 1]).toBe('gpt-4o');

    // The OLD key watcher should no longer fire after re-subscription.
    const countBefore = received.length;
    fireWatcher('provider.apiKey.selectedModel', 'old-key-update');
    expect(received.length).toBe(countBefore);

    sub.dispose();
  });

  it('dispose unregisters all three watchers (inner + auth + providerId)', () => {
    const storeData: Record<string, unknown> = {
      authMethod: 'apiKey',
      anthropicProviderId: '',
    };
    const backend = makeMockStore(storeData);

    const resolveKey = () => `provider.apiKey.selectedModel`;

    const handle = new ComputedSettingHandle(
      backend,
      providerSelectedModelDef('apiKey'),
      resolveKey,
      'authMethod',
      'anthropicProviderId',
    );

    const received: unknown[] = [];
    const sub = handle.watch((v) => received.push(v));
    // Clear the immediate-fire value.
    received.length = 0;

    sub.dispose();

    // After dispose, no new calls when the store fires any watched key.
    backend._fire('authMethod', 'claudeCli');
    backend._fire('provider.apiKey.selectedModel', 'x');
    expect(received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TC-11: resolveAuthProviderKey table
// ---------------------------------------------------------------------------

describe('TC-11: resolveAuthProviderKey concrete cases', () => {
  it("('apiKey', undefined) => 'apiKey'", () => {
    expect(resolveAuthProviderKey('apiKey', undefined)).toBe('apiKey');
  });

  it("('claudeCli', undefined) => 'claudeCli'", () => {
    expect(resolveAuthProviderKey('claudeCli', undefined)).toBe('claudeCli');
  });

  it("('thirdParty', 'openrouter') => 'thirdParty.openrouter'", () => {
    expect(resolveAuthProviderKey('thirdParty', 'openrouter')).toBe(
      'thirdParty.openrouter',
    );
  });

  it("('thirdParty', '') => 'thirdParty.unknown'", () => {
    expect(resolveAuthProviderKey('thirdParty', '')).toBe('thirdParty.unknown');
  });

  it("('thirdParty', undefined) => 'thirdParty.unknown'", () => {
    expect(resolveAuthProviderKey('thirdParty', undefined)).toBe(
      'thirdParty.unknown',
    );
  });
});

// ---------------------------------------------------------------------------
// TC-12: runV2Migration idempotency
// ---------------------------------------------------------------------------

describe('TC-12: runV2Migration idempotency', () => {
  const tmpDir = path.join(mockTestHome, 'v2-idempotency');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const settingsPath = path.join(tmpDir, 'settings.json');
    if (fs.existsSync(settingsPath)) fs.rmSync(settingsPath);
    const migrationsDir = path.join(tmpDir, 'migrations');
    if (fs.existsSync(migrationsDir))
      fs.rmSync(migrationsDir, { recursive: true });
  });

  it('migrates model.selected to provider-scoped key and removes the legacy key', async () => {
    const initial = {
      $schema: 'https://ptah.live/schemas/settings.json',
      version: 1,
      model: { selected: 'my-model' },
      authMethod: 'apiKey',
    };
    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify(initial, null, 2),
      'utf8',
    );

    await runV2Migration(tmpDir);

    const raw = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8');
    const after = JSON.parse(raw) as Record<string, unknown>;

    // Legacy key must be gone.
    const model = after['model'] as Record<string, unknown> | undefined;
    expect(model?.['selected']).toBeUndefined();

    // Provider-scoped key must exist.
    const provider = after['provider'] as
      | Record<string, Record<string, Record<string, unknown>>>
      | undefined;
    expect(provider?.['apiKey']?.['selectedModel']).toBe('my-model');
  });

  it('running migration a second time is idempotent (no error, no double-modification)', async () => {
    const initial = {
      $schema: 'https://ptah.live/schemas/settings.json',
      version: 1,
      model: { selected: 'my-model' },
      authMethod: 'apiKey',
    };
    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify(initial, null, 2),
      'utf8',
    );

    await runV2Migration(tmpDir);
    await expect(runV2Migration(tmpDir)).resolves.toBeUndefined();

    const raw = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8');
    const after = JSON.parse(raw) as Record<string, unknown>;
    const provider = after['provider'] as
      | Record<string, Record<string, Record<string, unknown>>>
      | undefined;
    expect(provider?.['apiKey']?.['selectedModel']).toBe('my-model');
  });
});

// ---------------------------------------------------------------------------
// TC-13: runV2Migration with no legacy keys is a no-op
// ---------------------------------------------------------------------------

describe('TC-13: runV2Migration with no legacy keys is a no-op', () => {
  const tmpDir = path.join(mockTestHome, 'v2-noop');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const settingsPath = path.join(tmpDir, 'settings.json');
    if (fs.existsSync(settingsPath)) fs.rmSync(settingsPath);
  });

  it('does not throw when no legacy keys are present in settings.json', async () => {
    const initial = {
      $schema: 'https://ptah.live/schemas/settings.json',
      version: 1,
      authMethod: 'apiKey',
    };
    fs.writeFileSync(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify(initial, null, 2),
      'utf8',
    );

    await expect(runV2Migration(tmpDir)).resolves.toBeUndefined();

    // File should not have been rewritten (early return path).
    const raw = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8');
    const after = JSON.parse(raw) as Record<string, unknown>;
    expect(after['provider']).toBeUndefined();
  });

  it('does not throw when settings.json contains only {}', async () => {
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), '{}', 'utf8');
    await expect(runV2Migration(tmpDir)).resolves.toBeUndefined();
  });

  it('does not throw when settings.json does not exist', async () => {
    // tmpDir exists (created in beforeEach) but settings.json is absent.
    // runV2Migration must handle the ENOENT gracefully and resolve.
    const missingSettingsPath = path.join(tmpDir, 'settings.json');
    expect(fs.existsSync(missingSettingsPath)).toBe(false);

    // We call directly without expect().resolves because Jest's assertion
    // wrapper can obscure whether the rejection is from the catch or our code.
    let threw = false;
    try {
      await runV2Migration(tmpDir);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TC-14: MigrationRunner skips already-applied migrations
// ---------------------------------------------------------------------------

describe('TC-14: MigrationRunner skips already-applied migrations', () => {
  const tmpDir = path.join(mockTestHome, 'migration-runner');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const migrationsDir = path.join(tmpDir, 'migrations');
    if (fs.existsSync(migrationsDir))
      fs.rmSync(migrationsDir, { recursive: true });
  });

  it('skips a migration when its sentinel file already exists', async () => {
    const migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, 'v1.applied'),
      new Date().toISOString(),
      'utf8',
    );

    let v1Called = false;
    const v1Fn = async (_dir: string) => {
      v1Called = true;
    };
    const runner = new MigrationRunner(tmpDir, [v1Fn]);

    await runner.runMigrations();

    expect(v1Called).toBe(false);
  });

  it('runs an unapplied migration and writes the sentinel', async () => {
    let v1Called = false;
    const v1Fn = async (_dir: string) => {
      v1Called = true;
    };
    const runner = new MigrationRunner(tmpDir, [v1Fn]);

    await runner.runMigrations();

    expect(v1Called).toBe(true);
    const sentinel = path.join(tmpDir, 'migrations', 'v1.applied');
    expect(fs.existsSync(sentinel)).toBe(true);
  });

  it('skips v2 when only v2 sentinel exists, still runs v1', async () => {
    const migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, 'v2.applied'),
      new Date().toISOString(),
      'utf8',
    );

    let v1Called = false;
    let v2Called = false;
    const v1Fn = async (_dir: string) => {
      v1Called = true;
    };
    const v2Fn = async (_dir: string) => {
      v2Called = true;
    };
    const runner = new MigrationRunner(tmpDir, [v1Fn, v2Fn]);

    await runner.runMigrations();

    expect(v1Called).toBe(true);
    expect(v2Called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TC-18: Isolation guarantee — no call sites outside permitted scope
// ---------------------------------------------------------------------------

describe('TC-18: Isolation guarantee — zero unauthorized consumers', () => {
  it('settings-core is not imported by any app or lib outside permitted adapter scope', () => {
    const { execSync } =
      require('child_process') as typeof import('child_process');
    // Walk up from __dirname (which is .../libs/backend/settings-core/src) to find
    // the monorepo root that contains a .git directory.
    let projectRoot = __dirname;
    for (let i = 0; i < 6; i++) {
      const candidate = path.resolve(projectRoot, '..');
      if (fs.existsSync(path.join(candidate, '.git'))) {
        projectRoot = candidate;
        break;
      }
      projectRoot = candidate;
    }

    let grepOutput = '';
    try {
      grepOutput = execSync('git grep -rl "@ptah-extension/settings-core"', {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: unknown) {
      // git grep exits 1 when there are zero matches — that's a pass.
      if (
        err &&
        typeof err === 'object' &&
        'status' in err &&
        (err as { status: number }).status === 1
      ) {
        grepOutput = '';
      } else {
        throw err;
      }
    }

    const lines = grepOutput
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // Permitted: the lib itself, platform adapters (Batch 2), Batch 3 call-site
    // migrations, WP-4A gateway migration, tsconfig path-alias declarations.
    const permittedPatterns = [
      /libs[\\/]backend[\\/]settings-core[\\/]/,
      /libs[\\/]backend[\\/]platform-electron[\\/]src[\\/]settings[\\/]/,
      /libs[\\/]backend[\\/]platform-cli[\\/]src[\\/]settings[\\/]/,
      /libs[\\/]backend[\\/]platform-vscode[\\/]src[\\/]settings[\\/]/,
      // Batch 3 (WP-3A/3B/3C): call sites migrated to modelSettings / reasoningSettings.
      /apps[\\/]ptah-cli[\\/]src[\\/]cli[\\/]bootstrap[\\/]/,
      /apps[\\/]ptah-electron[\\/]src[\\/]activation[\\/]/,
      /apps[\\/]ptah-extension-vscode[\\/]src[\\/]activation[\\/]/,
      /libs[\\/]backend[\\/]agent-generation[\\/]/,
      /libs[\\/]backend[\\/]agent-sdk[\\/]/,
      /libs[\\/]backend[\\/]rpc-handlers[\\/]/,
      // WP-4A: messaging-gateway uses GatewaySettings for secret token storage.
      /libs[\\/]backend[\\/]messaging-gateway[\\/]/,
      // tsconfig files declare path aliases — not runtime consumers.
      /tsconfig(\.\w+)?\.json$/,
    ];

    const unauthorized = lines.filter(
      (line) => !permittedPatterns.some((pattern) => pattern.test(line)),
    );

    if (unauthorized.length > 0) {
      throw new Error(
        `settings-core is imported outside permitted scope (Batch 2+3 allowed consumers):\n` +
          unauthorized.join('\n'),
      );
    }
    expect(unauthorized).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TC-19 (WP-3T): Drift guard — KNOWN_PROVIDER_AUTH_KEYS ↔ FILE_BASED_SETTINGS_KEYS
//
// Every entry in KNOWN_PROVIDER_AUTH_KEYS MUST produce exactly two entries in
// FILE_BASED_SETTINGS_KEYS (`provider.<key>.selectedModel` and
// `provider.<key>.reasoningEffort`).  If either list drifts the VS Code
// workspace provider silently routes the orphaned key to
// vscode.workspace.getConfiguration — a key that has no schema there — and
// the value is never read back, producing a silent model/effort reset.
// ---------------------------------------------------------------------------

describe('TC-19 (WP-3T): KNOWN_PROVIDER_AUTH_KEYS ↔ FILE_BASED_SETTINGS_KEYS drift guard', () => {
  it('every KNOWN_PROVIDER_AUTH_KEY produces .selectedModel and .reasoningEffort in FILE_BASED_SETTINGS_KEYS', () => {
    // Dynamically resolve from actual source — never hard-coded here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { KNOWN_PROVIDER_AUTH_KEYS } =
      require('./schema/provider-schema') as {
        KNOWN_PROVIDER_AUTH_KEYS: readonly string[];
      };
    // FILE_BASED_SETTINGS_KEYS lives in platform-core (one level up from settings-core).
    // We require the compiled output via the tsconfig path alias.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { FILE_BASED_SETTINGS_KEYS } =
      require('@ptah-extension/platform-core') as {
        FILE_BASED_SETTINGS_KEYS: Set<string>;
      };

    const missing: string[] = [];
    for (const authKey of KNOWN_PROVIDER_AUTH_KEYS) {
      const modelKey = `provider.${authKey}.selectedModel`;
      const effortKey = `provider.${authKey}.reasoningEffort`;
      if (!FILE_BASED_SETTINGS_KEYS.has(modelKey)) missing.push(modelKey);
      if (!FILE_BASED_SETTINGS_KEYS.has(effortKey)) missing.push(effortKey);
    }

    if (missing.length > 0) {
      throw new Error(
        `FILE_BASED_SETTINGS_KEYS is missing provider-scoped keys — VS Code will silently\n` +
          `route these to vscode.workspace.getConfiguration (no schema → silent fail):\n` +
          missing.join('\n'),
      );
    }
    expect(missing).toHaveLength(0);
  });
});
