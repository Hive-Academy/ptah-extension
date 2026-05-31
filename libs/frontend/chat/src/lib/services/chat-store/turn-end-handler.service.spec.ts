/**
 * TurnEndHandlerService specs — SDK Stop / StopFailure turn-end pivot.
 *
 * Coverage:
 *   - handleTurnEnded happy path (terminalReason: 'completed' → isAborted: false)
 *   - handleTurnEnded aborted path (terminalReason: 'aborted_streaming' → isAborted: true)
 *   - handleTurnEnded null terminalReason treated as non-aborted
 *   - handleTurnEnded multi-tab fan-out (siblings sharing sessionId both updated)
 *   - handleTurnEnded no-tab-bound → warn + no side effects
 *   - handleTurnFailed happy path → finalize(isAborted=true), error routed via
 *     ChatLifecycleService.handleChatError, terminal reason stamped
 *   - handleTurnFailed no-tab-bound → warn + no side effects
 *   - Back-to-back handleTurnEnded calls produce distinct mutator calls
 */

import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { MessageFinalizationService } from '@ptah-extension/chat-streaming';
import {
  SessionId,
  type SdkTurnEndedPayload,
  type SdkTurnFailedPayload,
} from '@ptah-extension/shared';
import type { TabState } from '@ptah-extension/chat-types';
import { ChatLifecycleService } from './chat-lifecycle.service';
import { TurnEndHandlerService } from './turn-end-handler.service';

const SESS_PRIMARY = SessionId.create();
const SESS_SHARED = SessionId.create();
const SESS_UNKNOWN = SessionId.create();

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 'tab-1',
    title: 'Tab 1',
    status: 'streaming',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: SESS_PRIMARY,
    ...overrides,
  } as unknown as TabState;
}

