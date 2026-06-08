/**
 * TurnEndHandlerService — background-workspace fallback.
 *
 * When findTabsBySessionId returns [] but a cross-workspace lookup hits, each
 * handler must apply terminal state to the background tab via
 * updateBackgroundTab (NO signal markers, NO finalize) and return:
 *   - handleTurnEnded: pendingBackgroundTasks/pendingSessionCrons/lastTerminalReason,
 *     status 'awaiting-background' iff backgroundTasks.length>0 else 'loaded'.
 *   - handleSubagentEnded: onStopped still runs; updateBackgroundTab with
 *     pendingBackgroundTasks; status 'loaded' only when prior status was
 *     'awaiting-background' AND remaining===0.
 *   - handleTurnFailed: updateBackgroundTab with lastTerminalReason + status
 *     'loaded'; no finalize; handleChatError STILL fires exactly once.
 * The existing active-tab path (findTabsBySessionId hit) is unaffected and never
 * calls updateBackgroundTab.
 */

import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  BackgroundAgentStore,
  MessageFinalizationService,
} from '@ptah-extension/chat-streaming';
import {
  SessionId,
  type SdkSubagentEndedPayload,
  type SdkTurnEndedPayload,
  type SdkTurnFailedPayload,
} from '@ptah-extension/shared';
import type { TabState } from '@ptah-extension/chat-types';
import { ChatLifecycleService } from './chat-lifecycle.service';
import { TurnEndHandlerService } from './turn-end-handler.service';

const SESS_PRIMARY = SessionId.create();
const SESS_BG = SessionId.create();

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'bg-tab',
    title: 'Background',
    status: 'awaiting-background',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: SESS_BG,
    ...overrides,
  } as unknown as TabState;
}

