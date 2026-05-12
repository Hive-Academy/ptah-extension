/**
 * rpc-call.util.ts unit specs.
 *
 * Critical isolation: The module exports a module-level singleton `_client`.
 * The `RpcClient` gates outbound sends on an internal `readyPromise`. Because
 * `rpcCall` awaits that promise before posting, `postMessage` is called
 * asynchronously even after `markReady()`. Tests must use `await flushMicrotasks()`
 * (a `Promise.resolve()` tick) after calling `rpcCall()` to ensure postMessage fires.
 *
 * We drive the window `message` listener via:
 *   window.dispatchEvent(new MessageEvent('message', { data }))
 */

import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { getRpcClient, rpcCall } from './rpc-call.util';
import { VSCodeService } from './vscode.service';

interface PtahTestWindow {
  vscode?: {
    postMessage: jest.Mock<void, [unknown]>;
    getState: jest.Mock<unknown, []>;
    setState: jest.Mock<void, [unknown]>;
  };
  ptahConfig?: Record<string, unknown>;
}

function getPtahWindow(): PtahTestWindow {
  return window as unknown as PtahTestWindow;
}

function installVsCodeApi(): jest.Mock<void, [unknown]> {
  const postMessage = jest.fn<void, [unknown]>();
  getPtahWindow().vscode = {
    postMessage,
    getState: jest.fn(() => ({})),
    setState: jest.fn(),
  };
  getPtahWindow().ptahConfig = {
    isVSCode: true,
    theme: 'dark',
    workspaceRoot: '',
    workspaceName: '',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
  };
  return postMessage;
}

function uninstallVsCodeApi(): void {
  delete getPtahWindow().vscode;
  delete getPtahWindow().ptahConfig;
}

/** Flush microtasks (let async/await chains complete one hop) */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function simulateRpcResponse(data: {
  type: string;
  success?: boolean;
  data?: unknown;
  error?: string | { message: string } | null;
  correlationId?: string;
}): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

