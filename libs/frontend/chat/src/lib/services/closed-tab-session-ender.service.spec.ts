/**
 * ClosedTabSessionEnderService (TASK_2026_592) — closing a tab ends its
 * backend session with exactly one `chat:abort`, and nothing else does.
 *
 * Signal-driven fake TabManager (mirrors transcript-retention.service.spec.ts):
 * each test sets `closedTab` and flushes effects with `TestBed.tick()`.
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  ConfirmationDialogService,
  ConversationRegistry,
  MODEL_REFRESH_CONTROL,
  TabManagerService,
  TabSessionBinding,
  TabWorkspacePartitionService,
  type ClosedTabEvent,
  type ModelRefreshControl,
} from '@ptah-extension/chat-state';
import { SessionId } from '@ptah-extension/shared';
import { ClosedTabSessionEnderService } from './closed-tab-session-ender.service';

const SESSION_A = '11111111-1111-4111-8111-111111111111';
const SESSION_B = '22222222-2222-4222-8222-222222222222';

interface Harness {
  closedTab: ReturnType<typeof signal<ClosedTabEvent | null>>;
  emitClosedTab: (event: ClosedTabEvent) => void;
  rpcCall: jest.Mock;
  findTabsBySessionId: jest.Mock;
  findContainingSession: jest.Mock;
  surfacesFor: jest.Mock;
}

function makeHarness(initial: ClosedTabEvent | null = null): Harness {
  const closedTab = signal<ClosedTabEvent | null>(initial);
  const listeners = new Set<(event: ClosedTabEvent) => void>();
  const rpcCall = jest.fn().mockResolvedValue({ success: true });
  // Default: the closed tab is gone and no other tab holds the session.
  const findTabsBySessionId = jest.fn().mockReturnValue([]);
  // Default: no conversation record (StreamRouter already removed it).
  const findContainingSession = jest.fn().mockReturnValue(null);
  const surfacesFor = jest.fn().mockReturnValue([]);

  TestBed.configureTestingModule({
    providers: [
      {
        provide: TabManagerService,
        useValue: {
          closedTab: closedTab.asReadonly(),
          onTabClosed: (listener: (event: ClosedTabEvent) => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          findTabsBySessionId,
        },
      },
      { provide: ConversationRegistry, useValue: { findContainingSession } },
      { provide: TabSessionBinding, useValue: { surfacesFor } },
      { provide: ClaudeRpcService, useValue: { call: rpcCall } },
    ],
  });
  TestBed.inject(ClosedTabSessionEnderService);
  TestBed.tick();

  return {
    closedTab,
    emitClosedTab: (event) => {
      closedTab.set(event);
      for (const listener of listeners) listener(event);
    },
    rpcCall,
    findTabsBySessionId,
    findContainingSession,
    surfacesFor,
  };
}

function close(
  h: Harness,
  evt: Partial<ClosedTabEvent> & Pick<ClosedTabEvent, 'tabId'>,
): void {
  h.emitClosedTab({ sessionId: SESSION_A, kind: 'close', ...evt });
  TestBed.tick();
}

/** Let the `.catch` of a rejected RPC promise run. */
const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe('ClosedTabSessionEnderService', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    TestBed.resetTestingModule();
  });

  it('sends nothing before any tab closes', () => {
    const h = makeHarness();
    expect(h.rpcCall).not.toHaveBeenCalled();
  });

  it('ignores a close event recorded before the service was created', () => {
    const h = makeHarness({
      tabId: 'old',
      sessionId: SESSION_A,
      kind: 'close',
    });

    expect(h.rpcCall).not.toHaveBeenCalled();

    close(h, { tabId: 't1', sessionId: SESSION_B });

    expect(h.rpcCall).toHaveBeenCalledTimes(1);
    expect(h.rpcCall).toHaveBeenCalledWith('chat:abort', {
      sessionId: SESSION_B,
    });
  });

  it('idle close with a real session sends exactly one chat:abort for that session', () => {
    const h = makeHarness();

    close(h, { tabId: 't1' });

    expect(h.rpcCall).toHaveBeenCalledTimes(1);
    expect(h.rpcCall).toHaveBeenCalledWith('chat:abort', {
      sessionId: SESSION_A,
    });
    expect(h.findTabsBySessionId).toHaveBeenCalledWith(SESSION_A);
  });

  it('handles two closes in the same tick exactly once each', () => {
    const h = makeHarness();

    h.emitClosedTab({ tabId: 't1', sessionId: SESSION_A, kind: 'close' });
    h.emitClosedTab({ tabId: 't2', sessionId: SESSION_B, kind: 'close' });

    expect(h.rpcCall).toHaveBeenCalledTimes(2);
    expect(h.rpcCall).toHaveBeenNthCalledWith(1, 'chat:abort', { sessionId: SESSION_A });
    expect(h.rpcCall).toHaveBeenNthCalledWith(2, 'chat:abort', { sessionId: SESSION_B });
  });

  it('streamAbortDispatched: true sends no RPC (the abort listener already did)', () => {
    const h = makeHarness();

    close(h, { tabId: 't1', streamAbortDispatched: true });

    expect(h.rpcCall).not.toHaveBeenCalled();
  });

  it('streamAbortDispatched: false still ends the session', () => {
    const h = makeHarness();

    close(h, { tabId: 't1', streamAbortDispatched: false });

    expect(h.rpcCall).toHaveBeenCalledTimes(1);
  });

  it('kind forceClose (pop-out transfer) sends no RPC', () => {
    const h = makeHarness();

    close(h, { tabId: 't1', kind: 'forceClose' });

    expect(h.rpcCall).not.toHaveBeenCalled();
  });

  it('kind reset (/clear) sends no RPC', () => {
    const h = makeHarness();

    close(h, { tabId: 't1', kind: 'reset' });

    expect(h.rpcCall).not.toHaveBeenCalled();
  });

  it('sessionId null sends no RPC', () => {
    const h = makeHarness();

    close(h, { tabId: 't1', sessionId: null });

    expect(h.rpcCall).not.toHaveBeenCalled();
  });

  it('empty sessionId sends no RPC', () => {
    const h = makeHarness();

    close(h, { tabId: 't1', sessionId: '' });

    expect(h.rpcCall).not.toHaveBeenCalled();
  });

  it('a session still held by another tab sends no RPC', () => {
    const h = makeHarness();
    h.findTabsBySessionId.mockReturnValue([
      { id: 'tile-tab', claudeSessionId: SESSION_A },
    ]);

    close(h, { tabId: 't1' });

    expect(h.rpcCall).not.toHaveBeenCalled();
  });

  it('ends the session when its listener runs before the router unbinds the closing tab', () => {
    const h = makeHarness();
    // The closed tab remains in the binding lookup at notification time.
    h.findTabsBySessionId.mockReturnValue([
      { id: 't1', claudeSessionId: SESSION_A },
    ]);

    close(h, { tabId: 't1' });

    expect(h.rpcCall).toHaveBeenCalledWith('chat:abort', {
      sessionId: SESSION_A,
    });
  });

  it('a session still bound to a non-tab surface sends no RPC', () => {
    const h = makeHarness();
    h.findContainingSession.mockReturnValue({ id: 'conv-1' });
    h.surfacesFor.mockReturnValue(['surface-wizard']);

    close(h, { tabId: 't1' });

    expect(h.findContainingSession).toHaveBeenCalledWith(SESSION_A);
    expect(h.surfacesFor).toHaveBeenCalledWith('conv-1');
    expect(h.rpcCall).not.toHaveBeenCalled();
  });

  it('a conversation record with no surfaces left still ends the session', () => {
    const h = makeHarness();
    h.findContainingSession.mockReturnValue({ id: 'conv-1' });
    h.surfacesFor.mockReturnValue([]);

    close(h, { tabId: 't1' });

    expect(h.rpcCall).toHaveBeenCalledTimes(1);
  });

  it('an RPC rejection is logged, never thrown, and the next close still sends', async () => {
    const h = makeHarness();
    const failure = new Error('backend down');
    h.rpcCall.mockRejectedValueOnce(failure);

    expect(() => close(h, { tabId: 't1' })).not.toThrow();
    await flushMicrotasks();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ClosedTabSessionEnder]'),
      { tabId: 't1', sessionId: SESSION_A, error: failure },
    );

    close(h, { tabId: 't2', sessionId: SESSION_B });

    expect(h.rpcCall).toHaveBeenCalledTimes(2);
    expect(h.rpcCall).toHaveBeenLastCalledWith('chat:abort', {
      sessionId: SESSION_B,
    });
  });

  it('a synchronous RPC throw is logged, never thrown, and the next close still sends', () => {
    const h = makeHarness();
    const failure = new Error('transport not ready');
    h.rpcCall.mockImplementationOnce(() => {
      throw failure;
    });

    expect(() => close(h, { tabId: 't1' })).not.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ClosedTabSessionEnder]'),
      { tabId: 't1', sessionId: SESSION_A, error: failure },
    );

    close(h, { tabId: 't2', sessionId: SESSION_B });

    expect(h.rpcCall).toHaveBeenCalledTimes(2);
    expect(h.rpcCall).toHaveBeenLastCalledWith('chat:abort', {
      sessionId: SESSION_B,
    });
  });

  it('two sequential closes send two RPCs, one per session', () => {
    const h = makeHarness();

    close(h, { tabId: 't1', sessionId: SESSION_A });
    close(h, { tabId: 't2', sessionId: SESSION_B });

    expect(h.rpcCall).toHaveBeenCalledTimes(2);
    expect(h.rpcCall.mock.calls.map((c) => c[1].sessionId)).toEqual([
      SESSION_A,
      SESSION_B,
    ]);
  });
});

