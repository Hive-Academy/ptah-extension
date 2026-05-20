import 'reflect-metadata';
import { createMockAuthSecretsService } from './auth-secrets-service.mock';
import { createMockConfigManager } from './config-manager.mock';
import { createMockRpcHandler } from './rpc-handler.mock';
import { RpcUserError } from '../messaging/rpc-types';

describe('createMockAuthSecretsService — branch coverage', () => {
  it('setCredential with whitespace-only value deletes existing credential', async () => {
    const mock = createMockAuthSecretsService({
      credentials: { apiKey: 'sk-1' },
    });

    await mock.setCredential('apiKey', '   ');

    await expect(mock.hasCredential('apiKey')).resolves.toBe(false);
    await expect(mock.getCredential('apiKey')).resolves.toBeUndefined();
  });

  it('setCredential with empty string deletes credential', async () => {
    const mock = createMockAuthSecretsService({
      credentials: { apiKey: 'sk-1' },
    });

    await mock.setCredential('apiKey', '');

    await expect(mock.hasCredential('apiKey')).resolves.toBe(false);
  });

  it('setProviderKey with whitespace-only value deletes existing key', async () => {
    const mock = createMockAuthSecretsService({
      providerKeys: { openrouter: 'or-key' },
    });

    await mock.setProviderKey('openrouter', '   ');

    await expect(mock.hasProviderKey('openrouter')).resolves.toBe(false);
  });

  it('setProviderKey with valid value stores trimmed value', async () => {
    const mock = createMockAuthSecretsService();

    await mock.setProviderKey('openrouter', '  or-abc  ');

    await expect(mock.getProviderKey('openrouter')).resolves.toBe('or-abc');
    await expect(mock.hasProviderKey('openrouter')).resolves.toBe(true);
  });

  it('deleteCredential removes a seeded credential', async () => {
    const mock = createMockAuthSecretsService({
      credentials: { apiKey: 'sk-del' },
    });

    await mock.deleteCredential('apiKey');

    await expect(mock.hasCredential('apiKey')).resolves.toBe(false);
  });

  it('deleteProviderKey removes a seeded provider key', async () => {
    const mock = createMockAuthSecretsService({
      providerKeys: { prov: 'pk-del' },
    });

    await mock.deleteProviderKey('prov');

    await expect(mock.hasProviderKey('prov')).resolves.toBe(false);
  });

  it('__dumpCredentials returns a snapshot copy', async () => {
    const mock = createMockAuthSecretsService({
      credentials: { apiKey: 'sk-snap' },
    });

    const dump = mock.__dumpCredentials();
    expect(dump.get('apiKey')).toBe('sk-snap');
    dump.delete('apiKey');
    await expect(mock.getCredential('apiKey')).resolves.toBe('sk-snap');
  });

  it('__dumpProviderKeys returns a snapshot copy', async () => {
    const mock = createMockAuthSecretsService({
      providerKeys: { prov: 'pk-snap' },
    });

    const dump = mock.__dumpProviderKeys();
    expect(dump.get('prov')).toBe('pk-snap');
  });

  it('__reset clears all stored values', async () => {
    const mock = createMockAuthSecretsService({
      credentials: { apiKey: 'sk-reset' },
      providerKeys: { prov: 'pk-reset' },
    });

    mock.__reset();

    await expect(mock.hasCredential('apiKey')).resolves.toBe(false);
    await expect(mock.hasProviderKey('prov')).resolves.toBe(false);
  });

  it('skips seeding credential overrides with falsy values', async () => {
    const mock = createMockAuthSecretsService({
      credentials: { apiKey: '' as string },
    });

    await expect(mock.getCredential('apiKey')).resolves.toBeUndefined();
  });

  it('skips seeding providerKeys with falsy values', async () => {
    const mock = createMockAuthSecretsService({
      providerKeys: { prov: '' },
    });

    await expect(mock.getProviderKey('prov')).resolves.toBeUndefined();
  });
});

