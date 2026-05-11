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
const TEST_PTAH_DIR = path.join(mockTestHome, '.ptah');

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

// ---------------------------------------------------------------------------
// Shared mock factory
// ---------------------------------------------------------------------------

function makeMockStore(
  globalData: Record<string, unknown> = {},
): jest.Mocked<ISettingsStore> {
  const data = { ...globalData };
  const watchers = new Map<string, Set<(v: unknown) => void>>();

  const store: jest.Mocked<ISettingsStore> = {
    readGlobal: jest.fn(
      <T>(key: string): T | undefined => data[key] as T | undefined,
    ),
    writeGlobal: jest.fn(async <T>(key: string, value: T): Promise<void> => {
      data[key] = value;
      watchers.get(key)?.forEach((cb) => cb(value));
    }),
    readSecret: jest.fn().mockRejectedValue(new Error('Phase 4')),
    writeSecret: jest.fn().mockRejectedValue(new Error('Phase 4')),
    deleteSecret: jest.fn().mockRejectedValue(new Error('Phase 4')),
    watchGlobal: jest.fn(
      (key: string, cb: (v: unknown) => void): IDisposable => {
        if (!watchers.has(key)) watchers.set(key, new Set());
        watchers.get(key)!.add(cb);
        return {
          dispose: () => {
            watchers.get(key)?.delete(cb);
          },
        };
      },
    ),
    watchSecret: jest.fn((): IDisposable => ({ dispose: () => {} })),
    flushSync: jest.fn(),
  };

  // Expose internal trigger for tests that need to simulate store events.
  (store as unknown as { _fire: (key: string, value: unknown) => void })._fire =
    (key: string, value: unknown) => {
      data[key] = value;
      watchers.get(key)?.forEach((cb) => cb(value));
    };

  return store;
}

// ---------------------------------------------------------------------------
// TC-1: Schema sanity — every definition has required fields, no duplicate keys
// ---------------------------------------------------------------------------

