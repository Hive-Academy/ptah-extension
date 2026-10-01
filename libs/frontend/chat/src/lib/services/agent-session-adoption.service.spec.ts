/**
 * AgentSessionAdoptionService — late adoption of agent-started child tabs
 * (TASK_2026_584), against a fake RPC client and a fake TabManager.
 */

import { TestBed } from '@angular/core/testing';
import { signal, type WritableSignal } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  MODEL_REFRESH_CONTROL,
  TabManagerService,
} from '@ptah-extension/chat-state';
import {
  createExecutionChatMessage,
  type AgentSessionOpenedPayload,
} from '@ptah-extension/shared';
import {
  AgentSessionAdoptionService,
  parseAgentSessionOpenedPayload,
} from './agent-session-adoption.service';
import { SessionLoaderService } from './chat-store/session-loader.service';

function descriptor(
  tabId: string,
  overrides: Partial<AgentSessionOpenedPayload> = {},
): AgentSessionOpenedPayload {
  return {
    tabId,
    sessionId: 'child-sdk-id',
    parentTabId: 'parent-tab',
    parentSessionId: 'parent-sdk-id',
    workspaceRoot: '/ws/a',
    worktreePath: '/ws/a/.worktrees/x',
    branch: 'feat/x',
    label: 'X',
    displayPrompt: 'do x',
    startedAt: 5,
    ...overrides,
  };
}

