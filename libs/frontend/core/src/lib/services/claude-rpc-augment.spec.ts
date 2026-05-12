/**
 * ClaudeRpcService — additional specs for AbortSignal branches and typed
 * method wrappers (augments claude-rpc.service.spec.ts).
 *
 * Kept as a separate file to avoid one enormous file; Jest will merge
 * coverage from both spec files for the same source.
 */

import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { AppStateManager } from './app-state.service';
import { ClaudeRpcService, RpcResult } from './claude-rpc.service';
import { VSCodeService } from './vscode.service';

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

interface PostedRpcMessage {
  type: string;
  payload: {
    method: string;
    params: unknown;
    correlationId: string;
  };
}

function lastPostedRpc(
  postMessage: jest.Mock<void, [unknown]>,
): PostedRpcMessage {
  expect(postMessage).toHaveBeenCalled();
  const lastCall = postMessage.mock.calls[postMessage.mock.calls.length - 1];
  return lastCall[0] as PostedRpcMessage;
}

describe('ClaudeRpcService — AbortSignal branches', () => {
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

  it('pre-aborted signal returns error immediately without posting any message', async () => {
    const controller = new AbortController();
    controller.abort();

    postMessage.mockClear();
    const result = await service.call(
      'session:list',
      { workspacePath: '/tmp' },
      { signal: controller.signal },
    );

    expect(result.isError()).toBe(true);
    expect(result.error).toContain('RPC aborted');
    expect(result.error).toContain('session:list');
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('signal fired during in-flight call resolves with abort error', async () => {
    const controller = new AbortController();
    const pending = service.call(
      'session:list',
      { workspacePath: '/tmp' },
      { signal: controller.signal, timeout: 5000 },
    );

    // Abort after the call is in flight
    controller.abort();

    const result = await pending;
    expect(result.isError()).toBe(true);
    expect(result.error).toContain('RPC aborted');
  });

  it('abort listener is detached when call resolves before abort fires', async () => {
    const controller = new AbortController();
    const pending = service.call(
      'session:list',
      { workspacePath: '/tmp' },
      { signal: controller.signal },
    );

    const sent = lastPostedRpc(postMessage);

    // Resolve the call first
    service.handleResponse({
      success: true,
      data: { sessions: [], total: 0, hasMore: false },
      correlationId: sent.payload.correlationId,
    });

    const result = await pending;
    expect(result.isSuccess()).toBe(true);

    // Abort after resolution — must not throw or double-resolve
    expect(() => controller.abort()).not.toThrow();
  });

  it('late response after abort does not double-resolve (no throw)', async () => {
    jest.useFakeTimers();
    const controller = new AbortController();
    const pending = service.call(
      'session:list',
      { workspacePath: '/tmp' },
      { signal: controller.signal, timeout: 5000 },
    );

    const sent = lastPostedRpc(postMessage);

    controller.abort();
    const result = await pending;
    expect(result.isError()).toBe(true);

    // Late response arriving after abort — must be silently dropped
    expect(() =>
      service.handleResponse({
        success: true,
        data: { sessions: [], total: 0, hasMore: false },
        correlationId: sent.payload.correlationId,
      }),
    ).not.toThrow();
  });
});

describe('ClaudeRpcService — typed method wrappers', () => {
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

  it('listSessions posts session:list with workspacePath, limit, offset', async () => {
    const pending = service.listSessions('/workspace', 20, 5);
    const sent = lastPostedRpc(postMessage);

    expect(sent.payload.method).toBe('session:list');
    expect(sent.payload.params).toEqual({
      workspacePath: '/workspace',
      limit: 20,
      offset: 5,
    });

    service.handleResponse({
      success: true,
      data: { sessions: [], total: 0, hasMore: false },
      correlationId: sent.payload.correlationId,
    });
    const result = await pending;
    expect(result.isSuccess()).toBe(true);
  });

  it('loadSession posts session:load with sessionId', async () => {
    const pending = service.loadSession(
      'sess-abc' as Parameters<typeof service.loadSession>[0],
    );
    const sent = lastPostedRpc(postMessage);

    expect(sent.payload.method).toBe('session:load');
    expect(sent.payload.params).toEqual({ sessionId: 'sess-abc' });

    service.handleResponse({
      success: true,
      data: { session: null, messages: [] },
      correlationId: sent.payload.correlationId,
    });
    const result = await pending;
    expect(result.isSuccess()).toBe(true);
  });

  it('openFile posts file:open with path and optional line', async () => {
    const pending = service.openFile('/path/to/file.ts', 42);
    const sent = lastPostedRpc(postMessage);

    expect(sent.payload.method).toBe('file:open');
    expect(sent.payload.params).toEqual({ path: '/path/to/file.ts', line: 42 });

    service.handleResponse({
      success: true,
      data: { opened: true },
      correlationId: sent.payload.correlationId,
    });
    await pending;
  });

  it('openFile without line posts file:open with line=undefined', async () => {
    const pending = service.openFile('/path/to/file.ts');
    const sent = lastPostedRpc(postMessage);

    expect(sent.payload.method).toBe('file:open');
    expect(
      (sent.payload.params as Record<string, unknown>)['line'],
    ).toBeUndefined();

    service.handleResponse({
      success: true,
      data: { opened: true },
      correlationId: sent.payload.correlationId,
    });
    await pending;
  });

  it('deleteSession posts session:delete with sessionId', async () => {
    const pending = service.deleteSession(
      'sess-del' as Parameters<typeof service.deleteSession>[0],
    );
    const sent = lastPostedRpc(postMessage);

    expect(sent.payload.method).toBe('session:delete');
    expect(sent.payload.params).toEqual({ sessionId: 'sess-del' });

    service.handleResponse({
      success: true,
      data: { success: true },
      correlationId: sent.payload.correlationId,
    });
    await pending;
  });

  it('renameSession posts session:rename with sessionId and name', async () => {
    const pending = service.renameSession(
      'sess-ren' as Parameters<typeof service.renameSession>[0],
      'New Name',
    );
    const sent = lastPostedRpc(postMessage);

    expect(sent.payload.method).toBe('session:rename');
    expect(sent.payload.params).toEqual({
      sessionId: 'sess-ren',
      name: 'New Name',
    });

    service.handleResponse({
      success: true,
      data: { success: true },
      correlationId: sent.payload.correlationId,
    });
    await pending;
  });

  it('querySubagents posts chat:subagent-query with empty params', async () => {
    const pending = service.querySubagents();
    const sent = lastPostedRpc(postMessage);

    expect(sent.payload.method).toBe('chat:subagent-query');
    expect(sent.payload.params).toEqual({});

    service.handleResponse({
      success: true,
      data: { agents: [] },
      correlationId: sent.payload.correlationId,
    });
    await pending;
  });

  it('sendSubagentMessage posts subagent:send-message with correct params', async () => {
    const pending = service.sendSubagentMessage(
      'sess-1' as Parameters<typeof service.sendSubagentMessage>[0],
      'tool-use-id',
      'Hello agent!',
    );
    const sent = lastPostedRpc(postMessage);

    expect(sent.payload.method).toBe('subagent:send-message');
    expect(sent.payload.params).toEqual({
      sessionId: 'sess-1',
      parentToolUseId: 'tool-use-id',
      text: 'Hello agent!',
    });

    service.handleResponse({
      success: true,
      data: { queued: true },
      correlationId: sent.payload.correlationId,
    });
    await pending;
  });

  it('stopSubagent posts subagent:stop with sessionId and taskId', async () => {
    const pending = service.stopSubagent(
      'sess-1' as Parameters<typeof service.stopSubagent>[0],
      'task-abc',
    );
    const sent = lastPostedRpc(postMessage);

    expect(sent.payload.method).toBe('subagent:stop');
    expect(sent.payload.params).toEqual({
      sessionId: 'sess-1',
      taskId: 'task-abc',
    });

    service.handleResponse({
      success: true,
      data: { stopped: true },
      correlationId: sent.payload.correlationId,
    });
    await pending;
  });

  it('interruptSubagentSession posts subagent:interrupt with sessionId', async () => {
    const pending = service.interruptSubagentSession(
      'sess-1' as Parameters<typeof service.interruptSubagentSession>[0],
    );
    const sent = lastPostedRpc(postMessage);

    expect(sent.payload.method).toBe('subagent:interrupt');
    expect(sent.payload.params).toEqual({ sessionId: 'sess-1' });

    service.handleResponse({
      success: true,
      data: { interrupted: true },
      correlationId: sent.payload.correlationId,
    });
    await pending;
  });

  it('RpcResult.isSuccess() returns false when data is undefined even with success=true', () => {
    // Edge case: success=true but no data
    const result = new RpcResult(true, undefined, undefined);
    expect(result.isSuccess()).toBe(false);
  });

  it('RpcResult.isError() returns true when success=false', () => {
    const result = new RpcResult(false, undefined, 'some error');
    expect(result.isError()).toBe(true);
  });

  it('RpcResult handles MESSAGE_TYPES.RPC_RESPONSE via handleMessage dispatch', async () => {
    const pending = service.call('session:list', { workspacePath: '/tmp' });
    const sent = lastPostedRpc(postMessage);

    service.handleMessage({
      type: MESSAGE_TYPES.RPC_RESPONSE,
      success: true,
      data: { sessions: [{ id: 'abc' }], total: 1, hasMore: false },
      correlationId: sent.payload.correlationId,
    } as unknown as { type: string; payload?: unknown });

    const result = await pending;
    expect(result.isSuccess()).toBe(true);
  });
});
