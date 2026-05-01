/**
 * ClaudeRpcService specs — request/response correlation, timeouts, error
 * propagation, and subscription cleanup.
 *
 * VS Code API surface mocked at the window boundary:
 *   - `window.vscode.postMessage` (writes from `VSCodeService` private field).
 *   - `window.ptahConfig` (read by `VSCodeService` constructor so the service
 *     flips into "connected" mode and the `vscode` field is populated —
 *     `postRpcMessage` only sends when that field is truthy).
 *   - `window.addEventListener('message', …)` is NOT used by this service;
 *     responses arrive via `handleMessage` / `handleResponse`, which specs
 *     invoke directly — the real listener lives in `MessageRouterService`.
 *
 * Zone-less / signal notes:
 *   - Angular 21 zoneless. Tests drive promises via `await Promise.resolve()`
 *     microtask ticks rather than `fakeAsync`/`tick` because the service
 *     resolves via `setTimeout` + resolver callbacks, both of which are
 *     already native in Jest's fake timers.
 */

import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { AppStateManager } from './app-state.service';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import { VSCodeService } from './vscode.service';

interface PostedRpcMessage {
  type: string;
  payload: {
    method: string;
    params: unknown;
    correlationId: string;
  };
}

interface PtahTestWindow {
  vscode?: {
    postMessage: jest.Mock<void, [unknown]>;
    getState: jest.Mock<unknown, []>;
    setState: jest.Mock<void, [unknown]>;
  };
  ptahConfig?: Record<string, unknown>;
}

function installVsCodeApi(): jest.Mock<void, [unknown]> {
  const postMessage = jest.fn<void, [unknown]>();
  const ptahWindow = window as unknown as PtahTestWindow;
  ptahWindow.vscode = {
    postMessage,
    getState: jest.fn(() => ({})),
    setState: jest.fn(),
  };
  ptahWindow.ptahConfig = {
    isVSCode: true,
    theme: 'dark',
    workspaceRoot: '',
    workspaceName: '',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    isLicensed: true,
  };
  return postMessage;
}

function uninstallVsCodeApi(): void {
  const ptahWindow = window as unknown as PtahTestWindow;
  delete ptahWindow.vscode;
  delete ptahWindow.ptahConfig;
}

/**
 * Pull the most recent posted RPC payload — the service generates a fresh
 * correlationId per call, so tests read it back off the captured message.
 */
function lastPostedRpc(
  postMessage: jest.Mock<void, [unknown]>,
): PostedRpcMessage {
  expect(postMessage).toHaveBeenCalled();
  const lastCall = postMessage.mock.calls[postMessage.mock.calls.length - 1];
  return lastCall[0] as PostedRpcMessage;
}

