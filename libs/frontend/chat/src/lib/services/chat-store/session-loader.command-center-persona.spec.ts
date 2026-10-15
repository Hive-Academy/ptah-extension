import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { COMMAND_CENTER_PERSONA, TabManagerService } from '@ptah-extension/chat-state';
import { AgentMonitorStore, SessionManager, StreamingHandlerService } from '@ptah-extension/chat-streaming';
import { SessionHistoryReplayer } from './session-history-replayer.service';
import { SessionLivenessReconcilerService } from './session-liveness-reconciler.service';
import { StreamViewportController } from '../stream-viewport-controller.service';
import { HistoryPagingService } from './history-paging.service';
import { SessionLoaderService } from './session-loader.service';
import { SessionId } from '@ptah-extension/shared';

describe('Command Center resume persona', () => {
  const marked = { id: 'root', claudeSessionId: '00000000-0000-4000-8000-000000000001', status: 'loaded', name: 'Root', commandCenterOrigin: { workspaceId: '/repo', createdAt: 1, version: 1 } };
  const plain = { ...marked, id: 'plain', commandCenterOrigin: undefined };
  let selected: typeof marked | typeof plain = marked;
  const call = jest.fn((method: string, _params: object) => method === 'chat:resume'
    ? new Promise(() => undefined)
    : Promise.resolve({ success: true, data: {} }));
  let loader: SessionLoaderService;

  beforeEach(() => {
    selected = marked;
    call.mockClear();
    TestBed.configureTestingModule({ providers: [
      SessionLoaderService,
      { provide: ClaudeRpcService, useValue: { call } },
      { provide: VSCodeService, useValue: { config: () => ({ workspaceRoot: '/repo' }), isElectron: false } },
      { provide: TabManagerService, useValue: {
        pendingSessionLoad: signal(null), clearPendingSessionLoad: jest.fn(),
        activeTabSessionId: signal(null), activeTabStatus: signal(null), activeTabId: signal(null),
        tabs: () => [], findTabBySessionId: () => null,
        openSessionTab: () => selected.id,
        findTabByIdAcrossWorkspaces: (id: string) => ({ tab: id === selected.id ? selected : null }),
        applyResumingSession: jest.fn(),
      } },
      { provide: SessionManager, useValue: { setNodeMaps: jest.fn(), setSessionId: jest.fn(), setStatus: jest.fn() } },
      { provide: StreamingHandlerService, useValue: { cleanupSessionDeduplication: jest.fn() } },
      { provide: AgentMonitorStore, useValue: { cliOutputDemand: signal([]) } },
      { provide: SessionHistoryReplayer, useValue: { liveArrivalMark: () => 0, claim: () => null, release: jest.fn() } },
      { provide: HistoryPagingService, useValue: { tailRequest: () => ({ maxEvents: 250 }) } },
      { provide: SessionLivenessReconcilerService, useValue: {} },
      { provide: StreamViewportController, useValue: {} },
    ] });
    loader = TestBed.inject(SessionLoaderService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('sends persona for activated marked resume and omits it for unmarked resume', async () => {
    void loader.switchSession(SessionId.from('00000000-0000-4000-8000-000000000001'), { activate: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(call).toHaveBeenCalledWith('chat:resume', expect.objectContaining({ systemPrompt: COMMAND_CENTER_PERSONA }), expect.anything());
    selected = plain;
    void loader.switchSession(SessionId.from('00000000-0000-4000-8000-000000000002'), { activate: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const resumes = call.mock.calls.filter(([method]) => method === 'chat:resume');
    expect(resumes[1]?.[1]).not.toHaveProperty('systemPrompt');
  });
});
