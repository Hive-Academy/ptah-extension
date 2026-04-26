/**
 * StreamRouter specs — TASK_2026_106 Phase 2 (SHADOW MODE).
 *
 * What is in scope:
 *   - onTabCreated mints conversation, optionally seeds with session, binds tab
 *   - routeStreamEvent resolves containing-session + tab → conversation
 *   - First event for an unknown session on a brand-new tab mints + binds
 *   - Idempotency: replaying the same event MUST NOT create duplicate sessions
 *   - onTabClosed unbinds; removes conversation only when no tab references it
 *   - compaction_start / compaction_complete update registry flags
 *   - Lookup helpers reflect current binding state
 *
 * What is intentionally OUT of scope:
 *   - Multi-tab fan-out (Phase 4)
 *   - Permission prompt routing (Phase 6)
 *   - StreamingHandler cleanup (Phase 3 owns it; shadow mode forbids it)
 *
 * Shadow-mode invariant (asserted across multiple tests):
 *   The router NEVER calls TabManager mutators. Verified by injecting a
 *   jest.Mocked<TabManagerService> and asserting that
 *   adoptStreamingSession / attachSession / setStreamingState are
 *   never called for the lifetime of the test.
 */

import { TestBed } from '@angular/core/testing';
import {
  ConversationRegistry,
  TabId,
  TabSessionBinding,
  type ClaudeSessionId,
} from '@ptah-extension/chat-state';
import { TabManagerService } from '@ptah-extension/chat-state';
import { StreamingHandlerService } from '@ptah-extension/chat-streaming';
import type {
  CompactionCompleteEvent,
  CompactionStartEvent,
  FlatStreamEventUnion,
  MessageStartEvent,
  TextDeltaEvent,
} from '@ptah-extension/shared';
import { StreamRouter } from './stream-router.service';

// ---------- Helpers --------------------------------------------------------

const SESSION_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' as ClaudeSessionId;
const SESSION_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' as ClaudeSessionId;
const SESSION_C = 'cccccccc-cccc-4ccc-cccc-cccccccccccc' as ClaudeSessionId;

function newTabId(): TabId {
  return TabId.create();
}

function msgStart(
  sessionId: ClaudeSessionId,
  overrides: Partial<MessageStartEvent> = {},
): MessageStartEvent {
  return {
    id: 'evt-msg-start-' + sessionId,
    eventType: 'message_start',
    timestamp: 1,
    sessionId,
    messageId: 'msg-' + sessionId,
    role: 'assistant',
    source: 'stream',
    ...overrides,
  } as MessageStartEvent;
}

function textDelta(
  sessionId: ClaudeSessionId,
  overrides: Partial<TextDeltaEvent> = {},
): TextDeltaEvent {
  return {
    id: 'evt-text-' + sessionId,
    eventType: 'text_delta',
    timestamp: 2,
    sessionId,
    messageId: 'msg-' + sessionId,
    blockIndex: 0,
    delta: 'hello',
    source: 'stream',
    ...overrides,
  } as TextDeltaEvent;
}

function compactionStart(sessionId: ClaudeSessionId): CompactionStartEvent {
  return {
    id: 'evt-compact-start-' + sessionId,
    eventType: 'compaction_start',
    timestamp: 10,
    sessionId,
    trigger: 'auto',
  } as CompactionStartEvent;
}

function compactionComplete(
  sessionId: ClaudeSessionId,
): CompactionCompleteEvent {
  return {
    id: 'evt-compact-complete-' + sessionId,
    eventType: 'compaction_complete',
    timestamp: 11,
    sessionId,
    trigger: 'auto',
  } as CompactionCompleteEvent;
}

// ---------- Suite ----------------------------------------------------------

