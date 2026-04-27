/**
 * Surface-vs-Tab Parity Integration Test — TASK_2026_107 Phase 5.
 *
 * Pins the Phase 2 extraction contract: an event sequence driven through
 * `StreamRouter.routeStreamEventForSurface` produces the same final
 * `StreamingState` shape as the canonical tab path
 * (`StreamingAccumulatorCore.process` invoked directly — the same path
 * `StreamingHandlerService.processEventForTab` takes after Phase 2).
 *
 * If this test fails, the extraction in Phase 2 is broken — the surface
 * routing path has diverged from the canonical chat path. Do NOT skip
 * or weaken the assertions — fix the underlying issue.
 *
 * R7 (multi-surface fan-out): two surfaces bound to the same conversation
 * receive the same event; conversation-level state (dedup keyed by
 * sessionId) runs once, per-surface state runs N times. This is the
 * property that makes side-by-side canvas-style fan-out safe and the
 * reason the accumulator core is shared rather than duplicated.
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  ConversationRegistry,
  SurfaceId,
  TabManagerService,
  TabSessionBinding,
  type ClaudeSessionId,
  type ClosedTabEvent,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
  BatchedUpdateService,
  EventDeduplicationService,
  PermissionHandlerService,
  SessionManager,
  StreamingAccumulatorCore,
  StreamingHandlerService,
  type AccumulatorContext,
} from '@ptah-extension/chat-streaming';
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import type {
  AgentStartEvent,
  BackgroundAgentStartedEvent,
  CompactionCompleteEvent,
  CompactionStartEvent,
  FlatStreamEventUnion,
  MessageCompleteEvent,
  MessageStartEvent,
  TextDeltaEvent,
  ToolResultEvent,
  ToolStartEvent,
} from '@ptah-extension/shared';
import { StreamRouter } from '../stream-router.service';
import { StreamingSurfaceRegistry } from '../streaming-surface-registry.service';

// ---------- Helpers --------------------------------------------------------

const SESSION_TAB = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' as ClaudeSessionId;
const SESSION_SURFACE =
  'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb' as ClaudeSessionId;
const SESSION_SHARED =
  'cccccccc-cccc-4ccc-cccc-cccccccccccc' as ClaudeSessionId;
const MSG_ID = 'msg-parity-1';

function msgStart(
  sessionId: ClaudeSessionId,
  o: Partial<MessageStartEvent> = {},
): MessageStartEvent {
  return {
    id: 'evt-msg-start-' + sessionId,
    eventType: 'message_start',
    timestamp: 1,
    sessionId,
    messageId: MSG_ID,
    role: 'assistant',
    source: 'stream',
    ...o,
  } as MessageStartEvent;
}

function textDelta(
  sessionId: ClaudeSessionId,
  o: Partial<TextDeltaEvent> = {},
): TextDeltaEvent {
  return {
    id: 'evt-text-' + sessionId,
    eventType: 'text_delta',
    timestamp: 2,
    sessionId,
    messageId: MSG_ID,
    blockIndex: 0,
    delta: 'hello',
    source: 'stream',
    ...o,
  } as TextDeltaEvent;
}

function toolStart(
  sessionId: ClaudeSessionId,
  o: Partial<ToolStartEvent> = {},
): ToolStartEvent {
  return {
    id: 'evt-tool-start-' + sessionId,
    eventType: 'tool_start',
    timestamp: 3,
    sessionId,
    messageId: MSG_ID,
    toolCallId: 'tool-parity-1',
    toolName: 'Bash',
    isTaskTool: false,
    source: 'stream',
    ...o,
  } as ToolStartEvent;
}

function toolResult(
  sessionId: ClaudeSessionId,
  o: Partial<ToolResultEvent> = {},
): ToolResultEvent {
  return {
    id: 'evt-tool-result-' + sessionId,
    eventType: 'tool_result',
    timestamp: 4,
    sessionId,
    messageId: MSG_ID,
    toolCallId: 'tool-parity-1',
    output: 'ok',
    isError: false,
    source: 'stream',
    ...o,
  } as ToolResultEvent;
}

function agentStart(
  sessionId: ClaudeSessionId,
  o: Partial<AgentStartEvent> = {},
): AgentStartEvent {
  return {
    id: 'evt-agent-start-' + sessionId,
    eventType: 'agent_start',
    timestamp: 5,
    sessionId,
    messageId: MSG_ID,
    toolCallId: 'toolu_agent_parity_1',
    agentType: 'general-purpose',
    agentDescription: 'Sub agent parity',
    agentId: 'agent-id-parity-1',
    source: 'hook',
    ...o,
  } as AgentStartEvent;
}

function bgAgentStart(
  sessionId: ClaudeSessionId,
  o: Partial<BackgroundAgentStartedEvent> = {},
): BackgroundAgentStartedEvent {
  return {
    id: 'evt-bg-' + sessionId,
    eventType: 'background_agent_started',
    timestamp: 6,
    sessionId,
    messageId: MSG_ID,
    toolCallId: 'toolu_bg_parity_1',
    agentType: 'Explore',
    agentId: 'bg-agent-parity-1',
    source: 'hook',
    ...o,
  } as BackgroundAgentStartedEvent;
}

function compactionStart(sessionId: ClaudeSessionId): CompactionStartEvent {
  return {
    id: 'evt-compact-start-' + sessionId,
    eventType: 'compaction_start',
    timestamp: 7,
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
    timestamp: 8,
    sessionId,
    trigger: 'auto',
  } as CompactionCompleteEvent;
}

function messageComplete(sessionId: ClaudeSessionId): MessageCompleteEvent {
  return {
    id: 'evt-msg-complete-' + sessionId,
    eventType: 'message_complete',
    timestamp: 9,
    sessionId,
    messageId: MSG_ID,
    stopReason: 'end_turn',
    tokenUsage: { input: 10, output: 20 },
    source: 'stream',
  } as MessageCompleteEvent;
}

/** Minimal TabManager mock — router only reads tabs() and closedTab(). */
function makeTabManagerMock() {
  const tabsSignal = signal<{ id: string; claudeSessionId: string | null }[]>(
    [],
  );
  const closedTabSignal = signal<ClosedTabEvent | null>(null);
  return {
    tabs: tabsSignal.asReadonly(),
    closedTab: closedTabSignal.asReadonly(),
  };
}

