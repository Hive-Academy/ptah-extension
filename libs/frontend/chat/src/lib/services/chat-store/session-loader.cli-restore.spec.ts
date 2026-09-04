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
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  SessionManager,
  StreamingHandlerService,
  AgentMonitorStore,
} from '@ptah-extension/chat-streaming';
import type { CliSessionReference, SessionId } from '@ptah-extension/shared';

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
  let resumeData: Record<string, unknown>;

  beforeEach(() => {
    resumeData = {
      events: [{ eventType: 'text_delta', id: 'e1', timestamp: 1 }],
      cliSessions: REFS,
      resumableSubagents: [],
    };

    const rpcCall = jest.fn(async (method: string) => {
      if (method === 'session:load') return { success: true, data: {} };
      if (method === 'chat:resume') return { success: true, data: resumeData };
      return {
        success: true,
        data: { sessions: [], total: 0, hasMore: false },
      };
    });

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
      applyResumedHistory: jest.fn(),
      applyResumeFailure: jest.fn(),
      applyLoadedSessionStats: jest.fn(),
      setPreloadedStats: jest.fn(),
      setLiveModelStats: jest.fn(),
      setModelUsageList: jest.fn(),
      markSessionActive: jest.fn(),
    } as unknown as TabManagerService;

    processStreamEvent = jest.fn();
    loadCliSessions = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        SessionLoaderService,
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
          },
        },
        { provide: AgentMonitorStore, useValue: { loadCliSessions } },
      ],
    });
    service = TestBed.inject(SessionLoaderService);
  });

  afterEach(() => TestBed.resetTestingModule());

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
  });

  it('restores the cards when the transcript yields no events or messages', async () => {
    resumeData = { events: [], messages: [], cliSessions: REFS };

    await expect(service.switchSession(SESSION)).rejects.toThrow();
    expect(loadCliSessions).toHaveBeenCalledWith(REFS, SESSION);
  });
});
