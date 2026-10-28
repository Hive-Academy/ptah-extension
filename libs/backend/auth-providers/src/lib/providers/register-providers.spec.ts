import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockAuthSecretsService } from '@ptah-extension/vscode-core/testing';
import { AUTH_PROVIDERS_TOKENS as T } from '../di/tokens';
import type { ApiKeyProxyBinding } from '../auth/auth-strategy.types';
import { OpenCodeAuthService, OpenCodeTranslationProxy } from './opencode';
import { registerProviders } from './register-providers';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  KimiCodeAuthService,
  KimiCodeLoginService,
  KimiCodeTranslationProxy,
} from './kimi-code';

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

describe('registerProviders Kimi Code', () => {
  it('resolves the Kimi auth, proxy and login singletons without touching disk or starting servers', () => {
    const c = container.createChildContainer();
    c.registerInstance(TOKENS.LOGGER, createMockLogger());
    c.registerInstance(TOKENS.CONFIG_MANAGER, { get: jest.fn() });
    c.registerInstance(TOKENS.AUTH_SECRETS_SERVICE, createMockAuthSecretsService());
    c.registerInstance(SDK_TOKENS.SDK_ADAPTER_EVENTS, {
      emitAuthFileChanged: jest.fn(),
    });
    c.registerInstance(SDK_TOKENS.SDK_PROCESS_SPAWNER, {
      spawnProcess: jest.fn(),
    });
    c.registerInstance(PLATFORM_TOKENS.USER_INTERACTION, {
      openExternal: jest.fn(),
    });
    registerProviders(c);

    const auth = c.resolve(T.SDK_KIMI_CODE_AUTH);
    expect(auth).toBeInstanceOf(KimiCodeAuthService);
    expect(c.resolve(T.SDK_KIMI_CODE_AUTH)).toBe(auth);
    const proxy = c.resolve<KimiCodeTranslationProxy>(T.SDK_KIMI_CODE_PROXY);
    expect(proxy).toBeInstanceOf(KimiCodeTranslationProxy);
    expect(c.resolve(T.SDK_KIMI_CODE_PROXY)).toBe(proxy);
    expect(proxy.isRunning()).toBe(false);
    const login = c.resolve(T.SDK_KIMI_CODE_LOGIN);
    expect(login).toBeInstanceOf(KimiCodeLoginService);
    expect(c.resolve(T.SDK_KIMI_CODE_LOGIN)).toBe(login);
  });

  it('uses stable Symbol.for tokens', () => {
    expect(T.SDK_KIMI_CODE_AUTH).toBe(Symbol.for('SdkKimiCodeAuth'));
    expect(T.SDK_KIMI_CODE_PROXY).toBe(Symbol.for('SdkKimiCodeProxy'));
    expect(T.SDK_KIMI_CODE_LOGIN).toBe(Symbol.for('SdkKimiCodeLogin'));
    expect(T.SDK_CURATOR_KIMI_CODE_PROXY).toBe(
      Symbol.for('SdkCuratorKimiCodeProxy'),
    );
  });
});
