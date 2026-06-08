import { TestBed } from '@angular/core/testing';
import { SessionLivenessReconcilerService } from './session-liveness-reconciler.service';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import {
  TabManagerService,
  SessionLivenessRegistry,
} from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';
import { SessionId, SessionStatusResponse } from '@ptah-extension/shared';

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

describe('SessionLivenessReconcilerService', () => {
  let service: SessionLivenessReconcilerService;
  let tabs: TabState[];
  let callMock: jest.Mock;
  let markStreamingLiveness: jest.Mock;
  let markIdleLiveness: jest.Mock;
  let markStreamingTab: jest.Mock;
  let markTabStreaming: jest.Mock;
  let warn: jest.SpyInstance;

  function rpcResult(data: SessionStatusResponse) {
    return { success: true, data, isSuccess: () => true };
  }

  beforeEach(() => {
    tabs = [];
    callMock = jest.fn();
    markStreamingLiveness = jest.fn();
    markIdleLiveness = jest.fn();
    markStreamingTab = jest.fn();
    markTabStreaming = jest.fn();
    warn = jest.spyOn(console, 'warn').mockImplementation();

    const rpcMock = { call: callMock } as unknown as ClaudeRpcService;
    const vscodeMock = {
      config: () => ({ workspaceRoot: WS }),
    } as unknown as VSCodeService;
    const tabManagerMock = {
      tabs: () => tabs,
      markStreaming: markStreamingTab,
      markTabStreaming,
    } as unknown as TabManagerService;
    const livenessMock = {
      markStreaming: markStreamingLiveness,
      markIdle: markIdleLiveness,
    } as unknown as SessionLivenessRegistry;

    TestBed.configureTestingModule({
      providers: [
        SessionLivenessReconcilerService,
        { provide: ClaudeRpcService, useValue: rpcMock },
        { provide: VSCodeService, useValue: vscodeMock },
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: SessionLivenessRegistry, useValue: livenessMock },
      ],
    });
    service = TestBed.inject(SessionLivenessReconcilerService);
  });

  afterEach(() => {
    warn.mockRestore();
    TestBed.resetTestingModule();
  });

  it('streaming response marks liveness streaming and sets the tab streaming marker', async () => {
    tabs = [makeTab({ claudeSessionId: SESS_STREAM })];
    callMock.mockResolvedValue(
      rpcResult({ isActive: true, isStreaming: true }),
    );

    await service.reconcileRestoredTabs();

    expect(callMock).toHaveBeenCalledWith('session:status', {
      sessionId: SESS_STREAM,
    });
    expect(markStreamingLiveness).toHaveBeenCalledWith(SESS_STREAM, WS);
    expect(markStreamingTab).toHaveBeenCalledWith(`tab-${SESS_STREAM}`);
    expect(markTabStreaming).toHaveBeenCalledWith(`tab-${SESS_STREAM}`);
    expect(markIdleLiveness).not.toHaveBeenCalled();
  });

  it('active-not-streaming marks idle and does NOT set streaming', async () => {
    tabs = [makeTab({ claudeSessionId: SESS_IDLE })];
    callMock.mockResolvedValue(
      rpcResult({ isActive: true, isStreaming: false }),
    );

    await service.reconcileRestoredTabs();

    expect(markIdleLiveness).toHaveBeenCalledWith(SESS_IDLE, WS);
    expect(markStreamingLiveness).not.toHaveBeenCalled();
    expect(markStreamingTab).not.toHaveBeenCalled();
    expect(markTabStreaming).not.toHaveBeenCalled();
  });

  it('inactive session does nothing', async () => {
    tabs = [makeTab({ claudeSessionId: SESS_DEAD })];
    callMock.mockResolvedValue(
      rpcResult({ isActive: false, isStreaming: false }),
    );

    await service.reconcileRestoredTabs();

    expect(markStreamingLiveness).not.toHaveBeenCalled();
    expect(markIdleLiveness).not.toHaveBeenCalled();
    expect(markStreamingTab).not.toHaveBeenCalled();
    expect(markTabStreaming).not.toHaveBeenCalled();
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
          : Promise.resolve(rpcResult({ isActive: true, isStreaming: true })),
    );

    await expect(service.reconcileRestoredTabs()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      '[SessionLivenessReconciler] probe failed; leaving tab as restored',
      expect.objectContaining({ sessionId: SESS_REJECT }),
    );
    expect(markStreamingLiveness).toHaveBeenCalledWith(SESS_STREAM, WS);
    expect(markStreamingTab).toHaveBeenCalledWith(`tab-${SESS_STREAM}`);
  });

  it('passes undefined workspacePath when workspaceRoot is unavailable', async () => {
    TestBed.resetTestingModule();
    tabs = [makeTab({ claudeSessionId: SESS_IDLE })];
    callMock.mockResolvedValue(
      rpcResult({ isActive: true, isStreaming: false }),
    );
    TestBed.configureTestingModule({
      providers: [
        SessionLivenessReconcilerService,
        { provide: ClaudeRpcService, useValue: { call: callMock } },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: null }) },
        },
        {
          provide: TabManagerService,
          useValue: {
            tabs: () => tabs,
            markStreaming: markStreamingTab,
            markTabStreaming,
          },
        },
        {
          provide: SessionLivenessRegistry,
          useValue: {
            markStreaming: markStreamingLiveness,
            markIdle: markIdleLiveness,
          },
        },
      ],
    });
    service = TestBed.inject(SessionLivenessReconcilerService);

    await service.reconcileRestoredTabs();

    expect(markIdleLiveness).toHaveBeenCalledWith(SESS_IDLE, undefined);
  });
});
