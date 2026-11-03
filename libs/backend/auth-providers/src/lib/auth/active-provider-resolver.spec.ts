import 'reflect-metadata';

import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';
import {
  ActiveProviderResolver,
  createAuthCredentialProbe,
  type AuthCredentialProbe,
} from './active-provider-resolver';

function makeResolver(values: Record<string, unknown>): {
  resolver: ActiveProviderResolver;
  read: jest.Mock;
} {
  const read = jest.fn((key: string) => values[key]);
  // A key is stored when `read` returns a value for it.
  const isStored = (key: string): boolean => read(key) !== undefined;
  const scope = { read, isStored } as unknown as WorkspaceScopeResolver;
  return { resolver: new ActiveProviderResolver(scope), read };
}

describe('ActiveProviderResolver', () => {
  it('returns scoped thirdParty/openai-codex over a global claudeCli default', () => {
    const { resolver } = makeResolver({
      authMethod: 'thirdParty',
      anthropicProviderId: 'openai-codex',
    });

    expect(resolver.resolveActiveAuth()).toEqual({
      authMethod: 'thirdParty',
      providerId: 'openai-codex',
    });
  });

  it('reads authMethod with the app-scopable flag', () => {
    const { resolver, read } = makeResolver({ authMethod: 'apiKey' });

    resolver.resolveActiveAuth();

    expect(read).toHaveBeenCalledWith('authMethod', true);
  });

  it('short-circuits apiKey to the anthropic-direct provider id', () => {
    const { resolver } = makeResolver({ authMethod: 'apiKey' });

    expect(resolver.resolveActiveAuth()).toEqual({
      authMethod: 'apiKey',
      providerId: 'anthropic',
    });
  });

  it('short-circuits claudeCli to the anthropic-direct provider id', () => {
    const { resolver } = makeResolver({ authMethod: 'claudeCli' });

    expect(resolver.resolveActiveAuth()).toEqual({
      authMethod: 'claudeCli',
      providerId: 'anthropic',
    });
  });

  it('falls back to the registry default provider id for thirdParty without an override', () => {
    const { resolver } = makeResolver({ authMethod: 'thirdParty' });

    const result = resolver.resolveActiveAuth();
    expect(result.authMethod).toBe('thirdParty');
    expect(result.providerId).toBe('openrouter');
  });

  describe('resolveActiveAuthWithDefault', () => {
    function probe(facts: { hasKey: boolean; connected: boolean }): {
      probe: AuthCredentialProbe;
      hasAnthropicApiKey: jest.Mock<Promise<boolean>, []>;
      isClaudeCliConnected: jest.Mock<Promise<boolean>, []>;
    } {
      const hasAnthropicApiKey = jest.fn(async () => facts.hasKey);
      const isClaudeCliConnected = jest.fn(async () => facts.connected);
      return {
        probe: { hasAnthropicApiKey, isClaudeCliConnected },
        hasAnthropicApiKey,
        isClaudeCliConnected,
      };
    }

    it.each([
      ['missing', {}],
      ['unknown', { authMethod: 'garbage' }],
    ])(
      'uses the connected Claude CLI login when the method is %s and no key exists, and remembers it',
      async (_label, values: Record<string, unknown>) => {
        const { resolver } = makeResolver(values);
        const p = probe({ hasKey: false, connected: true });

        await expect(
          resolver.resolveActiveAuthWithDefault(p.probe),
        ).resolves.toEqual({
          authMethod: 'claudeCli',
          providerId: 'anthropic',
        });
        expect(resolver.resolveActiveAuth().authMethod).toBe('claudeCli');
      },
    );

    it('keeps apiKey when a key exists and the login is not connected', async () => {
      const { resolver } = makeResolver({});
      const p = probe({ hasKey: true, connected: false });

      const auth = await resolver.resolveActiveAuthWithDefault(p.probe);

      expect(auth.authMethod).toBe('apiKey');
      expect(resolver.resolveActiveAuth().authMethod).toBe('apiKey');
    });

    it('treats the registered claudeCli default as unset, so a key without a login gives apiKey', async () => {
      // The file store returns its registered default, but nothing is stored.
      const read = jest.fn((key: string) =>
        key === 'authMethod' ? 'claudeCli' : undefined,
      );
      const scope = {
        read,
        isStored: () => false,
      } as unknown as WorkspaceScopeResolver;
      const resolver = new ActiveProviderResolver(scope);
      const p = probe({ hasKey: true, connected: false });

      const auth = await resolver.resolveActiveAuthWithDefault(p.probe);

      expect(auth.authMethod).toBe('apiKey');
      expect(resolver.resolveActiveAuth().authMethod).toBe('apiKey');
    });

    it('prefers a connected login over a stored key', async () => {
      const { resolver } = makeResolver({});
      const p = probe({ hasKey: true, connected: true });

      const auth = await resolver.resolveActiveAuthWithDefault(p.probe);

      expect(auth.authMethod).toBe('claudeCli');
    });

    it('defaults to claudeCli when no key exists, without reading the login', async () => {
      const { resolver } = makeResolver({});
      const p = probe({ hasKey: false, connected: false });

      const auth = await resolver.resolveActiveAuthWithDefault(p.probe);

      expect(auth.authMethod).toBe('claudeCli');
      expect(p.isClaudeCliConnected).not.toHaveBeenCalled();
    });

    it('honours an explicit apiKey without reading any credential', async () => {
      const { resolver } = makeResolver({ authMethod: 'apiKey' });
      const p = probe({ hasKey: false, connected: true });

      const auth = await resolver.resolveActiveAuthWithDefault(p.probe);

      expect(auth.authMethod).toBe('apiKey');
      expect(p.hasAnthropicApiKey).not.toHaveBeenCalled();
      expect(p.isClaudeCliConnected).not.toHaveBeenCalled();
    });

    it('reads the explicit workspace path when one is given', async () => {
      const readForPath = jest.fn((key: string) =>
        key === 'authMethod' ? 'claude-cli' : undefined,
      );
      const isStoredForPath = (key: string): boolean =>
        readForPath(key) !== undefined;
      const scope = {
        readForPath,
        isStoredForPath,
      } as unknown as WorkspaceScopeResolver;
      const resolver = new ActiveProviderResolver(scope);
      const p = probe({ hasKey: true, connected: false });

      const auth = await resolver.resolveActiveAuthWithDefault(
        p.probe,
        'D:/ws',
      );

      expect(auth.authMethod).toBe('claudeCli');
      expect(readForPath).toHaveBeenCalledWith('authMethod', 'D:/ws', true);
      expect(p.hasAnthropicApiKey).not.toHaveBeenCalled();
    });
  });

  describe('createAuthCredentialProbe', () => {
    const envApiKey = process.env['ANTHROPIC_API_KEY'];
    afterEach(() => {
      if (envApiKey === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = envApiKey;
    });

    it('counts a stored key or ANTHROPIC_API_KEY, and only a connected login', async () => {
      delete process.env['ANTHROPIC_API_KEY'];
      const stored: { key: string | undefined } = { key: '  ' };
      const p = createAuthCredentialProbe(
        { getCredential: async () => stored.key },
        {
          read: async () => ({
            state: 'connected',
            checkedAt: '2026-10-29T00:00:00.000Z',
          }),
        },
      );

      await expect(p.hasAnthropicApiKey()).resolves.toBe(false);
      process.env['ANTHROPIC_API_KEY'] = 'test-env-key';
      await expect(p.hasAnthropicApiKey()).resolves.toBe(true);
      delete process.env['ANTHROPIC_API_KEY'];
      stored.key = 'test-stored-key';
      await expect(p.hasAnthropicApiKey()).resolves.toBe(true);
      await expect(p.isClaudeCliConnected()).resolves.toBe(true);
    });
  });

  it('normalizes an unset authMethod to claudeCli', () => {
    const { resolver } = makeResolver({});

    expect(resolver.resolveActiveAuth()).toEqual({
      authMethod: 'claudeCli',
      providerId: 'anthropic',
    });
  });
});
