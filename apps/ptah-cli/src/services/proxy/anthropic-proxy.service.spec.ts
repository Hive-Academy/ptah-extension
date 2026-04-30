/**
 * Unit tests for `AnthropicProxyService.registerShutdownRpc` —
 * TASK_2026_108 T1 (Batch 1, Task 1.5).
 *
 * Scope: only the inbound `proxy.shutdown` JSON-RPC handler that the embedded
 * `ptah interact` host wires onto its `JsonRpcServer`. The HTTP dispatch /
 * Anthropic translator paths are exercised by other suites (see
 * `anthropic-sse-translator.spec.ts`, etc.).
 *
 * The proxy service is constructed against a stub `IHttpServerProvider` so
 * `start()` resolves without binding a real port, and the `proxy.shutdown`
 * RPC round-trip is verified end-to-end through a fake `JsonRpcServer`
 * shaped to `Pick<JsonRpcServer, 'register' | 'unregister'>`.
 */

import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import {
  AnthropicProxyService,
  type AnthropicProxyConfig,
  type ProxyNotifier,
} from './anthropic-proxy.service.js';
import type {
  IHttpServerHandle,
  IHttpServerProvider,
} from '@ptah-extension/platform-core';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type { CliWebviewManagerAdapter } from '../../transport/cli-webview-manager-adapter.js';
import type { JsonRpcServer } from '../../cli/jsonrpc/server.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

interface RegisteredHandler {
  (params: unknown): Promise<unknown> | unknown;
}

interface FakeJsonRpcServer extends Pick<
  JsonRpcServer,
  'register' | 'unregister'
> {
  readonly handlers: Map<string, RegisteredHandler>;
}

function makeFakeJsonRpcServer(): FakeJsonRpcServer {
  const handlers = new Map<string, RegisteredHandler>();
  return {
    handlers,
    register: jest.fn((method: string, handler: RegisteredHandler) => {
      handlers.set(method, handler);
    }),
    unregister: jest.fn((method: string) => {
      handlers.delete(method);
    }),
  };
}

function makeStubHttpProvider(): {
  provider: jest.Mocked<IHttpServerProvider>;
  handle: IHttpServerHandle;
} {
  const handle: IHttpServerHandle = {
    host: '127.0.0.1',
    port: 38421,
    close: jest.fn<Promise<void>, []>(() => Promise.resolve()),
  };
  const listen: jest.Mocked<IHttpServerProvider>['listen'] = jest.fn(
    async (_host, _port, _handler) => handle,
  );
  const provider: jest.Mocked<IHttpServerProvider> = { listen };
  return { provider, handle };
}

function makeStubTransport(): jest.Mocked<CliMessageTransport> {
  return {
    call: jest.fn(),
  } as unknown as jest.Mocked<CliMessageTransport>;
}

function makeStubPushAdapter(): jest.Mocked<CliWebviewManagerAdapter> {
  const ee = new EventEmitter();
  // Cast through `unknown` only at the test-double boundary — the spec needs
  // `on/off/emit` to satisfy `pushAdapter.on('chat:chunk', ...)` when the
  // proxy's per-request bridge is exercised, which the shutdown tests do not
  // hit, but the constructor still type-checks the parameter.
  return ee as unknown as jest.Mocked<CliWebviewManagerAdapter>;
}

function makeStubNotifier(): jest.Mocked<ProxyNotifier> {
  const notify: jest.Mocked<ProxyNotifier>['notify'] = jest.fn(
    (_method: string, _params?: unknown) => Promise.resolve(),
  );
  return { notify };
}

function makeBaseConfig(userDataPath: string): AnthropicProxyConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    exposeWorkspaceTools: false,
    autoApprove: true,
    workspacePath: path.join(userDataPath, 'workspace'),
    userDataPath,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnthropicProxyService.registerShutdownRpc', () => {
  let tmpUserData: string;

  beforeEach(() => {
    tmpUserData = mkdtempSync(path.join(tmpdir(), 'ptah-proxy-spec-'));
  });

  afterEach(() => {
    rmSync(tmpUserData, { recursive: true, force: true });
  });

  it('proxy.shutdown invokes stop() exactly once even when called twice', async () => {
    const { provider } = makeStubHttpProvider();
    const transport = makeStubTransport();
    const pushAdapter = makeStubPushAdapter();
    const notifier = makeStubNotifier();
    const service = new AnthropicProxyService(
      makeBaseConfig(tmpUserData),
      provider,
      transport,
      pushAdapter,
      notifier,
    );
    // Spy on stop() BEFORE start() so the writeProxyTokenFile path doesn't
    // need a real fs round-trip — but start() does need to run so `this.handle`
    // is non-null. The tokenfile write is real; we redirect userDataPath into
    // a per-test temp dir to keep the disk effects isolated.
    await service.start();

    const stopSpy = jest.spyOn(service, 'stop');
    const fakeServer = makeFakeJsonRpcServer();
    service.registerShutdownRpc(fakeServer);

    const handler = fakeServer.handlers.get('proxy.shutdown');
    expect(handler).toBeDefined();
    if (handler === undefined) throw new Error('handler not registered');

    const first = await handler(undefined);
    expect(first).toEqual(
      expect.objectContaining({ stopped: true, reason: 'rpc' }),
    );

    // The handler schedules `stop()` via `setImmediate` — flush it.
    await new Promise<void>((resolve) => setImmediate(resolve));

    const second = await handler(undefined);
    expect(second).toEqual({ stopped: false, reason: 'already stopped' });

    // `stop()` is invoked once via the setImmediate scheduled by the FIRST
    // handler call. The second call's idempotent branch never reaches stop().
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledWith('rpc');
  });

  it('proxy.shutdown returns { stopped: false } when proxy already stopped', async () => {
    const { provider } = makeStubHttpProvider();
    const service = new AnthropicProxyService(
      makeBaseConfig(tmpUserData),
      provider,
      makeStubTransport(),
      makeStubPushAdapter(),
      makeStubNotifier(),
    );
    await service.start();
    await service.stop('shutdown');

    const fakeServer = makeFakeJsonRpcServer();
    service.registerShutdownRpc(fakeServer);
    const handler = fakeServer.handlers.get('proxy.shutdown');
    if (handler === undefined) throw new Error('handler not registered');

    const result = await handler(undefined);
    expect(result).toEqual({ stopped: false, reason: 'already stopped' });
  });

  it('unregister() removes the proxy.shutdown handler', async () => {
    const { provider } = makeStubHttpProvider();
    const service = new AnthropicProxyService(
      makeBaseConfig(tmpUserData),
      provider,
      makeStubTransport(),
      makeStubPushAdapter(),
      makeStubNotifier(),
    );
    await service.start();

    const fakeServer = makeFakeJsonRpcServer();
    const unregister = service.registerShutdownRpc(fakeServer);
    expect(fakeServer.handlers.has('proxy.shutdown')).toBe(true);

    unregister();
    expect(fakeServer.handlers.has('proxy.shutdown')).toBe(false);
    expect(fakeServer.unregister).toHaveBeenCalledWith('proxy.shutdown');

    await service.stop('shutdown');
  });
});