function makeTurnEndedPayload(
  overrides: Partial<SdkTurnEndedPayload> = {},
): SdkTurnEndedPayload {
  return {
    sessionId: SESS_PRIMARY,
    cwd: '/workspace',
    lastAssistantMessage: 'all done',
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
    sessionId: SESS_PRIMARY,
    cwd: '/workspace',
    lastAssistantMessage: null,
    error: 'rate_limit',
    errorDetails: 'too many requests',
    terminalReason: 'blocking_limit',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe('TurnEndHandlerService', () => {
  let service: TurnEndHandlerService;
  let tabs: TabState[];
  let findTabsBySessionIdMock: jest.Mock;
  let setTurnEndedFieldsMock: jest.Mock;
  let setLastTerminalReasonMock: jest.Mock;
  let markTabIdleMock: jest.Mock;
  let finalizeCurrentMessageMock: jest.Mock;
  let handleChatErrorMock: jest.Mock;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    tabs = [makeTab()];
    findTabsBySessionIdMock = jest.fn((sessionId: string) =>
      tabs.filter((t) => t.claudeSessionId === sessionId),
    );
    setTurnEndedFieldsMock = jest.fn();
    setLastTerminalReasonMock = jest.fn();
    markTabIdleMock = jest.fn();
    finalizeCurrentMessageMock = jest.fn();
    handleChatErrorMock = jest.fn();

    const tabManagerMock = {
      findTabsBySessionId: findTabsBySessionIdMock,
      setTurnEndedFields: setTurnEndedFieldsMock,
      setLastTerminalReason: setLastTerminalReasonMock,
      markTabIdle: markTabIdleMock,
    } as unknown as TabManagerService;

    const finalizationMock = {
      finalizeCurrentMessage: finalizeCurrentMessageMock,
    } as unknown as MessageFinalizationService;

    const lifecycleMock = {
      handleChatError: handleChatErrorMock,
    } as unknown as ChatLifecycleService;

    warn = jest.spyOn(console, 'warn').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        TurnEndHandlerService,
        { provide: TabManagerService, useValue: tabManagerMock },
        { provide: MessageFinalizationService, useValue: finalizationMock },
        { provide: ChatLifecycleService, useValue: lifecycleMock },
      ],
    });
    service = TestBed.inject(TurnEndHandlerService);
  });

  afterEach(() => {
    warn.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('handleTurnEnded', () => {
    it('stamps fields, finalizes (isAborted=false on completed), and marks idle', () => {
      service.handleTurnEnded(
        makeTurnEndedPayload({
          backgroundTasks: [
            {
              id: 'bg-1',
              type: 'subagent',
              status: 'running',
              description: 'still going',
            },
          ],
          sessionCrons: [
            {
              id: 'cron-1',
              schedule: '*/5 * * * *',
              recurring: true,
              prompt: 'ping',
            },
          ],
        }),
      );

      expect(setTurnEndedFieldsMock).toHaveBeenCalledWith('tab-1', {
        pendingBackgroundTasks: expect.arrayContaining([
          expect.objectContaining({ id: 'bg-1' }),
        ]),
        pendingSessionCrons: expect.arrayContaining([
          expect.objectContaining({ id: 'cron-1' }),
        ]),
        lastTerminalReason: 'completed',
      });
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('tab-1', false);
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-1');
    });

    it('flips isAborted=true for non-completed terminalReason (aborted_streaming)', () => {
      service.handleTurnEnded(
        makeTurnEndedPayload({ terminalReason: 'aborted_streaming' }),
      );
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('tab-1', true);
    });

    it('treats null terminalReason as non-aborted (no Stop reason exposed)', () => {
      service.handleTurnEnded(makeTurnEndedPayload({ terminalReason: null }));
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('tab-1', false);
    });

    it('fans out to every tab bound to the same sessionId', () => {
      tabs = [
        makeTab({ id: 'tab-1', claudeSessionId: SESS_SHARED }),
        makeTab({ id: 'tab-2', claudeSessionId: SESS_SHARED }),
      ];
      service.handleTurnEnded(makeTurnEndedPayload({ sessionId: SESS_SHARED }));

      const stampedTabIds = setTurnEndedFieldsMock.mock.calls.map((c) => c[0]);
      expect(stampedTabIds).toEqual(expect.arrayContaining(['tab-1', 'tab-2']));
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('tab-1', false);
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('tab-2', false);
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-1');
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-2');
    });

    it('warns and no-ops when no tab is bound to the sessionId', () => {
      tabs = [];
      service.handleTurnEnded(
        makeTurnEndedPayload({ sessionId: SESS_UNKNOWN }),
      );

      expect(setTurnEndedFieldsMock).not.toHaveBeenCalled();
      expect(finalizeCurrentMessageMock).not.toHaveBeenCalled();
      expect(markTabIdleMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleTurnEnded: no tab bound to sessionId',
        expect.objectContaining({
          sessionId: SESS_UNKNOWN,
          terminalReason: 'completed',
          backgroundTaskCount: 0,
          sessionCronCount: 0,
        }),
      );
    });

    it('produces distinct mutator calls for back-to-back invocations (no aliasing)', () => {
      service.handleTurnEnded(
        makeTurnEndedPayload({ terminalReason: 'completed' }),
      );
      service.handleTurnEnded(
        makeTurnEndedPayload({ terminalReason: 'aborted_streaming' }),
      );

      expect(setTurnEndedFieldsMock).toHaveBeenCalledTimes(2);
      expect(setTurnEndedFieldsMock.mock.calls[0][1].lastTerminalReason).toBe(
        'completed',
      );
      expect(setTurnEndedFieldsMock.mock.calls[1][1].lastTerminalReason).toBe(
        'aborted_streaming',
      );
    });
  });

  describe('handleTurnFailed', () => {
    it('stamps terminal reason, finalizes (isAborted=true), and routes error', () => {
      service.handleTurnFailed(makeTurnFailedPayload());

      expect(setLastTerminalReasonMock).toHaveBeenCalledWith(
        'tab-1',
        'blocking_limit',
      );
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('tab-1', true);
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-1');
      expect(handleChatErrorMock).toHaveBeenCalledWith({
        sessionId: SESS_PRIMARY,
        error: 'rate_limit: too many requests',
      });
    });

    it('routes error without details suffix when errorDetails is null', () => {
      service.handleTurnFailed(makeTurnFailedPayload({ errorDetails: null }));
      expect(handleChatErrorMock).toHaveBeenCalledWith({
        sessionId: SESS_PRIMARY,
        error: 'rate_limit',
      });
    });

    it('warns and no-ops when no tab is bound to the sessionId', () => {
      tabs = [];
      service.handleTurnFailed(
        makeTurnFailedPayload({ sessionId: SESS_UNKNOWN }),
      );

      expect(setLastTerminalReasonMock).not.toHaveBeenCalled();
      expect(finalizeCurrentMessageMock).not.toHaveBeenCalled();
      expect(handleChatErrorMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleTurnFailed: no tab bound to sessionId',
        expect.objectContaining({
          sessionId: SESS_UNKNOWN,
          terminalReason: 'blocking_limit',
          error: 'rate_limit',
        }),
      );
    });

    it('fans out aborted finalization across sibling tabs sharing the session', () => {
      tabs = [
        makeTab({ id: 'tab-1', claudeSessionId: SESS_SHARED }),
        makeTab({ id: 'tab-2', claudeSessionId: SESS_SHARED }),
      ];
      service.handleTurnFailed(
        makeTurnFailedPayload({ sessionId: SESS_SHARED }),
      );

      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('tab-1', true);
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('tab-2', true);
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-1');
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-2');
      expect(handleChatErrorMock).toHaveBeenCalledTimes(1);
    });
  });
});