function makeTurnEndedPayload(
  overrides: Partial<SdkTurnEndedPayload> = {},
): SdkTurnEndedPayload {
  return {
    sessionId: SESS_BG,
    cwd: '/workspace',
    lastAssistantMessage: 'done',
    backgroundTasks: [],
    sessionCrons: [],
    terminalReason: 'completed',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function makeTurnFailedPayload(
  overrides: Partial<SdkTurnFailedPayload> = {},
): SdkTurnFailedPayload {
  return {
    sessionId: SESS_BG,
    cwd: '/workspace',
    lastAssistantMessage: null,
    error: 'rate_limit',
    errorDetails: null,
    terminalReason: 'blocking_limit',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function makeSubagentEndedPayload(
  overrides: Partial<SdkSubagentEndedPayload> = {},
): SdkSubagentEndedPayload {
  return {
    sessionId: SESS_BG,
    cwd: '/workspace',
    agentId: 'agent-a',
    agentType: 'subagent',
    lastAssistantMessage: 'sub done',
    backgroundTasks: [],
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function makeBackgroundTask(id: string) {
  return {
    id,
    type: 'subagent' as const,
    status: 'running' as const,
    description: 'still going',
  };
}

describe('TurnEndHandlerService — background fallback', () => {
  let service: TurnEndHandlerService;
  let crossWsTab: TabState | null;
  let findTabsBySessionIdMock: jest.Mock;
  let findAcrossWorkspacesMock: jest.Mock;
  let updateBackgroundTabMock: jest.Mock<boolean, [string, Partial<TabState>]>;
  let setTurnEndedFieldsMock: jest.Mock;
  let setLastTerminalReasonMock: jest.Mock;
  let setPendingBackgroundTasksMock: jest.Mock;
  let markTabIdleMock: jest.Mock;
  let markTabAwaitingBackgroundMock: jest.Mock;
  let markLoadedMock: jest.Mock;
  let finalizeCurrentMessageMock: jest.Mock;
  let handleChatErrorMock: jest.Mock;
  let onStoppedMock: jest.Mock;
  let findByAgentIdMock: jest.Mock;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    crossWsTab = null;
    findTabsBySessionIdMock = jest.fn(() => []);
    findAcrossWorkspacesMock = jest.fn(() =>
      crossWsTab ? { tab: crossWsTab, workspacePath: '/ws/bg' } : null,
    );
    updateBackgroundTabMock = jest.fn().mockReturnValue(true);
    setTurnEndedFieldsMock = jest.fn();
    setLastTerminalReasonMock = jest.fn();
    setPendingBackgroundTasksMock = jest.fn();
    markTabIdleMock = jest.fn();
    markTabAwaitingBackgroundMock = jest.fn();
    markLoadedMock = jest.fn();
    finalizeCurrentMessageMock = jest.fn();
    handleChatErrorMock = jest.fn();
    onStoppedMock = jest.fn();
    findByAgentIdMock = jest.fn().mockReturnValue(null);

    const tabManagerMock = {
      findTabsBySessionId: findTabsBySessionIdMock,
      findTabBySessionIdAcrossWorkspaces: findAcrossWorkspacesMock,
      updateBackgroundTab: updateBackgroundTabMock,
      setTurnEndedFields: setTurnEndedFieldsMock,
      setLastTerminalReason: setLastTerminalReasonMock,
      setPendingBackgroundTasks: setPendingBackgroundTasksMock,
      markTabIdle: markTabIdleMock,
      markTabAwaitingBackground: markTabAwaitingBackgroundMock,
      markLoaded: markLoadedMock,
    } as unknown as TabManagerService;

    const finalizationMock = {
      finalizeCurrentMessage: finalizeCurrentMessageMock,
    } as unknown as MessageFinalizationService;

    const lifecycleMock = {
      handleChatError: handleChatErrorMock,
    } as unknown as ChatLifecycleService;

    const backgroundAgentStoreMock = {
      onStopped: onStoppedMock,
      findByAgentId: findByAgentIdMock,
    } as unknown as BackgroundAgentStore;

    warn = jest.spyOn(console, 'warn').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        TurnEndHandlerService,
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: MessageFinalizationService, useValue: finalizationMock },
        { provide: ChatLifecycleService, useValue: lifecycleMock },
        { provide: BackgroundAgentStore, useValue: backgroundAgentStoreMock },
      ],
    });
    service = TestBed.inject(TurnEndHandlerService);
  });

  afterEach(() => {
    warn.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('handleTurnEnded background fallback', () => {
    it('updates the background tab with status loaded when no background work', () => {
      crossWsTab = makeTab();

      service.handleTurnEnded(
        makeTurnEndedPayload({
          backgroundTasks: [],
          sessionCrons: [makeCron('cron-1')],
        }),
      );

      expect(updateBackgroundTabMock).toHaveBeenCalledTimes(1);
      const [tabId, updates] = updateBackgroundTabMock.mock.calls[0];
      expect(tabId).toBe('bg-tab');
      expect(updates).toEqual(
        expect.objectContaining({
          pendingBackgroundTasks: [],
          lastTerminalReason: 'completed',
          status: 'loaded',
        }),
      );
      expect(updates.pendingSessionCrons).toEqual([
        expect.objectContaining({ id: 'cron-1' }),
      ]);
    });

    it('updates the background tab with status awaiting-background when tasks remain', () => {
      crossWsTab = makeTab();

      service.handleTurnEnded(
        makeTurnEndedPayload({ backgroundTasks: [makeBackgroundTask('bg-x')] }),
      );

      expect(updateBackgroundTabMock.mock.calls[0][1].status).toBe(
        'awaiting-background',
      );
    });

    it('does NOT call signal markers or finalize on the background path', () => {
      crossWsTab = makeTab();

      service.handleTurnEnded(makeTurnEndedPayload());

      expect(setTurnEndedFieldsMock).not.toHaveBeenCalled();
      expect(markTabIdleMock).not.toHaveBeenCalled();
      expect(markTabAwaitingBackgroundMock).not.toHaveBeenCalled();
      expect(finalizeCurrentMessageMock).not.toHaveBeenCalled();
    });

    it('warns when neither an active nor a background tab is found', () => {
      crossWsTab = null;

      service.handleTurnEnded(makeTurnEndedPayload());

      expect(updateBackgroundTabMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleTurnEnded: no tab bound to sessionId',
        expect.objectContaining({ sessionId: SESS_BG }),
      );
    });

    it('uses the active-tab path (no updateBackgroundTab) when a bound tab exists', () => {
      findTabsBySessionIdMock.mockReturnValue([
        makeTab({ claudeSessionId: SESS_PRIMARY }),
      ]);

      service.handleTurnEnded(
        makeTurnEndedPayload({ sessionId: SESS_PRIMARY }),
      );

      expect(updateBackgroundTabMock).not.toHaveBeenCalled();
      expect(setTurnEndedFieldsMock).toHaveBeenCalledWith(
        'bg-tab',
        expect.objectContaining({ lastTerminalReason: 'completed' }),
      );
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('bg-tab', false);
      expect(markTabIdleMock).toHaveBeenCalledWith('bg-tab');
    });
  });

  describe('handleSubagentEnded background fallback', () => {
    it('runs onStopped, then updates the bg tab to loaded when awaiting-background and remaining 0', () => {
      crossWsTab = makeTab({ status: 'awaiting-background' });

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ backgroundTasks: [] }),
      );

      expect(onStoppedMock).toHaveBeenCalledTimes(1);
      expect(updateBackgroundTabMock).toHaveBeenCalledTimes(1);
      const updates = updateBackgroundTabMock.mock.calls[0][1];
      expect(updates.pendingBackgroundTasks).toEqual([]);
      expect(updates.status).toBe('loaded');
    });

    it('omits the loaded status flip when background tasks remain', () => {
      crossWsTab = makeTab({ status: 'awaiting-background' });

      service.handleSubagentEnded(
        makeSubagentEndedPayload({
          backgroundTasks: [makeBackgroundTask('bg-b')],
        }),
      );

      const updates = updateBackgroundTabMock.mock.calls[0][1];
      expect(updates.pendingBackgroundTasks).toEqual([
        expect.objectContaining({ id: 'bg-b' }),
      ]);
      expect(updates.status).toBeUndefined();
    });

    it('omits the loaded status flip when the bg tab was not awaiting-background', () => {
      crossWsTab = makeTab({ status: 'loaded' });

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ backgroundTasks: [] }),
      );

      expect(updateBackgroundTabMock.mock.calls[0][1].status).toBeUndefined();
    });

    it('does NOT call setPendingBackgroundTasks or markLoaded signal markers', () => {
      crossWsTab = makeTab({ status: 'awaiting-background' });

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ backgroundTasks: [] }),
      );

      expect(setPendingBackgroundTasksMock).not.toHaveBeenCalled();
      expect(markLoadedMock).not.toHaveBeenCalled();
    });

    it('runs onStopped even when no tab is found anywhere, then warns', () => {
      crossWsTab = null;

      service.handleSubagentEnded(makeSubagentEndedPayload());

      expect(onStoppedMock).toHaveBeenCalledTimes(1);
      expect(updateBackgroundTabMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleSubagentEnded: no tab bound to sessionId',
        expect.objectContaining({ sessionId: SESS_BG }),
      );
    });

    it('uses the active-tab path (no updateBackgroundTab) when a bound tab exists', () => {
      findTabsBySessionIdMock.mockReturnValue([
        makeTab({
          status: 'awaiting-background',
          claudeSessionId: SESS_PRIMARY,
        }),
      ]);

      service.handleSubagentEnded(
        makeSubagentEndedPayload({
          sessionId: SESS_PRIMARY,
          backgroundTasks: [],
        }),
      );

      expect(updateBackgroundTabMock).not.toHaveBeenCalled();
      expect(setPendingBackgroundTasksMock).toHaveBeenCalledWith('bg-tab', []);
      expect(markLoadedMock).toHaveBeenCalledWith('bg-tab');
    });
  });

  describe('handleTurnFailed background fallback', () => {
    it('updates the bg tab with lastTerminalReason + loaded, no finalize, error routed once', () => {
      crossWsTab = makeTab();

      service.handleTurnFailed(makeTurnFailedPayload());

      expect(updateBackgroundTabMock).toHaveBeenCalledTimes(1);
      const updates = updateBackgroundTabMock.mock.calls[0][1];
      expect(updates.lastTerminalReason).toBe('blocking_limit');
      expect(updates.status).toBe('loaded');

      expect(finalizeCurrentMessageMock).not.toHaveBeenCalled();
      expect(setLastTerminalReasonMock).not.toHaveBeenCalled();
      expect(markTabIdleMock).not.toHaveBeenCalled();

      expect(handleChatErrorMock).toHaveBeenCalledTimes(1);
      expect(handleChatErrorMock).toHaveBeenCalledWith({
        sessionId: SESS_BG,
        error: 'Rate limited by Anthropic. Wait a moment and try again.',
      });
    });

    it('still routes handleChatError once when no tab is found anywhere', () => {
      crossWsTab = null;

      service.handleTurnFailed(makeTurnFailedPayload());

      expect(updateBackgroundTabMock).not.toHaveBeenCalled();
      expect(handleChatErrorMock).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleTurnFailed: no tab bound to sessionId',
        expect.objectContaining({ sessionId: SESS_BG }),
      );
    });

    it('uses the active-tab path (no updateBackgroundTab) when a bound tab exists', () => {
      findTabsBySessionIdMock.mockReturnValue([
        makeTab({ claudeSessionId: SESS_PRIMARY }),
      ]);

      service.handleTurnFailed(
        makeTurnFailedPayload({ sessionId: SESS_PRIMARY }),
      );

      expect(updateBackgroundTabMock).not.toHaveBeenCalled();
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('bg-tab', true);
      expect(markTabIdleMock).toHaveBeenCalledWith('bg-tab');
      expect(handleChatErrorMock).toHaveBeenCalledTimes(1);
    });
  });
});

function makeCron(id: string) {
  return { id, schedule: '*/5 * * * *', recurring: true, prompt: 'ping' };
}
