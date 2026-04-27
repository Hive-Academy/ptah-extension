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
  SurfaceId,
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
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import type {
  CompactionCompleteEvent,
  CompactionStartEvent,
  MessageStartEvent,
  PermissionRequest,
  TextDeltaEvent,
} from '@ptah-extension/shared';
import { StreamRouter } from './stream-router.service';
import { StreamingSurfaceRegistry } from './streaming-surface-registry.service';

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
  const responses: { id: string; decision: string; reason?: string }[] = [];
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
    // TASK_2026_107 Phase 5 — defensive guard auto-deny path. Mirrors the
    // real PermissionHandlerService.handlePermissionResponse contract: the
    // router calls this when a prompt resolves to a surface-only conversation.
    handlePermissionResponse: jest.fn(
      (response: { id: string; decision: string; reason?: string }) => {
        responses.push({ ...response });
        targets.delete(response.id);
      },
    ),
    decisionPulse: pulseSignal.asReadonly(),
    _emitDecision: (promptId: string, decidingTabId: string | null, seq = 1) =>
      pulseSignal.set({ seq, promptId, decidingTabId }),
    _cancelled: cancelled,
    _responses: responses,
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

// =============================================================================
// PHASE 2 — Surface routing (TASK_2026_107)
// =============================================================================
//
// Sibling APIs to onTabCreated/onTabClosed/routeStreamEvent/tabsForSession,
// keyed by SurfaceId. Coverage:
//   - onSurfaceCreated mints/seeds/binds a conversation; idempotent on repeat
//   - onSurfaceCreated reuses an existing conversation when the session is
//     already known to the registry (chat tab opened the same session first)
//   - onSurfaceClosed unbinds + cleans up only when no other consumer remains
//   - "Last consumer" check respects BOTH tabs AND surfaces
//   - routeStreamEventForSurface drops events for unregistered surfaces
//   - routeStreamEventForSurface mutates the surface adapter's state slot
//   - routeStreamEventForSurface installs a fresh state on compaction_complete
//   - surfacesForSession sibling lookup
//   - routePermissionPrompt SIGNATURE UNCHANGED — this regression check
//     guards against accidental wizard/harness leakage into permission
//     routing during Phase 2.

