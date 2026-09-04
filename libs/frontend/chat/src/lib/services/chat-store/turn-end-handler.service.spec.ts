/**
 * TurnEndHandlerService specs — SDK Stop / StopFailure / SubagentStop
 * SNAPSHOT consumer (TASK_2026_360).
 *
 * The hook pushes no longer drive `status`, the spinner, finalization or
 * liveness — the in-stream `turn_state` event does, through
 * `TurnStateApplier`. The `TabManagerService` mock below therefore exposes
 * ONLY the snapshot setters: any status write would throw a TypeError and fail
 * the spec, which is the invariant this file pins.
 *
 * Coverage:
 *   - handleTurnEnded stamps the Stop snapshot (tasks, crons, terminal reason)
 *   - handleTurnEnded keeps a frontend-stamped abort reason when Stop has none
 *   - handleTurnEnded multi-tab fan-out (siblings sharing sessionId both stamped)
 *   - handleTurnEnded no-tab-bound → warn + no side effects; surface → silent
 *   - handleTurnFailed stamps the terminal reason and routes the friendly error
 *   - handleTurnFailed no-tab-bound → warn + no side effects
 *   - handleSubagentEnded stops a KNOWN background agent only, stamps the
 *     remaining-tasks snapshot, never flips status
 *   - formatTurnFailedError mapping table coverage
 */

