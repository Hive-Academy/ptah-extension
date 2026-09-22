import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockAuthSecretsService } from '@ptah-extension/vscode-core/testing';
import { AUTH_PROVIDERS_TOKENS as T } from '../di/tokens';
import type { ApiKeyProxyBinding } from '../auth/auth-strategy.types';
import { OpenCodeAuthService, OpenCodeTranslationProxy } from './opencode';
import { registerProviders } from './register-providers';

describe('registerProviders OpenCode bindings', () => {
  it('resolves four cached proxy bindings and separate subscription auth without starting servers', async () => {
    const c = container.createChildContainer();
    c.registerInstance(TOKENS.LOGGER, createMockLogger());
    c.registerInstance(
      TOKENS.AUTH_SECRETS_SERVICE,
      createMockAuthSecretsService({
        providerKeys: { 'opencode-zen': 'zen-key', 'opencode-go': 'go-key' },
      }),
    );
    registerProviders(c);
    const bindings = c.resolve<readonly ApiKeyProxyBinding[]>(
      T.SDK_API_KEY_PROXY_BINDINGS,
    );
    expect(c.resolve(T.SDK_API_KEY_PROXY_BINDINGS)).toBe(bindings);
    expect(bindings.map((b) => b.providerId)).toEqual([
      'openrouter',
      'sakana',
      'opencode-zen',
      'opencode-go',
    ]);
    const zen = c.resolve<OpenCodeTranslationProxy>(T.SDK_OPENCODE_ZEN_PROXY);
    const go = c.resolve<OpenCodeTranslationProxy>(T.SDK_OPENCODE_GO_PROXY);
    expect(zen).not.toBe(go);
    expect(c.resolve(T.SDK_OPENCODE_ZEN_PROXY)).toBe(zen);
    expect(c.resolve(T.SDK_OPENCODE_GO_PROXY)).toBe(go);
    const zenAuth = c.resolve<OpenCodeAuthService>(T.SDK_OPENCODE_ZEN_AUTH);
    const goAuth = c.resolve<OpenCodeAuthService>(T.SDK_OPENCODE_GO_AUTH);
    expect(zenAuth).not.toBe(goAuth);
    expect(c.resolve(T.SDK_OPENCODE_ZEN_AUTH)).toBe(zenAuth);
    expect(c.resolve(T.SDK_OPENCODE_GO_AUTH)).toBe(goAuth);
    expect(await zenAuth.getApiKey()).toBe('zen-key');
    expect(await goAuth.getApiKey()).toBe('go-key');
    for (const binding of bindings)
      expect(binding.proxy.isRunning()).toBe(false);
    expect(bindings[0].proxy).toBe(c.resolve(T.SDK_OPENROUTER_PROXY));
    expect(bindings[1].proxy).toBe(c.resolve(T.SDK_SAKANA_PROXY));
    expect(bindings[2]).toMatchObject({
      proxy: zen,
      placeholder: 'opencode-proxy-token',
    });
    expect(bindings[3]).toMatchObject({
      proxy: go,
      placeholder: 'opencode-proxy-token',
    });
  });

  it('uses stable Symbol.for tokens', () => {
    expect(T.SDK_OPENCODE_ZEN_AUTH).toBe(Symbol.for('SdkOpenCodeZenAuth'));
    expect(T.SDK_OPENCODE_GO_AUTH).toBe(Symbol.for('SdkOpenCodeGoAuth'));
    expect(T.SDK_OPENCODE_ZEN_PROXY).toBe(Symbol.for('SdkOpenCodeZenProxy'));
    expect(T.SDK_OPENCODE_GO_PROXY).toBe(Symbol.for('SdkOpenCodeGoProxy'));
    expect(T.SDK_API_KEY_PROXY_BINDINGS).toBe(
      Symbol.for('SdkApiKeyProxyBindings'),
    );
  });
});
