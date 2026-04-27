/**
 * StreamRouter specs — TASK_2026_106 Phase 3 (AUTHORITATIVE).
 *
 * What is in scope:
 *   - onTabCreated mints conversation, optionally seeds with session, binds tab
 *   - routeStreamEvent resolves containing-session + tab → conversation
 *   - First event for an unknown session on a brand-new tab mints + binds
 *   - Idempotency: replaying the same event MUST NOT create duplicate sessions
 *   - onTabClosed unbinds; removes conversation only when no tab references it
 *   - compaction_start / compaction_complete update registry flags
 *   - Lookup helpers reflect current binding state
 *   - **Phase 3**: bootstrap migrates persisted `tab.claudeSessionId` values
 *     from `TabManagerService` into the registry/binding
 *   - **Phase 3**: `closedTab` signal effect performs router-owned cleanup —
 *     `cleanupSessionDeduplication` always (when sessionId present), and
 *     `clearSessionAgents` only on `kind === 'close'`
 *
 * What is intentionally OUT of scope:
 *   - Multi-tab fan-out (Phase 4)
 *   - Permission prompt routing (Phase 6)
 *   - Tab content rendering (still flows through chat.store.processStreamEvent)
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  ConversationRegistry,
  TabId,
  TabManagerService,
  TabSessionBinding,
  type ClaudeSessionId,
  type ClosedTabEvent,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  PermissionHandlerService,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import type {
  CompactionCompleteEvent,
  CompactionStartEvent,
  MessageStartEvent,
  PermissionRequest,
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

/**
 * Phase 3 mock harness for `TabManagerService`. The router only reads
 * `tabs()` (constructor migration) and `closedTab()` (effect cleanup), so
 * the mock exposes both as signals plus a `_emitClosedTab` test helper.
 */
function makeTabManagerMock(
  initialTabs: { id: string; claudeSessionId: string | null }[] = [],
) {
  const tabsSignal =
    signal<{ id: string; claudeSessionId: string | null }[]>(initialTabs);
  const closedTabSignal = signal<ClosedTabEvent | null>(null);
  return {
    tabs: tabsSignal.asReadonly(),
    closedTab: closedTabSignal.asReadonly(),
    _setTabs: (next: { id: string; claudeSessionId: string | null }[]) =>
      tabsSignal.set(next),
    _emitClosedTab: (evt: ClosedTabEvent) => closedTabSignal.set(evt),
  };
}

/**
 * Phase 6a mock harness for `PermissionHandlerService`. The router only
 * touches `attachPromptTargets`, `targetTabsFor`, `cancelPrompt`, and
 * subscribes to `decisionPulse` via effect — so the mock exposes those
 * methods + a writable signal for decision broadcasts.
 */
function makePermissionHandlerMock() {
  const targets = new Map<string, readonly string[]>();
  const cancelled: { promptId: string; exceptTabId: string | null }[] = [];
  const pulseSignal = signal<{
    seq: number;
    promptId: string;
    decidingTabId: string | null;
  } | null>(null);
  return {
    attachPromptTargets: jest.fn(
      (promptId: string, tabIds: readonly string[]) => {
        if (tabIds.length === 0) return;
        targets.set(promptId, [...tabIds]);
      },
    ),
    targetTabsFor: jest.fn((promptId: string) => targets.get(promptId) ?? []),
    cancelPrompt: jest.fn((promptId: string, exceptTabId: string | null) => {
      cancelled.push({ promptId, exceptTabId });
      targets.delete(promptId);
    }),
    decisionPulse: pulseSignal.asReadonly(),
    _emitDecision: (promptId: string, decidingTabId: string | null, seq = 1) =>
      pulseSignal.set({ seq, promptId, decidingTabId }),
    _cancelled: cancelled,
    _targets: targets,
  };
}

function makePermissionRequest(
  overrides: Partial<PermissionRequest> = {},
): PermissionRequest {
  return {
    id: 'perm-1',
    toolName: 'Bash',
    toolInput: {},
    toolUseId: 'tool-1',
    timestamp: Date.now(),
    description: 'Run a command',
    timeoutAt: 0,
    sessionId: SESSION_A as unknown as string,
    ...overrides,
  } as PermissionRequest;
}

// ---------- Suite ----------------------------------------------------------

