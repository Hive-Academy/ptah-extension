/**
 * TurnEndHandlerService specs — SDK Stop / StopFailure / SubagentStop pivot.
 *
 * Coverage:
 *   - handleTurnEnded happy path (terminalReason: 'completed' → isAborted: false)
 *   - handleTurnEnded aborted path (terminalReason: 'aborted_streaming' → isAborted: true)
 *   - handleTurnEnded null terminalReason treated as non-aborted
 *   - handleTurnEnded multi-tab fan-out (siblings sharing sessionId both updated)
 *   - handleTurnEnded no-tab-bound → warn + no side effects
 *   - handleTurnEnded with backgroundTasks → markTabAwaitingBackground called
 *   - handleTurnEnded with empty backgroundTasks → markTabAwaitingBackground NOT called
 *   - handleTurnFailed happy path → finalize(isAborted=true), error routed via
 *     ChatLifecycleService.handleChatError with user-readable message, terminal
 *     reason stamped
 *   - handleTurnFailed no-tab-bound → warn + no side effects
 *   - Back-to-back handleTurnEnded calls produce distinct mutator calls
 *   - handleSubagentEnded happy path (last subagent → status flips to loaded)
 *   - handleSubagentEnded non-last (remaining > 0 → status stays awaiting-background)
 *   - handleSubagentEnded unknown agentId → BackgroundAgentStore still updated
 *   - handleSubagentEnded no-tab-bound → warn + no side effects
 *   - handleSubagentEnded on 'loaded' tab (idempotent)
 *   - handleSubagentEnded on 'streaming' tab (race before Stop)
 *   - formatTurnFailedError mapping table coverage
 */