describe('createMockConfigManager — branch coverage', () => {
  it('getTypedWithDefault returns defaultValue when schema parse throws', () => {
    const { z } = require('zod');
    const mock = createMockConfigManager({ values: { key: 'not-a-number' } });
    const schema = z.number();

    const result = mock.getTypedWithDefault('key', schema, 42);
    expect(result).toBe(42);
  });

  it('getTypedWithDefault returns parsed value when schema succeeds', () => {
    const { z } = require('zod');
    const mock = createMockConfigManager({ values: { key: 7 } });
    const schema = z.number();

    const result = mock.getTypedWithDefault('key', schema, 99);
    expect(result).toBe(7);
  });

  it('has returns true for keys in knownKeys', () => {
    const mock = createMockConfigManager({ knownKeys: ['ptah.special'] });
    expect(mock.has('ptah.special')).toBe(true);
  });

  it('has returns true for keys in seeded values', () => {
    const mock = createMockConfigManager({ values: { 'ptah.exists': true } });
    expect(mock.has('ptah.exists')).toBe(true);
  });

  it('has returns false for unknown keys', () => {
    const mock = createMockConfigManager();
    expect(mock.has('ptah.missing')).toBe(false);
  });

  it('watch returns disposable with dispose fn', () => {
    const mock = createMockConfigManager();
    const disposable = mock.watch('ptah.key', jest.fn());
    expect(typeof disposable.dispose).toBe('function');
    expect(() => disposable.dispose()).not.toThrow();
  });

  it('watchTyped returns disposable', () => {
    const { z } = require('zod');
    const mock = createMockConfigManager();
    const disposable = mock.watchTyped('ptah.key', z.string(), jest.fn());
    expect(typeof disposable.dispose).toBe('function');
  });

  it('setFileSettingsStore is callable', () => {
    const mock = createMockConfigManager();
    expect(() =>
      mock.setFileSettingsStore(new Set(['key']), {
        get: jest.fn(),
        set: jest.fn(),
      } as never),
    ).not.toThrow();
  });

  it('inspect returns undefined', () => {
    const mock = createMockConfigManager();
    expect(mock.inspect('ptah.key')).toBeUndefined();
  });

  it('getSection returns empty object', () => {
    const mock = createMockConfigManager();
    expect(mock.getSection()).toEqual({});
  });

  it('dispose is callable', () => {
    const mock = createMockConfigManager();
    expect(() => mock.dispose()).not.toThrow();
  });
});

describe('createMockRpcHandler — branch coverage', () => {
  it('handleMessage returns method-not-found for unregistered method', async () => {
    const mock = createMockRpcHandler();

    const response = await mock.handleMessage({
      method: 'session:unknown',
      params: {},
      correlationId: 'corr-nf',
    });

    expect(response.success).toBe(false);
    expect(response.error).toMatch(/Method not found/);
  });

  it('handleMessage propagates RpcUserError with errorCode', async () => {
    const mock = createMockRpcHandler({
      handlers: {
        'session:fail': async () => {
          throw new RpcUserError('workspace needed', 'WORKSPACE_NOT_OPEN');
        },
      },
    });

    const response = await mock.handleMessage({
      method: 'session:fail',
      params: {},
      correlationId: 'corr-ue',
    });

    expect(response.success).toBe(false);
    expect(response.errorCode).toBe('WORKSPACE_NOT_OPEN');
    expect(response.error).toBe('workspace needed');
  });

  it('handleMessage wraps non-RpcUserError thrown as error string', async () => {
    const mock = createMockRpcHandler({
      handlers: {
        'session:crash': async () => {
          throw new Error('plain crash');
        },
      },
    });

    const response = await mock.handleMessage({
      method: 'session:crash',
      params: {},
      correlationId: 'corr-crash',
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe('plain crash');
    expect(response.errorCode).toBeUndefined();
  });

  it('handleMessage wraps non-Error thrown values', async () => {
    const mock = createMockRpcHandler({
      handlers: {
        'session:str': async () => {
          throw 'string thrown';
        },
      },
    });

    const response = await mock.handleMessage({
      method: 'session:str',
      params: {},
      correlationId: 'corr-str',
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe('string thrown');
  });

  it('__reset clears all registered handlers', async () => {
    const mock = createMockRpcHandler();
    mock.registerMethod('session:list', async () => ({}));

    mock.__reset();

    const response = await mock.handleMessage({
      method: 'session:list',
      params: {},
      correlationId: 'corr-reset',
    });

    expect(response.success).toBe(false);
    expect(response.error).toMatch(/Method not found/);
  });

  it('__handlers returns the current handler map', () => {
    const mock = createMockRpcHandler();
    mock.registerMethod('chat:send', async () => ({}));

    const handlers = mock.__handlers();
    expect(handlers.has('chat:send')).toBe(true);
  });

  it('unregisterMethod removes registered handler', async () => {
    const mock = createMockRpcHandler();
    mock.registerMethod('session:list', async () => ({}));
    mock.unregisterMethod('session:list');

    const response = await mock.handleMessage({
      method: 'session:list',
      params: {},
      correlationId: 'corr-unreg',
    });

    expect(response.success).toBe(false);
  });

  it('getRegisteredMethods returns all method names', () => {
    const mock = createMockRpcHandler();
    mock.registerMethod('session:list', async () => ({}));
    mock.registerMethod('chat:send', async () => ({}));

    const methods = mock.getRegisteredMethods();
    expect(methods).toContain('session:list');
    expect(methods).toContain('chat:send');
  });
});
