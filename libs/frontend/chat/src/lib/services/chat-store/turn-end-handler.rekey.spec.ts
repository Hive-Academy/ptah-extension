/**
 * TurnEndHandlerService x BackgroundAgentStore — the identity re-key.
 *
 * These specs run against the REAL `BackgroundAgentStore`, not a mock, because
 * the defect they pin lives in the seam between the two identity spaces and a
 * mocked store cannot show it.
 *
 * The chain: `background_agent_started` reads `agentId` from the subagent
 * registry, whose record only exists once the `SubagentStart` hook has fired —
 * which can be after the placeholder tool_result. Without it the store keys the
 * entry by `toolCallId`. `handleSubagentEnded` is the ONLY terminal signal a
 * background agent has (`background_agent_completed` has no producer anywhere
 * in the repository), and it looks the entry up by the real `agentId`, so a
 * `toolCallId`-keyed entry stayed `running` forever.
 *
 * Coverage:
 *   - started with NO agentId, then subagentEnded carrying the real agentId
 *     and the toolCallId -> the entry reaches a terminal state
 *   - after that transition `isBackgroundAgent(originalToolCallId)` is STILL
 *     true — the tree builder reads the other identity space
 *   - the re-keyed entry carries `hasRealAgentId: true`
 *   - a payload WITHOUT the optional `toolCallId` behaves exactly as before
 *   - an entry that already had a real agentId is untouched by the new path
 */

import { TestBed } from '@angular/core/testing';
import {
  TabManagerService,
  type BackgroundAgentId,
} from '@ptah-extension/chat-state';
import { BackgroundAgentStore } from '@ptah-extension/chat-streaming';
import {
  SessionId,
  type BackgroundAgentStartedEvent,
  type SdkSubagentEndedPayload,
} from '@ptah-extension/shared';
import type { TabState } from '@ptah-extension/chat-types';
import { ChatLifecycleService } from './chat-lifecycle.service';
import { TurnEndHandlerService } from './turn-end-handler.service';

const SESS = SessionId.create();
const TOOL_CALL_ID = 'toolu_placeholder_first';
const REAL_AGENT_ID = 'adcecb2';

function makeTab(): TabState {
  return {
    id: 'tab-1',
    title: 'Tab 1',
    status: 'awaiting-background',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: SESS,
  } as unknown as TabState;
}

/** A started event as the transformer builds it when the hook has NOT fired. */
function startedWithoutAgentId(
  overrides: Partial<BackgroundAgentStartedEvent> = {},
): BackgroundAgentStartedEvent {
  return {
    id: 'evt-1',
    eventType: 'background_agent_started',
    timestamp: 1_700_000_000_000,
    sessionId: SESS,
    messageId: 'msg-1',
    toolCallId: TOOL_CALL_ID,
    agentType: 'software-architect',
    ...overrides,
  } as unknown as BackgroundAgentStartedEvent;
}

function makeSubagentEndedPayload(
  overrides: Partial<SdkSubagentEndedPayload> = {},
): SdkSubagentEndedPayload {
  return {
    sessionId: SESS,
    cwd: '/workspace',
    agentId: REAL_AGENT_ID,
    agentType: 'software-architect',
    lastAssistantMessage: 'plan written',
    backgroundTasks: [],
    timestamp: 1_700_000_001_000,
    ...overrides,
  };
}

