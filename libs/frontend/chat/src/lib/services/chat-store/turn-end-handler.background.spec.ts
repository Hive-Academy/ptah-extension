/**
 * TurnEndHandlerService — background-workspace fallback.
 *
 * When findTabsBySessionId returns [] but a cross-workspace lookup hits, each
 * terminal handler applies terminal state to the background tab via
 * updateBackgroundTab AND finalizes the in-flight reply so it survives reload.
 *
 * TASK_2026_154 Bug 2: a terminal background branch that transitions the tab
 * to a non-streaming status MUST also call markTabIdle(tab.id) to clear the
 * global `_streamingTabIds` visual set — updateBackgroundTab only mutates the
 * partitioned TabState and never touches the spinner set, so without this the
 * tab-bar spinner stays lit forever after switching back. markTabIdle keys
 * purely on tab id (workspace-agnostic), so it is safe for a background tab.
 *
 * TASK_2026_154 Wave 2 REVISION (Critical Failure Mode 1): a turn that ends
 * while its tab is backgrounded must ALSO promote its assistant reply from
 * `streamingState` into the persisted `messages` array via
 * `finalizeCurrentMessage` (now workspace-aware). Skipping this stranded the
 * reply in `streamingState`, which the reload sanitize nulls — silent data
 * loss. The earlier revision of this spec encoded the bug by asserting finalize
 * is NOT called; those assertions are flipped below.
 *
 *   - handleTurnEnded: pendingBackgroundTasks/pendingSessionCrons/lastTerminalReason,
 *     status 'loaded' on updateBackgroundTab; finalize(tab.id, isAborted);
 *     markTabIdle ALWAYS (mirrors the active branch which always clears the
 *     spinner at turn-end); markTabAwaitingBackground when background work
 *     remains (queued after finalize's status microtask, exactly like active).
 *   - handleSubagentEnded: onStopped still runs; updateBackgroundTab with
 *     pendingBackgroundTasks; status 'loaded' AND markTabIdle only when prior
 *     status was 'awaiting-background' AND remaining===0 (a subagent ending
 *     mid-turn must NOT clear the parent turn's spinner and must NOT finalize
 *     the parent turn — only the true turn terminal events finalize).
 *   - handleTurnFailed: updateBackgroundTab with lastTerminalReason + status
 *     'loaded'; finalize(tab.id, true); markTabIdle; the foreground
 *     handleChatError channel is NOT invoked (its active-tab fallback would
 *     reset an unrelated foreground tab).
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
      // Bug 2: the spinner set must be cleared for the backgrounded tab.
      expect(markTabIdleMock).toHaveBeenCalledWith('bg-tab');
    });

    it('clears the tab-bar spinner even when background work remains', () => {
      crossWsTab = makeTab();

      service.handleTurnEnded(
        makeTurnEndedPayload({ backgroundTasks: [makeBackgroundTask('bg-y')] }),
      );

      // awaiting-background is a separate indicator from the streaming
      // spinner; the turn itself has ended, so the spinner must clear.
      expect(markTabIdleMock).toHaveBeenCalledWith('bg-tab');
    });

    it('flips to awaiting-background via markTabAwaitingBackground when tasks remain', () => {
      crossWsTab = makeTab();

      service.handleTurnEnded(
        makeTurnEndedPayload({ backgroundTasks: [makeBackgroundTask('bg-x')] }),
      );

      // updateBackgroundTab writes status 'loaded' synchronously; the
      // awaiting-background flip is applied via markTabAwaitingBackground so it
      // lands AFTER finalize's own status microtask (mirrors the active branch).
      expect(updateBackgroundTabMock.mock.calls[0][1].status).toBe('loaded');
      expect(markTabAwaitingBackgroundMock).toHaveBeenCalledWith('bg-tab');
    });

    it('finalizes the reply and clears the spinner on the background path (Wave 2 revision)', () => {
      crossWsTab = makeTab();

      service.handleTurnEnded(makeTurnEndedPayload());

      // setTurnEndedFields targets the active _tabs signal — never used on the
      // background partition path (updateBackgroundTab is used instead).
      expect(setTurnEndedFieldsMock).not.toHaveBeenCalled();
      // No background work in the default payload → no awaiting-background flip.
      expect(markTabAwaitingBackgroundMock).not.toHaveBeenCalled();
      // Critical Failure Mode 1: the reply MUST be finalized so it survives
      // reload — previously this was (incorrectly) asserted NOT to be called.
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('bg-tab', false);
      // markTabIdle clears the workspace-agnostic spinner set (Bug 2 fix).
      expect(markTabIdleMock).toHaveBeenCalledWith('bg-tab');
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
      // Bug 2: transitioning to loaded ends the turn → clear the spinner.
      expect(markTabIdleMock).toHaveBeenCalledWith('bg-tab');
      // A subagent stop is NOT a turn terminal — it must never finalize the
      // parent turn's message (the turn-end pivot owns finalization).
      expect(finalizeCurrentMessageMock).not.toHaveBeenCalled();
    });

    it('omits the loaded status flip AND the spinner clear when background tasks remain', () => {
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
      // A subagent ending mid-turn must NOT clear the parent turn's spinner.
      expect(markTabIdleMock).not.toHaveBeenCalled();
    });

    it('omits the loaded status flip AND the spinner clear when the bg tab was not awaiting-background', () => {
      crossWsTab = makeTab({ status: 'loaded' });

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ backgroundTasks: [] }),
      );

      expect(updateBackgroundTabMock.mock.calls[0][1].status).toBeUndefined();
      expect(markTabIdleMock).not.toHaveBeenCalled();
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
    it('updates the bg tab with lastTerminalReason + loaded, finalizes as aborted, no foreground error surface', () => {
      crossWsTab = makeTab();

      service.handleTurnFailed(makeTurnFailedPayload());

      expect(updateBackgroundTabMock).toHaveBeenCalledTimes(1);
      const updates = updateBackgroundTabMock.mock.calls[0][1];
      expect(updates.lastTerminalReason).toBe('blocking_limit');
      expect(updates.status).toBe('loaded');

      // Wave 2 revision: a failed background turn still finalizes (as aborted)
      // so its partial reply survives reload — previously asserted NOT called.
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('bg-tab', true);
      // setLastTerminalReason targets the active signal; the background path
      // stamps the reason via updateBackgroundTab instead.
      expect(setLastTerminalReasonMock).not.toHaveBeenCalled();
      // Bug 2: a background failure ends the turn → clear the spinner set.
      expect(markTabIdleMock).toHaveBeenCalledWith('bg-tab');

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
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('bg-tab', true);
      expect(markTabIdleMock).toHaveBeenCalledWith('bg-tab');
      expect(handleChatErrorMock).toHaveBeenCalledTimes(1);
    });
  });
});

function makeCron(id: string) {
  return { id, schedule: '*/5 * * * *', recurring: true, prompt: 'ping' };
}
