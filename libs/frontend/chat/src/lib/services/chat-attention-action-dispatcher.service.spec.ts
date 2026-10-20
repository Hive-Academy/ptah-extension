import { TestBed } from '@angular/core/testing';
import { AppStateManager, ATTENTION_LANE_OPENER, LoggingService, NOTIFICATION_FOCUS_ROUTER, NotificationService } from '@ptah-extension/core';
import { ChatAttentionHostMessageHandler } from './chat-attention-host-message-handler.service';
import { AgentPermissionResponder } from './agent-permission-responder';
import { ChatAttentionActionDispatcherService } from './chat-attention-action-dispatcher.service';
import { ChatAttentionSourceService } from './chat-attention-source.service';

describe('ChatAttentionActionDispatcherService', () => {
  const respondLane = jest.fn();
  const focus = jest.fn();
  const openLane = jest.fn();
  const upsert = jest.fn();
  const warn = jest.fn();
  const live = {
    item: {
      key: 'lane', generation: 1, kind: 'lane-permission', source: 'chat',
      workspacePath: '/ws', workspaceName: 'ws', sessionId: 'session', tabId: 'tab',
      severity: 'warning', title: 'Permission', actionable: true, soundEligible: true,
      actions: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }, { id: 'open', label: 'Open' }],
    },
    target: { kind: 'lane-permission', agentId: 'agent', request: { requestId: 'request' }, tabId: 'tab' },
  };
  let service: ChatAttentionActionDispatcherService;

  beforeEach(() => {
    jest.clearAllMocks();
    respondLane.mockReturnValue(true);
    focus.mockResolvedValue({ success: true, outcome: 'focused' });
    openLane.mockReturnValue(true);
    TestBed.configureTestingModule({ providers: [
      { provide: ChatAttentionSourceService, useValue: {
        getLive: (key: string, generation: number) => key === 'lane' && generation === 1 ? live : undefined,
      } },
      { provide: AgentPermissionResponder, useValue: { respondLane } },
      { provide: NotificationService, useValue: { upsert } },
      { provide: NOTIFICATION_FOCUS_ROUTER, useValue: { focus } },
      { provide: ATTENTION_LANE_OPENER, useValue: { open: openLane } },
      { provide: LoggingService, useValue: { warn } },
      { provide: AppStateManager, useValue: { setStatusMessage: jest.fn() } },
      { provide: ChatAttentionHostMessageHandler, useValue: { openProjected: jest.fn().mockResolvedValue(true) } },
    ] });
    service = TestBed.inject(ChatAttentionActionDispatcherService);
  });

  it('rejects stale generations before invoking a responder', async () => {
    expect(await service.dispatch('lane', 0, 'allow')).toBe(false);
    expect(await service.dispatchOutcome('lane', 0, 'allow')).toEqual({ kind: 'stale' });
    expect(respondLane).not.toHaveBeenCalled();
  });

  it('uses the existing guarded lane responder', async () => {
    expect(await service.dispatch('lane', 1, 'deny')).toBe(true);
    expect(respondLane).toHaveBeenCalledWith('agent', 'request', 'deny');
  });

  it('routes Open to the recorded workspace and session', async () => {
    expect(await service.dispatch('lane', 1, 'open')).toBe(true);
    expect(focus).toHaveBeenCalledWith({ workspacePath: '/ws', sessionId: 'session', tabId: 'tab' });
    expect(openLane).toHaveBeenCalledWith('tab', 'agent');
  });

  it('keeps session focus when the lane has ended', async () => {
    openLane.mockReturnValue(false);
    expect(await service.dispatch('lane', 1, 'open')).toBe(true);
    expect(focus).toHaveBeenCalledWith({ workspacePath: '/ws', sessionId: 'session', tabId: 'tab' });
    expect(openLane).toHaveBeenCalledWith('tab', 'agent');
    expect(warn).toHaveBeenCalledWith('ChatAttentionActionDispatcherService', 'Lane detail unavailable; session focused');
  });

  it('leaves non-lane Open on the session focus route', async () => {
    live.item.kind = 'permission';
    live.target.kind = 'permission';
    try {
      expect(await service.dispatch('lane', 1, 'open')).toBe(true);
      expect(focus).toHaveBeenCalledTimes(1);
      expect(openLane).not.toHaveBeenCalled();
    } finally {
      live.item.kind = 'lane-permission';
      live.target.kind = 'lane-permission';
    }
  });

  it('routes host-only Open through the host snapshot guard', async () => {
    expect(await service.dispatch('host-only', 1, 'open')).toBe(true);
  });

  it('keeps a failed request live and emits a safe failure notice', async () => {
    respondLane.mockImplementationOnce(() => { throw new Error('secret detail'); });
    expect(await service.dispatch('lane', 1, 'allow')).toBe(false);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not complete action', kind: 'failure' }));
    expect(JSON.stringify(upsert.mock.calls)).not.toContain('secret detail');
    expect(await service.dispatch('lane', 1, 'allow')).toBe(true);
  });
});