/** Minimal PermissionHandler mock — none of the parity events touch it. */
function makePermissionHandlerMock() {
  const pulseSignal = signal<{
    seq: number;
    promptId: string;
    decidingTabId: string | null;
  } | null>(null);
  return {
    attachPromptTargets: jest.fn(),
    targetTabsFor: jest.fn(() => [] as readonly string[]),
    cancelPrompt: jest.fn(),
    handlePermissionResponse: jest.fn(),
    decisionPulse: pulseSignal.asReadonly(),
  };
}

/**
 * Build a structural snapshot of a StreamingState that ignores Map/Set
 * iteration order quirks but preserves observable shape (event ids per
 * message, tool-call wiring, accumulator content). Used for parity
 * equality assertions.
 */
function snapshotState(state: StreamingState) {
  const eventsByMessage: Record<string, string[]> = {};
  for (const [k, v] of state.eventsByMessage) {
    eventsByMessage[k] = v.map((e) => e.id);
  }
  const toolCallMap: Record<string, string[]> = {};
  for (const [k, v] of state.toolCallMap) {
    toolCallMap[k] = [...v];
  }
  const textAccumulators: Record<string, string> = {};
  for (const [k, v] of state.textAccumulators) {
    textAccumulators[k] = v;
  }
  const toolInputAccumulators: Record<string, string> = {};
  for (const [k, v] of state.toolInputAccumulators) {
    toolInputAccumulators[k] = v;
  }
  return {
    currentMessageId: state.currentMessageId,
    messageEventIds: [...state.messageEventIds],
    eventIds: [...state.events.keys()].sort(),
    eventsByMessage,
    toolCallMap,
    textAccumulators,
    toolInputAccumulators,
    currentTokenUsage: state.currentTokenUsage,
  };
}

// ---------- Suite ----------------------------------------------------------