/**
 * Switch safety with the REAL TabManagerService and partition service: only
 * ClaudeRpcService is mocked. A workspace switch must never end a session;
 * closing an idle tab ends exactly its own.
 */
describe('ClosedTabSessionEnderService with the real TabManagerService', () => {
  const WS_A = '/ws/a';
  const WS_B = '/ws/b';
  let rpcCall: jest.Mock;
  let tabManager: TabManagerService;

  beforeEach(() => {
    localStorage.clear();
    rpcCall = jest.fn().mockResolvedValue({ success: true });
    const modelRefresh: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;
    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefresh },
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
      ],
    });
    tabManager = TestBed.inject(TabManagerService);
    TestBed.inject(ClosedTabSessionEnderService);
    TestBed.tick();
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('switching workspaces sends no chat:abort; closing an idle tab sends exactly one', async () => {
    const sessKeep = SessionId.create();
    const sessClose = SessionId.create();
    const sessB = SessionId.create();

    tabManager.switchWorkspace(WS_A);
    const keepTab = tabManager.createTab('keep');
    tabManager.attachSession(keepTab, sessKeep);
    const closeTab = tabManager.createTab('close');
    tabManager.attachSession(closeTab, sessClose);
    TestBed.tick();

    tabManager.switchWorkspace(WS_B);
    const bTab = tabManager.createTab('b');
    tabManager.attachSession(bTab, sessB);
    TestBed.tick();
    tabManager.switchWorkspace(WS_A);
    TestBed.tick();

    expect(rpcCall).not.toHaveBeenCalled();

    await tabManager.closeTab(closeTab);
    TestBed.tick();

    expect(rpcCall).toHaveBeenCalledTimes(1);
    expect(rpcCall).toHaveBeenCalledWith('chat:abort', {
      sessionId: sessClose,
    });
    expect(tabManager.tabs().map((t) => t.id)).toEqual([keepTab]);
  });
});