describe('StreamRouter (TASK_2026_107 Phase 2 — surface routing)', () => {
  let router: StreamRouter;
  let registry: ConversationRegistry;
  let binding: TabSessionBinding;
  let surfaceRegistry: StreamingSurfaceRegistry;
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
    streamingHandler = { cleanupSessionDeduplication: jest.fn() };
    agentMonitorStore = { clearSessionAgents: jest.fn() };
    permissionHandler = makePermissionHandlerMock();

    TestBed.resetTestingModule();
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
    surfaceRegistry = TestBed.inject(StreamingSurfaceRegistry);
    TestBed.tick();
  });

  /** Build a minimal SurfaceAdapter probe and register it. */
  function makeSurfaceProbe(): {
    surfaceId: SurfaceId;
    state: StreamingState;
    setState: jest.Mock;
    getState: jest.Mock;
  } {
    const probe = {
      surfaceId: SurfaceId.create(),
      state: createEmptyStreamingState(),
      getState: jest.fn<StreamingState, []>(),
      setState: jest.fn<void, [StreamingState]>(),
    };
    probe.getState.mockImplementation(() => probe.state);
    probe.setState.mockImplementation((next) => {
      probe.state = next;
    });
    surfaceRegistry.register(probe.surfaceId, probe.getState, probe.setState);
    return probe;
  }

  // ---- onSurfaceCreated ---------------------------------------------------

  describe('onSurfaceCreated()', () => {
    it('with no existing sessionId mints empty conversation and binds the surface', () => {
      const surfaceId = SurfaceId.create();
      const conv = router.onSurfaceCreated(surfaceId);

      expect(binding.conversationForSurface(surfaceId)).toBe(conv);
      const record = registry.getRecord(conv);
      expect(record).not.toBeNull();
      expect(record?.sessions).toEqual([]);
    });

    it('with an existing sessionId mints a one-session conversation and binds the surface', () => {
      const surfaceId = SurfaceId.create();
      const conv = router.onSurfaceCreated(surfaceId, SESSION_A);

      expect(binding.conversationForSurface(surfaceId)).toBe(conv);
      expect(registry.getRecord(conv)?.sessions).toEqual([SESSION_A]);
    });

    it('is idempotent — calling twice for the same surface returns the same conversation', () => {
      const surfaceId = SurfaceId.create();
      const first = router.onSurfaceCreated(surfaceId);
      const second = router.onSurfaceCreated(surfaceId);

      expect(second).toBe(first);
      expect(registry.conversations()).toHaveLength(1);
    });

    it('upgrades an empty conversation to one-session when a sessionId is provided on re-call', () => {
      const surfaceId = SurfaceId.create();
      const conv = router.onSurfaceCreated(surfaceId);
      expect(registry.getRecord(conv)?.sessions).toEqual([]);

      router.onSurfaceCreated(surfaceId, SESSION_A);
      expect(registry.getRecord(conv)?.sessions).toEqual([SESSION_A]);
    });

    it('reuses an existing conversation when the session is already known (chat tab opened it first)', () => {
      // Tab opens SESSION_A first.
      const tab = newTabId();
      const tabConv = router.onTabCreated(tab, SESSION_A);

      // Surface registers later for the same session — must bind to the
      // SAME conversation (no duplicate conversation minted).
      const surfaceId = SurfaceId.create();
      const surfaceConv = router.onSurfaceCreated(surfaceId, SESSION_A);

      expect(surfaceConv).toBe(tabConv);
      expect(binding.conversationForSurface(surfaceId)).toBe(tabConv);
      expect(binding.conversationFor(tab)).toBe(tabConv);
      expect(registry.conversations()).toHaveLength(1);
    });
  });

  // ---- onSurfaceClosed ----------------------------------------------------

  describe('onSurfaceClosed()', () => {
    it('unbinds the surface and removes the conversation when no other consumer remains', () => {
      const probe = makeSurfaceProbe();
      const conv = router.onSurfaceCreated(probe.surfaceId, SESSION_A);

      router.onSurfaceClosed(probe.surfaceId);

      expect(binding.conversationForSurface(probe.surfaceId)).toBeNull();
      expect(registry.getRecord(conv)).toBeNull();
      // Cleanup ran for the conversation's sessions.
      expect(streamingHandler.cleanupSessionDeduplication).toHaveBeenCalledWith(
        SESSION_A,
      );
      expect(agentMonitorStore.clearSessionAgents).toHaveBeenCalledWith(
        SESSION_A,
      );
      // Surface adapter unregistered too.
      expect(surfaceRegistry.getAdapter(probe.surfaceId)).toBeNull();
    });

    it('runs cleanup for every session the conversation ever spanned (compaction-spanning conversations)', () => {
      const probe = makeSurfaceProbe();
      const conv = router.onSurfaceCreated(probe.surfaceId, SESSION_A);
      // Simulate the surface picking up a second session mid-conversation
      // (e.g., compaction boundary).
      registry.appendSession(conv, SESSION_B);

      router.onSurfaceClosed(probe.surfaceId);

      expect(streamingHandler.cleanupSessionDeduplication).toHaveBeenCalledWith(
        SESSION_A,
      );
      expect(streamingHandler.cleanupSessionDeduplication).toHaveBeenCalledWith(
        SESSION_B,
      );
      expect(agentMonitorStore.clearSessionAgents).toHaveBeenCalledWith(
        SESSION_A,
      );
      expect(agentMonitorStore.clearSessionAgents).toHaveBeenCalledWith(
        SESSION_B,
      );
    });

    it('keeps the conversation alive when a tab is still bound to the same conversation', () => {
      // 1 tab + 1 surface bound to the SAME conversation (rare but legal).
      const tab = newTabId();
      const conv = router.onTabCreated(tab, SESSION_A);
      const probe = makeSurfaceProbe();
      const surfConv = router.onSurfaceCreated(probe.surfaceId, SESSION_A);
      expect(surfConv).toBe(conv);

      router.onSurfaceClosed(probe.surfaceId);

      // Conversation MUST still exist — the tab is still bound.
      expect(registry.getRecord(conv)).not.toBeNull();
      expect(binding.conversationFor(tab)).toBe(conv);
      expect(binding.conversationForSurface(probe.surfaceId)).toBeNull();
      // No teardown calls — the conversation isn't dead.
      expect(
        streamingHandler.cleanupSessionDeduplication,
      ).not.toHaveBeenCalled();
      expect(agentMonitorStore.clearSessionAgents).not.toHaveBeenCalled();
    });

    it('keeps the conversation alive when another surface is still bound to it', () => {
      const probe1 = makeSurfaceProbe();
      const probe2 = makeSurfaceProbe();
      const conv = router.onSurfaceCreated(probe1.surfaceId, SESSION_A);
      const conv2 = router.onSurfaceCreated(probe2.surfaceId, SESSION_A);
      expect(conv2).toBe(conv);

      router.onSurfaceClosed(probe1.surfaceId);

      expect(registry.getRecord(conv)).not.toBeNull();
      expect(binding.conversationForSurface(probe2.surfaceId)).toBe(conv);
      expect(
        streamingHandler.cleanupSessionDeduplication,
      ).not.toHaveBeenCalled();
      expect(agentMonitorStore.clearSessionAgents).not.toHaveBeenCalled();
    });

    it('mixed tabs + surfaces — closing the surface first keeps the conversation alive (tab is the surviving consumer)', () => {
      const tab = newTabId();
      const conv = router.onTabCreated(tab, SESSION_A);
      const probe = makeSurfaceProbe();
      router.onSurfaceCreated(probe.surfaceId, SESSION_A);

      // Close the surface FIRST. onSurfaceClosed correctly checks both
      // tabsFor() and surfacesFor() before tearing down the conversation,
      // so the tab keeps the conversation alive.
      router.onSurfaceClosed(probe.surfaceId);

      expect(registry.getRecord(conv)).not.toBeNull();
      expect(binding.conversationFor(tab)).toBe(conv);
      expect(binding.conversationForSurface(probe.surfaceId)).toBeNull();
      // No teardown ran — the conversation is not dead.
      expect(
        streamingHandler.cleanupSessionDeduplication,
      ).not.toHaveBeenCalled();
      expect(agentMonitorStore.clearSessionAgents).not.toHaveBeenCalled();

      // Now close the tab — last consumer, conversation must drop.
      tabManager._emitClosedTab({
        tabId: tab,
        sessionId: SESSION_A,
        kind: 'close',
      });
      TestBed.tick();

      expect(registry.getRecord(conv)).toBeNull();
      expect(streamingHandler.cleanupSessionDeduplication).toHaveBeenCalledWith(
        SESSION_A,
      );
      expect(agentMonitorStore.clearSessionAgents).toHaveBeenCalledWith(
        SESSION_A,
      );
    });

    /**
     * Asymmetry note (TASK_2026_107 Phase 2 unexpected discovery):
     * `StreamRouter.onTabClosed` (and its driver `handleTabClosed`) only
     * checks `binding.hasBoundTabs(convId)` — it is NOT surface-aware.
     * `StreamRouter.onSurfaceClosed`, by contrast, IS tab-aware. This is
     * intentional for Phase 2: the chat-view path must remain unchanged
     * (R1 regression risk). Production-wise, tabs and surfaces never
     * co-exist on the same conversation, so the asymmetry is benign —
     * but Phase 3+ should consider tightening `onTabClosed` to mirror
     * `onSurfaceClosed` once wizard/harness ship.
     */
    it('asymmetry — closing the tab when a surface still binds the same conversation drops the conversation (chat-view unchanged)', () => {
      const tab = newTabId();
      const conv = router.onTabCreated(tab, SESSION_A);
      const probe = makeSurfaceProbe();
      router.onSurfaceCreated(probe.surfaceId, SESSION_A);

      tabManager._emitClosedTab({
        tabId: tab,
        sessionId: SESSION_A,
        kind: 'close',
      });
      TestBed.tick();

      // Phase 2 reality: the tab-close path is surface-blind. The
      // conversation IS dropped even though the surface still claims it.
      // This documents the chat-view unchanged contract; Phase 3+ may
      // tighten this once surfaces have a real consumer.
      expect(registry.getRecord(conv)).toBeNull();
      expect(binding.conversationFor(tab)).toBeNull();
    });

    it('is a graceful no-op when called for a never-registered surface (close-race tolerance)', () => {
      const ghost = SurfaceId.create();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      expect(() => router.onSurfaceClosed(ghost)).not.toThrow();
      expect(
        streamingHandler.cleanupSessionDeduplication,
      ).not.toHaveBeenCalled();
      expect(agentMonitorStore.clearSessionAgents).not.toHaveBeenCalled();
      // No warn emitted for a missing binding — that's the happy path.
      warnSpy.mockRestore();
    });

    it('tolerates errors thrown by streaming cleanup (best-effort)', () => {
      const probe = makeSurfaceProbe();
      router.onSurfaceCreated(probe.surfaceId, SESSION_A);

      streamingHandler.cleanupSessionDeduplication.mockImplementationOnce(
        () => {
          throw new Error('boom');
        },
      );
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      expect(() => router.onSurfaceClosed(probe.surfaceId)).not.toThrow();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // ---- routeStreamEventForSurface ----------------------------------------

  describe('routeStreamEventForSurface()', () => {
    it('drops events silently when the surface is not registered with the adapter registry', () => {
      const orphan = SurfaceId.create();
      const result = router.routeStreamEventForSurface(
        msgStart(SESSION_A),
        orphan,
      );

      expect(result).toBeNull();
      // No side effects.
      expect(registry.conversations()).toHaveLength(0);
      expect(binding.conversationForSurface(orphan)).toBeNull();
    });

    it('lazy-binds when the surface adapter is registered but onSurfaceCreated was skipped', () => {
      const probe = makeSurfaceProbe();

      const conv = router.routeStreamEventForSurface(
        msgStart(SESSION_A),
        probe.surfaceId,
      );

      expect(conv).not.toBeNull();
      expect(binding.conversationForSurface(probe.surfaceId)).toBe(conv);
      expect(registry.getRecord(conv as never)?.sessions).toEqual([SESSION_A]);
    });

    it('mutates the surface adapter state slot when the accumulator core writes', () => {
      const probe = makeSurfaceProbe();
      router.onSurfaceCreated(probe.surfaceId, SESSION_A);

      router.routeStreamEventForSurface(msgStart(SESSION_A), probe.surfaceId);

      // The accumulator wrote to the surface's state — currentMessageId
      // is the cheapest tell.
      expect(probe.state.currentMessageId).toBe(`msg-${SESSION_A}`);
      expect(probe.state.messageEventIds).toContain(`msg-${SESSION_A}`);
    });

    it('appends a new session to the conversation when the first event carries a different sessionId', () => {
      const probe = makeSurfaceProbe();
      const conv = router.onSurfaceCreated(probe.surfaceId, SESSION_A);

      router.routeStreamEventForSurface(msgStart(SESSION_B), probe.surfaceId);

      const sessions = registry.getRecord(conv)?.sessions ?? [];
      expect(sessions).toEqual([SESSION_A, SESSION_B]);
    });

    it('compaction_start marks the conversation in-flight (lifecycle parity with tab path)', () => {
      const probe = makeSurfaceProbe();
      const conv = router.onSurfaceCreated(probe.surfaceId, SESSION_A);

      router.routeStreamEventForSurface(
        compactionStart(SESSION_A),
        probe.surfaceId,
      );

      expect(registry.getRecord(conv)?.compactionInFlight).toBe(true);
    });

    it('compaction_complete installs a fresh state via adapter.setState (replacementState path)', () => {
      const probe = makeSurfaceProbe();
      const conv = router.onSurfaceCreated(probe.surfaceId, SESSION_A);

      // Seed the surface's state with content so we can observe the swap.
      router.routeStreamEventForSurface(msgStart(SESSION_A), probe.surfaceId);
      const seededState = probe.state;
      expect(seededState.currentMessageId).toBe(`msg-${SESSION_A}`);

      router.routeStreamEventForSurface(
        compactionStart(SESSION_A),
        probe.surfaceId,
      );
      router.routeStreamEventForSurface(
        compactionComplete(SESSION_A),
        probe.surfaceId,
      );

      // Adapter received a brand-new state object via setState.
      expect(probe.setState).toHaveBeenCalled();
      expect(probe.state).not.toBe(seededState);
      expect(probe.state.currentMessageId).toBeNull();
      expect(probe.state.messageEventIds).toEqual([]);
      // Lifecycle flags propagated.
      const record = registry.getRecord(conv);
      expect(record?.compactionInFlight).toBe(false);
      expect(record?.lastCompactionAt).not.toBeNull();
    });
  });

  // ---- surfacesForSession -------------------------------------------------

  describe('surfacesForSession()', () => {
    it('returns every surface bound to a conversation containing the session', () => {
      const p1 = makeSurfaceProbe();
      const p2 = makeSurfaceProbe();
      router.onSurfaceCreated(p1.surfaceId, SESSION_A);
      router.onSurfaceCreated(p2.surfaceId, SESSION_A);

      const surfaces = router.surfacesForSession(SESSION_A);

      expect(new Set(surfaces)).toEqual(new Set([p1.surfaceId, p2.surfaceId]));
    });

    it('returns an empty array for an unknown session', () => {
      expect(router.surfacesForSession(SESSION_C)).toEqual([]);
    });

    it('does not include tabs (parallel-graph isolation)', () => {
      const tab = newTabId();
      const probe = makeSurfaceProbe();
      router.onTabCreated(tab, SESSION_A);
      router.onSurfaceCreated(probe.surfaceId, SESSION_A);

      const surfaces = router.surfacesForSession(SESSION_A);
      expect(surfaces).toEqual([probe.surfaceId]);
      expect(surfaces as readonly unknown[]).not.toContain(tab);

      const tabs = router.tabsForSession(SESSION_A);
      expect(tabs).toEqual([tab]);
      expect(tabs as readonly unknown[]).not.toContain(probe.surfaceId);
    });
  });

  // ---- routePermissionPrompt regression check ----------------------------

  describe('routePermissionPrompt — signature unchanged (TASK_2026_107 R1 regression check)', () => {
    it('routes ONLY to tabs (NOT surfaces) — wizard/harness must NOT receive permission prompts', () => {
      // Set up: 1 tab + 1 surface, both bound to SESSION_A.
      const tab = newTabId();
      const probe = makeSurfaceProbe();
      router.onTabCreated(tab, SESSION_A);
      router.onSurfaceCreated(probe.surfaceId, SESSION_A);

      const prompt = makePermissionRequest({ id: 'perm-tab-only' });
      const targets = router.routePermissionPrompt(prompt);

      // Targets are tabs only — surface excluded by design (full-auto).
      expect(targets).toEqual([tab]);
      // attachPromptTargets received ONLY the tab id — no surface id leaked.
      expect(permissionHandler.attachPromptTargets).toHaveBeenCalledWith(
        'perm-tab-only',
        [tab],
      );
    });

    it('returns empty array when only surfaces are bound (no tab consumer for the prompt)', () => {
      const probe = makeSurfaceProbe();
      router.onSurfaceCreated(probe.surfaceId, SESSION_A);

      const prompt = makePermissionRequest({ id: 'perm-no-tab' });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const targets = router.routePermissionPrompt(prompt);

      expect(targets).toEqual([]);
      expect(permissionHandler.attachPromptTargets).not.toHaveBeenCalled();
      // TASK_2026_107 Phase 5 — defensive guard kicks in here.
      expect(warnSpy).toHaveBeenCalledWith(
        'prompt.received.no-tab-surface-only',
        expect.objectContaining({
          promptId: 'perm-no-tab',
          surfaceCount: 1,
        }),
      );
      warnSpy.mockRestore();
    });
  });

  // ---- TASK_2026_107 Phase 5 — defensive guard ---------------------------

  describe('defensive guard — prompt for surface-only conversation', () => {
    it('emits prompt.received.no-tab-surface-only warning with full payload', () => {
      const probe = makeSurfaceProbe();
      const conv = router.onSurfaceCreated(probe.surfaceId, SESSION_A);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      router.routePermissionPrompt(
        makePermissionRequest({ id: 'perm-guard-1' }),
      );

      expect(warnSpy).toHaveBeenCalledWith(
        'prompt.received.no-tab-surface-only',
        {
          promptId: 'perm-guard-1',
          sessionId: SESSION_A as unknown as string,
          conversationId: conv,
          surfaceCount: 1,
        },
      );
      warnSpy.mockRestore();
    });

    it('auto-denies via handlePermissionResponse so the SDK is unblocked', () => {
      const probe = makeSurfaceProbe();
      router.onSurfaceCreated(probe.surfaceId, SESSION_A);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      router.routePermissionPrompt(
        makePermissionRequest({ id: 'perm-guard-2' }),
      );

      expect(permissionHandler.handlePermissionResponse).toHaveBeenCalledWith({
        id: 'perm-guard-2',
        decision: 'deny',
        reason: expect.stringContaining('auto-deny'),
      });
      warnSpy.mockRestore();
    });

    it('counts every surface bound to the conversation in surfaceCount', () => {
      const p1 = makeSurfaceProbe();
      const p2 = makeSurfaceProbe();
      router.onSurfaceCreated(p1.surfaceId, SESSION_A);
      router.onSurfaceCreated(p2.surfaceId, SESSION_A);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      router.routePermissionPrompt(
        makePermissionRequest({ id: 'perm-guard-3' }),
      );

      expect(warnSpy).toHaveBeenCalledWith(
        'prompt.received.no-tab-surface-only',
        expect.objectContaining({ surfaceCount: 2 }),
      );
      warnSpy.mockRestore();
    });

    it('does NOT fire when at least one tab is bound (mixed tab+surface conversation)', () => {
      const tab = newTabId();
      const probe = makeSurfaceProbe();
      router.onTabCreated(tab, SESSION_A);
      router.onSurfaceCreated(probe.surfaceId, SESSION_A);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const targets = router.routePermissionPrompt(
        makePermissionRequest({ id: 'perm-guard-4' }),
      );

      // Tab path wins — guard does not fire. Tab is the prompt target.
      expect(targets).toEqual([tab]);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(permissionHandler.handlePermissionResponse).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('does NOT fire when sessionId is unknown to the registry (legacy fallback path)', () => {
      // No surfaces, no tabs — session is unknown. Guard must not warn
      // because this is the existing legacy-fallback case (router didn't
      // see the binding event yet); auto-deny would be wrong here.
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const targets = router.routePermissionPrompt(
        makePermissionRequest({
          id: 'perm-guard-5',
          sessionId: SESSION_C as unknown as string,
        }),
      );

      expect(targets).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(permissionHandler.handlePermissionResponse).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('does NOT fire when prompt has no sessionId (legacy fallback path)', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const targets = router.routePermissionPrompt(
        makePermissionRequest({ id: 'perm-guard-6', sessionId: undefined }),
      );

      expect(targets).toEqual([]);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(permissionHandler.handlePermissionResponse).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
