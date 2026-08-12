/**
 * CustomProviderStore — unit specs (TASK_2026_236, batch C1).
 *
 * Coverage:
 *   load()   — publishes valid entries to the shared registry cache
 *   load()   — DROPS a malformed entry and keeps its valid siblings (never throws)
 *   load()   — tolerates a non-array value at the key
 *   load()   — rejects an entry that shadows a built-in provider id
 *   add()    — stamps createdAt, rejects bad charset / built-in id / duplicates
 *   add()    — the persisted JSON blob contains NO key material
 *   update() — merges partials, refuses an id change
 *   remove() — removes and reports, and is a no-op for an unknown id
 *
 * Source-under-test:
 *   libs/backend/settings-core/src/repositories/custom-provider-store.ts
 */

import type { IDisposable } from '@ptah-extension/platform-core';
import {
  clearCustomProviderEntries,
  getAllAnthropicProviders,
  getAnthropicProvider,
  getCustomProviderEntries,
  type CustomProviderEntryInput,
} from '@ptah-extension/shared';

import type { ISettingsStore } from '../ports/settings-store.interface';
import {
  CustomProviderStore,
  CustomProviderStoreError,
  CUSTOM_PROVIDER_ENTRIES_KEY,
} from './custom-provider-store';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface FakeStore extends ISettingsStore {
  readonly values: Map<string, unknown>;
  readonly secrets: Map<string, string>;
}

function createFakeStore(seed?: unknown): FakeStore {
  const values = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  if (seed !== undefined) values.set(CUSTOM_PROVIDER_ENTRIES_KEY, seed);

  return {
    values,
    secrets,
    readGlobal<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },
    async writeGlobal<T>(key: string, value: T): Promise<void> {
      // Round-trip through JSON so the spec sees exactly what lands on disk.
      values.set(key, JSON.parse(JSON.stringify(value)));
    },
    async readSecret(key: string): Promise<string | undefined> {
      return secrets.get(key);
    },
    async writeSecret(key: string, ciphertext: string): Promise<void> {
      secrets.set(key, ciphertext);
    },
    async deleteSecret(key: string): Promise<void> {
      secrets.delete(key);
    },
    watchGlobal(): IDisposable {
      return { dispose: () => undefined };
    },
    watchSecret(): IDisposable {
      return { dispose: () => undefined };
    },
    flushSync(): void {
      /* nothing buffered in the fake */
    },
  };
}

function validInput(
  over: Partial<CustomProviderEntryInput> = {},
): CustomProviderEntryInput {
  return {
    id: 'my-gateway',
    name: 'My Gateway',
    baseUrl: 'https://gateway.example.com',
    lane: 'anthropic',
    ...over,
  };
}

const warn = jest.fn();

function makeStore(seed?: unknown): {
  store: CustomProviderStore;
  backing: FakeStore;
} {
  const backing = createFakeStore(seed);
  return { store: new CustomProviderStore(backing, { warn }), backing };
}

beforeEach(() => {
  warn.mockClear();
  clearCustomProviderEntries();
});

afterAll(() => {
  clearCustomProviderEntries();
});

// ---------------------------------------------------------------------------
// load()
// ---------------------------------------------------------------------------

