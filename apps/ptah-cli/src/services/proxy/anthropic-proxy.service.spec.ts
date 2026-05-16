/**
 * Unit tests for `AnthropicProxyService.registerShutdownRpc`.
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
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

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

/** Captures the dispatcher passed to `httpProvider.listen` so the spec can
 * drive synthetic HTTP requests through `dispatch()` without binding a real
 * port. The `dispatcher` slot is `null` until `start()` resolves. */
interface StubHttpProvider {
  readonly provider: jest.Mocked<IHttpServerProvider>;
  readonly handle: IHttpServerHandle;
  dispatcher: ((req: unknown, res: unknown) => void) | null;
}

function makeStubHttpProvider(): StubHttpProvider {
  const handle: IHttpServerHandle = {
    host: '127.0.0.1',
    port: 38421,
    close: jest.fn<Promise<void>, []>(() => Promise.resolve()),
  };
  const stub: StubHttpProvider = {
    provider: {
      listen: jest.fn(),
    } as unknown as jest.Mocked<IHttpServerProvider>,
    handle,
    dispatcher: null,
  };
  (stub.provider.listen as jest.Mock).mockImplementation(
    async (
      _host: string,
      _port: number,
      handler: (req: unknown, res: unknown) => void,
    ) => {
      stub.dispatcher = handler;
      return handle;
    },
  );
  return stub;
}

// ---------------------------------------------------------------------------
// Synthetic HTTP request / response helpers
//
// `dispatch()` calls `readBody(req)` which expects an `IncomingMessage` with
// a node `Readable` stream and `headers`. We assemble one from a JSON body
// string; `ServerResponse` only needs `writeHead | write | end | once` plus
// a `writableEnded` flag for the proxy's happy/error paths.
// ---------------------------------------------------------------------------

interface CapturedResponse {
  statusCode: number | null;
  headers: Record<string, string | number | string[]> | null;
  bodyChunks: string[];
  ended: boolean;
}

function makeSyntheticReq(opts: {
  url: string;
  method: string;
  headers: Record<string, string | string[]>;
  body: string;
}): IncomingMessage {
  const stream = Readable.from([Buffer.from(opts.body, 'utf8')]);
  // Lowercase header keys to match Node's IncomingMessage behavior.
  const headers: Record<string, string | string[]> = {};
  for (const k of Object.keys(opts.headers)) {
    headers[k.toLowerCase()] = opts.headers[k];
  }
  Object.assign(stream, {
    url: opts.url,
    method: opts.method,
    headers,
  });
  return stream as unknown as IncomingMessage;
}