import { TestBed } from '@angular/core/testing';
import {
  BackgroundAgentId,
  ConversationRegistry,
  SurfaceId,
  TabManagerService,
  TabSessionBinding,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import {
  BackgroundAgentStore,
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
    handleChatErrorMock = jest.fn();
    onStoppedMock = jest.fn();
    findByAgentIdMock = jest.fn().mockReturnValue(null);

    // Snapshot setters ONLY. No `markTabIdle`, `markLoaded`, `markStreaming`,
    // `setStatus` — a status write from this service is a regression and
    // surfaces as a TypeError.
    const tabManagerMock = {
      findTabsBySessionId: findTabsBySessionIdMock,
      findTabBySessionIdAcrossWorkspaces: jest.fn(() => null),
      updateBackgroundTab: jest.fn(() => false),
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

  /**
   * Register `sessionId` the way a workflow surface does: a conversation in the
   * registry with a surface — and no tab — bound to it.
   */
  function bindSessionToSurface(sessionId: string): void {
    const registry = TestBed.inject(ConversationRegistry);
    const binding = TestBed.inject(TabSessionBinding);
    binding.bindSurface(
      SurfaceId.create(),
      registry.create(sessionId as ClaudeSessionId),
    );
  }

  afterEach(() => {
    warn.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('handleTurnEnded', () => {
    it('stamps the Stop snapshot (tasks, crons, terminal reason) and nothing else', () => {
      service.handleTurnEnded(
        makeTurnEndedPayload({
          backgroundTasks: [makeBackgroundTask('bg-1')],
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

      expect(setTurnEndedFieldsMock).toHaveBeenCalledTimes(1);
      expect(setTurnEndedFieldsMock).toHaveBeenCalledWith('tab-1', {
        pendingBackgroundTasks: expect.arrayContaining([
          expect.objectContaining({ id: 'bg-1' }),
        ]),
        pendingSessionCrons: expect.arrayContaining([
          expect.objectContaining({ id: 'cron-1' }),
        ]),
        lastTerminalReason: 'completed',
      });
    });

    it('stamps the snapshot the same way when backgroundTasks is empty (no status decision here)', () => {
      service.handleTurnEnded(makeTurnEndedPayload({ backgroundTasks: [] }));

      expect(setTurnEndedFieldsMock).toHaveBeenCalledWith(
        'tab-1',
        expect.objectContaining({
          pendingBackgroundTasks: [],
          lastTerminalReason: 'completed',
        }),
      );
    });

    it('stamps a non-completed terminalReason verbatim (aborted_streaming)', () => {
      service.handleTurnEnded(
        makeTurnEndedPayload({ terminalReason: 'aborted_streaming' }),
      );
      expect(setTurnEndedFieldsMock).toHaveBeenCalledWith(
        'tab-1',
        expect.objectContaining({ lastTerminalReason: 'aborted_streaming' }),
      );
    });

    it('stamps null when the Stop payload carries no reason and the tab has none', () => {
      service.handleTurnEnded(makeTurnEndedPayload({ terminalReason: null }));
      expect(setTurnEndedFieldsMock).toHaveBeenCalledWith(
        'tab-1',
        expect.objectContaining({ lastTerminalReason: null }),
      );
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
      expect(setTurnEndedFieldsMock).toHaveBeenCalledTimes(2);
    });

    it('warns and no-ops when no tab is bound to the sessionId', () => {
      tabs = [];
      service.handleTurnEnded(
        makeTurnEndedPayload({ sessionId: SESS_UNKNOWN }),
      );

      expect(setTurnEndedFieldsMock).not.toHaveBeenCalled();
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

    it('stays silent when the session belongs to a surface, not a tab', () => {
      tabs = [];
      bindSessionToSurface(SESS_UNKNOWN);

      service.handleTurnEnded(
        makeTurnEndedPayload({ sessionId: SESS_UNKNOWN }),
      );

      // The harness / New Project workflow runs on a surface and never owns a
      // TabState. Its turn state is applied by the surface path, so "no tab
      // bound" here is not a defect — it is the normal shape.
      expect(warn).not.toHaveBeenCalled();
      expect(setTurnEndedFieldsMock).not.toHaveBeenCalled();
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
    it('stamps the terminal reason and routes the friendly error', () => {
      service.handleTurnFailed(makeTurnFailedPayload());

      expect(setLastTerminalReasonMock).toHaveBeenCalledWith(
        'tab-1',
        'blocking_limit',
      );
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

    it('stamps every sibling tab sharing the session and routes the error once', () => {
      tabs = [
        makeTab({ id: 'tab-1', claudeSessionId: SESS_SHARED }),
        makeTab({ id: 'tab-2', claudeSessionId: SESS_SHARED }),
      ];
      service.handleTurnFailed(
        makeTurnFailedPayload({ sessionId: SESS_SHARED }),
      );

      expect(setLastTerminalReasonMock).toHaveBeenCalledWith(
        'tab-1',
        'blocking_limit',
      );
      expect(setLastTerminalReasonMock).toHaveBeenCalledWith(
        'tab-2',
        'blocking_limit',
      );
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
    const knownEntry: BackgroundAgentEntry = {
      toolCallId: 'toolu_abc',
      agentId: 'agent-a' as BackgroundAgentId,
      agentType: 'subagent',
      sessionId: SESS_PRIMARY as unknown as ClaudeSessionId,
      status: 'running',
      startedAt: 0,
      summary: '',
    };

    it('stops the KNOWN background agent and stamps the remaining-tasks snapshot', () => {
      tabs = [
        makeTab({
          id: 'tab-1',
          status: 'awaiting-background',
          pendingBackgroundTasks: [makeBackgroundTask('bg-a')],
        }),
      ];
      findByAgentIdMock.mockReturnValue(knownEntry);

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
    });

    it('stamps the remaining tasks when other background tasks are still running', () => {
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

      service.handleSubagentEnded(
        makeSubagentEndedPayload({
          backgroundTasks: [makeBackgroundTask('bg-b')],
        }),
      );

      expect(setPendingBackgroundTasksMock).toHaveBeenCalledWith('tab-1', [
        expect.objectContaining({ id: 'bg-b' }),
      ]);
    });

    // Defect 5: a FOREGROUND subagent is not a background agent — stopping a
    // store entry with `toolCallId: ''` for it was never right.
    it('does NOT touch BackgroundAgentStore for an agent it does not know (foreground subagent)', () => {
      tabs = [makeTab({ id: 'tab-1', status: 'streaming' })];
      findByAgentIdMock.mockReturnValue(null);

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ agentId: 'mystery', backgroundTasks: [] }),
      );

      expect(onStoppedMock).not.toHaveBeenCalled();
      expect(setPendingBackgroundTasksMock).toHaveBeenCalledWith('tab-1', []);
    });

    it('warns and still stops a known agent when no tab is bound to the sessionId', () => {
      tabs = [];
      findByAgentIdMock.mockReturnValue(knownEntry);

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ sessionId: SESS_UNKNOWN }),
      );

      expect(onStoppedMock).toHaveBeenCalledTimes(1);
      expect(setPendingBackgroundTasksMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        '[ChatStore] handleSubagentEnded: no tab bound to sessionId',
        expect.objectContaining({
          sessionId: SESS_UNKNOWN,
          agentId: 'agent-a',
        }),
      );
    });

    it('is a snapshot-only write on a loaded tab', () => {
      tabs = [makeTab({ id: 'tab-1', status: 'loaded' })];

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ backgroundTasks: [] }),
      );

      expect(setPendingBackgroundTasksMock).toHaveBeenCalledWith('tab-1', []);
    });

    it('is a snapshot-only write on a streaming tab (SubagentStop racing ahead of Stop)', () => {
      tabs = [makeTab({ id: 'tab-1', status: 'streaming' })];

      service.handleSubagentEnded(
        makeSubagentEndedPayload({ backgroundTasks: [] }),
      );

      expect(setPendingBackgroundTasksMock).toHaveBeenCalledWith('tab-1', []);
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
    });
  });
});
