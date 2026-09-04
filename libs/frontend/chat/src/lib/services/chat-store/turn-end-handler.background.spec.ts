/**
 * TurnEndHandlerService — background-workspace fallback (TASK_2026_360).
 *
 * When findTabsBySessionId returns [] but a cross-workspace lookup hits, each
 * hook handler stamps its SNAPSHOT on the background tab via
 * `updateBackgroundTab` — and nothing else. Status, the spinner set,
 * finalization and liveness belong to the in-stream `turn_state` event
 * (`TurnStateApplier`), which is workspace-aware on its own.
 *
 *   - handleTurnEnded: pendingBackgroundTasks / pendingSessionCrons /
 *     lastTerminalReason; NO `status` key in the update.
 *   - handleSubagentEnded: onStopped only for a KNOWN background agent;
 *     updateBackgroundTab with pendingBackgroundTasks; NO `status` key.
 *   - handleTurnFailed: updateBackgroundTab with lastTerminalReason only; the
 *     foreground handleChatError channel is NOT invoked (its active-tab
 *     fallback would reset an unrelated foreground tab).
 * The active-tab path (findTabsBySessionId hit) never calls updateBackgroundTab.
 */

import { TestBed } from '@angular/core/testing';
import {
  TabManagerService,
  type BackgroundAgentId,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import {
  BackgroundAgentStore,
  type BackgroundAgentEntry,
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

function makeCron(id: string) {
  return { id, schedule: '*/5 * * * *', recurring: true, prompt: 'ping' };
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
  let handleChatErrorMock: jest.Mock;
  let onStoppedMock: jest.Mock;
  let findByAgentIdMock: jest.Mock;
  let warn: jest.SpyInstance;

  const knownEntry: BackgroundAgentEntry = {
    toolCallId: 'toolu_abc',
    agentId: 'agent-a' as BackgroundAgentId,
    agentType: 'subagent',
    sessionId: SESS_BG as unknown as ClaudeSessionId,
    status: 'running',
    startedAt: 0,
    summary: '',
  };

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
    handleChatErrorMock = jest.fn();
    onStoppedMock = jest.fn();
    findByAgentIdMock = jest.fn().mockReturnValue(null);

    // Snapshot setters only — see turn-end-handler.service.spec.ts.
    const tabManagerMock = {
      findTabsBySessionId: findTabsBySessionIdMock,
      findTabBySessionIdAcrossWorkspaces: findAcrossWorkspacesMock,
      updateBackgroundTab: updateBackgroundTabMock,
      setTurnEndedFields: setTurnEndedFieldsMock,
      setLastTerminalReason: setLastTerminalReasonMock,
      setPendingBackgroundTasks: setPendingBackgroundTasksMock,
    } as unknown as TabManagerService;

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
    it('stamps the snapshot on the background tab without a status key', () => {
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
      expect(updates).toEqual({
        pendingBackgroundTasks: [],
        pendingSessionCrons: [expect.objectContaining({ id: 'cron-1' })],
        lastTerminalReason: 'completed',
      });
      expect('status' in updates).toBe(false);
    });

    it('stamps remaining background tasks without deciding awaiting-background', () => {
      crossWsTab = makeTab();

      service.handleTurnEnded(
        makeTurnEndedPayload({ backgroundTasks: [makeBackgroundTask('bg-x')] }),
      );

      const updates = updateBackgroundTabMock.mock.calls[0][1];
      expect(updates.pendingBackgroundTasks).toEqual([
        expect.objectContaining({ id: 'bg-x' }),
      ]);
      expect('status' in updates).toBe(false);
    });

    it('keeps a frontend-stamped abort reason when the Stop payload reason is null', () => {
      crossWsTab = makeTab({ lastTerminalReason: 'aborted_streaming' });

      service.handleTurnEnded(makeTurnEndedPayload({ terminalReason: null }));

      expect(updateBackgroundTabMock.mock.calls[0][1].lastTerminalReason).toBe(
        'aborted_streaming',
      );
    });

    it('never uses the active-signal setter on the background path', () => {
      crossWsTab = makeTab();

      service.handleTurnEnded(makeTurnEndedPayload());

      expect(setTurnEndedFieldsMock).not.toHaveBeenCalled();
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
    });
  });

  describe('handleSubagentEnded background fallback', () => {
    it('stops the known agent and stamps the snapshot without a status key', () => {
      crossWsTab = makeTab({ status: 'awaiting-background' });
      findByAgentIdMock.mockReturnValue(knownEntry);

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ backgroundTasks: [] }),
      );

      expect(onStoppedMock).toHaveBeenCalledTimes(1);
      expect(updateBackgroundTabMock).toHaveBeenCalledTimes(1);
      const updates = updateBackgroundTabMock.mock.calls[0][1];
      expect(updates).toEqual({ pendingBackgroundTasks: [] });
    });

    it('stamps the remaining tasks when background tasks remain', () => {
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
      expect('status' in updates).toBe(false);
    });

    it('does NOT stop a store entry for an unknown (foreground) agent', () => {
      crossWsTab = makeTab({ status: 'streaming' });
      findByAgentIdMock.mockReturnValue(null);

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ backgroundTasks: [] }),
      );

      expect(onStoppedMock).not.toHaveBeenCalled();
      expect(updateBackgroundTabMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT call the active-signal setter on the background path', () => {
      crossWsTab = makeTab({ status: 'awaiting-background' });

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ backgroundTasks: [] }),
      );

      expect(setPendingBackgroundTasksMock).not.toHaveBeenCalled();
    });

    it('still stops a known agent when no tab is found anywhere, then warns', () => {
      crossWsTab = null;
      findByAgentIdMock.mockReturnValue(knownEntry);

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
    });
  });

  describe('handleTurnFailed background fallback', () => {
    it('stamps lastTerminalReason only and never reaches the foreground error surface', () => {
      crossWsTab = makeTab();

      service.handleTurnFailed(makeTurnFailedPayload());

      expect(updateBackgroundTabMock).toHaveBeenCalledTimes(1);
      const updates = updateBackgroundTabMock.mock.calls[0][1];
      expect(updates).toEqual({ lastTerminalReason: 'blocking_limit' });
      // setLastTerminalReason targets the active signal; the background path
      // stamps the reason via updateBackgroundTab instead.
      expect(setLastTerminalReasonMock).not.toHaveBeenCalled();
      // handleChatError's active-tab fallback would reset an unrelated
      // foreground tab; a background failure must not reach it.
      expect(handleChatErrorMock).not.toHaveBeenCalled();
    });

    it('warns without routing handleChatError when no tab is found anywhere', () => {
      crossWsTab = null;

      service.handleTurnFailed(makeTurnFailedPayload());

      expect(updateBackgroundTabMock).not.toHaveBeenCalled();
      expect(handleChatErrorMock).not.toHaveBeenCalled();
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
      expect(setLastTerminalReasonMock).toHaveBeenCalledWith(
        'bg-tab',
        'blocking_limit',
      );
      expect(handleChatErrorMock).toHaveBeenCalledTimes(1);
    });
  });
});