describe('StreamRouter (authoritative — Phase 3)', () => {
  let router: StreamRouter;
  let registry: ConversationRegistry;
  let binding: TabSessionBinding;
  let tabManager: ReturnType<typeof makeTabManagerMock>;
  let streamingHandler: jest.Mocked<
    Pick<StreamingHandlerService, 'cleanupSessionDeduplication'>
  >;
  let agentMonitorStore: jest.Mocked<
    Pick<AgentMonitorStore, 'clearSessionAgents'>
  >;
  let permissionHandler: ReturnType<typeof makePermissionHandlerMock>;

  beforeEach(() => {
    tabManager = makeTabManagerMock();
    streamingHandler = {
      cleanupSessionDeduplication: jest.fn(),
    };
    agentMonitorStore = {
      clearSessionAgents: jest.fn(),
    };
    permissionHandler = makePermissionHandlerMock();

    TestBed.configureTestingModule({
      providers: [
        { provide: TabManagerService, useValue: tabManager },
        { provide: StreamingHandlerService, useValue: streamingHandler },
        { provide: AgentMonitorStore, useValue: agentMonitorStore },
        { provide: PermissionHandlerService, useValue: permissionHandler },
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

    const convA = router.routeStreamEvent(msgStart(SESSION_A), tabA);
    expect(convA).not.toBeNull();

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

    for (let i = 0; i < 5; i += 1) {
      router.routeStreamEvent(textDelta(SESSION_A), tab);
    }

    const sessions = registry.getRecord(conv as never)?.sessions ?? [];
    expect(sessions.filter((s) => s === SESSION_A)).toHaveLength(1);
  });

  it('routeStreamEvent for new sessionId on a tab already bound to a conversation appends the session', () => {
    const tab = newTabId();
    const convA = router.onTabCreated(tab, SESSION_A);

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
    router.routeStreamEvent(textDelta(SESSION_A), tabB);

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

  // TASK_2026_106 Phase 4c — banner UI reads compaction state via the new
  // `compactionStateFor(convId)` API, which the StreamRouter must drive
  // through the same lifecycle events as the per-record flag.
  it('compactionStateFor reflects router-driven compaction lifecycle (TASK_2026_106 Phase 4c)', () => {
    const tab = newTabId();
    const conv = router.onTabCreated(tab, SESSION_A);

    expect(registry.compactionStateFor(conv)?.inFlight).toBe(false);

    router.routeStreamEvent(compactionStart(SESSION_A), tab);
    expect(registry.compactionStateFor(conv)?.inFlight).toBe(true);

    router.routeStreamEvent(compactionComplete(SESSION_A), tab);
    const after = registry.compactionStateFor(conv);
    expect(after?.inFlight).toBe(false);
    expect(typeof after?.lastCompactionAt).toBe('number');
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

  it('notifyEvent is a synonym for routeStreamEvent (back-compat alias)', () => {
    const tab = newTabId();
    const conv = router.notifyEvent(msgStart(SESSION_A), tab);

    expect(conv).not.toBeNull();
    expect(binding.conversationFor(tab)).toBe(conv);
  });

  // =============================================================================
  // PHASE 6a — Permission prompt fan-out
  // =============================================================================
  //
  // Two-tab canvas-grid scenario: both tabs are bound to the same SDK session
  // (the same conversation). When a permission_required prompt arrives, the
  // router resolves the bound tab set and tags the prompt; when one tab
  // decides, the router broadcasts a cancellation that targets the OTHER
  // tabs (deciding tab is excluded).

  describe('routePermissionPrompt + cancelPendingPromptOnOtherTabs (Phase 6a)', () => {
    it('routePermissionPrompt resolves both tabs when two are bound to the same conversation', () => {
      const tabA = newTabId();
      const tabB = newTabId();
      router.onTabCreated(tabA, SESSION_A);
      router.routeStreamEvent(textDelta(SESSION_A), tabB);

      const prompt = makePermissionRequest({ id: 'perm-fanout' });
      const targets = router.routePermissionPrompt(prompt);

      expect(new Set(targets)).toEqual(new Set([tabA, tabB]));
      // Router stashed the resolution on PermissionHandler for later
      // cancellation broadcast.
      expect(permissionHandler.attachPromptTargets).toHaveBeenCalledWith(
        'perm-fanout',
        expect.arrayContaining([tabA, tabB]),
      );
    });

    it('routePermissionPrompt returns empty array when prompt has no sessionId', () => {
      const prompt = makePermissionRequest({
        id: 'perm-no-session',
        sessionId: undefined,
      });
      expect(router.routePermissionPrompt(prompt)).toEqual([]);
      expect(permissionHandler.attachPromptTargets).not.toHaveBeenCalled();
    });

    it('routePermissionPrompt returns empty array when sessionId is unknown to the registry', () => {
      const prompt = makePermissionRequest({
        id: 'perm-unknown',
        sessionId: SESSION_C as unknown as string,
      });
      expect(router.routePermissionPrompt(prompt)).toEqual([]);
      expect(permissionHandler.attachPromptTargets).not.toHaveBeenCalled();
    });

    it('cancelPendingPromptOnOtherTabs excludes the deciding tab and cancels on the others', () => {
      const tabA = newTabId();
      const tabB = newTabId();
      router.onTabCreated(tabA, SESSION_A);
      router.routeStreamEvent(textDelta(SESSION_A), tabB);

      const prompt = makePermissionRequest({ id: 'perm-decide' });
      router.routePermissionPrompt(prompt);

      // tabA decides — broadcast cancellation should exclude tabA.
      const cancelOn = router.cancelPendingPromptOnOtherTabs(
        'perm-decide',
        tabA,
      );

      expect(cancelOn).toEqual([tabB]);
      expect(permissionHandler.cancelPrompt).toHaveBeenCalledWith(
        'perm-decide',
        tabA as unknown as string,
      );
    });

    it('decisionPulse signal triggers router fan-out via effect (decision-from-tab-A cancels prompt on tab-B)', () => {
      const tabA = newTabId();
      const tabB = newTabId();
      router.onTabCreated(tabA, SESSION_A);
      router.routeStreamEvent(textDelta(SESSION_A), tabB);

      router.routePermissionPrompt(makePermissionRequest({ id: 'perm-pulse' }));

      // Simulate PermissionHandler.handlePermissionResponse firing the
      // pulse with tabA as the deciding tab.
      permissionHandler._emitDecision('perm-pulse', tabA as unknown as string);
      TestBed.tick();

      // Router's effect should have called cancelPrompt for the other
      // tab (the prompt is dropped from PermissionHandler's queue).
      expect(permissionHandler.cancelPrompt).toHaveBeenCalledWith(
        'perm-pulse',
        tabA as unknown as string,
      );
    });

    it('cancelPendingPromptOnOtherTabs is a no-op when prompt has no resolved targets', () => {
      const result = router.cancelPendingPromptOnOtherTabs('perm-orphan', null);
      expect(result).toEqual([]);
      expect(permissionHandler.cancelPrompt).not.toHaveBeenCalled();
    });

    it('decisionPulse with null decidingTabId still cancels the prompt across all bound tabs', () => {
      const tabA = newTabId();
      const tabB = newTabId();
      router.onTabCreated(tabA, SESSION_A);
      router.routeStreamEvent(textDelta(SESSION_A), tabB);

      router.routePermissionPrompt(
        makePermissionRequest({ id: 'perm-headless' }),
      );

      permissionHandler._emitDecision('perm-headless', null);
      TestBed.tick();

      expect(permissionHandler.cancelPrompt).toHaveBeenCalledWith(
        'perm-headless',
        null,
      );
    });
  });
});

// =============================================================================
// PHASE 3 — closedTab effect cleanup
// =============================================================================

describe('StreamRouter (authoritative — closedTab effect)', () => {
  let registry: ConversationRegistry;
  let binding: TabSessionBinding;
  let tabManager: ReturnType<typeof makeTabManagerMock>;
  let streamingHandler: jest.Mocked<
    Pick<StreamingHandlerService, 'cleanupSessionDeduplication'>
  >;
  let agentMonitorStore: jest.Mocked<
    Pick<AgentMonitorStore, 'clearSessionAgents'>
  >;

  function bootRouter(
    initialTabs: { id: string; claudeSessionId: string | null }[] = [],
  ) {
    tabManager = makeTabManagerMock(initialTabs);
    streamingHandler = { cleanupSessionDeduplication: jest.fn() };
    agentMonitorStore = { clearSessionAgents: jest.fn() };
    const permissionHandler = makePermissionHandlerMock();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: TabManagerService, useValue: tabManager },
        { provide: StreamingHandlerService, useValue: streamingHandler },
        { provide: AgentMonitorStore, useValue: agentMonitorStore },
        { provide: PermissionHandlerService, useValue: permissionHandler },
      ],
    });

    const router = TestBed.inject(StreamRouter);
    registry = TestBed.inject(ConversationRegistry);
    binding = TestBed.inject(TabSessionBinding);
    // Drain effects scheduled by the constructor.
    TestBed.tick();
    return router;
  }

  it('close event with sessionId triggers cleanupSessionDeduplication AND clearSessionAgents', () => {
    const router = bootRouter();
    const tab = newTabId();
    router.onTabCreated(tab, SESSION_A);

    tabManager._emitClosedTab({
      tabId: tab,
      sessionId: SESSION_A,
      kind: 'close',
    });
    TestBed.tick();

    expect(streamingHandler.cleanupSessionDeduplication).toHaveBeenCalledWith(
      SESSION_A,
    );
    expect(agentMonitorStore.clearSessionAgents).toHaveBeenCalledWith(
      SESSION_A,
    );
    expect(binding.conversationFor(tab)).toBeNull();
  });

  it('forceClose event with sessionId triggers cleanupSessionDeduplication ONLY (agents survive pop-out)', () => {
    const router = bootRouter();
    const tab = newTabId();
    router.onTabCreated(tab, SESSION_A);

    tabManager._emitClosedTab({
      tabId: tab,
      sessionId: SESSION_A,
      kind: 'forceClose',
    });
    TestBed.tick();

    expect(streamingHandler.cleanupSessionDeduplication).toHaveBeenCalledWith(
      SESSION_A,
    );
    expect(agentMonitorStore.clearSessionAgents).not.toHaveBeenCalled();
    expect(binding.conversationFor(tab)).toBeNull();
  });

  it('close event with null sessionId still unbinds but does not call streaming cleanup', () => {
    const router = bootRouter();
    const tab = newTabId();
    router.onTabCreated(tab);

    tabManager._emitClosedTab({
      tabId: tab,
      sessionId: null,
      kind: 'close',
    });
    TestBed.tick();

    expect(streamingHandler.cleanupSessionDeduplication).not.toHaveBeenCalled();
    expect(agentMonitorStore.clearSessionAgents).not.toHaveBeenCalled();
    expect(binding.conversationFor(tab)).toBeNull();
  });

  it('close event keeps conversation alive when other tabs still reference it', () => {
    const router = bootRouter();
    const tabA = newTabId();
    const tabB = newTabId();
    const conv = router.onTabCreated(tabA, SESSION_A);
    router.routeStreamEvent(textDelta(SESSION_A), tabB);

    tabManager._emitClosedTab({
      tabId: tabA,
      sessionId: SESSION_A,
      kind: 'close',
    });
    TestBed.tick();

    expect(binding.conversationFor(tabA)).toBeNull();
    expect(binding.conversationFor(tabB)).toBe(conv);
    expect(registry.getRecord(conv)).not.toBeNull();
  });

  it('close effect tolerates errors thrown by streaming cleanup (best-effort)', () => {
    const router = bootRouter();
    const tab = newTabId();
    router.onTabCreated(tab, SESSION_A);

    streamingHandler.cleanupSessionDeduplication.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

    expect(() => {
      tabManager._emitClosedTab({
        tabId: tab,
        sessionId: SESSION_A,
        kind: 'close',
      });
      TestBed.tick();
    }).not.toThrow();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// =============================================================================
// PHASE 3 — bootstrap migration of persisted tabs
// =============================================================================

describe('StreamRouter (authoritative — bootstrap migration)', () => {
  let registry: ConversationRegistry;
  let binding: TabSessionBinding;

  function bootWithTabs(
    persisted: { id: string; claudeSessionId: string | null }[],
  ) {
    const tabManager = makeTabManagerMock(persisted);
    const streamingHandler = { cleanupSessionDeduplication: jest.fn() };
    const agentMonitorStore = { clearSessionAgents: jest.fn() };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: TabManagerService, useValue: tabManager },
        { provide: StreamingHandlerService, useValue: streamingHandler },
        { provide: AgentMonitorStore, useValue: agentMonitorStore },
      ],
    });

    const router = TestBed.inject(StreamRouter);
    registry = TestBed.inject(ConversationRegistry);
    binding = TestBed.inject(TabSessionBinding);
    return router;
  }

  it('migrates persisted tabs with a claudeSessionId into the registry/binding', () => {
    const tabIdA = TabId.create();
    const tabIdB = TabId.create();
    const router = bootWithTabs([
      { id: tabIdA, claudeSessionId: SESSION_A },
      { id: tabIdB, claudeSessionId: SESSION_B },
    ]);

    const convA = router.conversationForTab(tabIdA);
    const convB = router.conversationForTab(tabIdB);
    expect(convA).not.toBeNull();
    expect(convB).not.toBeNull();
    expect(convA).not.toBe(convB);
    expect(registry.getRecord(convA as never)?.sessions).toEqual([SESSION_A]);
    expect(registry.getRecord(convB as never)?.sessions).toEqual([SESSION_B]);
  });

  it('migrates persisted tabs without a claudeSessionId as empty conversations', () => {
    const tabId = TabId.create();
    const router = bootWithTabs([{ id: tabId, claudeSessionId: null }]);

    const conv = router.conversationForTab(tabId);
    expect(conv).not.toBeNull();
    expect(registry.getRecord(conv as never)?.sessions).toEqual([]);
  });

  it('skips tabs with malformed ids (TabId.safeParse returns null)', () => {
    const router = bootWithTabs([
      { id: 'not-a-uuid', claudeSessionId: SESSION_A },
    ]);

    expect(binding.boundTabCount()).toBe(0);
    expect(registry.conversations()).toHaveLength(0);
    // Sanity: router still functions for new tabs after a bad migration entry.
    const fresh = TabId.create();
    const conv = router.onTabCreated(fresh, SESSION_B);
    expect(conv).not.toBeNull();
  });

  it('is a no-op for empty tab list', () => {
    bootWithTabs([]);
    expect(binding.boundTabCount()).toBe(0);
    expect(registry.conversations()).toHaveLength(0);
  });
});