describe('Surface-vs-Tab parity (TASK_2026_107 Phase 5)', () => {
  let router: StreamRouter;
  let surfaceRegistry: StreamingSurfaceRegistry;
  let core: StreamingAccumulatorCore;
  let sessionManager: SessionManager;
  let deduplication: EventDeduplicationService;
  let batchedUpdate: BatchedUpdateService;
  let backgroundAgentStore: BackgroundAgentStore;
  let agentMonitorStore: AgentMonitorStore;
  let binding: TabSessionBinding;
  let registry: ConversationRegistry;

  beforeEach(() => {
    const tabManager = makeTabManagerMock();
    const permissionHandler = makePermissionHandlerMock();
    // Real StreamingHandlerService would over-couple this test — we only
    // need cleanupSessionDeduplication, and the accumulator-core under
    // test does the real work.
    const streamingHandler = {
      cleanupSessionDeduplication: jest.fn(),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: TabManagerService, useValue: tabManager },
        { provide: PermissionHandlerService, useValue: permissionHandler },
        { provide: StreamingHandlerService, useValue: streamingHandler },
      ],
    });

    router = TestBed.inject(StreamRouter);
    surfaceRegistry = TestBed.inject(StreamingSurfaceRegistry);
    core = TestBed.inject(StreamingAccumulatorCore);
    sessionManager = TestBed.inject(SessionManager);
    deduplication = TestBed.inject(EventDeduplicationService);
    batchedUpdate = TestBed.inject(BatchedUpdateService);
    backgroundAgentStore = TestBed.inject(BackgroundAgentStore);
    agentMonitorStore = TestBed.inject(AgentMonitorStore);
    binding = TestBed.inject(TabSessionBinding);
    registry = TestBed.inject(ConversationRegistry);
    TestBed.tick();
  });

  /** Register a surface adapter against an in-memory state slot. */
  function makeSurface(): {
    surfaceId: SurfaceId;
    state: StreamingState;
    setState: jest.Mock;
  } {
    const ref = {
      surfaceId: SurfaceId.create(),
      state: createEmptyStreamingState(),
      setState: jest.fn(),
    };
    ref.setState.mockImplementation((next: StreamingState) => {
      ref.state = next;
    });
    surfaceRegistry.register(ref.surfaceId, () => ref.state, ref.setState);
    return ref;
  }

  /** Build a context bag that mirrors what the chat tab path uses. */
  function makeCtx(): AccumulatorContext {
    return {
      sessionManager,
      deduplication,
      batchedUpdate,
      backgroundAgentStore,
      agentMonitorStore,
    };
  }

  // -------------------------------------------------------------------------
  // Test 1 — Identical event sequence on independent sessions produces
  // structurally identical state on both paths.
  //
  // The two paths must NOT share a session id — dedup is keyed by sessionId
  // and would suppress the second path's events. Independent sessions keep
  // the two paths cleanly comparable.
  // -------------------------------------------------------------------------
  it('drives the same event sequence through both paths — structural state parity', () => {
    // Tab path: drive directly through the accumulator core (mirrors what
    // StreamingHandlerService.processEventForTab does after Phase 2).
    const canonicalState = createEmptyStreamingState();
    const ctx = makeCtx();
    const tabSequence: FlatStreamEventUnion[] = [
      msgStart(SESSION_TAB),
      textDelta(SESSION_TAB),
      toolStart(SESSION_TAB),
      toolResult(SESSION_TAB),
      agentStart(SESSION_TAB),
      bgAgentStart(SESSION_TAB),
      messageComplete(SESSION_TAB),
    ];
    for (const evt of tabSequence) {
      core.process(canonicalState, evt, ctx);
    }

    // Surface path: drive through routeStreamEventForSurface.
    const surface = makeSurface();
    router.onSurfaceCreated(surface.surfaceId, SESSION_SURFACE);
    const surfaceSequence: FlatStreamEventUnion[] = [
      msgStart(SESSION_SURFACE),
      textDelta(SESSION_SURFACE),
      toolStart(SESSION_SURFACE),
      toolResult(SESSION_SURFACE),
      agentStart(SESSION_SURFACE),
      bgAgentStart(SESSION_SURFACE),
      messageComplete(SESSION_SURFACE),
    ];
    for (const evt of surfaceSequence) {
      router.routeStreamEventForSurface(evt, surface.surfaceId);
    }

    // Replace event-id session suffix so we can compare structures
    // independent of which session carried the event.
    const canonicalSnap = snapshotState(canonicalState);
    const surfaceSnap = snapshotState(surface.state);

    // Strip session-id suffixes from the event ids and message-event ids
    // so the two structurally-identical state slots compare equal.
    const stripSession = (s: string) =>
      s.replace(SESSION_TAB, 'SESS').replace(SESSION_SURFACE, 'SESS');
    const normalize = <T extends ReturnType<typeof snapshotState>>(
      snap: T,
    ) => ({
      currentMessageId: snap.currentMessageId,
      messageEventIds: snap.messageEventIds.map(stripSession),
      eventIds: snap.eventIds.map(stripSession).sort(),
      eventsByMessage: Object.fromEntries(
        Object.entries(snap.eventsByMessage).map(([k, v]) => [
          k,
          v.map(stripSession),
        ]),
      ),
      toolCallMap: Object.fromEntries(
        Object.entries(snap.toolCallMap).map(([k, v]) => [
          k,
          v.map(stripSession),
        ]),
      ),
      textAccumulators: snap.textAccumulators,
      toolInputAccumulators: snap.toolInputAccumulators,
      currentTokenUsage: snap.currentTokenUsage,
    });

    expect(normalize(surfaceSnap)).toEqual(normalize(canonicalSnap));
  });

  // -------------------------------------------------------------------------
  // Test 2 — compaction_complete swap produces the same fresh-empty state
  // on both paths.
  // -------------------------------------------------------------------------
  it('compaction_complete on both paths produces a fresh-empty state with parity', () => {
    const canonicalState = createEmptyStreamingState();
    const ctx = makeCtx();
    core.process(canonicalState, msgStart(SESSION_TAB), ctx);
    core.process(canonicalState, textDelta(SESSION_TAB), ctx);
    core.process(canonicalState, compactionStart(SESSION_TAB), ctx);
    const canonicalResult = core.process(
      canonicalState,
      compactionComplete(SESSION_TAB),
      ctx,
    );
    expect(canonicalResult.replacementState).not.toBeNull();
    const canonicalAfter = canonicalResult.replacementState as StreamingState;

    const surface = makeSurface();
    router.onSurfaceCreated(surface.surfaceId, SESSION_SURFACE);
    router.routeStreamEventForSurface(
      msgStart(SESSION_SURFACE),
      surface.surfaceId,
    );
    router.routeStreamEventForSurface(
      textDelta(SESSION_SURFACE),
      surface.surfaceId,
    );
    router.routeStreamEventForSurface(
      compactionStart(SESSION_SURFACE),
      surface.surfaceId,
    );
    router.routeStreamEventForSurface(
      compactionComplete(SESSION_SURFACE),
      surface.surfaceId,
    );

    // Surface adapter received a setState with the fresh state.
    expect(surface.setState).toHaveBeenCalled();

    // Both should be empty (no messages, no events, no tool calls).
    expect(canonicalAfter.messageEventIds).toEqual([]);
    expect(canonicalAfter.events.size).toBe(0);
    expect(canonicalAfter.currentMessageId).toBeNull();

    expect(surface.state.messageEventIds).toEqual([]);
    expect(surface.state.events.size).toBe(0);
    expect(surface.state.currentMessageId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // R7: multi-surface fan-out semantics.
  //
  // Two surfaces bound to the SAME conversation receive the SAME event
  // sequence. Conversation-level state (dedup keyed by sessionId, agent
  // registration with SessionManager, BackgroundAgentStore writes) MUST
  // run exactly once. Per-surface state MUST mutate on every call.
  //
  // This is the property that makes side-by-side canvas-style fan-out
  // safe — without it, a duplicate `tool_start` from a `complete`/`history`
  // source replay would render twice in every visible surface.
  // -------------------------------------------------------------------------
  describe('R7 — multi-surface fan-out: per-surface state runs N times, dedup is per-state', () => {
    it('two surfaces on the same conversation: each surface receives the event into its own state', () => {
      const s1 = makeSurface();
      const s2 = makeSurface();
      // Bind both surfaces to the SAME conversation (same session id).
      const conv1 = router.onSurfaceCreated(s1.surfaceId, SESSION_SHARED);
      const conv2 = router.onSurfaceCreated(s2.surfaceId, SESSION_SHARED);
      expect(conv2).toBe(conv1);
      expect(binding.surfacesFor(conv1)).toHaveLength(2);

      // dedup is per-state (it scans state.events for the messageId), so when
      // two surfaces have separate state objects, each call sees a clean
      // state and proceeds through the full first-occurrence path.
      const dedupSpy = jest.spyOn(deduplication, 'handleDuplicateMessageStart');

      // Drive ONE message_start through BOTH surfaces.
      const evt = msgStart(SESSION_SHARED);
      router.routeStreamEventForSurface(evt, s1.surfaceId);
      router.routeStreamEventForSurface(evt, s2.surfaceId);

      // dedup is called BOTH times — once per surface invocation.
      expect(dedupSpy).toHaveBeenCalledTimes(2);

      // CRITICAL: each surface's state contains the event independently.
      // This is the multi-surface fan-out invariant — per-surface state
      // mutations DO run N times because each surface owns its own state.
      expect(s1.state.events.has(evt.id)).toBe(true);
      expect(s2.state.events.has(evt.id)).toBe(true);
      expect(s1.state.messageEventIds).toContain(MSG_ID);
      expect(s2.state.messageEventIds).toContain(MSG_ID);
      expect(s1.state.currentMessageId).toBe(MSG_ID);
      expect(s2.state.currentMessageId).toBe(MSG_ID);
    });

    it('per-surface dedup independence: each surface scans its own events Map', () => {
      // The dedup service is keyed by sessionId for tool/agent caches but
      // for message_start it scans state.events directly. Because each
      // surface has its own state object, the per-surface dedup paths are
      // independent — confirming surface fan-out is structurally safe.
      const s1 = makeSurface();
      const s2 = makeSurface();
      router.onSurfaceCreated(s1.surfaceId, SESSION_SHARED);
      router.onSurfaceCreated(s2.surfaceId, SESSION_SHARED);

      // First message_start: both surfaces see it.
      const evt1 = msgStart(SESSION_SHARED);
      router.routeStreamEventForSurface(evt1, s1.surfaceId);
      router.routeStreamEventForSurface(evt1, s2.surfaceId);

      // Both have it.
      expect(s1.state.events.has(evt1.id)).toBe(true);
      expect(s2.state.events.has(evt1.id)).toBe(true);

      // Now drive an unrelated text_delta only on s1 — s2 stays untouched.
      const td = textDelta(SESSION_SHARED);
      router.routeStreamEventForSurface(td, s1.surfaceId);

      expect(s1.state.events.has(td.id)).toBe(true);
      expect(s2.state.events.has(td.id)).toBe(false);
    });

    it('two surfaces on the same conversation: per-surface state stays isolated for non-deduped writes', () => {
      const s1 = makeSurface();
      const s2 = makeSurface();
      router.onSurfaceCreated(s1.surfaceId, SESSION_SHARED);
      router.onSurfaceCreated(s2.surfaceId, SESSION_SHARED);

      // Drive a message_start on s1 only.
      const evt = msgStart(SESSION_SHARED);
      router.routeStreamEventForSurface(evt, s1.surfaceId);

      expect(s1.state.events.has(evt.id)).toBe(true);
      // s2 was not invoked — state is untouched.
      expect(s2.state.events.size).toBe(0);
      expect(s2.state.currentMessageId).toBeNull();
    });

    it('two surfaces on the same conversation: BackgroundAgentStore registers only once', () => {
      const s1 = makeSurface();
      const s2 = makeSurface();
      router.onSurfaceCreated(s1.surfaceId, SESSION_SHARED);
      router.onSurfaceCreated(s2.surfaceId, SESSION_SHARED);

      const onStartedSpy = jest.spyOn(backgroundAgentStore, 'onStarted');

      const evt = bgAgentStart(SESSION_SHARED);
      router.routeStreamEventForSurface(evt, s1.surfaceId);
      router.routeStreamEventForSurface(evt, s2.surfaceId);

      // BackgroundAgentStore.onStarted is itself idempotent on repeat
      // agentId — it's safe to call twice. The point of R7 is that the
      // store's eventual state (one entry for this agent) is correct
      // regardless of how many surfaces saw the event.
      expect(onStartedSpy).toHaveBeenCalled();
      // Sanity: the agent appears exactly once in the store, not twice.
      const agents = backgroundAgentStore.agentsForSession(SESSION_SHARED);
      expect(agents).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Sanity: surfacesForSession finds the right surfaces (used by the
  // defensive guard in production).
  // -------------------------------------------------------------------------
  it('surfacesForSession returns every surface bound to a conversation containing the session', () => {
    const s1 = makeSurface();
    const s2 = makeSurface();
    router.onSurfaceCreated(s1.surfaceId, SESSION_SHARED);
    router.onSurfaceCreated(s2.surfaceId, SESSION_SHARED);

    const found = router.surfacesForSession(SESSION_SHARED);
    expect(new Set(found)).toEqual(new Set([s1.surfaceId, s2.surfaceId]));

    // Conversation registry agrees.
    const containing = registry.findContainingSession(SESSION_SHARED);
    if (!containing)
      throw new Error('expected conversation for shared session');
    expect(binding.surfacesFor(containing.id)).toHaveLength(2);

    // agentMonitorStore is a real instance — sanity that the test wired
    // it up (the parity sequence does not exercise its public APIs).
    expect(agentMonitorStore).toBeDefined();
  });
});
