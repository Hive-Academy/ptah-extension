import 'reflect-metadata';

import type { WorkspaceScopeResolver } from '@ptah-extension/settings-core';
import { ActiveProviderResolver } from './active-provider-resolver';

function makeResolver(values: Record<string, unknown>): {
  resolver: ActiveProviderResolver;
  read: jest.Mock;
} {
  const read = jest.fn((key: string) => values[key]);
  const scope = { read } as unknown as WorkspaceScopeResolver;
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

  it('normalizes an unset authMethod to apiKey', () => {
    const { resolver } = makeResolver({});

    expect(resolver.resolveActiveAuth()).toEqual({
      authMethod: 'apiKey',
      providerId: 'anthropic',
    });
  });
});