describe('CustomProviderStore.load', () => {
  it('publishes valid entries into the shared registry cache', () => {
    const { store } = makeStore([
      {
        id: 'my-gateway',
        name: 'My Gateway',
        baseUrl: 'https://gateway.example.com',
        lane: 'openai',
      },
    ]);

    const result = store.load();

    expect(result.dropped).toEqual([]);
    expect(result.entries.map((entry) => entry.id)).toEqual(['my-gateway']);
    // The whole point of the store: by-id lookup now resolves the custom id.
    const resolved = getAnthropicProvider('my-gateway');
    expect(resolved?.isCustom).toBe(true);
    // lane 'openai' → the translation proxy is required.
    expect(resolved?.requiresProxy).toBe(true);
    expect(getAllAnthropicProviders().some((p) => p.id === 'my-gateway')).toBe(
      true,
    );
  });

  it('drops a malformed entry, keeps its valid siblings, and does NOT throw', () => {
    const { store } = makeStore([
      {
        id: 'good-one',
        name: 'Good',
        baseUrl: 'https://a.example',
        lane: 'anthropic',
      },
      {
        id: 'BadCase',
        name: 'Bad id',
        baseUrl: 'https://b.example',
        lane: 'anthropic',
      },
      {
        id: 'bad-url',
        name: 'Bad url',
        baseUrl: 'ftp://c.example',
        lane: 'anthropic',
      },
      'not an object',
    ]);

    const result = store.load();

    expect(result.entries.map((entry) => entry.id)).toEqual(['good-one']);
    expect(result.dropped.map((entry) => entry.id).sort()).toEqual([
      '<unknown>',
      'BadCase',
      'bad-url',
    ]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('tolerates a settings value that is not an array at all', () => {
    const { store } = makeStore({ id: 'hand-edited-wrong' });

    const result = store.load();

    expect(result.entries).toEqual([]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toContain('must be an array');
  });

  it('treats a missing key as an empty list', () => {
    const { store } = makeStore();
    expect(store.load()).toEqual({ entries: [], dropped: [] });
  });

  it('rejects an entry that would shadow a built-in provider id', () => {
    const { store } = makeStore([
      {
        id: 'openrouter',
        name: 'Not the real OpenRouter',
        baseUrl: 'https://evil.example',
        lane: 'anthropic',
      },
    ]);

    const result = store.load();

    expect(result.entries).toEqual([]);
    expect(result.dropped[0].id).toBe('openrouter');
    expect(result.dropped[0].reason).toContain('built-in');
    // The shipped entry is untouched.
    expect(getAnthropicProvider('openrouter')?.baseUrl).toBe(
      'https://openrouter.ai/api',
    );
  });
});

// ---------------------------------------------------------------------------
// add()
// ---------------------------------------------------------------------------

describe('CustomProviderStore.add', () => {
  it('persists the entry, stamps createdAt, and republishes the cache', async () => {
    const { store, backing } = makeStore();

    const entry = await store.add(validInput());

    expect(entry.id).toBe('my-gateway');
    expect(entry.createdAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(entry.createdAt as string))).toBe(false);
    // Schema defaults are materialised on the way in.
    expect(entry.authEnvVar).toBe('ANTHROPIC_AUTH_TOKEN');
    expect(entry.keyPrefix).toBe('');
    expect(backing.values.get(CUSTOM_PROVIDER_ENTRIES_KEY)).toHaveLength(1);
    expect(getCustomProviderEntries().map((e) => e.id)).toEqual(['my-gateway']);
  });

  it('never writes key material into the entries blob', async () => {
    const { store, backing } = makeStore();

    // A caller trying to smuggle a key in as an extra field must not succeed —
    // the API key belongs in SecretStorage and nowhere else.
    await store.add({
      ...validInput(),
      apiKey: 'sk-super-secret',
    } as unknown as CustomProviderEntryInput);

    const blob = JSON.stringify(
      backing.values.get(CUSTOM_PROVIDER_ENTRIES_KEY),
    );
    expect(blob).not.toContain('sk-super-secret');
    expect(blob).not.toContain('apiKey');
    expect(backing.secrets.size).toBe(0);
  });

  it('rejects an id outside the [a-z0-9-] charset', async () => {
    const { store } = makeStore();

    await expect(store.add(validInput({ id: 'My_Gateway' }))).rejects.toThrow(
      CustomProviderStoreError,
    );
    await expect(store.add(validInput({ id: 'has space' }))).rejects.toThrow(
      /lower-case|Provider id/,
    );
  });

  it('rejects an id already taken by a built-in provider', async () => {
    const { store } = makeStore();

    await expect(store.add(validInput({ id: 'moonshot' }))).rejects.toThrow(
      /reserved by a built-in/,
    );
    // The virtual direct-auth id is reserved too.
    await expect(store.add(validInput({ id: 'anthropic' }))).rejects.toThrow(
      /reserved by a built-in/,
    );
    // Requesty is a built-in as of this task (C4).
    await expect(store.add(validInput({ id: 'requesty' }))).rejects.toThrow(
      /reserved by a built-in/,
    );
  });

  it('rejects a duplicate custom id', async () => {
    const { store } = makeStore();
    await store.add(validInput());

    await expect(store.add(validInput())).rejects.toThrow(/already exists/);
  });

  it('rejects a non-http(s) base URL', async () => {
    const { store } = makeStore();

    await expect(
      store.add(validInput({ baseUrl: 'file:///etc/passwd' })),
    ).rejects.toThrow(CustomProviderStoreError);
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('CustomProviderStore.update', () => {
  it('merges a partial change and preserves untouched fields + createdAt', async () => {
    const { store } = makeStore();
    const created = await store.add(
      validInput({ helpUrl: 'https://help.example' }),
    );

    const updated = await store.update('my-gateway', { name: 'Renamed' });

    expect(updated.name).toBe('Renamed');
    expect(updated.baseUrl).toBe('https://gateway.example.com');
    expect(updated.helpUrl).toBe('https://help.example');
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it('does NOT reset the defaulted fields the caller did not mention', async () => {
    // Regression guard: building the changes schema by partialling the FULL
    // entry schema still materialises `authEnvVar` / `keyPrefix` / `helpUrl`
    // defaults for absent keys, which silently wiped them on every edit.
    const { store } = makeStore();
    await store.add(
      validInput({
        authEnvVar: 'ANTHROPIC_API_KEY',
        keyPrefix: 'rqy_',
        helpUrl: 'https://help.example',
      }),
    );

    const updated = await store.update('my-gateway', { name: 'Renamed' });

    expect(updated.authEnvVar).toBe('ANTHROPIC_API_KEY');
    expect(updated.keyPrefix).toBe('rqy_');
    expect(updated.helpUrl).toBe('https://help.example');
  });

  it('refuses to change the id, because the API key is filed under it', async () => {
    const { store } = makeStore();
    await store.add(validInput());

    await expect(
      store.update('my-gateway', { id: 'other-gateway' }),
    ).rejects.toThrow(/cannot be changed/);
  });

  it('accepts a changes object that repeats the same id', async () => {
    const { store } = makeStore();
    await store.add(validInput());

    const updated = await store.update('my-gateway', {
      id: 'my-gateway',
      lane: 'openai',
    });

    expect(updated.lane).toBe('openai');
  });

  it('rejects an unknown id', async () => {
    const { store } = makeStore();

    await expect(store.update('nope', { name: 'x' })).rejects.toThrow(
      /No custom provider entry/,
    );
  });

  it('rejects a change that makes the entry invalid', async () => {
    const { store } = makeStore();
    await store.add(validInput());

    await expect(
      store.update('my-gateway', { baseUrl: 'not a url' }),
    ).rejects.toThrow(CustomProviderStoreError);
  });
});

// ---------------------------------------------------------------------------
// remove()
// ---------------------------------------------------------------------------

describe('CustomProviderStore.remove', () => {
  it('removes the entry and republishes the cache', async () => {
    const { store, backing } = makeStore();
    await store.add(validInput());
    await store.add(validInput({ id: 'other', name: 'Other' }));

    await expect(store.remove('my-gateway')).resolves.toBe(true);

    expect(backing.values.get(CUSTOM_PROVIDER_ENTRIES_KEY)).toHaveLength(1);
    expect(getAnthropicProvider('my-gateway')).toBeUndefined();
    expect(getAnthropicProvider('other')).toBeDefined();
  });

  it('reports false for an unknown id and leaves the file alone', async () => {
    const { store, backing } = makeStore();
    await store.add(validInput());

    await expect(store.remove('never-existed')).resolves.toBe(false);
    expect(backing.values.get(CUSTOM_PROVIDER_ENTRIES_KEY)).toHaveLength(1);
  });
});