describe('AgentSessionAdoptionService', () => {
  let service: AgentSessionAdoptionService;
  let rpc: { call: jest.Mock };
  let tabManager: {
    adoptAgentSessionTab: jest.Mock;
    activeWorkspacePath$: WritableSignal<string | null>;
    activeTab: WritableSignal<null>;
    isTabStreaming: jest.Mock;
  };
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(() => {
    rpc = {
      call: jest.fn().mockResolvedValue({
        success: true,
        data: { sessions: [] },
      }),
    };
    tabManager = {
      adoptAgentSessionTab: jest.fn().mockReturnValue('adopted'),
      activeWorkspacePath$: signal<string | null>(null),
      activeTab: signal(null),
      isTabStreaming: jest.fn().mockReturnValue(false),
    };
    TestBed.configureTestingModule({
      providers: [
        AgentSessionAdoptionService,
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: TabManagerService, useValue: tabManager },
        {
          provide: SessionLoaderService,
          useValue: { switchSession: jest.fn() },
        },
      ],
    });
    service = TestBed.inject(AgentSessionAdoptionService);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    error.mockRestore();
    TestBed.resetTestingModule();
  });

  it('queries chat:agent-sessions for the workspace and adopts each descriptor late', async () => {
    rpc.call.mockResolvedValueOnce({
      success: true,
      data: { sessions: [descriptor('c1'), descriptor('c2')] },
    });

    await service.adoptLiveChildren('/ws/a');

    expect(rpc.call).toHaveBeenCalledWith('chat:agent-sessions', {
      workspaceRoot: '/ws/a',
    });
    expect(tabManager.adoptAgentSessionTab).toHaveBeenCalledTimes(2);
    expect(tabManager.adoptAgentSessionTab).toHaveBeenCalledWith(
      descriptor('c1'),
      'late',
    );
  });

  it('asks for every live child when no workspace is active', async () => {
    await service.adoptLiveChildren(null);
    expect(rpc.call).toHaveBeenCalledWith('chat:agent-sessions', {});
  });

  it('does not re-adopt a child already adopted or present on this page (a closed child stays closed)', async () => {
    tabManager.adoptAgentSessionTab
      .mockReturnValueOnce('adopted')
      .mockReturnValueOnce('exists');
    rpc.call.mockResolvedValue({
      success: true,
      data: { sessions: [descriptor('c1'), descriptor('c2')] },
    });

    await service.adoptLiveChildren('/ws/a');
    await service.adoptLiveChildren('/ws/a');

    expect(tabManager.adoptAgentSessionTab).toHaveBeenCalledTimes(2);
  });

  it('a child adopted by the live push is not re-adopted late', async () => {
    service.adopt(descriptor('c1', { sessionId: null }), 'live');
    rpc.call.mockResolvedValueOnce({
      success: true,
      data: { sessions: [descriptor('c1')] },
    });

    await service.adoptLiveChildren('/ws/a');

    expect(tabManager.adoptAgentSessionTab).toHaveBeenCalledTimes(1);
    expect(tabManager.adoptAgentSessionTab).toHaveBeenCalledWith(
      descriptor('c1', { sessionId: null }),
      'live',
    );
  });

  it('retries a parent-absent child on the next query', async () => {
    tabManager.adoptAgentSessionTab
      .mockReturnValueOnce('parent-absent')
      .mockReturnValueOnce('adopted');
    rpc.call.mockResolvedValue({
      success: true,
      data: { sessions: [descriptor('c1')] },
    });

    await service.adoptLiveChildren('/ws/a');
    await service.adoptLiveChildren('/ws/b');

    expect(tabManager.adoptAgentSessionTab).toHaveBeenCalledTimes(2);
  });

  it('drops malformed descriptors and keeps going', async () => {
    rpc.call.mockResolvedValueOnce({
      success: true,
      data: { sessions: [{ tabId: 'broken' }, descriptor('c2')] },
    });

    await service.adoptLiveChildren('/ws/a');

    expect(tabManager.adoptAgentSessionTab).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('malformed agent session descriptor'),
    );
  });

  it('a failed or throwing RPC adopts nothing and does not throw', async () => {
    rpc.call.mockResolvedValueOnce({ success: false, error: 'boom' });
    await expect(service.adoptLiveChildren('/ws/a')).resolves.toBeUndefined();

    rpc.call.mockRejectedValueOnce(new Error('transport'));
    await expect(service.adoptLiveChildren('/ws/a')).resolves.toBeUndefined();

    expect(tabManager.adoptAgentSessionTab).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('an adoption that throws is contained and the loop continues', async () => {
    tabManager.adoptAgentSessionTab
      .mockImplementationOnce(() => {
        throw new Error('bad');
      })
      .mockReturnValueOnce('adopted');
    rpc.call.mockResolvedValueOnce({
      success: true,
      data: { sessions: [descriptor('c1'), descriptor('c2')] },
    });

    await service.adoptLiveChildren('/ws/a');

    expect(tabManager.adoptAgentSessionTab).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('start() queries on bootstrap and again on each workspace change, once per change', async () => {
    service.start();
    service.start(); // idempotent
    TestBed.tick();
    await Promise.resolve();
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(rpc.call).toHaveBeenLastCalledWith('chat:agent-sessions', {});

    tabManager.activeWorkspacePath$.set('/ws/b');
    TestBed.tick();
    await Promise.resolve();
    expect(rpc.call).toHaveBeenCalledTimes(2);
    expect(rpc.call).toHaveBeenLastCalledWith('chat:agent-sessions', {
      workspaceRoot: '/ws/b',
    });
  });

  describe('parseAgentSessionOpenedPayload', () => {
    it('accepts a full descriptor and copies only known fields', () => {
      const parsed = parseAgentSessionOpenedPayload({
        ...descriptor('c1', { taskId: 'T1' }),
        extra: 'ignored',
      });
      expect(parsed).toEqual(descriptor('c1', { taskId: 'T1' }));
    });

    it.each([
      ['null', null],
      ['an array', []],
      ['empty tabId', { ...descriptor('c1'), tabId: '' }],
      ['missing label', { ...descriptor('c1'), label: undefined }],
      ['non-finite startedAt', { ...descriptor('c1'), startedAt: Infinity }],
      ['non-string taskId', { ...descriptor('c1'), taskId: 3 }],
      ['empty parentSessionId', { ...descriptor('c1'), parentSessionId: '' }],
    ])('rejects %s', (_label, value) => {
      expect(parseAgentSessionOpenedPayload(value)).toBeNull();
    });
  });
});

/**
 * First-activation history load (TASK_2026_584 B7 review, finding 1), against
 * the REAL TabManagerService so activation, status and `hasLiveSession` are
 * the genuine state machine. The session loader and RPC are fakes.
 */
describe('AgentSessionAdoptionService — history load on first activation', () => {
  const CHILD = '11111111-1111-4111-8111-111111111111';
  const CHILD_SESSION = '22222222-2222-4222-8222-222222222222';

  let service: AgentSessionAdoptionService;
  let tabs: TabManagerService;
  let switchSession: jest.Mock;
  let parent: string;

  function child(
    overrides: Partial<AgentSessionOpenedPayload> = {},
  ): AgentSessionOpenedPayload {
    return {
      ...descriptor(CHILD, { parentTabId: parent, sessionId: CHILD_SESSION }),
      ...overrides,
    };
  }

  function activate(tabId: string): void {
    tabs.switchTab(tabId);
    TestBed.tick();
  }

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();
    switchSession = jest.fn().mockResolvedValue({ staleSnapshot: false });
    TestBed.configureTestingModule({
      providers: [
        AgentSessionAdoptionService,
        {
          provide: ClaudeRpcService,
          useValue: {
            call: jest
              .fn()
              .mockResolvedValue({ success: true, data: { sessions: [] } }),
          },
        },
        { provide: SessionLoaderService, useValue: { switchSession } },
        {
          provide: MODEL_REFRESH_CONTROL,
          useValue: { refreshModels: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    });
    tabs = TestBed.inject(TabManagerService);
    service = TestBed.inject(AgentSessionAdoptionService);
    parent = tabs.createTab('parent');
    service.start();
    TestBed.tick();
  });

  afterEach(() => {
    jest.useRealTimers();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('loads a late tab once on first activation, targeted and never with activate', () => {
    tabs.adoptAgentSessionTab(child(), 'late');
    expect(switchSession).not.toHaveBeenCalled(); // adoption alone never loads

    activate(CHILD);

    expect(switchSession).toHaveBeenCalledTimes(1);
    expect(switchSession).toHaveBeenCalledWith(CHILD_SESSION, {
      targetTabId: CHILD,
    });
    expect(switchSession.mock.calls[0][1]).not.toHaveProperty('activate');
  });

  it('loads on a host with no active workspace partition (VS Code panel)', () => {
    // Visual review B7, finding 1. The fixture never switches workspace, so
    // the child exists only in the active tab set; the end-to-end load into
    // that tab is pinned in session-loader.service.spec.ts ("loads history
    // into a targeted tab when no workspace partition is active").
    expect(tabs.activeWorkspacePath).toBeNull();
    tabs.adoptAgentSessionTab(child(), 'late');
    expect(tabs.tabs().some((t) => t.id === CHILD)).toBe(true);

    activate(CHILD);

    expect(switchSession).toHaveBeenCalledWith(CHILD_SESSION, {
      targetTabId: CHILD,
    });
  });

  it('does not reload on a second activation', () => {
    tabs.adoptAgentSessionTab(child(), 'late');
    activate(CHILD);
    activate(parent);
    activate(CHILD);

    expect(switchSession).toHaveBeenCalledTimes(1);
  });

  it('never loads a live tab', () => {
    tabs.adoptAgentSessionTab(child({ sessionId: null }), 'live');
    activate(CHILD);
    // Session resolved and the turn finished: only `hasLiveSession` blocks.
    tabs.attachSession(CHILD, CHILD_SESSION);
    tabs.markLoaded(CHILD);
    TestBed.tick();

    expect(tabs.activeTab()?.hasLiveSession).toBe(true);
    expect(switchSession).not.toHaveBeenCalled();
  });

  it('never loads a tab whose session id is not resolved', () => {
    tabs.adoptAgentSessionTab(child({ sessionId: null }), 'late');
    tabs.markLoaded(CHILD);
    activate(CHILD);

    expect(tabs.activeTab()?.claudeSessionId).toBeNull();
    expect(switchSession).not.toHaveBeenCalled();
  });

  it('keeps turns that streamed in before the first activation, neither dropped nor duplicated', () => {
    tabs.adoptAgentSessionTab(child(), 'late');
    // A turn streams into the background tab: the stream path marks it
    // streaming (sticky hasLiveSession), the finalized turn lands, it idles.
    tabs.markStreaming(CHILD);
    const streamed = [
      createExecutionChatMessage({ id: 'u1', role: 'user', rawContent: 'q' }),
      createExecutionChatMessage({ id: 'a1', role: 'assistant' }),
    ];
    tabs.setMessagesAndMarkLoaded(CHILD, streamed);

    activate(CHILD);

    expect(switchSession).not.toHaveBeenCalled();
    expect(tabs.activeTab()?.messages.map((m) => m.id)).toEqual(['u1', 'a1']);
  });

  it('does not load over messages even when the tab was never flagged live', () => {
    tabs.adoptAgentSessionTab(child(), 'late');
    tabs.setMessages(CHILD, [
      createExecutionChatMessage({ id: 'a1', role: 'assistant' }),
    ]);

    activate(CHILD);

    expect(switchSession).not.toHaveBeenCalled();
    expect(tabs.activeTab()?.messages).toHaveLength(1);
  });

  it('a failed load is retried on the next activation, not in a loop', async () => {
    switchSession.mockRejectedValueOnce(new Error('resume failed'));
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    tabs.adoptAgentSessionTab(child(), 'late');

    activate(CHILD);
    await Promise.resolve();
    await Promise.resolve();
    expect(switchSession).toHaveBeenCalledTimes(1);

    activate(parent);
    activate(CHILD);
    expect(switchSession).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('ignores ordinary tabs', () => {
    const plain = tabs.openSessionTab(CHILD_SESSION as never, 'plain');
    activate(parent);
    activate(plain);

    expect(switchSession).not.toHaveBeenCalled();
  });
});
