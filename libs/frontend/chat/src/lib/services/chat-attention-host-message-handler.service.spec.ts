import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AppStateManager, ClaudeRpcService, LoggingService,
  NOTIFICATION_FOCUS_ROUTER, SURFACE_FOCUS_ROUTER, NotificationService, RpcResult, VSCodeService,
} from '@ptah-extension/core';
import { MESSAGE_TYPES, type AttentionNotice, workspaceIdFromPath } from '@ptah-extension/shared';
import { ChatAttentionHostMessageHandler } from './chat-attention-host-message-handler.service';

describe('ChatAttentionHostMessageHandler', () => {
  const target = { workspaceId: workspaceIdFromPath('/workspace-a'), sessionId: 'session-1', tabId: 'tab-1' };
  const notice: AttentionNotice = {
    key: 'host-request-1', generation: 1, kind: 'permission',
    title: 'Permission required', occurredAt: 1, target,
  };
  const upsert = jest.fn();
  const resolve = jest.fn();
  const focus = jest.fn();
  const focusSurface = jest.fn();
  const call = jest.fn();
  const warn = jest.fn();
  const setStatusMessage = jest.fn();
  let ownerWorkspacePath: string | null;
  let ownerSessionId: string;
  let activeWorkspacePath: string | null;
  let workspaceRoot: string;
  let handler: ChatAttentionHostMessageHandler;

  beforeEach(async () => {
    jest.clearAllMocks();
    ownerWorkspacePath = '/workspace-a';
    ownerSessionId = 'session-1';
    activeWorkspacePath = '/workspace-active';
    workspaceRoot = '';
    call.mockResolvedValue(new RpcResult(true, { notices: [] }));
    focus.mockResolvedValue({ success: true, outcome: 'focused' });
    focusSurface.mockResolvedValue({ success: true, outcome: 'focused' });
    TestBed.configureTestingModule({ providers: [
      ChatAttentionHostMessageHandler,
      { provide: ClaudeRpcService, useValue: { call } },
      { provide: NotificationService, useValue: { upsert, resolve } },
      { provide: NOTIFICATION_FOCUS_ROUTER, useValue: { focus } },
      { provide: SURFACE_FOCUS_ROUTER, useValue: {
        kind: 'mcp-apps', canFocus: (id: string) => id === 'apps-session', focus: focusSurface,
      }, multi: true },
      { provide: LoggingService, useValue: { warn } },
      { provide: AppStateManager, useValue: { setStatusMessage } },
      { provide: VSCodeService, useValue: { config: () => ({ isVSCode: false, workspaceRoot }) } },
      { provide: TabManagerService, useValue: {
        get activeWorkspacePath() { return activeWorkspacePath; },
        findTabByIdAcrossWorkspaces: () => ({
          workspacePath: ownerWorkspacePath, tab: { id: 'tab-1', claudeSessionId: ownerSessionId, providerId: 'claude-cli' },
        }),
        findTabBySessionIdAcrossWorkspaces: () => null,
      } },
      { provide: DOCUMENT, useValue: document },
    ] });
    handler = TestBed.inject(ChatAttentionHostMessageHandler);
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    jest.clearAllMocks();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('reconciles a missed push on bootstrap', async () => {
    call.mockResolvedValue(new RpcResult(true, { notices: [notice] }));
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    window.dispatchEvent(new Event('focus'));
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(call).toHaveBeenCalledWith('attention:getSnapshot', {}, { timeout: 5000 });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      key: notice.key, generation: 1, workspacePath: '/workspace-a',
      soundEligible: false,
    }));
  });

  it('uses the kind title and a safe session context for a local projection', () => {
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice: { ...notice, title: 'Fix notifications' },
    } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Permission required', context: 'Claude · Fix notifications',
      sessionTitle: 'Fix notifications', provider: 'Claude',
      actions: [{ id: 'open', label: 'Show in canvas' }],
    }));
    expect(upsert.mock.lastCall?.[0].title).not.toContain('Fix notifications');
  });

  it('labels a validated unpartitioned owner from the matching local root', () => {
    ownerWorkspacePath = null;
    activeWorkspacePath = '/workspace-a';
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice: { ...notice, title: 'Fix notifications' },
    } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      workspacePath: '', workspaceName: 'workspace-a',
      title: 'Permission required', context: 'Claude · Fix notifications',
    }));
  });

  it('uses the matching renderer root for an unpartitioned owner', () => {
    ownerWorkspacePath = null;
    activeWorkspacePath = null;
    workspaceRoot = '/workspace-a';
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice: { ...notice, title: 'Fix notifications' },
    } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      workspacePath: '', workspaceName: 'workspace-a', context: 'Claude · Fix notifications',
    }));
  });

  it('keeps an unmatched unpartitioned owner unknown without a provider', () => {
    ownerWorkspacePath = null;
    activeWorkspacePath = '/another-workspace';
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice: { ...notice, title: 'Fix notifications' },
    } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      workspaceName: 'Unknown workspace', context: 'Fix notifications',
    }));
  });

  it('does not label an unpartitioned tab whose session does not own the request', () => {
    ownerWorkspacePath = null;
    activeWorkspacePath = '/workspace-a';
    ownerSessionId = 'other-session';
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice: { ...notice, title: 'Fix notifications' },
    } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      workspaceName: 'Unknown workspace', context: 'Fix notifications',
    }));
  });

  it('uses the kind title and session context but keeps a remote projection workspace unknown', () => {
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice: { ...notice, kind: 'question', title: 'Fix notifications',
        target: { ...target, workspaceId: workspaceIdFromPath('/remote') } },
    } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      workspaceName: 'Unknown workspace', title: 'Question needs an answer', context: 'Fix notifications',
    }));
    expect(upsert.mock.lastCall?.[0].title).not.toContain('Fix notifications');
  });

  it('uses the lane permission label for a host projection', () => {
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice: { ...notice, kind: 'lane-permission', title: 'Fix notifications' },
    } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Lane permission required', context: 'Claude · Fix notifications',
    }));
  });

  it('keeps ordinary slash and security-word titles but drops paths and keys', () => {
    for (const title of ['Fix token refresh', 'CI/CD pipeline', 'and/or', 'Use /compact', 'run /clear', '/init', '/review']) {
      handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
        change: 'upsert', notice: { ...notice, title },
      } });
      expect(upsert.mock.lastCall?.[0].context).toContain(title);
    }
    for (const title of ['/home/user/private', '/tmp', '/tmp/', '/etc', '/Volumes', '/SYSTEM', 'C:\\Users\\private', ['sk-', '1234567890abcdef'].join('')]) {
      handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
        change: 'upsert', notice: { ...notice, title },
      } });
      expect(upsert.mock.lastCall?.[0].context).toBe('Claude');
      expect(upsert.mock.lastCall?.[0].sessionTitle).toBeUndefined();
      expect(upsert.mock.lastCall?.[0].title).toBe('Permission required');
    }
  });

  it('caps the assembled provider and session context at 80 characters', () => {
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice: { ...notice, title: 'Long safe session title '.repeat(4) },
    } });
    const context = upsert.mock.lastCall?.[0].context;
    expect(context).toHaveLength(80);
    expect(context).toMatch(/…$/);
  });

  it('omits a default session title from context', () => {
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice: { ...notice, title: 'New session' },
    } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Permission required', context: 'Claude',
    }));
  });

  it('omits the lane permission default title from context', () => {
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice: { ...notice, kind: 'lane-permission', title: 'Lane permission required' },
    } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Lane permission required', context: 'Claude',
    }));
  });

  it('drops private or malformed push payloads', () => {
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice: { ...notice, prompt: 'private' },
    } });
    expect(warn).toHaveBeenCalledWith(expect.any(String), 'Invalid attention change dropped');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('resolves only the matching generation and ignores an old upsert', () => {
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: { change: 'upsert', notice } });
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'resolve', key: notice.key, generation: 1,
    } });
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: { change: 'upsert', notice } });
    expect(resolve).toHaveBeenCalledWith(notice.key, 1, 'host');
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it('resolves a newer generation and keeps an older resolve from removing it', () => {
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: { change: 'upsert', notice } });
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'resolve', key: notice.key, generation: 2,
    } });
    expect(resolve).toHaveBeenCalledWith(notice.key, 2, 'host');
  });

  it('rechecks a host click and refuses a stale request', async () => {
    call.mockResolvedValue(new RpcResult(true, { notices: [] }));
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_OPEN_TARGET, payload: {
      key: notice.key, generation: 1, target,
    } });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(focus).not.toHaveBeenCalled();
    expect(setStatusMessage).toHaveBeenCalledWith('Already answered');
  });

  it('reports a mismatched target instead of dropping the click silently', async () => {
    call.mockResolvedValue(new RpcResult(true, { notices: [{ ...notice,
      target: { ...target, sessionId: 'other-session' } }] }));
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_OPEN_TARGET, payload: {
      key: notice.key, generation: 1, target,
    } });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(setStatusMessage).toHaveBeenCalledWith('Target unavailable');
    expect(focus).not.toHaveBeenCalled();
  });

  it('retries a failed snapshot when the view is revealed', async () => {
    jest.useFakeTimers();
    call.mockRejectedValueOnce(new Error('private failure'))
      .mockResolvedValue(new RpcResult(true, { notices: [notice] }));
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(2000);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ key: notice.key }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private failure');
    jest.useRealTimers();
  });

  it('backs off and stops after five failed snapshots, then retries on focus', async () => {
    jest.useFakeTimers();
    try {
      call.mockRejectedValue(new Error('private snapshot detail'));
      window.dispatchEvent(new Event('focus'));
      await jest.advanceTimersByTimeAsync(30000);
      expect(call).toHaveBeenCalledTimes(5);
      expect(warn).toHaveBeenCalledWith(expect.any(String), 'Attention snapshot retries exhausted');
      expect(warn.mock.calls.filter(([, message]) => message === 'Attention snapshot retries exhausted')).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(60000);
      expect(call).toHaveBeenCalledTimes(5);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private snapshot detail');

      call.mockResolvedValue(new RpcResult(true, { notices: [notice] }));
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
      expect(call).toHaveBeenCalledTimes(6);
      expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ key: notice.key }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('waits for backoff when a queued reconcile follows a failed snapshot', async () => {
    jest.useFakeTimers();
    try {
      let failSnapshot: (reason: Error) => void = () => { throw new Error('Snapshot was not requested'); };
      call.mockImplementationOnce(() => new Promise((_resolve, reject) => {
        failSnapshot = reject;
      }));
      window.dispatchEvent(new Event('focus'));
      expect(call).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new Event('focus'));
      failSnapshot(new Error('private snapshot detail'));
      await Promise.resolve();
      await Promise.resolve();
      expect(call).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1999);
      expect(call).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(call).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('opens a pending local owner after snapshot validation', async () => {
    call.mockResolvedValue(new RpcResult(true, { notices: [notice] }));
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_OPEN_TARGET, payload: {
      key: notice.key, generation: 1, target,
    } });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    expect(focus).toHaveBeenCalledWith({
      workspacePath: '/workspace-a', sessionId: 'session-1', tabId: 'tab-1',
    });
  });

  it('opens a null-path owner through its unpartitioned routing path', async () => {
    ownerWorkspacePath = null;
    activeWorkspacePath = '/workspace-a';
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice,
    } });
    call.mockResolvedValue(new RpcResult(true, { notices: [notice] }));
    await expect(handler.openProjected(notice.key, notice.generation)).resolves.toBe(true);
    expect(focus).toHaveBeenCalledWith({ workspacePath: '', sessionId: 'session-1', tabId: 'tab-1' });
  });

  it('keeps an unknown surface owner counted with Open disabled', () => {
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice: { ...notice, target: { ...target, surfaceMode: true } },
    } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      ownerSurface: 'surface', actions: [{ id: 'open', label: 'Open', disabledReason: 'Answer in owning surface' }],
    }));
  });

  it('maps a tab-less host target to its owning surface and opens it', async () => {
    const tabless = { workspaceId: target.workspaceId, sessionId: 'apps-session' };
    const projected = { ...notice, target: tabless };
    handler.handleMessage({ type: MESSAGE_TYPES.ATTENTION_CHANGED, payload: {
      change: 'upsert', notice: projected,
    } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      ownerSurface: 'surface', actions: [{ id: 'open', label: 'Open' }],
    }));
    call.mockResolvedValue(new RpcResult(true, { notices: [projected] }));
    await expect(handler.openProjected(notice.key, notice.generation)).resolves.toBe(true);
    expect(focusSurface).toHaveBeenCalledWith('apps-session');
    expect(focus).not.toHaveBeenCalled();
  });
});
