/**
 * `switchSession` is the ONLY path that puts a session's CLI agent cards back
 * after the user closes a tab and reopens the session: closing the tab
 * force-clears the cards, and `restoreCliSessionsForSession` refuses to fetch
 * twice for the same session in one app run.
 *
 * These specs pin that the restore does not ride behind the transcript replay,
 * which is the part that can fail — 250+ events through the streaming handler,
 * or no events at all.
 */

import { TestBed } from '@angular/core/testing';
import { signal, computed } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { SessionLoaderService } from './session-loader.service';
import { HistoryPagingService } from './history-paging.service';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  HistoryMessageBuilder,
  SessionManager,
  StreamingHandlerService,
  AgentMonitorStore,
} from '@ptah-extension/chat-streaming';
import type {
  CliSessionReference,
  FlatStreamEventUnion,
  SessionId,
} from '@ptah-extension/shared';

const SESSION = 'sess-reopen' as SessionId;
const TAB = 'tab-1';

const REFS = [
  { agentId: 'a1', cli: 'codex', status: 'completed' },
  { agentId: 'a2', cli: 'ptah-cli', status: 'completed' },
] as unknown as CliSessionReference[];

describe('SessionLoaderService — CLI agent cards on reopen', () => {
  let service: SessionLoaderService;
  let loadCliSessions: jest.Mock;
  let processStreamEvent: jest.Mock;
  let applyResumeFailure: jest.Mock;
  let clearPendingUpdates: jest.Mock;
  let resumeData: Record<string, unknown>;
  let rpcCall: jest.Mock;
  let appendCliOutputPage: jest.Mock;
  let cliOutputDemand: ReturnType<
    typeof signal<readonly { sessionId: string; agentId: string }[]>
  >;

  beforeEach(() => {
    resumeData = {
      events: [{ eventType: 'text_delta', id: 'e1', timestamp: 1 }],
      cliSessions: REFS,
      resumableSubagents: [],
    };

    rpcCall = jest.fn(async (method: string) => {
      if (method === 'session:load') return { success: true, data: {} };
      if (method === 'chat:resume') return { success: true, data: resumeData };
      if (method === 'session:cli-output-page') {
        return {
          success: true,
          data: { items: [], nextCursor: null, done: true },
        };
      }
      return {
        success: true,
        data: { sessions: [], total: 0, hasMore: false },
      };
    });

    applyResumeFailure = jest.fn();
    clearPendingUpdates = jest.fn();
    const idle = signal<string | null>(null);
    const tabManagerMock = {
      pendingSessionLoad: computed(() => idle()),
      clearPendingSessionLoad: jest.fn(),
      activeTabSessionId: computed(() => idle()),
      activeTabStatus: computed(() => idle()),
      activeTabId: computed(() => idle()),
      tabs: computed(() => [{ id: TAB, claudeSessionId: SESSION }]),
      findTabBySessionId: jest.fn(() => undefined),
      openSessionTab: jest.fn(() => TAB),
      switchTab: jest.fn(),
      applyResumingSession: jest.fn(),
      applyResumeFailure,
      applyLoadedSessionStats: jest.fn(),
      setLiveModelStats: jest.fn(),
      markSessionActive: jest.fn(),
      findTabByIdAcrossWorkspaces: jest.fn((tabId: string) =>
        tabId === TAB
          ? {
              tab: { id: TAB, claudeSessionId: SESSION },
              workspacePath: 'D:/repo',
            }
          : null,
      ),
    } as unknown as TabManagerService;

    processStreamEvent = jest.fn();
    loadCliSessions = jest.fn();
    appendCliOutputPage = jest.fn();
    cliOutputDemand = signal<readonly { sessionId: string; agentId: string }[]>(
      [],
    );

    TestBed.configureTestingModule({
      providers: [
        SessionLoaderService,
        { provide: HistoryMessageBuilder, useValue: {} },
        {
          provide: HistoryPagingService,
          useValue: {
            tailRequest: () => ({ maxEvents: 250 }),
            recordTail: jest.fn(),
          },
        },
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: VSCodeService,
          useValue: { config: jest.fn(() => ({ workspaceRoot: 'D:/repo' })) },
        },
        { provide: TabManagerService, useValue: tabManagerMock },
        {
          provide: SessionManager,
          useValue: {
            setStatus: jest.fn(),
            setSessionId: jest.fn(),
            setNodeMaps: jest.fn(),
          },
        },
        {
          provide: StreamingHandlerService,
          useValue: {
            processStreamEvent,
            finalizeSessionHistory: jest.fn(),
            cleanupSessionDeduplication: jest.fn(),
            clearPendingUpdates,
          },
        },
        {
          provide: AgentMonitorStore,
          useValue: {
            loadCliSessions,
            appendCliOutputPage,
            cliOutputProgress: jest.fn(() => null),
            resetCliOutputHistory: jest.fn(),
            cliOutputDemand: cliOutputDemand.asReadonly(),
          },
        },
      ],
    });
    service = TestBed.inject(SessionLoaderService);
  });

  afterEach(() => TestBed.resetTestingModule());

  const outputPageCalls = (): unknown[][] =>
    rpcCall.mock.calls.filter(
      ([method]) => method === 'session:cli-output-page',
    );

  const settle = async (): Promise<void> => {
    for (let round = 0; round < 3; round++) {
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  it('requests no output page at resume until a card is expanded', async () => {
    await service.switchSession(SESSION);
    await settle();

    expect(loadCliSessions).toHaveBeenCalledWith(REFS, SESSION);
    expect(outputPageCalls()).toHaveLength(0);
    expect(appendCliOutputPage).not.toHaveBeenCalled();
  });

  it('pages exactly one sequence for the card that is expanded', async () => {
    await service.switchSession(SESSION);
    await settle();

    cliOutputDemand.set([{ sessionId: SESSION, agentId: 'a2' }]);
    await settle();
    await settle();

    expect(outputPageCalls()).toEqual([
      [
        'session:cli-output-page',
        {
          sessionId: SESSION,
          agentId: 'a2',
          cursor: undefined,
          maxBytes: 128 * 1024,
        },
        { signal: expect.any(AbortSignal) },
      ],
    ]);
    expect(appendCliOutputPage).toHaveBeenCalledTimes(1);
  });

  it('restores the cards on a normal resume', async () => {
    await service.switchSession(SESSION);

    expect(loadCliSessions).toHaveBeenCalledWith(REFS, SESSION);
  });

  it('restores the cards even when the transcript replay throws', async () => {
    processStreamEvent.mockImplementation(() => {
      throw new Error('bad event');
    });

    await expect(service.switchSession(SESSION)).rejects.toThrow('bad event');
    expect(loadCliSessions).toHaveBeenCalledWith(REFS, SESSION);
    // TASK_2026_437 C15: the half-replayed tab settles through the failure
    // branch instead of staying `resuming` with a partial transcript.
    expect(clearPendingUpdates).toHaveBeenCalledWith(TAB);
    expect(applyResumeFailure).toHaveBeenCalledWith(TAB);
  });

  it('restores the cards when the transcript yields no events', async () => {
    resumeData = { events: [], cliSessions: REFS };

    await expect(service.switchSession(SESSION)).rejects.toThrow();
    expect(loadCliSessions).toHaveBeenCalledWith(REFS, SESSION);
  });

  describe('with a chunked replay (TASK_2026_437 C15)', () => {
    const originalMessageChannel = globalThis.MessageChannel;
    let yields: number;

    beforeEach(() => {
      yields = 0;
      class CountingMessageChannel {
        readonly port1: { onmessage: (() => void) | null; close: () => void } =
          { onmessage: null, close: () => undefined };
        readonly port2 = {
          postMessage: () => {
            yields++;
            void Promise.resolve().then(() => this.port1.onmessage?.());
          },
          close: () => undefined,
        };
      }
      globalThis.MessageChannel =
        CountingMessageChannel as unknown as typeof MessageChannel;
    });

    afterEach(() => {
      globalThis.MessageChannel = originalMessageChannel;
    });

    const manyEvents = (count: number): FlatStreamEventUnion[] =>
      Array.from(
        { length: count },
        (_, index) =>
          ({
            eventType: 'text_delta',
            id: `e${index}`,
            timestamp: index,
          }) as unknown as FlatStreamEventUnion,
      );

    it('restores the cards before the first chunk is replayed', async () => {
      resumeData = { ...resumeData, events: manyEvents(600) };
      const yieldsAtFirstEvent: number[] = [];
      processStreamEvent.mockImplementation(() => {
        if (yieldsAtFirstEvent.length === 0) {
          yieldsAtFirstEvent.push(yields);
          expect(loadCliSessions).toHaveBeenCalledWith(REFS, SESSION);
        }
      });

      await service.switchSession(SESSION);

      expect(yieldsAtFirstEvent).toEqual([0]);
      expect(processStreamEvent).toHaveBeenCalledTimes(600);
      expect(yields).toBe(3);
    });

    it('restores the cards when a later chunk throws, and settles the tab as failed', async () => {
      resumeData = { ...resumeData, events: manyEvents(600) };
      processStreamEvent.mockImplementation((event: { id: string }) => {
        if (event.id === 'e300') throw new Error('bad chunk');
      });

      await expect(service.switchSession(SESSION)).rejects.toThrow('bad chunk');

      expect(loadCliSessions).toHaveBeenCalledWith(REFS, SESSION);
      expect(yields).toBe(1);
      expect(applyResumeFailure).toHaveBeenCalledWith(TAB);
    });
  });
});