describe('TurnEndHandlerService — background agent identity re-key', () => {
  let service: TurnEndHandlerService;
  let store: BackgroundAgentStore;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    const tabs = [makeTab()];
    const tabManagerMock = {
      findTabsBySessionId: jest.fn((sessionId: string) =>
        tabs.filter((t) => t.claudeSessionId === sessionId),
      ),
      findTabBySessionIdAcrossWorkspaces: jest.fn(() => null),
      updateBackgroundTab: jest.fn(() => false),
      setTurnEndedFields: jest.fn(),
      setLastTerminalReason: jest.fn(),
      setPendingBackgroundTasks: jest.fn(),
    } as unknown as TabManagerService;

    warn = jest.spyOn(console, 'warn').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        TurnEndHandlerService,
        BackgroundAgentStore,
        { provide: TabManagerService, useValue: tabManagerMock },
        {
          provide: ChatLifecycleService,
          useValue: { handleChatError: jest.fn() },
        },
      ],
    });
    service = TestBed.inject(TurnEndHandlerService);
    store = TestBed.inject(BackgroundAgentStore);
  });

  afterEach(() => {
    store.ngOnDestroy();
    warn.mockRestore();
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  it('reaches a terminal state when the started event had no agentId', () => {
    store.onStarted(startedWithoutAgentId());
    expect(store.findByAgentId(TOOL_CALL_ID as BackgroundAgentId)?.status).toBe(
      'running',
    );

    service.handleSubagentEnded(
      makeSubagentEndedPayload({ toolCallId: TOOL_CALL_ID }),
    );

    const entry = store.findByAgentId(REAL_AGENT_ID as BackgroundAgentId);
    expect(entry).not.toBeNull();
    expect(entry?.status).toBe('stopped');
    expect(store.runningCount()).toBe(0);
  });

  it('keeps isBackgroundAgent(originalToolCallId) true after the re-key', () => {
    store.onStarted(startedWithoutAgentId());

    service.handleSubagentEnded(
      makeSubagentEndedPayload({ toolCallId: TOOL_CALL_ID }),
    );

    expect(store.isBackgroundAgent(TOOL_CALL_ID)).toBe(true);
    expect(store.findByToolCallId(TOOL_CALL_ID)?.toolCallId).toBe(TOOL_CALL_ID);
    expect(store.totalCount()).toBe(1);
  });

  it('marks the re-keyed entry with hasRealAgentId', () => {
    store.onStarted(startedWithoutAgentId());
    expect(
      store.findByAgentId(TOOL_CALL_ID as BackgroundAgentId)?.hasRealAgentId,
    ).toBe(false);

    service.handleSubagentEnded(
      makeSubagentEndedPayload({ toolCallId: TOOL_CALL_ID }),
    );

    const entry = store.findByAgentId(REAL_AGENT_ID as BackgroundAgentId);
    expect(entry?.hasRealAgentId).toBe(true);
    expect(entry?.agentId).toBe(REAL_AGENT_ID);
  });

  it('bumps revision once for the re-key and once for the stop', () => {
    store.onStarted(startedWithoutAgentId());
    const before = store.revision();

    service.handleSubagentEnded(
      makeSubagentEndedPayload({ toolCallId: TOOL_CALL_ID }),
    );

    expect(store.revision()).toBe(before + 2);
  });

  it('behaves exactly as before when the payload carries no toolCallId', () => {
    store.onStarted(startedWithoutAgentId());
    const before = store.revision();

    service.handleSubagentEnded(makeSubagentEndedPayload());

    // Nothing to bridge the two identity spaces with — the entry is left alone
    // and no synthetic stop is invented for an agent the store cannot address.
    expect(store.revision()).toBe(before);
    expect(store.findByAgentId(REAL_AGENT_ID as BackgroundAgentId)).toBeNull();
    expect(store.findByAgentId(TOOL_CALL_ID as BackgroundAgentId)?.status).toBe(
      'running',
    );
  });

  it('leaves an entry that already had a real agentId on the existing path', () => {
    store.onStarted(startedWithoutAgentId({ agentId: REAL_AGENT_ID }));
    const before = store.revision();

    service.handleSubagentEnded(
      makeSubagentEndedPayload({ toolCallId: TOOL_CALL_ID }),
    );

    const entry = store.findByAgentId(REAL_AGENT_ID as BackgroundAgentId);
    expect(entry?.status).toBe('stopped');
    expect(entry?.toolCallId).toBe(TOOL_CALL_ID);
    // One mutation only: findByAgentId hit, so no re-key was attempted.
    expect(store.revision()).toBe(before + 1);
  });

  it('does not adopt an entry belonging to a different Task tool call', () => {
    store.onStarted(startedWithoutAgentId());
    const before = store.revision();

    service.handleSubagentEnded(
      makeSubagentEndedPayload({ toolCallId: 'toolu_someone_else' }),
    );

    expect(store.revision()).toBe(before);
    expect(store.findByAgentId(TOOL_CALL_ID as BackgroundAgentId)?.status).toBe(
      'running',
    );
  });
});