describe('StreamRouter (shadow mode)', () => {
  let router: StreamRouter;
  let registry: ConversationRegistry;
  let binding: TabSessionBinding;
  let tabManager: jest.Mocked<
    Pick<
      TabManagerService,
      | 'adoptStreamingSession'
      | 'attachSession'
      | 'setStreamingState'
      | 'findTabBySessionId'
      | 'markTabIdle'
      | 'markTabStreaming'
    >
  >;
  let streamingHandler: jest.Mocked<
    Pick<StreamingHandlerService, 'cleanupSessionDeduplication'>
  >;

  beforeEach(() => {
    tabManager = {
      adoptStreamingSession: jest.fn(),
      attachSession: jest.fn(),
      setStreamingState: jest.fn(),
      findTabBySessionId: jest.fn(),
      markTabIdle: jest.fn(),
      markTabStreaming: jest.fn(),
    };
    streamingHandler = {
      cleanupSessionDeduplication: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: TabManagerService, useValue: tabManager },
        { provide: StreamingHandlerService, useValue: streamingHandler },
      ],
    });

    router = TestBed.inject(StreamRouter);
    registry = TestBed.inject(ConversationRegistry);
    binding = TestBed.inject(TabSessionBinding);
  });

  // ---- onTabCreated -------------------------------------------------------

  it('onTabCreated with no existing sessionId mints empty conversation and binds the tab', () => {
    const tab = newTabId();
    const conv = router.onTabCreated(tab);

    expect(binding.conversationFor(tab)).toBe(conv);
    const record = registry.getRecord(conv);
    expect(record).not.toBeNull();
    expect(record?.sessions).toEqual([]);
  });

  it('onTabCreated with an existing sessionId mints a one-session conversation and binds the tab', () => {
    const tab = newTabId();
    const conv = router.onTabCreated(tab, SESSION_A);

    expect(binding.conversationFor(tab)).toBe(conv);
    const record = registry.getRecord(conv);
    expect(record?.sessions).toEqual([SESSION_A]);
  });

  it('onTabCreated is idempotent — calling twice for the same tab returns the same conversation', () => {
    const tab = newTabId();
    const first = router.onTabCreated(tab);
    const second = router.onTabCreated(tab);

    expect(second).toBe(first);
    expect(registry.conversations()).toHaveLength(1);
  });

  it('onTabCreated upgrades an empty conversation to one-session when a sessionId is provided on re-call', () => {
    const tab = newTabId();
    const conv = router.onTabCreated(tab);
    expect(registry.getRecord(conv)?.sessions).toEqual([]);

    router.onTabCreated(tab, SESSION_A);
    expect(registry.getRecord(conv)?.sessions).toEqual([SESSION_A]);
  });

  // ---- routeStreamEvent ---------------------------------------------------

  it('routeStreamEvent for unknown sessionId on a fresh tab mints conversation, appends session, binds tab', () => {
    const tab = newTabId();
    const conv = router.routeStreamEvent(msgStart(SESSION_A), tab);

    expect(conv).not.toBeNull();
    expect(binding.conversationFor(tab)).toBe(conv);
    expect(registry.getRecord(conv as never)?.sessions).toEqual([SESSION_A]);
  });

  it('routeStreamEvent for known sessionId binds an unbound originTabId to the existing conversation', () => {
    const tabA = newTabId();
    const tabB = newTabId();

    // tabA opens the conversation
    const convA = router.routeStreamEvent(msgStart(SESSION_A), tabA);
    expect(convA).not.toBeNull();

    // tabB sees a follow-up event for the same session — should bind to convA
    const convB = router.routeStreamEvent(textDelta(SESSION_A), tabB);

    expect(convB).toBe(convA);
    expect(binding.conversationFor(tabB)).toBe(convA);
  });

  it('routeStreamEvent for known sessionId without originTabId returns conversation id and does not mutate bindings', () => {
    const tabA = newTabId();
    const conv = router.routeStreamEvent(msgStart(SESSION_A), tabA);
    const beforeCount = binding.boundTabCount();

    const resolved = router.routeStreamEvent(textDelta(SESSION_A));

    expect(resolved).toBe(conv);
    expect(binding.boundTabCount()).toBe(beforeCount);
  });

  it('routeStreamEvent twice for the same event is idempotent — no duplicate session entries', () => {
    const tab = newTabId();
    router.routeStreamEvent(msgStart(SESSION_A), tab);
    const conv = router.conversationForTab(tab);
    expect(conv).not.toBeNull();

    // Replay the same delta many times
    for (let i = 0; i < 5; i += 1) {
      router.routeStreamEvent(textDelta(SESSION_A), tab);
    }

    const sessions = registry.getRecord(conv as never)?.sessions ?? [];
    expect(sessions.filter((s) => s === SESSION_A)).toHaveLength(1);
  });

  it('routeStreamEvent for new sessionId on a tab already bound to a conversation appends the session', () => {
    const tab = newTabId();
    const convA = router.onTabCreated(tab, SESSION_A);

    // Same tab, different session id (e.g. SDK rolled session id post-compaction)
    router.routeStreamEvent(msgStart(SESSION_B), tab);

    const sessions = registry.getRecord(convA)?.sessions ?? [];
    expect(sessions).toEqual([SESSION_A, SESSION_B]);
  });

  it('routeStreamEvent without a sessionId-resolved conversation and without originTabId returns null', () => {
    const result = router.routeStreamEvent(msgStart(SESSION_C));
    expect(result).toBeNull();
    expect(registry.conversations()).toHaveLength(0);
  });

  // ---- onTabClosed --------------------------------------------------------

  it('onTabClosed unbinds the tab and removes the conversation when no other tabs reference it', () => {
    const tab = newTabId();
    const conv = router.onTabCreated(tab, SESSION_A);

    router.onTabClosed(tab);

    expect(binding.conversationFor(tab)).toBeNull();
    expect(registry.getRecord(conv)).toBeNull();
  });

  it('onTabClosed leaves the conversation alive when other tabs are still bound to it', () => {
    const tabA = newTabId();
    const tabB = newTabId();
    const conv = router.onTabCreated(tabA, SESSION_A);
    router.routeStreamEvent(textDelta(SESSION_A), tabB); // binds tabB to conv

    router.onTabClosed(tabA);

    expect(binding.conversationFor(tabA)).toBeNull();
    expect(binding.conversationFor(tabB)).toBe(conv);
    expect(registry.getRecord(conv)).not.toBeNull();
  });

  it('onTabClosed for an unbound tab is a no-op (idempotent on close races)', () => {
    const tab = newTabId();
    expect(() => router.onTabClosed(tab)).not.toThrow();
  });

  // ---- Compaction lifecycle ----------------------------------------------

  it('compaction_start event marks the conversation as compaction-in-flight', () => {
    const tab = newTabId();
    const conv = router.onTabCreated(tab, SESSION_A);

    router.routeStreamEvent(compactionStart(SESSION_A), tab);

    expect(registry.getRecord(conv)?.compactionInFlight).toBe(true);
  });

  it('compaction_complete event clears the in-flight flag and stamps lastCompactionAt', () => {
    const tab = newTabId();
    const conv = router.onTabCreated(tab, SESSION_A);

    router.routeStreamEvent(compactionStart(SESSION_A), tab);
    router.routeStreamEvent(compactionComplete(SESSION_A), tab);

    const record = registry.getRecord(conv);
    expect(record?.compactionInFlight).toBe(false);
    expect(record?.lastCompactionAt).not.toBeNull();
  });

  // ---- Shadow-mode invariant ---------------------------------------------

  it('routeStreamEvent never calls TabManager mutators (shadow mode)', () => {
    const tab = newTabId();

    const events: FlatStreamEventUnion[] = [
      msgStart(SESSION_A),
      textDelta(SESSION_A),
      compactionStart(SESSION_A),
      compactionComplete(SESSION_A),
    ];

    for (const event of events) {
      router.routeStreamEvent(event, tab);
    }

    expect(tabManager.adoptStreamingSession).not.toHaveBeenCalled();
    expect(tabManager.attachSession).not.toHaveBeenCalled();
    expect(tabManager.setStreamingState).not.toHaveBeenCalled();
    expect(tabManager.markTabIdle).not.toHaveBeenCalled();
    expect(tabManager.markTabStreaming).not.toHaveBeenCalled();
  });

  it('onTabClosed never calls StreamingHandler cleanup (Phase 3 owns it)', () => {
    const tab = newTabId();
    router.onTabCreated(tab, SESSION_A);
    router.onTabClosed(tab);

    expect(streamingHandler.cleanupSessionDeduplication).not.toHaveBeenCalled();
  });

  // ---- Lookup helpers -----------------------------------------------------

  it('conversationForTab and tabsForSession reflect the current binding/registry state', () => {
    const tabA = newTabId();
    const tabB = newTabId();
    const convA = router.onTabCreated(tabA, SESSION_A);
    router.routeStreamEvent(textDelta(SESSION_A), tabB);

    expect(router.conversationForTab(tabA)).toBe(convA);
    expect(router.conversationForTab(tabB)).toBe(convA);

    const tabsForA = router.tabsForSession(SESSION_A);
    expect(tabsForA).toHaveLength(2);
    expect(new Set(tabsForA)).toEqual(new Set([tabA, tabB]));

    expect(router.tabsForSession(SESSION_C)).toHaveLength(0);
  });

  it('notifyEvent is a synonym for routeStreamEvent', () => {
    const tab = newTabId();
    const conv = router.notifyEvent(msgStart(SESSION_A), tab);

    expect(conv).not.toBeNull();
    expect(binding.conversationFor(tab)).toBe(conv);
  });
});