describe('TC-1: SETTINGS_SCHEMA sanity', () => {
  const requiredFields: Array<keyof (typeof SETTINGS_SCHEMA)[0]> = [
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
    const keys = SETTINGS_SCHEMA.map((d: { key: string }) => d.key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it('all scope values are valid', () => {
    const validScopes = new Set(['global', 'secret', 'session']);
    for (const def of SETTINGS_SCHEMA) {
      expect(validScopes.has((def as { scope: string }).scope)).toBe(true);
    }
  });

  it('all sensitivity values are valid', () => {
    const validSensitivities = new Set(['plain', 'encrypted', 'secret']);
    for (const def of SETTINGS_SCHEMA) {
      expect(
        validSensitivities.has((def as { sensitivity: string }).sensitivity),
      ).toBe(true);
    }
  });

  it('sinceVersion is a positive integer for all definitions', () => {
    for (const def of SETTINGS_SCHEMA) {
      expect(typeof (def as { sinceVersion: unknown }).sinceVersion).toBe(
        'number',
      );
      expect((def as { sinceVersion: number }).sinceVersion).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-2: defineSetting produces frozen definitions
// ---------------------------------------------------------------------------

describe('TC-2: defineSetting returns frozen objects', () => {
  it('Object.isFrozen returns true for a definition', () => {
    expect(Object.isFrozen(AUTH_METHOD_DEF)).toBe(true);
  });

  it('any definition produced by defineSetting is frozen', () => {
    const { z } = require('zod');
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

  it('frozen definition cannot be mutated', () => {
    expect(() => {
      // In strict mode this throws; in non-strict it silently fails.
      // Either way, the property must not have changed.
      (AUTH_METHOD_DEF as { key: string }).key = 'mutated';
    }).toThrow();
    // Regardless of whether it threw, the key must still be the original.
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

    const cb = jest.fn();
    store.watchGlobal('foo', cb);

    await store.writeGlobal('foo', 'bar');

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('bar');
  });
});

// ---------------------------------------------------------------------------
// TC-4: ReactiveSettingsStore — watchers only fire for the watched key
// ---------------------------------------------------------------------------

describe('TC-4: ReactiveSettingsStore listener isolation', () => {
  it('only the watcher for the written key fires', async () => {
    const backend = makeMockStore();
    const store = new ReactiveSettingsStore(backend);

    const cbFoo = jest.fn();
    const cbBaz = jest.fn();
    store.watchGlobal('foo', cbFoo);
    store.watchGlobal('baz', cbBaz);

    await store.writeGlobal('foo', 'updated');

    expect(cbFoo).toHaveBeenCalledTimes(1);
    expect(cbBaz).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-5: SettingHandle.get() returns schema default when store is empty
// ---------------------------------------------------------------------------

describe('TC-5: SettingHandle.get() returns definition default for empty store', () => {
  it('returns the AUTH_METHOD_DEF default ("apiKey") when nothing is stored', () => {
    const backend = makeMockStore({}); // empty store
    const repo = new BaseSettingsRepository(backend);
    // Access protected handleFor via subclass pattern.
    class TestRepo extends BaseSettingsRepository {
      public readonly handle = this.handleFor(AUTH_METHOD_DEF);
    }
    const testRepo = new TestRepo(backend);
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
    expect(backend.writeGlobal).not.toHaveBeenCalled();
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

    const { z } = require('zod');
    const { providerSelectedModelDef } = require('./schema/provider-schema');

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

    const { providerSelectedModelDef } = require('./schema/provider-schema');

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

    expect(backend.writeGlobal).toHaveBeenCalledWith(
      'provider.thirdParty.openrouter.selectedModel',
      'claude-3',
    );
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
      // No 'provider.thirdParty.openrouter.selectedModel' key stored
    });

    const { providerSelectedModelDef } = require('./schema/provider-schema');
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
    // Start with apiKey
    const storeData: Record<string, unknown> = {
      authMethod: 'apiKey',
      anthropicProviderId: '',
      'provider.apiKey.selectedModel': 'claude-initial',
    };

    const watchers = new Map<string, Set<(v: unknown) => void>>();

    // Build a manually controllable store so we can fire watchers ourselves.
    const backend: ISettingsStore = {
      readGlobal: jest.fn(
        <T>(key: string): T | undefined => storeData[key] as T | undefined,
      ),
      writeGlobal: jest.fn(async () => {}),
      readSecret: jest.fn().mockRejectedValue(new Error('Phase 4')),
      writeSecret: jest.fn().mockRejectedValue(new Error('Phase 4')),
      deleteSecret: jest.fn().mockRejectedValue(new Error('Phase 4')),
      watchGlobal: jest.fn(
        (key: string, cb: (v: unknown) => void): IDisposable => {
          if (!watchers.has(key)) watchers.set(key, new Set());
          watchers.get(key)!.add(cb);
          return {
            dispose: () => {
              watchers.get(key)?.delete(cb);
            },
          };
        },
      ),
      watchSecret: jest.fn((): IDisposable => ({ dispose: () => {} })),
      flushSync: jest.fn(),
    };

    const fireWatcher = (key: string, value: unknown) => {
      storeData[key] = value;
      watchers.get(key)?.forEach((cb) => cb(value));
    };

    const { providerSelectedModelDef } = require('./schema/provider-schema');

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

    const received: string[] = [];
    const sub = handle.watch((v) => received.push(v as string));

    // Immediate fire with current value.
    expect(received).toEqual(['claude-initial']);

    // Simulate auth method change → thirdParty.openrouter
    storeData['authMethod'] = 'thirdParty';
    storeData['anthropicProviderId'] = 'openrouter';
    storeData['provider.thirdParty.openrouter.selectedModel'] = 'mistral-7b';
    fireWatcher('authMethod', 'thirdParty');

    // Should have re-fired (auth change means effective value changed)
    expect(received.length).toBeGreaterThanOrEqual(2);

    // Now fire the new key watcher — the handle should be subscribed to it.
    fireWatcher('provider.thirdParty.openrouter.selectedModel', 'gpt-4o');
    expect(received[received.length - 1]).toBe('gpt-4o');

    // The OLD key watcher should no longer fire.
    const countBefore = received.length;
    fireWatcher('provider.apiKey.selectedModel', 'old-key-update');
    expect(received.length).toBe(countBefore); // no additional fires

    sub.dispose();
  });

  it('dispose unregisters all three watchers (inner + auth + providerId)', () => {
    const backend = makeMockStore({
      authMethod: 'apiKey',
      anthropicProviderId: '',
    });
    const { providerSelectedModelDef } = require('./schema/provider-schema');

    const resolveKey = () => `provider.apiKey.selectedModel`;

    const handle = new ComputedSettingHandle(
      backend,
      providerSelectedModelDef('apiKey'),
      resolveKey,
      'authMethod',
      'anthropicProviderId',
    );

    const cb = jest.fn();
    const sub = handle.watch(cb);
    cb.mockClear(); // clear the immediate fire

    sub.dispose();

    // After dispose, no new calls when the store fires.
    (backend as unknown as { _fire: (k: string, v: unknown) => void })._fire(
      'authMethod',
      'claudeCli',
    );
    expect(cb).not.toHaveBeenCalled();
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
    // Clean slate.
    if (fs.existsSync(path.join(tmpDir, 'settings.json'))) {
      fs.rmSync(path.join(tmpDir, 'settings.json'));
    }
    if (fs.existsSync(path.join(tmpDir, 'migrations'))) {
      fs.rmSync(path.join(tmpDir, 'migrations'), { recursive: true });
    }
  });

  it('migrates model.selected to provider-scoped key and removes legacy key', async () => {
    // Write settings in the nested format PtahFileSettingsManager produces.
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
    expect(
      (after['model'] as Record<string, unknown> | undefined)?.['selected'],
    ).toBeUndefined();

    // Provider-scoped key must exist.
    const provider = after['provider'] as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(provider?.['apiKey']?.['selectedModel']).toBe('my-model');
  });

  it('running migration a second time does not corrupt data', async () => {
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
    // Run again — should be idempotent.
    await expect(runV2Migration(tmpDir)).resolves.toBeUndefined();

    const raw = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8');
    const after = JSON.parse(raw) as Record<string, unknown>;
    const provider = after['provider'] as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
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
    if (fs.existsSync(path.join(tmpDir, 'settings.json'))) {
      fs.rmSync(path.join(tmpDir, 'settings.json'));
    }
  });

  it('does not throw and settings.json is unchanged when no legacy keys present', async () => {
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

    // File should be unchanged (migration returned early without writing).
    const raw = fs.readFileSync(path.join(tmpDir, 'settings.json'), 'utf8');
    const after = JSON.parse(raw) as Record<string, unknown>;
    expect(after['provider']).toBeUndefined();
  });

  it('does not throw when settings.json is empty {}', async () => {
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), '{}', 'utf8');
    await expect(runV2Migration(tmpDir)).resolves.toBeUndefined();
  });

  it('does not throw when settings.json does not exist', async () => {
    // No file written.
    await expect(runV2Migration(tmpDir)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TC-14: MigrationRunner skips already-applied migrations
// ---------------------------------------------------------------------------

describe('TC-14: MigrationRunner skips already-applied migrations', () => {
  const tmpDir = path.join(mockTestHome, 'migration-runner');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
    if (fs.existsSync(path.join(tmpDir, 'migrations'))) {
      fs.rmSync(path.join(tmpDir, 'migrations'), { recursive: true });
    }
  });

  it('skips a migration when its sentinel file already exists', async () => {
    // Pre-create v1.applied sentinel.
    const migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, 'v1.applied'),
      new Date().toISOString(),
      'utf8',
    );

    const v1Fn = jest.fn().mockResolvedValue(undefined);
    const runner = new MigrationRunner(tmpDir, [v1Fn]);

    await runner.runMigrations();

    expect(v1Fn).not.toHaveBeenCalled();
  });

  it('runs an unapplied migration and writes the sentinel', async () => {
    const v1Fn = jest.fn().mockResolvedValue(undefined);
    const runner = new MigrationRunner(tmpDir, [v1Fn]);

    await runner.runMigrations();

    expect(v1Fn).toHaveBeenCalledTimes(1);

    const sentinel = path.join(tmpDir, 'migrations', 'v1.applied');
    expect(fs.existsSync(sentinel)).toBe(true);
  });

  it('skips v2 when only v2 sentinel exists and runs v1', async () => {
    const migrationsDir = path.join(tmpDir, 'migrations');
    fs.mkdirSync(migrationsDir, { recursive: true });
    // Pre-create v2 sentinel, but NOT v1.
    fs.writeFileSync(
      path.join(migrationsDir, 'v2.applied'),
      new Date().toISOString(),
      'utf8',
    );

    const v1Fn = jest.fn().mockResolvedValue(undefined);
    const v2Fn = jest.fn().mockResolvedValue(undefined);
    const runner = new MigrationRunner(tmpDir, [v1Fn, v2Fn]);

    await runner.runMigrations();

    expect(v1Fn).toHaveBeenCalledTimes(1);
    expect(v2Fn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TC-18: Isolation guarantee — no call sites outside settings-core
// ---------------------------------------------------------------------------

describe('TC-18: Isolation guarantee — zero external consumers', () => {
  it('settings-core is not imported by any app or lib outside its own directory', () => {
    // Grep the project for @ptah-extension/settings-core imports.
    // The only files permitted to import it are:
    //   - files under libs/backend/settings-core/ (the lib itself)
    //   - platform adapter files (libs/backend/platform-{electron,cli,vscode})
    //     that are allowed per the adapter scaffolding in Batch 2.
    //   - this spec file itself

    const { execSync } = require('child_process');
    const projectRoot = path.resolve(__dirname, '../../../../..');

    let grepOutput = '';
    try {
      grepOutput = execSync('git grep -rl "@ptah-extension/settings-core"', {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: unknown) {
      // git grep exits 1 when no matches — that's a pass (zero consumers).
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

    // Permitted patterns: settings-core lib itself, platform adapters, and specs.
    const permittedPatterns = [
      /libs[\\/]backend[\\/]settings-core[\\/]/,
      /libs[\\/]backend[\\/]platform-electron[\\/]src[\\/]settings[\\/]/,
      /libs[\\/]backend[\\/]platform-cli[\\/]src[\\/]settings[\\/]/,
      /libs[\\/]backend[\\/]platform-vscode[\\/]src[\\/]settings[\\/]/,
    ];

    const unauthorized = lines.filter(
      (line) => !permittedPatterns.some((pattern) => pattern.test(line)),
    );

    if (unauthorized.length > 0) {
      fail(
        `settings-core is imported outside permitted scope:\n${unauthorized.join('\n')}\n` +
          'Batch 2 must be a pure-additive scaffold — no app should consume settings-core yet.',
      );
    }
  });
});
