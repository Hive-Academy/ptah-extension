/**
 * ProviderRpcHandlers — user-defined provider entries (TASK_2026_236, batch C2).
 *
 * Behavioural contracts locked in here:
 *
 *   - METHODS carries the five new `provider:*` names, so the manifest (which
 *     reads `ProviderRpcHandlers.METHODS`) partitions RPC_METHOD_NAMES exactly.
 *   - Every method validates its params with zod BEFORE touching the store.
 *   - SECURITY: `apiKey` goes to AuthSecretsService and NEVER into the entry
 *     that gets persisted to `provider.custom.entries`.
 *   - Removing an entry also deletes the stored secret — including when the
 *     entry was already gone, so a stale secret can never be re-adopted by a
 *     future entry that reuses the id.
 *   - `provider:testCustomEntry` returns exactly `{ ok, message, latencyMs? }`
 *     — the internal `failure` classification stays off the wire.
 *
 * Source-under-test:
 *   libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts
 */

import 'reflect-metadata';

import type {
  ConfigManager,
  Logger,
  RpcHandler,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockAuthSecretsService,
  type MockRpcHandler,
  type MockAuthSecretsService,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { clearCustomProviderEntries } from '@ptah-extension/shared';
import type { CustomProviderStore } from '@ptah-extension/settings-core';

import { ProviderRpcHandlers } from './provider-rpc.handlers';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const VALID_ENTRY = {
  id: 'my-gateway',
  name: 'My Gateway',
  baseUrl: 'https://gateway.example.com',
  lane: 'anthropic' as const,
  authEnvVar: 'ANTHROPIC_AUTH_TOKEN' as const,
  keyPrefix: '',
  helpUrl: '',
  createdAt: '2026-08-12T00:00:00.000Z',
};

interface FakeStore {
  load: jest.Mock;
  list: jest.Mock;
  get: jest.Mock;
  add: jest.Mock;
  update: jest.Mock;
  remove: jest.Mock;
}

interface Suite {
  rpc: MockRpcHandler;
  store: FakeStore;
  secrets: MockAuthSecretsService;
  logger: ReturnType<typeof createMockLogger>;
}

function buildSuite(): Suite {
  const logger = createMockLogger();
  const rpc = createMockRpcHandler();
  const secrets = createMockAuthSecretsService();

  const store: FakeStore = {
    load: jest.fn(() => ({ entries: [VALID_ENTRY], dropped: [] })),
    list: jest.fn(() => [VALID_ENTRY]),
    get: jest.fn((id: string) =>
      id === VALID_ENTRY.id ? VALID_ENTRY : undefined,
    ),
    add: jest.fn(async (input: Record<string, unknown>) => ({
      ...VALID_ENTRY,
      ...input,
    })),
    update: jest.fn(async (id: string, changes: Record<string, unknown>) => ({
      ...VALID_ENTRY,
      id,
      ...changes,
    })),
    remove: jest.fn(async () => true),
  };

  const noop = {} as never;
  const providerModels = { registerDynamicFetcher: jest.fn() };

  const handlers = new ProviderRpcHandlers(
    logger as unknown as Logger,
    rpc as unknown as RpcHandler,
    noop as unknown as ConfigManager,
    secrets,
    providerModels as never,
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
    { captureException: jest.fn() } as unknown as SentryService,
    store as unknown as CustomProviderStore,
  );
  handlers.register();

  return { rpc, store, secrets, logger };
}

function getHandler(
  rpc: MockRpcHandler,
  method: string,
): (params: unknown) => Promise<unknown> {
  const calls = (rpc.registerMethod as jest.Mock).mock.calls as Array<
    [string, (p: unknown) => Promise<unknown>]
  >;
  const match = calls.find(([name]) => name === method);
  if (!match) throw new Error(`Method '${method}' was not registered`);
  return match[1];
}

beforeEach(() => {
  clearCustomProviderEntries();
});

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('ProviderRpcHandlers — custom-entry registration', () => {
  it('declares the five new methods on METHODS', () => {
    expect(ProviderRpcHandlers.METHODS).toEqual(
      expect.arrayContaining([
        'provider:listCustomEntries',
        'provider:addCustomEntry',
        'provider:updateCustomEntry',
        'provider:removeCustomEntry',
        'provider:testCustomEntry',
      ]),
    );
  });

  it('registers every declared method exactly once', () => {
    const { rpc } = buildSuite();
    const registered = (rpc.registerMethod as jest.Mock).mock.calls.map(
      ([name]) => name as string,
    );
    for (const method of ProviderRpcHandlers.METHODS) {
      expect(registered.filter((name) => name === method)).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// provider:listCustomEntries
// ---------------------------------------------------------------------------

describe('provider:listCustomEntries', () => {
  it('returns the loaded entries', async () => {
    const { rpc, store } = buildSuite();

    const result = await getHandler(rpc, 'provider:listCustomEntries')({});

    expect(store.load).toHaveBeenCalled();
    expect(result).toEqual({ entries: [VALID_ENTRY] });
  });

  it('warns but still answers when entries were dropped', async () => {
    const { rpc, store, logger } = buildSuite();
    store.load.mockReturnValueOnce({
      entries: [],
      dropped: [{ id: 'broken', reason: 'baseUrl: invalid' }],
    });

    const result = await getHandler(rpc, 'provider:listCustomEntries')({});

    expect(result).toEqual({ entries: [] });
    expect(logger.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// provider:addCustomEntry
// ---------------------------------------------------------------------------

describe('provider:addCustomEntry', () => {
  it('rejects params that fail the zod envelope', async () => {
    const { rpc, store } = buildSuite();
    const handler = getHandler(rpc, 'provider:addCustomEntry');

    await expect(handler({})).rejects.toThrow();
    await expect(handler({ entry: { id: 'x' } })).rejects.toThrow();
    // Bad id charset is rejected at the boundary, before the store is asked.
    await expect(
      handler({ entry: { ...VALID_ENTRY, id: 'Not_Valid' } }),
    ).rejects.toThrow();
    expect(store.add).not.toHaveBeenCalled();
  });

  it('persists the entry and stores the key in SecretStorage', async () => {
    const { rpc, store, secrets } = buildSuite();

    const result = await getHandler(
      rpc,
      'provider:addCustomEntry',
    )({
      entry: {
        id: 'my-gateway',
        name: 'My Gateway',
        baseUrl: 'https://gateway.example.com',
        lane: 'anthropic',
      },
      apiKey: 'sk-super-secret',
    });

    expect(result).toEqual({
      entry: expect.objectContaining({ id: 'my-gateway' }),
    });
    expect(secrets.setProviderKey).toHaveBeenCalledWith(
      'my-gateway',
      'sk-super-secret',
    );
    expect(secrets.__dumpProviderKeys().get('my-gateway')).toBe(
      'sk-super-secret',
    );
  });

  it('NEVER hands the api key to the settings store', async () => {
    const { rpc, store } = buildSuite();

    await getHandler(
      rpc,
      'provider:addCustomEntry',
    )({
      entry: {
        id: 'my-gateway',
        name: 'My Gateway',
        baseUrl: 'https://gateway.example.com',
        lane: 'anthropic',
      },
      apiKey: 'sk-super-secret',
    });

    expect(store.add).toHaveBeenCalledTimes(1);
    const persisted = JSON.stringify(store.add.mock.calls[0][0]);
    expect(persisted).not.toContain('sk-super-secret');
    expect(persisted).not.toContain('apiKey');
  });

  it('strips an apiKey smuggled inside the entry object', async () => {
    const { rpc, store } = buildSuite();

    await getHandler(
      rpc,
      'provider:addCustomEntry',
    )({
      entry: {
        id: 'my-gateway',
        name: 'My Gateway',
        baseUrl: 'https://gateway.example.com',
        lane: 'anthropic',
        apiKey: 'sk-smuggled',
      },
    });

    expect(JSON.stringify(store.add.mock.calls[0][0])).not.toContain(
      'sk-smuggled',
    );
  });

  it('does not touch SecretStorage when no key is supplied', async () => {
    const { rpc, secrets } = buildSuite();

    await getHandler(
      rpc,
      'provider:addCustomEntry',
    )({
      entry: {
        id: 'my-gateway',
        name: 'My Gateway',
        baseUrl: 'https://gateway.example.com',
        lane: 'anthropic',
      },
    });

    expect(secrets.setProviderKey).not.toHaveBeenCalled();
  });

  it('passes a store error through with its actionable message', async () => {
    const { rpc, store } = buildSuite();
    const storeError = new Error(
      "Provider id 'moonshot' is reserved by a built-in provider.",
    );
    storeError.name = 'CustomProviderStoreError';
    store.add.mockRejectedValueOnce(storeError);

    await expect(
      getHandler(
        rpc,
        'provider:addCustomEntry',
      )({
        entry: {
          id: 'my-gateway',
          name: 'My Gateway',
          baseUrl: 'https://gateway.example.com',
          lane: 'anthropic',
        },
      }),
    ).rejects.toThrow(/reserved by a built-in/);
  });

  it('does NOT leak an unexpected internal error message to the caller', async () => {
    const { rpc, store } = buildSuite();
    store.add.mockRejectedValueOnce(
      new Error('EACCES /home/u/.ptah/settings.json'),
    );

    await expect(
      getHandler(
        rpc,
        'provider:addCustomEntry',
      )({
        entry: {
          id: 'my-gateway',
          name: 'My Gateway',
          baseUrl: 'https://gateway.example.com',
          lane: 'anthropic',
        },
      }),
    ).rejects.toThrow(/Could not save the custom provider entry/);
  });
});

// ---------------------------------------------------------------------------
// provider:updateCustomEntry
// ---------------------------------------------------------------------------

describe('provider:updateCustomEntry', () => {
  it('rejects a missing id or a non-object changes payload', async () => {
    const { rpc } = buildSuite();
    const handler = getHandler(rpc, 'provider:updateCustomEntry');

    await expect(handler({ changes: {} })).rejects.toThrow();
    await expect(handler({ id: '', changes: {} })).rejects.toThrow();
    await expect(handler({ id: 'x', changes: 'nope' })).rejects.toThrow();
  });

  it('applies the change and replaces the stored key when one is supplied', async () => {
    const { rpc, store, secrets } = buildSuite();

    const result = await getHandler(
      rpc,
      'provider:updateCustomEntry',
    )({
      id: 'my-gateway',
      changes: { name: 'Renamed' },
      apiKey: 'sk-rotated',
    });

    expect(store.update).toHaveBeenCalledWith('my-gateway', {
      name: 'Renamed',
    });
    expect(result).toEqual({
      entry: expect.objectContaining({ name: 'Renamed' }),
    });
    expect(secrets.__dumpProviderKeys().get('my-gateway')).toBe('sk-rotated');
  });

  it('leaves the stored key alone when apiKey is omitted', async () => {
    const { rpc, secrets } = buildSuite();
    await secrets.setProviderKey('my-gateway', 'sk-existing');
    secrets.setProviderKey.mockClear();

    await getHandler(
      rpc,
      'provider:updateCustomEntry',
    )({
      id: 'my-gateway',
      changes: { name: 'Renamed' },
    });

    expect(secrets.setProviderKey).not.toHaveBeenCalled();
    expect(secrets.__dumpProviderKeys().get('my-gateway')).toBe('sk-existing');
  });
});

// ---------------------------------------------------------------------------
// provider:removeCustomEntry
// ---------------------------------------------------------------------------

describe('provider:removeCustomEntry', () => {
  it('rejects a missing id', async () => {
    const { rpc } = buildSuite();
    await expect(
      getHandler(rpc, 'provider:removeCustomEntry')({}),
    ).rejects.toThrow();
  });

  it('removes the entry AND deletes the stored secret', async () => {
    const { rpc, store, secrets } = buildSuite();
    await secrets.setProviderKey('my-gateway', 'sk-existing');

    const result = await getHandler(
      rpc,
      'provider:removeCustomEntry',
    )({
      id: 'my-gateway',
    });

    expect(result).toEqual({ removed: true });
    expect(store.remove).toHaveBeenCalledWith('my-gateway');
    expect(secrets.deleteProviderKey).toHaveBeenCalledWith('my-gateway');
    expect(secrets.__dumpProviderKeys().has('my-gateway')).toBe(false);
  });

  it('still deletes the secret when the entry was already gone', async () => {
    const { rpc, store, secrets } = buildSuite();
    store.remove.mockResolvedValueOnce(false);
    await secrets.setProviderKey('ghost', 'sk-orphan');

    const result = await getHandler(
      rpc,
      'provider:removeCustomEntry',
    )({
      id: 'ghost',
    });

    expect(result).toEqual({ removed: false });
    expect(secrets.__dumpProviderKeys().has('ghost')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// provider:testCustomEntry
// ---------------------------------------------------------------------------

describe('provider:testCustomEntry', () => {
  it('rejects a missing id', async () => {
    const { rpc } = buildSuite();
    await expect(
      getHandler(rpc, 'provider:testCustomEntry')({}),
    ).rejects.toThrow();
  });

  it('answers without probing when the id is unknown', async () => {
    const { rpc, store, secrets } = buildSuite();
    store.get.mockReturnValueOnce(undefined);

    const result = await getHandler(
      rpc,
      'provider:testCustomEntry',
    )({
      id: 'never-saved',
    });

    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('never-saved'),
    });
    expect(secrets.getProviderKey).not.toHaveBeenCalled();
  });

  it('probes with the stored key and returns only the wire fields', async () => {
    const { rpc, store, secrets } = buildSuite();
    await secrets.setProviderKey('my-gateway', 'sk-stored');
    // A tier mapping keeps the probe on its single-request path, so the
    // assertion below is about the probe call and not about model discovery.
    store.get.mockReturnValueOnce({
      ...VALID_ENTRY,
      defaultTiers: { sonnet: 'm-s', opus: 'm-o', haiku: 'm-h' },
    });

    const fetchMock = jest.fn().mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), {
          code: 'ENOTFOUND',
        }),
      }),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    try {
      const result = (await getHandler(
        rpc,
        'provider:testCustomEntry',
      )({
        id: 'my-gateway',
      })) as Record<string, unknown>;

      expect(secrets.getProviderKey).toHaveBeenCalledWith('my-gateway');
      expect(result['ok']).toBe(false);
      expect(String(result['message'])).toContain('could not be resolved');
      // The internal classification must not reach the client.
      expect(Object.keys(result).sort()).toEqual([
        'latencyMs',
        'message',
        'ok',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
