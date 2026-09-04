/**
 * `LoopbackOAuthCallbackListener` — the default `IOAuthCallbackListener`.
 *
 * Exercises the redirect-capture semantics that used to live inside
 * `McpOAuthService.startCallbackListener`: redirect URI shape, happy-path
 * resolve, state-mismatch / error-param / missing-code rejection, and the
 * 404 no-op for stray requests. Uses an in-process fake `IHttpServerProvider`
 * that captures the handler and lets the test drive it (mirrors the deterministic
 * fake-provider pattern in `mcp-oauth.service.spec.ts`).
 */

import type {
  IHttpServerProvider,
  HttpServerRequestHandler,
} from '@ptah-extension/platform-core';
import {
  LoopbackOAuthCallbackListener,
  MCP_OAUTH_LOOPBACK_PORT,
} from './loopback-oauth-callback-listener';

/** Fake loopback provider: captures the handler and exposes an invoker. */
function makeFakeHttpProvider(port = 51820) {
  let handler: HttpServerRequestHandler | undefined;
  let closed = false;
  const listenCalls: number[] = [];
  const provider: IHttpServerProvider = {
    async listen(_host, requestedPort, h) {
      listenCalls.push(requestedPort);
      handler = h;
      return {
        port,
        host: '127.0.0.1',
        close: async () => {
          closed = true;
        },
      };
    },
  };
  const invoke = (url: string): void => {
    const res = {
      writeHead: () => res,
      end: () => undefined,
    } as unknown as Parameters<HttpServerRequestHandler>[1];
    void handler?.({ url } as Parameters<HttpServerRequestHandler>[0], res);
  };
  return { provider, invoke, isClosed: () => closed, listenCalls };
}

describe('LoopbackOAuthCallbackListener', () => {
  it('start() binds 127.0.0.1 on the fixed port and reports the loopback redirect URI', async () => {
    const { provider, listenCalls } = makeFakeHttpProvider(45123);
    const listener = new LoopbackOAuthCallbackListener(provider);
    const handle = await listener.start('state-1');
    expect(listenCalls).toEqual([MCP_OAUTH_LOOPBACK_PORT]);
    expect(handle.redirectUri).toBe('http://127.0.0.1:45123/callback');
  });

  it('start() falls back to port 0 when the fixed port is already taken', async () => {
    const listenCalls: number[] = [];
    const provider: IHttpServerProvider = {
      async listen(_host, requestedPort) {
        listenCalls.push(requestedPort);
        if (requestedPort !== 0) {
          throw Object.assign(new Error('listen EADDRINUSE'), {
            code: 'EADDRINUSE',
          });
        }
        return { port: 60001, host: '127.0.0.1', close: async () => undefined };
      },
    };

    const listener = new LoopbackOAuthCallbackListener(provider);
    const handle = await listener.start('state-busy');

    expect(listenCalls).toEqual([MCP_OAUTH_LOOPBACK_PORT, 0]);
    // The armed URI reports the port actually bound, which is what lets
    // `McpOAuthService` notice it no longer matches `describeRedirectUri()`.
    expect(handle.redirectUri).toBe('http://127.0.0.1:60001/callback');
  });

  it('describeRedirectUri() reports the fixed port without binding anything', async () => {
    const { provider, listenCalls } = makeFakeHttpProvider();
    const listener = new LoopbackOAuthCallbackListener(provider);

    await expect(listener.describeRedirectUri()).resolves.toBe(
      `http://127.0.0.1:${MCP_OAUTH_LOOPBACK_PORT}/callback`,
    );
    expect(listenCalls).toEqual([]);
  });

  it('honours an explicit port override in both start() and describeRedirectUri()', async () => {
    const { provider, listenCalls } = makeFakeHttpProvider(7001);
    const listener = new LoopbackOAuthCallbackListener(provider, 7001);

    await expect(listener.describeRedirectUri()).resolves.toBe(
      'http://127.0.0.1:7001/callback',
    );
    await listener.start('state-fixed');
    expect(listenCalls).toEqual([7001]);
  });

  it('resolves waitForCode when a matching-state redirect arrives', async () => {
    const { provider, invoke } = makeFakeHttpProvider();
    const listener = new LoopbackOAuthCallbackListener(provider);
    const handle = await listener.start('good-state');

    const pending = handle.waitForCode(1000);
    invoke('http://127.0.0.1:51820/callback?code=CODE123&state=good-state');

    await expect(pending).resolves.toBe('CODE123');
  });

  it('rejects on a state mismatch', async () => {
    const { provider, invoke } = makeFakeHttpProvider();
    const listener = new LoopbackOAuthCallbackListener(provider);
    const handle = await listener.start('expected');

    const pending = handle.waitForCode(1000);
    invoke('http://127.0.0.1:51820/callback?code=X&state=WRONG');

    await expect(pending).rejects.toThrow(/state mismatch/i);
  });

  it('rejects when the redirect carries an error param', async () => {
    const { provider, invoke } = makeFakeHttpProvider();
    const listener = new LoopbackOAuthCallbackListener(provider);
    const handle = await listener.start('st');

    const pending = handle.waitForCode(1000);
    invoke('http://127.0.0.1:51820/callback?error=access_denied&state=st');

    await expect(pending).rejects.toThrow(/access_denied/i);
  });

  it('rejects when no authorization code is returned', async () => {
    const { provider, invoke } = makeFakeHttpProvider();
    const listener = new LoopbackOAuthCallbackListener(provider);
    const handle = await listener.start('st');

    const pending = handle.waitForCode(1000);
    invoke('http://127.0.0.1:51820/callback?state=st');

    await expect(pending).rejects.toThrow(/no authorization code/i);
  });

  it('ignores stray requests with no OAuth params (waiter stays pending)', async () => {
    const { provider, invoke } = makeFakeHttpProvider();
    const listener = new LoopbackOAuthCallbackListener(provider);
    const handle = await listener.start('st');

    const pending = handle.waitForCode(50);
    invoke('http://127.0.0.1:51820/favicon.ico');

    await expect(pending).rejects.toThrow(/timed out/i);
  });

  it('close() delegates to the underlying server handle', async () => {
    const { provider, isClosed } = makeFakeHttpProvider();
    const listener = new LoopbackOAuthCallbackListener(provider);
    const handle = await listener.start('st');
    await handle.close();
    expect(isClosed()).toBe(true);
  });
});