describe('getRpcClient() and RpcClient', () => {
  let postMessage: jest.Mock<void, [unknown]>;
  let vscodeService: VSCodeService;

  beforeEach(() => {
    postMessage = installVsCodeApi();
    TestBed.configureTestingModule({ providers: [VSCodeService] });
    vscodeService = TestBed.inject(VSCodeService);
    // Ensure the singleton is ready
    getRpcClient().markReady();
  });

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
    uninstallVsCodeApi();
    postMessage.mockClear();
  });

  it('getRpcClient() returns the same singleton on repeated calls', () => {
    const client1 = getRpcClient();
    const client2 = getRpcClient();
    expect(client1).toBe(client2);
  });

  it('markReady() is idempotent — calling twice does not throw', () => {
    expect(() => {
      getRpcClient().markReady();
      getRpcClient().markReady();
    }).not.toThrow();
  });

  it('rpcCall posts RPC_CALL message with method, params, and correlationId after microtask', async () => {
    postMessage.mockClear();
    const pending = rpcCall(vscodeService, 'editor:openFile', {
      path: '/file.ts',
    });

    // After awaiting the readyPromise microtask, postMessage must be called
    await flushMicrotasks();

    expect(postMessage).toHaveBeenCalled();
    const msg = postMessage.mock.calls[
      postMessage.mock.calls.length - 1
    ][0] as {
      type: string;
      payload: { method: string; params: unknown; correlationId: string };
    };

    expect(msg.type).toBe(MESSAGE_TYPES.RPC_CALL);
    expect(msg.payload.method).toBe('editor:openFile');
    expect(msg.payload.params).toEqual({ path: '/file.ts' });
    expect(typeof msg.payload.correlationId).toBe('string');
    expect(msg.payload.correlationId.length).toBeGreaterThan(0);

    // Respond to prevent dangling promise
    simulateRpcResponse({
      type: MESSAGE_TYPES.RPC_RESPONSE,
      success: true,
      data: { opened: true },
      correlationId: msg.payload.correlationId,
    });
    await pending;
  });

  it('rpcCall resolves with success=true and data when matching response arrives', async () => {
    postMessage.mockClear();
    const pending = rpcCall<{ opened: boolean }>(
      vscodeService,
      'editor:openFile',
      { path: '/file.ts' },
    );

    await flushMicrotasks();

    const msg = postMessage.mock.calls[
      postMessage.mock.calls.length - 1
    ][0] as {
      payload: { correlationId: string };
    };

    simulateRpcResponse({
      type: MESSAGE_TYPES.RPC_RESPONSE,
      success: true,
      data: { opened: true },
      correlationId: msg.payload.correlationId,
    });

    const result = await pending;
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ opened: true });
  });

  it('rpcCall resolves with success=false and error string on timeout', async () => {
    jest.useFakeTimers();
    postMessage.mockClear();

    const pending = rpcCall(
      vscodeService,
      'editor:openFile',
      { path: '/file.ts' },
      500, // short timeout
    );

    // Advance past the readyPromise microtask then the timer
    await flushMicrotasks();
    jest.advanceTimersByTime(500);

    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.error).toContain('RPC timeout');
    expect(result.error).toContain('editor:openFile');
  });

  it('late response after timeout is silently dropped (no throw)', async () => {
    jest.useFakeTimers();
    postMessage.mockClear();

    const pending = rpcCall(
      vscodeService,
      'editor:openFile',
      { path: '/f.ts' },
      100,
    );

    await flushMicrotasks();

    const msg = postMessage.mock.calls[
      postMessage.mock.calls.length - 1
    ][0] as {
      payload: { correlationId: string };
    };
    const correlationId = msg.payload.correlationId;

    jest.advanceTimersByTime(100);
    await pending;

    // Now send a late response — must not throw
    expect(() => {
      simulateRpcResponse({
        type: MESSAGE_TYPES.RPC_RESPONSE,
        success: true,
        data: { opened: true },
        correlationId,
      });
    }).not.toThrow();
  });

  it('onMessage ignores events with non-RPC_RESPONSE type', async () => {
    postMessage.mockClear();
    const pending = rpcCall<{ opened: boolean }>(
      vscodeService,
      'editor:openFile',
      { path: '/file.ts' },
    );

    await flushMicrotasks();
    const msg = postMessage.mock.calls[
      postMessage.mock.calls.length - 1
    ][0] as {
      payload: { correlationId: string };
    };

    // Send wrong type — should be ignored
    simulateRpcResponse({
      type: 'WRONG_TYPE',
      success: true,
      data: { opened: true },
      correlationId: msg.payload.correlationId,
    });

    // Now send the correct type to resolve
    simulateRpcResponse({
      type: MESSAGE_TYPES.RPC_RESPONSE,
      success: true,
      data: { opened: true },
      correlationId: msg.payload.correlationId,
    });

    const result = await pending;
    expect(result.success).toBe(true);
  });

  it('onMessage ignores events with missing correlationId string', async () => {
    jest.useFakeTimers();
    postMessage.mockClear();

    const pending = rpcCall(
      vscodeService,
      'editor:openFile',
      { path: '/file.ts' },
      200,
    );

    await flushMicrotasks();

    // Event with no correlationId (non-string)
    simulateRpcResponse({
      type: MESSAGE_TYPES.RPC_RESPONSE,
      success: true,
      data: {},
      // no correlationId field
    });

    jest.advanceTimersByTime(200);
    const result = await pending;
    // Should have timed out, not resolved via the message without correlationId
    expect(result.success).toBe(false);
    expect(result.error).toContain('RPC timeout');
  });

  it('onMessage ignores response with unknown correlationId (pending entry missing)', async () => {
    jest.useFakeTimers();
    postMessage.mockClear();

    const pending = rpcCall(
      vscodeService,
      'editor:openFile',
      { path: '/f.ts' },
      100,
    );
    await flushMicrotasks();

    jest.advanceTimersByTime(100);
    await pending;

    // Stale response with unknown correlationId — must not throw
    expect(() => {
      simulateRpcResponse({
        type: MESSAGE_TYPES.RPC_RESPONSE,
        success: true,
        data: {},
        correlationId: 'totally-unknown-id',
      });
    }).not.toThrow();
  });

  it('onMessage normalizes string error from response', async () => {
    postMessage.mockClear();
    const pending = rpcCall(vscodeService, 'editor:openFile', {
      path: '/f.ts',
    });

    await flushMicrotasks();
    const msg = postMessage.mock.calls[
      postMessage.mock.calls.length - 1
    ][0] as {
      payload: { correlationId: string };
    };

    simulateRpcResponse({
      type: MESSAGE_TYPES.RPC_RESPONSE,
      success: false,
      error: 'file not found',
      correlationId: msg.payload.correlationId,
    });

    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.error).toBe('file not found');
  });

  it('onMessage normalizes { message } error object to string', async () => {
    postMessage.mockClear();
    const pending = rpcCall(vscodeService, 'editor:openFile', {
      path: '/f.ts',
    });

    await flushMicrotasks();
    const msg = postMessage.mock.calls[
      postMessage.mock.calls.length - 1
    ][0] as {
      payload: { correlationId: string };
    };

    simulateRpcResponse({
      type: MESSAGE_TYPES.RPC_RESPONSE,
      success: false,
      error: { message: 'structured error message' } as unknown as string,
      correlationId: msg.payload.correlationId,
    });

    const result = await pending;
    expect(result.error).toBe('structured error message');
  });

  it('onMessage passes undefined error when error is null', async () => {
    postMessage.mockClear();
    const pending = rpcCall(vscodeService, 'editor:openFile', {
      path: '/f.ts',
    });

    await flushMicrotasks();
    const msg = postMessage.mock.calls[
      postMessage.mock.calls.length - 1
    ][0] as {
      payload: { correlationId: string };
    };

    simulateRpcResponse({
      type: MESSAGE_TYPES.RPC_RESPONSE,
      success: true,
      data: { opened: true },
      error: null as unknown as string,
      correlationId: msg.payload.correlationId,
    });

    const result = await pending;
    expect(result.error).toBeUndefined();
  });

  it('inbound RPC_RESPONSE with unknown correlationId does not throw (markReadyFn side-effect covered)', () => {
    // The singleton is already ready; this tests the path where markReadyFn is
    // called again (idempotent) by any inbound response.
    expect(() => {
      simulateRpcResponse({
        type: MESSAGE_TYPES.RPC_RESPONSE,
        success: true,
        data: {},
        correlationId: 'not-in-pending-map',
      });
    }).not.toThrow();
  });
});
