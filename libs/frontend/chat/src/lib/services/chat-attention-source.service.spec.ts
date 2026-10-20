import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CommandCenterVoiceSessionService, TabManagerService } from '@ptah-extension/chat-state';
import { AgentMonitorStore, PermissionHandlerService } from '@ptah-extension/chat-streaming';
import { AttentionItem, NotificationService } from '@ptah-extension/core';
import type { AskUserQuestionRequest, PermissionRequest } from '@ptah-extension/shared';
import { ChatAttentionSourceService } from './chat-attention-source.service';

describe('ChatAttentionSourceService', () => {
  const permissions = signal<PermissionRequest[]>([]);
  const questions = signal<AskUserQuestionRequest[]>([]);
  const lanes = signal<{ agentId: string; parentSessionId: string; permissionQueue: {
    requestId: string; toolName: string; timestamp: number;
  }[] }[]>([]);
  const revision = signal(0);
  const tabs = signal([{ id: 'tab-1', claudeSessionId: 'session-1' }]);
  const upsert = jest.fn<void, [AttentionItem]>();
  const resolve = jest.fn<void, [string, number, string]>();
  const setSnackbarSuppressed = jest.fn();
  const voice = jest.fn<boolean, [string]>(() => false);

  beforeEach(() => {
    permissions.set([]);
    questions.set([]);
    lanes.set([]);
    revision.set(0);
    upsert.mockClear();
    resolve.mockClear();
    voice.mockReset().mockReturnValue(false);
    TestBed.configureTestingModule({ providers: [
      { provide: PermissionHandlerService, useValue: {
        permissionRequests: permissions, questionRequests: questions,
        routingTargetRevision: revision, targetTabsFor: () => [], questionTargetTabsFor: () => [],
      } },
      { provide: AgentMonitorStore, useValue: { pendingPermissions: lanes } },
      { provide: TabManagerService, useValue: {
        tabs, activeTabId: signal('tab-1'), visibleTabIds: signal(new Set<string>()), findTabByIdAcrossWorkspaces: (id: string) =>
          id === 'tab-1' ? { tab: tabs()[0], workspacePath: '/ws/one' } : null,
        findTabBySessionIdAcrossWorkspaces: (id: string) =>
          id === 'session-1' ? { tab: tabs()[0], workspacePath: '/ws/one' } : null,
      } },
      { provide: CommandCenterVoiceSessionService, useValue: { isActive: voice } },
      { provide: NotificationService, useValue: { upsert, resolve, setSnackbarSuppressed } },
    ] });
  });

  it('publishes one keyed request, mutes active voice, and resolves withdrawal', () => {
    voice.mockReturnValue(true);
    const source = TestBed.inject(ChatAttentionSourceService);
    const request: PermissionRequest = {
      id: 'p1', toolName: 'Write', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: 'private details', tabId: 'tab-1', sessionId: 'session-1',
    };
    permissions.set([request]);
    TestBed.tick();
    const item = upsert.mock.lastCall?.[0];
    if (!item) throw new Error('Missing attention item');
    expect(item).toMatchObject({ kind: 'permission', workspacePath: '/ws/one', soundEligible: false });
    expect(item.title).not.toContain('private details');
    expect(source.getLive(item.key, item.generation)?.target.kind).toBe('permission');
    permissions.set([]);
    TestBed.tick();
    expect(resolve).toHaveBeenCalledWith(item.key, item.generation, 'chat');
    expect(source.getLive(item.key, item.generation)).toBeUndefined();
  });

  it('uses a new generation when the same request id reappears', () => {
    TestBed.inject(ChatAttentionSourceService);
    const request: PermissionRequest = {
      id: 'p2', toolName: 'Read', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'tab-1',
    };
    permissions.set([request]); TestBed.tick();
    const first = upsert.mock.lastCall?.[0];
    if (!first) throw new Error('Missing first attention item');
    permissions.set([]); TestBed.tick();
    permissions.set([request]); TestBed.tick();
    expect(upsert.mock.lastCall?.[0].generation).toBeGreaterThan(first.generation);
  });

  it('maps questions to Answer and lanes to Allow/Deny/Open', () => {
    TestBed.inject(ChatAttentionSourceService);
    questions.set([{ id: 'q1', toolName: 'AskUserQuestion', questions: [],
      timestamp: 1, timeoutAt: 0, tabId: 'tab-1' }]);
    lanes.set([{ agentId: 'agent', parentSessionId: 'session-1', permissionQueue: [
      { requestId: 'l1', toolName: 'Bash', timestamp: 1 },
    ] }]);
    TestBed.tick();
    const items = upsert.mock.calls.map(call => call[0]);
    expect(items.find(item => item.kind === 'question')?.actions.map((action: { id: string }) => action.id))
      .toEqual(['answer', 'open']);
    expect(items.find(item => item.kind === 'lane-permission')?.actions.map((action: { id: string }) => action.id))
      .toEqual(['allow', 'deny', 'open']);
  });

  it('keeps an unmatched request countable with Open disabled', () => {
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'orphan', toolName: '', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', sessionId: 'missing' }]);
    TestBed.tick();
    const item = upsert.mock.lastCall?.[0];
    expect(item?.workspacePath).toBe('');
    expect(item?.actions.find(action => action.id === 'open')?.disabledReason).toBe('Session unavailable');
  });

  it('keeps an ownerless request in the real model without a reactive write loop', () => {
    TestBed.overrideProvider(NotificationService, { useClass: NotificationService });
    const model = TestBed.inject(NotificationService);
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'ownerless', toolName: 'Write', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'missing-tab', sessionId: 'missing-session' }]);
    TestBed.tick();
    expect(model.badgeCount()).toBe(1);
    expect(model.needsYou()[0].actions.find(action => action.id === 'open')?.disabledReason).toBeTruthy();
    const original = model.needsYou()[0];
    const upsertSpy = jest.spyOn(model, 'upsert');
    tabs.set([...tabs()]);
    TestBed.tick();
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(model.needsYou()[0]).toBe(original);
    expect(model.badgeCount()).toBe(1);
    permissions.set([]);
    TestBed.tick();
    expect(model.badgeCount()).toBe(0);
  });

  it('updates inline snackbar suppression when focus changes', () => {
    const focused = jest.spyOn(document, 'hasFocus').mockReturnValue(true);
    TestBed.overrideProvider(NotificationService, { useClass: NotificationService });
    const model = TestBed.inject(NotificationService);
    TestBed.inject(ChatAttentionSourceService);
    permissions.set([{ id: 'focused', toolName: 'Read', toolInput: {}, timestamp: 1,
      timeoutAt: 0, description: '', tabId: 'tab-1', sessionId: 'session-1' }]);
    TestBed.tick();
    expect(model.snackbars()).toHaveLength(0);
    focused.mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    expect(model.snackbars()).toHaveLength(1);
    focused.mockRestore();
  });
});