import { TestBed } from '@angular/core/testing';
import {
  BackgroundAgentId,
  TabManagerService,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import {
  BackgroundAgentStore,
  MessageFinalizationService,
  type BackgroundAgentEntry,
} from '@ptah-extension/chat-streaming';
import {
  SessionId,
  type SdkAssistantMessageError,
  type SdkSubagentEndedPayload,
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

function makeSubagentEndedPayload(
  overrides: Partial<SdkSubagentEndedPayload> = {},
): SdkSubagentEndedPayload {
  return {
    sessionId: SESS_PRIMARY,
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

describe('TurnEndHandlerService', () => {
  let service: TurnEndHandlerService;
  let tabs: TabState[];
  let findTabsBySessionIdMock: jest.Mock;
  let setTurnEndedFieldsMock: jest.Mock;
  let setLastTerminalReasonMock: jest.Mock;
  let setPendingBackgroundTasksMock: jest.Mock;
  let markTabIdleMock: jest.Mock;
  let markTabAwaitingBackgroundMock: jest.Mock;
  let markLoadedMock: jest.Mock;
  let finalizeCurrentMessageMock: jest.Mock;
  let handleChatErrorMock: jest.Mock;
  let onStoppedMock: jest.Mock;
  let findByAgentIdMock: jest.Mock<
    BackgroundAgentEntry | null,
    [BackgroundAgentId]
  >;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    tabs = [makeTab()];
    findTabsBySessionIdMock = jest.fn((sessionId: string) =>
      tabs.filter((t) => t.claudeSessionId === sessionId),
    );
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
      findTabBySessionIdAcrossWorkspaces: jest.fn(() => null),
      updateBackgroundTab: jest.fn(() => false),
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
      expect(markTabAwaitingBackgroundMock).toHaveBeenCalledWith('tab-1');
    });

    it('does NOT mark awaiting-background when backgroundTasks is empty', () => {
      service.handleTurnEnded(makeTurnEndedPayload({ backgroundTasks: [] }));

      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('tab-1', false);
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-1');
      expect(markTabAwaitingBackgroundMock).not.toHaveBeenCalled();
    });

    it('marks awaiting-background when backgroundTasks.length > 0 (status flips)', () => {
      service.handleTurnEnded(
        makeTurnEndedPayload({
          backgroundTasks: [makeBackgroundTask('bg-x')],
        }),
      );

      expect(markTabAwaitingBackgroundMock).toHaveBeenCalledWith('tab-1');
      expect(markTabAwaitingBackgroundMock).toHaveBeenCalledTimes(1);
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

    it('does NOT clobber a frontend-stamped abort reason when the Stop payload reason is null', () => {
      tabs = [
        makeTab({ id: 'tab-1', lastTerminalReason: 'aborted_streaming' }),
      ];
      service.handleTurnEnded(makeTurnEndedPayload({ terminalReason: null }));
      expect(setTurnEndedFieldsMock).toHaveBeenCalledWith(
        'tab-1',
        expect.objectContaining({ lastTerminalReason: 'aborted_streaming' }),
      );
    });

    it('lets a concrete Stop payload reason override a prior stamped reason', () => {
      tabs = [
        makeTab({ id: 'tab-1', lastTerminalReason: 'aborted_streaming' }),
      ];
      service.handleTurnEnded(
        makeTurnEndedPayload({ terminalReason: 'completed' }),
      );
      expect(setTurnEndedFieldsMock).toHaveBeenCalledWith(
        'tab-1',
        expect.objectContaining({ lastTerminalReason: 'completed' }),
      );
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
    it('stamps terminal reason, finalizes (isAborted=true), and routes friendly error', () => {
      service.handleTurnFailed(makeTurnFailedPayload());

      expect(setLastTerminalReasonMock).toHaveBeenCalledWith(
        'tab-1',
        'blocking_limit',
      );
      expect(finalizeCurrentMessageMock).toHaveBeenCalledWith('tab-1', true);
      expect(markTabIdleMock).toHaveBeenCalledWith('tab-1');
      expect(handleChatErrorMock).toHaveBeenCalledWith({
        sessionId: SESS_PRIMARY,
        error:
          'Rate limited by Anthropic. Wait a moment and try again. (too many requests)',
      });
    });

    it('routes friendly error without details suffix when errorDetails is null', () => {
      service.handleTurnFailed(makeTurnFailedPayload({ errorDetails: null }));
      expect(handleChatErrorMock).toHaveBeenCalledWith({
        sessionId: SESS_PRIMARY,
        error: 'Rate limited by Anthropic. Wait a moment and try again.',
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

    const errorMappings: ReadonlyArray<
      readonly [SdkAssistantMessageError, string]
    > = [
      [
        'authentication_failed',
        'Authentication failed. Check your API key in Settings.',
      ],
      ['rate_limit', 'Rate limited by Anthropic. Wait a moment and try again.'],
      [
        'oauth_org_not_allowed',
        "This organization is not allowed to access Anthropic's API.",
      ],
      ['billing_error', 'Billing error. Check your Anthropic account.'],
      ['invalid_request', 'Invalid request to Anthropic API.'],
      [
        'model_not_found',
        'Model not found. Check your model selection in Settings.',
      ],
      ['server_error', 'Anthropic server error. Try again shortly.'],
      ['max_output_tokens', 'Maximum output tokens reached.'],
      ['unknown', 'An unknown error occurred.'],
    ];

    for (const [code, expected] of errorMappings) {
      it(`maps SDK error code '${code}' to user-readable message`, () => {
        service.handleTurnFailed(
          makeTurnFailedPayload({ error: code, errorDetails: null }),
        );
        expect(handleChatErrorMock).toHaveBeenCalledWith({
          sessionId: SESS_PRIMARY,
          error: expected,
        });
      });
    }
  });

  describe('handleSubagentEnded', () => {
    it('reconciles BackgroundAgentStore + pendingBackgroundTasks and flips to loaded on last subagent', () => {
      tabs = [
        makeTab({
          id: 'tab-1',
          status: 'awaiting-background',
          pendingBackgroundTasks: [makeBackgroundTask('bg-a')],
        }),
      ];
      findByAgentIdMock.mockReturnValue({
        toolCallId: 'toolu_abc',
        agentId: 'agent-a' as BackgroundAgentId,
        agentType: 'subagent',
        sessionId: SESS_PRIMARY as unknown as ClaudeSessionId,
        status: 'running',
        startedAt: 0,
        summary: '',
      });

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ backgroundTasks: [] }),
      );

      expect(onStoppedMock).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'background_agent_stopped',
          agentId: 'agent-a',
          agentType: 'subagent',
          toolCallId: 'toolu_abc',
          sessionId: SESS_PRIMARY,
        }),
      );
      expect(setPendingBackgroundTasksMock).toHaveBeenCalledWith('tab-1', []);
      expect(markLoadedMock).toHaveBeenCalledWith('tab-1');
    });

    it('does NOT flip to loaded when subagent ends but other background tasks remain', () => {
      tabs = [
        makeTab({
          id: 'tab-1',
          status: 'awaiting-background',
          pendingBackgroundTasks: [
            makeBackgroundTask('bg-a'),
            makeBackgroundTask('bg-b'),
          ],
        }),
      ];
      findByAgentIdMock.mockReturnValue(null);

      service.handleSubagentEnded(
        makeSubagentEndedPayload({
          backgroundTasks: [makeBackgroundTask('bg-b')],
        }),
      );

      expect(setPendingBackgroundTasksMock).toHaveBeenCalledWith('tab-1', [
        expect.objectContaining({ id: 'bg-b' }),
      ]);
      expect(markLoadedMock).not.toHaveBeenCalled();
    });

    it('still reconciles when agentId is unknown to BackgroundAgentStore (no throw)', () => {
      tabs = [makeTab({ id: 'tab-1', status: 'awaiting-background' })];
      findByAgentIdMock.mockReturnValue(null);

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ agentId: 'mystery', backgroundTasks: [] }),
      );

      expect(onStoppedMock).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: 'mystery',
          toolCallId: '',
        }),
      );
      expect(setPendingBackgroundTasksMock).toHaveBeenCalledWith('tab-1', []);
      expect(markLoadedMock).toHaveBeenCalledWith('tab-1');
    });

    it('warns and still runs onStopped when no tab is bound to the sessionId', () => {
      tabs = [];

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ sessionId: SESS_UNKNOWN }),
      );

      expect(onStoppedMock).toHaveBeenCalledTimes(1);
      expect(setPendingBackgroundTasksMock).not.toHaveBeenCalled();
      expect(markLoadedMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleSubagentEnded: no tab bound to sessionId',
        expect.objectContaining({
          sessionId: SESS_UNKNOWN,
          agentId: 'agent-a',
        }),
      );
    });

    it('is idempotent on a tab that is already loaded (no status flip)', () => {
      tabs = [makeTab({ id: 'tab-1', status: 'loaded' })];

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ backgroundTasks: [] }),
      );

      expect(onStoppedMock).toHaveBeenCalledTimes(1);
      expect(setPendingBackgroundTasksMock).toHaveBeenCalledWith('tab-1', []);
      expect(markLoadedMock).not.toHaveBeenCalled();
    });

    it('leaves status as streaming when SubagentStop races ahead of Stop', () => {
      tabs = [makeTab({ id: 'tab-1', status: 'streaming' })];

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ backgroundTasks: [] }),
      );

      expect(onStoppedMock).toHaveBeenCalledTimes(1);
      expect(setPendingBackgroundTasksMock).toHaveBeenCalledWith('tab-1', []);
      expect(markLoadedMock).not.toHaveBeenCalled();
    });

    it('fans out across sibling tabs sharing the session', () => {
      tabs = [
        makeTab({
          id: 'tab-1',
          status: 'awaiting-background',
          claudeSessionId: SESS_SHARED,
        }),
        makeTab({
          id: 'tab-2',
          status: 'awaiting-background',
          claudeSessionId: SESS_SHARED,
        }),
      ];

      service.handleSubagentEnded(
        makeSubagentEndedPayload({
          sessionId: SESS_SHARED,
          backgroundTasks: [],
        }),
      );

      expect(setPendingBackgroundTasksMock).toHaveBeenCalledWith('tab-1', []);
      expect(setPendingBackgroundTasksMock).toHaveBeenCalledWith('tab-2', []);
      expect(markLoadedMock).toHaveBeenCalledWith('tab-1');
      expect(markLoadedMock).toHaveBeenCalledWith('tab-2');
    });
  });
});
