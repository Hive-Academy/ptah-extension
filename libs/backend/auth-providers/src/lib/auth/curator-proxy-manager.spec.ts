import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { CuratorProxyManager } from './curator-proxy-manager';
import { TranslationProxyBase } from '../translation';
import type { ITranslationProxy } from '../translation';
import { COPILOT_PROXY_TOKEN_PLACEHOLDER } from '../providers/copilot';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

class StubTranslationProxy extends TranslationProxyBase {
  constructor(logger: Logger) {
    super(logger, {
      name: 'Stub',
      modelPrefix: '',
      completionsPath: '/chat/completions',
    });
  }
  protected async getApiEndpoint(): Promise<string> {
    return 'http://127.0.0.1:9';
  }
  protected async getHeaders(): Promise<Record<string, string>> {
    return { authorization: 'Bearer stub' };
  }
  protected async onAuthFailure(): Promise<boolean> {
    return false;
  }
  protected getStaticModels(): Array<{ id: string }> {
    return [{ id: 'stub-model' }];
  }
}

function createIdleProxy(): jest.Mocked<ITranslationProxy> {
  return {
    start: jest
      .fn<Promise<{ port: number; url: string }>, []>()
      .mockResolvedValue({ port: 0, url: '' }),
    stop: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    isRunning: jest.fn<boolean, []>().mockReturnValue(false),
    getUrl: jest.fn<string | undefined, []>().mockReturnValue(undefined),
  };
}

describe('CuratorProxyManager', () => {
  let logger: MockLogger;
  let copilotProxy: StubTranslationProxy;
  let manager: CuratorProxyManager;

  beforeEach(() => {
    logger = createMockLogger();
    copilotProxy = new StubTranslationProxy(asLogger(logger));
    manager = new CuratorProxyManager(
      asLogger(logger),
      copilotProxy,
      createIdleProxy(),
      createIdleProxy(),
      createIdleProxy(),
      50,
    );
  });

  afterEach(async () => {
    await manager.disposeAll();
  });

  it('ensureProxy starts a proxy on a real OS port and returns its url + token', async () => {
    const handle = await manager.ensureProxy('github-copilot');
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(handle.token).toBe(COPILOT_PROXY_TOKEN_PLACEHOLDER);
    expect(copilotProxy.isRunning()).toBe(true);
  });

  it('reuses the same running proxy on the second ensureProxy call', async () => {
    const startSpy = jest.spyOn(copilotProxy, 'start');
    const first = await manager.ensureProxy('github-copilot');
    const second = await manager.ensureProxy('github-copilot');
    expect(second.url).toBe(first.url);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('idle-disposes the proxy after the TTL elapses', async () => {
    await manager.ensureProxy('github-copilot');
    expect(copilotProxy.isRunning()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(copilotProxy.isRunning()).toBe(false);
  });

  it('disposeAll stops every running curator proxy', async () => {
    await manager.ensureProxy('github-copilot');
    expect(copilotProxy.isRunning()).toBe(true);
    await manager.disposeAll();
    expect(copilotProxy.isRunning()).toBe(false);
  });

  it('rejects providers that are not proxy-class', async () => {
    await expect(manager.ensureProxy('anthropic')).rejects.toThrow();
  });

  it('coexists with the chat proxy: the chat teardown cannot stop the curator instance', async () => {
    const chatProxy = new StubTranslationProxy(asLogger(logger));
    await chatProxy.start();

    await manager.ensureProxy('github-copilot');
    expect(copilotProxy.isRunning()).toBe(true);
    expect(chatProxy.isRunning()).toBe(true);

    await stopProxyIfRunning(chatProxy);

    expect(chatProxy.isRunning()).toBe(false);
    expect(copilotProxy.isRunning()).toBe(true);
    expect(chatProxy).not.toBe(copilotProxy);
  });
});

async function stopProxyIfRunning(proxy: {
  isRunning(): boolean;
  stop(): Promise<void>;
}): Promise<void> {
  if (proxy.isRunning()) {
    await proxy.stop();
  }
}
