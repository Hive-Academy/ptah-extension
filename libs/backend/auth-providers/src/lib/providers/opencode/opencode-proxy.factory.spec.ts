import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { OpenCodeTranslationProxy } from './opencode-translation-proxy';
import { createOpenCodeProxyForKey } from './opencode-proxy.factory';

describe('createOpenCodeProxyForKey', () => {
  afterEach(() => jest.restoreAllMocks());

  it('binds independent credentials and subscriptions with caller-owned lifecycles', async () => {
    // Capture the real constructor arguments through the auth hook, without
    // exposing production internals or making upstream network requests.
    const logger = createMockLogger();
    const zen = createOpenCodeProxyForKey(
      'opencode-zen',
      ' zen-key ',
      logger as unknown as Logger,
    );
    const go = createOpenCodeProxyForKey(
      'opencode-go',
      ' go-key ',
      logger as unknown as Logger,
    );
    const another = createOpenCodeProxyForKey(
      'opencode-zen',
      ' another-key ',
      logger as unknown as Logger,
    );
    expect(zen).not.toBe(go);
    expect(zen).not.toBe(another);
    class Hooks extends OpenCodeTranslationProxy {
      static headers(proxy: OpenCodeTranslationProxy) {
        return Hooks.prototype.getHeaders.call(proxy);
      }
      static endpoint(proxy: OpenCodeTranslationProxy) {
        return Hooks.prototype.getApiEndpoint.call(proxy);
      }
    }
    expect((await Hooks.headers(zen)).Authorization).toBe('Bearer zen-key');
    expect((await Hooks.headers(go)).Authorization).toBe('Bearer go-key');
    expect((await Hooks.headers(another)).Authorization).toBe(
      'Bearer another-key',
    );
    expect(await Hooks.endpoint(zen)).toBe('https://opencode.ai/zen/v1');
    expect(await Hooks.endpoint(go)).toBe('https://opencode.ai/zen/go/v1');
    expect(zen.isRunning()).toBe(false);
    expect(go.isRunning()).toBe(false);
    try {
      const [a, b] = await Promise.all([zen.start(), go.start()]);
      expect(a.port).not.toBe(b.port);
      await zen.stop();
      expect(go.isRunning()).toBe(true);
    } finally {
      await Promise.all([zen.stop(), go.stop(), another.stop()]);
    }
    for (const log of [logger.debug, logger.info, logger.warn, logger.error]) {
      expect(JSON.stringify((log as jest.Mock).mock.calls)).not.toMatch(
        /zen-key|go-key|another-key/,
      );
    }
  });

  it('rejects blank key headers with subscription-specific guidance', async () => {
    class Hooks extends OpenCodeTranslationProxy {
      static headers(proxy: OpenCodeTranslationProxy) {
        return Hooks.prototype.getHeaders.call(proxy);
      }
    }
    const proxy = createOpenCodeProxyForKey(
      'opencode-go',
      ' \n ',
      createMockLogger() as unknown as Logger,
    );
    await expect(Hooks.headers(proxy)).rejects.toThrow(
      'No OpenCode Go API key configured. Add one in Settings.',
    );
  });
});
