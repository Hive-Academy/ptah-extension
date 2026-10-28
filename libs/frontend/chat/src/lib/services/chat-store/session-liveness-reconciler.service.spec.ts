import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SessionLivenessReconcilerService } from './session-liveness-reconciler.service';
import { ClaudeRpcService, LoggingService, VSCodeService } from '@ptah-extension/core';
import {
  TabManagerService,
  SessionLivenessRegistry,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  TurnStateApplier,
} from '@ptah-extension/chat-streaming';
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
  const candidates = signal<
    readonly { sessionId: string; generation: number }[]
  >([]);
  const applyEvidence = jest.fn();
  const warnMock = jest.fn();

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
        {
          provide: AgentMonitorStore,
          useValue: {
            pendingHistoryCandidates: candidates,
            applyHistoryEvidence: applyEvidence,
          },
        },
        { provide: ClaudeRpcService, useValue: rpcMock },
        { provide: LoggingService, useValue: { warn: warnMock } },
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
    candidates.set([]);
    applyEvidence.mockReset();
    warnMock.mockReset();
    configure(WS);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it.each([
    ['inactive', { isActive: false, isStreaming: false }, 'inactive'],
    [
      'idle',
      {
        isActive: true,
        isStreaming: true,
        turnState: makeTurnState({ phase: 'idle' }),
      },
      'inactive',
    ],
    [
      'sleeping',
      {
        isActive: true,
        isStreaming: true,
        turnState: makeTurnState({ phase: 'sleeping' }),
      },
      'inactive',
    ],
    [
      'live',
      { isActive: true, isStreaming: true, turnState: makeTurnState() },
      'live',
    ],
    ['unknown', { isActive: true, isStreaming: true }, undefined],
  ] as const)(
    'maps %s evidence without reading the liveness registry',
    async (_name, data, expected) => {
      candidates.set([{ sessionId: SESS_IDLE, generation: 3 }]);
      callMock.mockResolvedValue(rpcResult(data));
      await service.reconcileTab('tab', SESS_IDLE);
      if (expected)
        expect(applyEvidence).toHaveBeenCalledWith(SESS_IDLE, 3, expected);
      else expect(applyEvidence).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, { success: false }, { success: true }])(
    'leaves unknown answers pending: %j',
    async (response) => {
      candidates.set([{ sessionId: SESS_IDLE, generation: 1 }]);
      callMock.mockResolvedValue(response);
      await service.reconcileTab('tab', SESS_IDLE);
      expect(applyEvidence).not.toHaveBeenCalled();
    },
  );

  it('keeps failed candidates pending and re-probes after a new history registration', async () => {
    tabs = [makeTab({ claudeSessionId: SESS_IDLE })];
    candidates.set([{ sessionId: SESS_IDLE, generation: 1 }]);
    callMock.mockRejectedValueOnce(new Error('offline'));
    TestBed.flushEffects();
    await Promise.resolve();
    expect(applyEvidence).not.toHaveBeenCalled();
    callMock.mockResolvedValue(
      rpcResult({
        isActive: true,
        isStreaming: true,
        turnState: makeTurnState({ phase: 'awaiting-background' }),
      }),
    );
    candidates.set([{ sessionId: SESS_IDLE, generation: 2 }]);
    TestBed.flushEffects();
    await Promise.resolve();
    expect(applyEvidence).toHaveBeenCalledWith(SESS_IDLE, 2, 'live');
  });

  it('retries a failed probe once when candidates change at the same generation', async () => {
    tabs = [makeTab({ claudeSessionId: SESS_IDLE })];
    candidates.set([{ sessionId: SESS_IDLE, generation: 1 }]);
    callMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(
      rpcResult({ isActive: false, isStreaming: false }),
    );
    TestBed.flushEffects();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(callMock).toHaveBeenCalledTimes(1);

    candidates.set([{ sessionId: SESS_IDLE, generation: 1 }]);
    TestBed.flushEffects();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(callMock).toHaveBeenCalledTimes(2);
    expect(applyEvidence).toHaveBeenCalledWith(SESS_IDLE, 1, 'inactive');
    candidates.set([{ sessionId: SESS_IDLE, generation: 1 }]);
    TestBed.flushEffects();
    expect(callMock).toHaveBeenCalledTimes(2);
  });

  it('does not attach a delayed status answer to a newer registration', async () => {
    let resolve!: (value: ReturnType<typeof rpcResult>) => void;
    candidates.set([{ sessionId: SESS_IDLE, generation: 1 }]);
    callMock.mockReturnValue(
      new Promise<ReturnType<typeof rpcResult>>((done) => {
        resolve = done;
      }),
    );
    const pending = service.reconcileTab('tab', SESS_IDLE);
    candidates.set([{ sessionId: SESS_IDLE, generation: 2 }]);
    resolve(rpcResult({ isActive: false, isStreaming: false }));
    await pending;
    expect(applyEvidence).toHaveBeenCalledWith(SESS_IDLE, 1, 'inactive');
  });

  it('probes each registration once and captures its generation before awaiting', async () => {
    tabs = [makeTab({ claudeSessionId: SESS_IDLE })];
    candidates.set([{ sessionId: SESS_IDLE, generation: 1 }]);
    callMock.mockResolvedValue(
      rpcResult({ isActive: false, isStreaming: false }),
    );
    TestBed.flushEffects();
    await Promise.resolve();
    TestBed.flushEffects();
    expect(callMock).toHaveBeenCalledTimes(1);
    candidates.set([{ sessionId: SESS_IDLE, generation: 2 }]);
    TestBed.flushEffects();
    await Promise.resolve();
    expect(callMock).toHaveBeenCalledTimes(2);
    expect(applyEvidence).toHaveBeenCalledWith(SESS_IDLE, 2, 'inactive');
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

    expect(applyMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESS_STREAM }),
      `tab-${SESS_STREAM}`,
      { ordered: false },
    );
    expect(warnMock).toHaveBeenCalledWith(
      'SessionLivenessReconciler', 'probe failed', expect.any(Error),
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

  it('reconcileTab probes only the requested tab through the unordered turn-state path', async () => {
    callMock.mockResolvedValue(
      rpcResult({
        isActive: true,
        isStreaming: true,
        turnState: makeTurnState(),
      }),
    );
    await service.reconcileTab('tab-target', SESS_STREAM);
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(callMock).toHaveBeenCalledWith('session:status', {
      sessionId: SESS_STREAM,
    });
    expect(applyMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESS_STREAM }),
      'tab-target',
      { ordered: false },
    );
  });
});