function makeSyntheticRes(): {
  res: ServerResponse;
  captured: CapturedResponse;
} {
  const captured: CapturedResponse = {
    statusCode: null,
    headers: null,
    bodyChunks: [],
    ended: false,
  };
  const res = {
    writableEnded: false,
    writeHead(
      status: number,
      headers?: Record<string, string | number | string[]>,
    ): void {
      captured.statusCode = status;
      captured.headers = headers ?? null;
    },
    write(chunk: string | Buffer): boolean {
      captured.bodyChunks.push(
        typeof chunk === 'string' ? chunk : chunk.toString('utf8'),
      );
      return true;
    },
    end(chunk?: string | Buffer): void {
      if (chunk !== undefined) {
        captured.bodyChunks.push(
          typeof chunk === 'string' ? chunk : chunk.toString('utf8'),
        );
      }
      captured.ended = true;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
    once(_event: string, _cb: (...args: unknown[]) => void): unknown {
      return res;
    },
  };
  return { res: res as unknown as ServerResponse, captured };
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

// ---------------------------------------------------------------------------
// AnthropicProxyService — mcpServersOverride population.
//
// Drives a synthetic POST /v1/messages through the captured dispatcher so we
// can assert the parser extracts X-Ptah-Mcp-Servers correctly and forwards
// it onto the chat:start RPC payload. Auth is satisfied by issuing the
// proxy.token.issued notification from start() and reading the minted token
// off the notifier mock.
// ---------------------------------------------------------------------------

describe('AnthropicProxyService — mcpServersOverride population', () => {
  let tmpUserData: string;

  beforeEach(() => {
    tmpUserData = mkdtempSync(path.join(tmpdir(), 'ptah-proxy-mcp-'));
  });

  afterEach(() => {
    rmSync(tmpUserData, { recursive: true, force: true });
  });

  /** Resolve as soon as `transport.call` is invoked for `chat:start`. */
  function captureChatStart(transport: jest.Mocked<CliMessageTransport>): {
    waitForCall: () => Promise<unknown>;
  } {
    let resolveCall: (params: unknown) => void;
    const callPromise = new Promise<unknown>((resolve) => {
      resolveCall = resolve;
    });
    (transport.call as jest.Mock).mockImplementation(
      async (method: string, params: unknown) => {
        if (method === 'chat:start') {
          resolveCall(params);
          return { success: true };
        }
        return undefined;
      },
    );
    return { waitForCall: () => callPromise };
  }

  /** Read the minted token off the notifier (`proxy.token.issued`). */
  function tokenFromNotifier(notifier: jest.Mocked<ProxyNotifier>): string {
    const issued = notifier.notify.mock.calls.find(
      ([m]) => m === 'proxy.token.issued',
    );
    if (!issued) throw new Error('proxy.token.issued was not emitted');
    const params = issued[1] as { token: string };
    return params.token;
  }

  it('parses X-Ptah-Mcp-Servers header into mcpServersOverride on chat:start', async () => {
    const httpStub = makeStubHttpProvider();
    const transport = makeStubTransport();
    const pushAdapter = makeStubPushAdapter();
    const notifier = makeStubNotifier();
    const { waitForCall } = captureChatStart(transport);

    const service = new AnthropicProxyService(
      makeBaseConfig(tmpUserData),
      httpStub.provider,
      transport,
      pushAdapter,
      notifier,
    );
    await service.start();
    const token = tokenFromNotifier(notifier);
    const dispatcher = httpStub.dispatcher;
    if (dispatcher === null) throw new Error('dispatcher not captured');

    const headerValue = JSON.stringify({
      ptah: {
        type: 'http',
        url: 'http://override.example/proxy',
        headers: { 'X-Trace': 'on' },
      },
    });
    const req = makeSyntheticReq({
      url: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': token,
        'content-type': 'application/json',
        'x-ptah-mcp-servers': headerValue,
      },
      body: JSON.stringify({
        model: 'ptah-default',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const { res } = makeSyntheticRes();
    dispatcher(req, res);

    const params = (await waitForCall()) as Record<string, unknown>;
    expect(params['mcpServersOverride']).toEqual({
      ptah: {
        type: 'http',
        url: 'http://override.example/proxy',
        headers: { 'X-Trace': 'on' },
      },
    });

    await service.stop('shutdown');
  });

  it('emits proxy.warning kind=mcp_override_invalid on malformed header — and proceeds without override', async () => {
    const httpStub = makeStubHttpProvider();
    const transport = makeStubTransport();
    const pushAdapter = makeStubPushAdapter();
    const notifier = makeStubNotifier();
    const { waitForCall } = captureChatStart(transport);

    const service = new AnthropicProxyService(
      makeBaseConfig(tmpUserData),
      httpStub.provider,
      transport,
      pushAdapter,
      notifier,
    );
    await service.start();
    const token = tokenFromNotifier(notifier);
    const dispatcher = httpStub.dispatcher;
    if (dispatcher === null) throw new Error('dispatcher not captured');

    const req = makeSyntheticReq({
      url: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': token,
        'content-type': 'application/json',
        'x-ptah-mcp-servers': '{not-json',
      },
      body: JSON.stringify({
        model: 'ptah-default',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const { res } = makeSyntheticRes();
    dispatcher(req, res);

    const params = (await waitForCall()) as Record<string, unknown>;
    // Q2=A locked — malformed header MUST NOT block the request. We proceed
    // with `undefined` so the SDK chain's identity-preserving merge runs.
    expect(params['mcpServersOverride']).toBeUndefined();

    const warningCall = notifier.notify.mock.calls.find(
      ([method, p]) =>
        method === 'proxy.warning' &&
        (p as { kind?: string } | undefined)?.kind === 'mcp_override_invalid',
    );
    expect(warningCall).toBeDefined();

    await service.stop('shutdown');
  });

  it('omits mcpServersOverride when header is absent', async () => {
    const httpStub = makeStubHttpProvider();
    const transport = makeStubTransport();
    const pushAdapter = makeStubPushAdapter();
    const notifier = makeStubNotifier();
    const { waitForCall } = captureChatStart(transport);

    const service = new AnthropicProxyService(
      makeBaseConfig(tmpUserData),
      httpStub.provider,
      transport,
      pushAdapter,
      notifier,
    );
    await service.start();
    const token = tokenFromNotifier(notifier);
    const dispatcher = httpStub.dispatcher;
    if (dispatcher === null) throw new Error('dispatcher not captured');

    const req = makeSyntheticReq({
      url: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'ptah-default',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const { res } = makeSyntheticRes();
    dispatcher(req, res);

    const params = (await waitForCall()) as Record<string, unknown>;
    // Property must be absent (not set to undefined) so JSON-RPC payloads
    // are byte-identical to the pre-T2 shape on non-proxy calls.
    expect(
      Object.prototype.hasOwnProperty.call(params, 'mcpServersOverride'),
    ).toBe(false);

    // No mcp_override_invalid warning when the header is absent.
    const warningCall = notifier.notify.mock.calls.find(
      ([method, p]) =>
        method === 'proxy.warning' &&
        (p as { kind?: string } | undefined)?.kind === 'mcp_override_invalid',
    );
    expect(warningCall).toBeUndefined();

    await service.stop('shutdown');
  });
});