describe('ClaudeRpcService', () => {
  let postMessage: jest.Mock<void, [unknown]>;
  let service: ClaudeRpcService;

  beforeEach(() => {
    postMessage = installVsCodeApi();
    TestBed.configureTestingModule({
      providers: [ClaudeRpcService, VSCodeService, AppStateManager],
    });
    service = TestBed.inject(ClaudeRpcService);
  });

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
    uninstallVsCodeApi();
  });

  describe('call() request/response correlation', () => {
    it('sends an RPC_CALL message with a correlationId and resolves with the matching response', async () => {
      const pending = service.call('session:list', { workspacePath: '/tmp' });

      const sent = lastPostedRpc(postMessage);
      expect(sent.type).toBe(MESSAGE_TYPES.RPC_CALL);
      expect(sent.payload.method).toBe('session:list');
      expect(sent.payload.params).toEqual({ workspacePath: '/tmp' });
      expect(typeof sent.payload.correlationId).toBe('string');
      expect(sent.payload.correlationId.length).toBeGreaterThan(0);

      // Simulate backend response arriving via the message router dispatch.
      service.handleMessage({
        type: MESSAGE_TYPES.RPC_RESPONSE,
        payload: undefined,
        success: true,
        data: { sessions: [], total: 0, hasMore: false },
        correlationId: sent.payload.correlationId,
      } as unknown as { type: string; payload?: unknown });

      const result = await pending;
      expect(result).toBeInstanceOf(RpcResult);
      expect(result.isSuccess()).toBe(true);
      if (result.isSuccess()) {
        expect(result.data).toEqual({
          sessions: [],
          total: 0,
          hasMore: false,
        });
      }
    });

    it('ignores responses with an unknown correlationId and leaves the promise pending', async () => {
      jest.useFakeTimers();
      const pending = service.call(
        'session:list',
        { workspacePath: '/tmp' },
        { timeout: 5000 },
      );

      // Response with a bogus correlation id must NOT resolve the call.
      service.handleResponse({
        success: true,
        data: { foo: 'bar' },
        correlationId: 'not-the-real-id',
      });

      // Microtask flush — pending should still be unresolved.
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      // Timeout path resolves the pending promise so Jest can tear down cleanly.
      jest.advanceTimersByTime(5000);
      const result = await pending;
      expect(result.isError()).toBe(true);
    });

    it('matches concurrent calls to their own responses by correlationId', async () => {
      const first = service.call('session:list', { workspacePath: '/a' });
      const firstSent = lastPostedRpc(postMessage);

      const second = service.call('session:list', { workspacePath: '/b' });
      const secondSent = lastPostedRpc(postMessage);

      expect(firstSent.payload.correlationId).not.toBe(
        secondSent.payload.correlationId,
      );

      // Respond out-of-order.
      service.handleResponse({
        success: true,
        data: { sessions: [{ id: 'B' }], total: 1, hasMore: false },
        correlationId: secondSent.payload.correlationId,
      });
      service.handleResponse({
        success: true,
        data: { sessions: [{ id: 'A' }], total: 1, hasMore: false },
        correlationId: firstSent.payload.correlationId,
      });

      const [a, b] = await Promise.all([first, second]);
      expect(a.isSuccess() && a.data).toEqual({
        sessions: [{ id: 'A' }],
        total: 1,
        hasMore: false,
      });
      expect(b.isSuccess() && b.data).toEqual({
        sessions: [{ id: 'B' }],
        total: 1,
        hasMore: false,
      });
    });
  });

  describe('timeout handling', () => {
    it('resolves with an error RpcResult after the configured timeout', async () => {
      jest.useFakeTimers();
      const pending = service.call(
        'session:list',
        { workspacePath: '/tmp' },
        { timeout: 1000 },
      );

      jest.advanceTimersByTime(999);
      // Still pending — only 999ms elapsed.
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      jest.advanceTimersByTime(1);
      const result = await pending;
      expect(result.isError()).toBe(true);
      expect(result.error).toContain('RPC timeout');
      expect(result.error).toContain('session:list');
    });

    it('clears the pending subscription when a timeout fires', async () => {
      jest.useFakeTimers();
      const pending = service.call(
        'session:list',
        { workspacePath: '/tmp' },
        { timeout: 100 },
      );
      const sent = lastPostedRpc(postMessage);

      jest.advanceTimersByTime(100);
      await pending;

      // A late response after the timeout must not throw or double-resolve.
      expect(() =>
        service.handleResponse({
          success: true,
          data: { sessions: [], total: 0, hasMore: false },
          correlationId: sent.payload.correlationId,
        }),
      ).not.toThrow();

      const pendingCalls = (
        service as unknown as { pendingCalls: Map<string, unknown> }
      ).pendingCalls;
      expect(pendingCalls.has(sent.payload.correlationId)).toBe(false);
    });
  });

  describe('error propagation', () => {
    it('propagates string errors from the backend into RpcResult.error', async () => {
      const pending = service.call('session:list', { workspacePath: '/tmp' });
      const sent = lastPostedRpc(postMessage);

      service.handleResponse({
        success: false,
        error: 'workspace not found',
        correlationId: sent.payload.correlationId,
      });

      const result = await pending;
      expect(result.isError()).toBe(true);
      expect(result.error).toBe('workspace not found');
    });

    it('normalizes { message } error objects into a string', async () => {
      const pending = service.call('session:list', { workspacePath: '/tmp' });
      const sent = lastPostedRpc(postMessage);

      service.handleResponse({
        success: false,
        error: { message: 'structured failure' },
        correlationId: sent.payload.correlationId,
      });

      const result = await pending;
      expect(result.error).toBe('structured failure');
    });

    it('propagates errorCode for license-related failures', async () => {
      const pending = service.call('session:list', { workspacePath: '/tmp' });
      const sent = lastPostedRpc(postMessage);

      service.handleResponse({
        success: false,
        error: 'pro tier required',
        errorCode: 'PRO_TIER_REQUIRED',
        correlationId: sent.payload.correlationId,
      });

      const result = await pending;
      expect(result.isLicenseError()).toBe(true);
      expect(result.isProRequired()).toBe(true);
    });

    it('blocks unlicensed callers from non-whitelisted methods without posting anything', async () => {
      const appState = TestBed.inject(AppStateManager);
      (
        appState as unknown as { _isLicensed: { set: (v: boolean) => void } }
      )._isLicensed.set(false);

      postMessage.mockClear();
      const result = await service.call('session:list', {
        workspacePath: '/tmp',
      });

      expect(result.isError()).toBe(true);
      expect(result.errorCode).toBe('LICENSE_REQUIRED');
      expect(postMessage).not.toHaveBeenCalled();
    });
  });

  describe('subscription cleanup', () => {
    it('removes the pending resolver from the registry once a response arrives', async () => {
      const pending = service.call('session:list', { workspacePath: '/tmp' });
      const sent = lastPostedRpc(postMessage);
      const pendingCalls = (
        service as unknown as { pendingCalls: Map<string, unknown> }
      ).pendingCalls;

      expect(pendingCalls.has(sent.payload.correlationId)).toBe(true);

      service.handleResponse({
        success: true,
        data: { sessions: [], total: 0, hasMore: false },
        correlationId: sent.payload.correlationId,
      });
      await pending;

      expect(pendingCalls.has(sent.payload.correlationId)).toBe(false);
    });

    it('forwards handleMessage(RPC_RESPONSE) to the matching resolver', async () => {
      const pending = service.call('session:list', { workspacePath: '/tmp' });
      const sent = lastPostedRpc(postMessage);

      // MessageRouter dispatch path — a full message envelope.
      service.handleMessage({
        type: MESSAGE_TYPES.RPC_RESPONSE,
        success: true,
        data: { sessions: [], total: 0, hasMore: false },
        correlationId: sent.payload.correlationId,
      } as unknown as { type: string; payload?: unknown });

      const result = await pending;
      expect(result.isSuccess()).toBe(true);
    });

    it('exposes MESSAGE_TYPES.RPC_RESPONSE via handledMessageTypes', () => {
      expect(service.handledMessageTypes).toContain(MESSAGE_TYPES.RPC_RESPONSE);
    });
  });

  describe('forkSession() / rewindFiles() wrappers', () => {
    it('forkSession posts session:forkSession with all params and a 15s timeout', async () => {
      jest.useFakeTimers();
      const pending = service.forkSession(
        'sess-1' as unknown as Parameters<typeof service.forkSession>[0],
        'msg-42',
        'My Branch',
      );
      const sent = lastPostedRpc(postMessage);

      expect(sent.payload.method).toBe('session:forkSession');
      expect(sent.payload.params).toEqual({
        sessionId: 'sess-1',
        upToMessageId: 'msg-42',
        title: 'My Branch',
      });

      // Default timeout is 30s — confirm the wrapper bumped to 15s by checking
      // it has NOT timed out at 14999ms but DOES at 15000ms.
      jest.advanceTimersByTime(14999);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      service.handleResponse({
        success: true,
        data: { newSessionId: 'sess-2' },
        correlationId: sent.payload.correlationId,
      });

      const result = await pending;
      expect(result.isSuccess()).toBe(true);
      if (result.isSuccess()) {
        expect(result.data.newSessionId).toBe('sess-2');
      }
    });

    it('forkSession works with only the required sessionId', async () => {
      const pending = service.forkSession(
        'sess-1' as unknown as Parameters<typeof service.forkSession>[0],
      );
      const sent = lastPostedRpc(postMessage);

      expect(sent.payload.method).toBe('session:forkSession');
      expect(sent.payload.params).toEqual({
        sessionId: 'sess-1',
        upToMessageId: undefined,
        title: undefined,
      });

      service.handleResponse({
        success: true,
        data: { newSessionId: 'sess-3' },
        correlationId: sent.payload.correlationId,
      });
      await pending;
    });

    it('rewindFiles posts session:rewindFiles with dryRun flag', async () => {
      const pending = service.rewindFiles(
        'sess-1' as unknown as Parameters<typeof service.rewindFiles>[0],
        'msg-99',
        true,
      );
      const sent = lastPostedRpc(postMessage);

      expect(sent.payload.method).toBe('session:rewindFiles');
      expect(sent.payload.params).toEqual({
        sessionId: 'sess-1',
        userMessageId: 'msg-99',
        dryRun: true,
      });

      service.handleResponse({
        success: true,
        data: {
          canRewind: true,
          filesChanged: ['/a.ts', '/b.ts'],
          insertions: 10,
          deletions: 4,
        },
        correlationId: sent.payload.correlationId,
      });

      const result = await pending;
      expect(result.isSuccess()).toBe(true);
      if (result.isSuccess()) {
        expect(result.data.canRewind).toBe(true);
        expect(result.data.filesChanged).toEqual(['/a.ts', '/b.ts']);
      }
    });

    it('rewindFiles propagates session-not-active error code through error string', async () => {
      const pending = service.rewindFiles(
        'sess-1' as unknown as Parameters<typeof service.rewindFiles>[0],
        'msg-99',
      );
      const sent = lastPostedRpc(postMessage);

      service.handleResponse({
        success: false,
        error: 'session-not-active: SDK process has exited',
        correlationId: sent.payload.correlationId,
      });

      const result = await pending;
      expect(result.isError()).toBe(true);
      expect(result.error).toMatch(/^session-not-active/);
    });
  });
});
