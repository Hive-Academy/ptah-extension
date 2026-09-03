import { TestBed } from '@angular/core/testing';
import { SessionLivenessReconcilerService } from './session-liveness-reconciler.service';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  TabManagerService,
  SessionLivenessRegistry,
} from '@ptah-extension/chat-state';
import { TurnStateApplier } from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import {
  SessionId,
  type SessionStatusResponse,
  type SessionTurnState,
} from '@ptah-extension/shared';

const WS = '/ws/active';
const SESS_STREAM = SessionId.create();
const SESS_IDLE = SessionId.create();
const SESS_DEAD = SessionId.create();
const SESS_REJECT = SessionId.create();

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: `tab-${overrides.claudeSessionId ?? 'x'}`,
    title: 'Tab',
    status: 'loaded',
    messages: [],
    streamingState: null,
    claudeSessionId: null,
    queuedContent: null,
    queuedOptions: null,
    ...overrides,
  } as unknown as TabState;
}

function makeTurnState(
  overrides: Partial<SessionTurnState> = {},
): SessionTurnState {
  return {
    phase: 'generating',
    revision: 4,
    backgroundTasks: [],
    sessionCrons: [],
    terminalReason: null,
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe('SessionLivenessReconcilerService', () => {
  let service: SessionLivenessReconcilerService;
  let tabs: TabState[];
  let activeWorkspacePath: string | null;
  let callMock: jest.Mock;
  let markStreamingLiveness: jest.Mock;
  let markIdleLiveness: jest.Mock;
  let applyMock: jest.Mock;
  let warn: jest.SpyInstance;

  function rpcResult(data: SessionStatusResponse) {
    return { success: true, data, isSuccess: () => true };
  }

  function configure(workspaceRoot: string | null): void {
    const rpcMock = { call: callMock } as unknown as ClaudeRpcService;
    const vscodeMock = {
      config: () => ({ workspaceRoot }),
    } as unknown as VSCodeService;
    // No `markStreaming` / `markTabStreaming` on the mock: the reconciler
    // must not write tab status itself any more (TASK_2026_360, Defect 4).
    const tabManagerMock = {
      tabs: () => tabs,
      get activeWorkspacePath() {
        return activeWorkspacePath;
      },
    } as unknown as TabManagerService;
    const livenessMock = {
      markStreaming: markStreamingLiveness,
      markIdle: markIdleLiveness,
    } as unknown as SessionLivenessRegistry;
    const applierMock = { apply: applyMock } as unknown as TurnStateApplier;

    TestBed.configureTestingModule({
      providers: [
        SessionLivenessReconcilerService,
        { provide: ClaudeRpcService, useValue: rpcMock },
        { provide: VSCodeService, useValue: vscodeMock },
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: SessionLivenessRegistry, useValue: livenessMock },
        { provide: TurnStateApplier, useValue: applierMock },
      ],
    });
    service = TestBed.inject(SessionLivenessReconcilerService);
  }

  beforeEach(() => {
    tabs = [];
    activeWorkspacePath = null;
    callMock = jest.fn();
    markStreamingLiveness = jest.fn();
    markIdleLiveness = jest.fn();
    applyMock = jest.fn();
    warn = jest.spyOn(console, 'warn').mockImplementation();
    configure(WS);
  });

  afterEach(() => {
    warn.mockRestore();
    TestBed.resetTestingModule();
  });

  it('applies the backend turnState through TurnStateApplier as a synthetic turn_state event', async () => {
    tabs = [makeTab({ claudeSessionId: SESS_STREAM })];
    const turnState = makeTurnState({ phase: 'generating', revision: 7 });
    callMock.mockResolvedValue(
      rpcResult({ isActive: true, isStreaming: true, turnState }),
    );

    await service.reconcileRestoredTabs();

    expect(callMock).toHaveBeenCalledWith('session:status', {
      sessionId: SESS_STREAM,
    });
    expect(applyMock).toHaveBeenCalledTimes(1);
    const [event, tabId] = applyMock.mock.calls[0];
    expect(tabId).toBe(`tab-${SESS_STREAM}`);
    expect(event).toEqual(
      expect.objectContaining({
        eventType: 'turn_state',
        sessionId: SESS_STREAM,
        messageId: `turn-state-${SESS_STREAM}`,
        phase: 'generating',
        revision: 7,
        backgroundTasks: [],
        sessionCrons: [],
        terminalReason: null,
        timestamp: turnState.timestamp,
      }),
    );
    // Liveness is the applier's job once a turn state exists.
    expect(markStreamingLiveness).not.toHaveBeenCalled();
    expect(markIdleLiveness).not.toHaveBeenCalled();
  });

  it('applies a terminal turnState (sleeping) the same way', async () => {
    tabs = [makeTab({ claudeSessionId: SESS_IDLE })];
    const crons = [
      { id: 'c1', schedule: '0 * * * *', recurring: true, prompt: 'wake' },
    ];
    callMock.mockResolvedValue(
      rpcResult({
        isActive: true,
        isStreaming: false,
        turnState: makeTurnState({
          phase: 'sleeping',
          revision: 2,
          sessionCrons: crons,
          terminalReason: 'completed',
        }),
      }),
    );

    await service.reconcileRestoredTabs();

    expect(applyMock).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'sleeping', sessionCrons: crons }),
      `tab-${SESS_IDLE}`,
      // A probe is synthesized from an RPC answer, not pulled from the tab's
      // chunk stream, so it must never trigger the terminal heal
      // (TASK_2026_371).
      { ordered: false },
    );
  });

  // Defect 4: `isStreaming` means "loop attached", not "generates now".
  it('ignores isStreaming: an active session without turnState is marked idle only', async () => {
    tabs = [makeTab({ claudeSessionId: SESS_IDLE })];
    callMock.mockResolvedValue(
      rpcResult({ isActive: true, isStreaming: true }),
    );

    await service.reconcileRestoredTabs();

    expect(markIdleLiveness).toHaveBeenCalledWith(SESS_IDLE, WS);
    expect(markStreamingLiveness).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('inactive session does nothing', async () => {
    tabs = [makeTab({ claudeSessionId: SESS_DEAD })];
    callMock.mockResolvedValue(
      rpcResult({ isActive: false, isStreaming: false }),
    );

    await service.reconcileRestoredTabs();

    expect(markStreamingLiveness).not.toHaveBeenCalled();
    expect(markIdleLiveness).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('skips tabs without a claudeSessionId', async () => {
    tabs = [makeTab({ id: 'tab-empty', claudeSessionId: null })];

    await service.reconcileRestoredTabs();

    expect(callMock).not.toHaveBeenCalled();
  });

  it('swallows a rejected probe without affecting sibling tabs', async () => {
    tabs = [
      makeTab({ claudeSessionId: SESS_REJECT }),
      makeTab({ claudeSessionId: SESS_STREAM }),
    ];
    callMock.mockImplementation(
      (_method: string, params: { sessionId: string }) =>
        params.sessionId === SESS_REJECT
          ? Promise.reject(new Error('rpc timeout'))
          : Promise.resolve(
              rpcResult({
                isActive: true,
                isStreaming: true,
                turnState: makeTurnState(),
              }),
            ),
    );

    await expect(service.reconcileRestoredTabs()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      '[SessionLivenessReconciler] probe failed; leaving tab as restored',
      expect.objectContaining({ sessionId: SESS_REJECT }),
    );
    expect(applyMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESS_STREAM }),
      `tab-${SESS_STREAM}`,
      { ordered: false },
    );
  });

  it('prefers the tab manager active workspace over the config root for the idle mark', async () => {
    TestBed.resetTestingModule();
    activeWorkspacePath = '/ws/from-tab-manager';
    tabs = [makeTab({ claudeSessionId: SESS_IDLE })];
    callMock.mockResolvedValue(
      rpcResult({ isActive: true, isStreaming: false }),
    );
    configure(WS);

    await service.reconcileRestoredTabs();

    expect(markIdleLiveness).toHaveBeenCalledWith(
      SESS_IDLE,
      '/ws/from-tab-manager',
    );
  });

  it('passes undefined workspacePath when neither source knows the workspace', async () => {
    TestBed.resetTestingModule();
    tabs = [makeTab({ claudeSessionId: SESS_IDLE })];
    callMock.mockResolvedValue(
      rpcResult({ isActive: true, isStreaming: false }),
    );
    configure(null);

    await service.reconcileRestoredTabs();

    expect(markIdleLiveness).toHaveBeenCalledWith(SESS_IDLE, undefined);
  });
});
