/**
 * StreamingHandlerService — cross-workspace delta isolation (TASK_2026_154 Bug 1).
 *
 * Two concurrent streaming sessions in two different workspaces. Workspace B is
 * active with its own live session B; workspace A is backgrounded with its own
 * live session A. When session A emits deltas, they must land in A's
 * partitioned TabState — NEVER in B's active tab — and B's rendered streaming
 * text must contain only B's content.
 *
 * Wiring: REAL TabManagerService + REAL TabWorkspacePartitionService + REAL
 * registries so the partition routing is genuine. The accumulator is mocked to
 * a deterministic text-append so the assertion targets routing (which tab's
 * StreamingState receives the delta), not accumulator internals.
 */

import { TestBed } from '@angular/core/testing';
import {
  TabManagerService,
  TabWorkspacePartitionService,
  ConversationRegistry,
  TabSessionBinding,
  ConfirmationDialogService,
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from '@ptah-extension/chat-state';
import {
  createEmptyStreamingState,
  type StreamingState,
} from '@ptah-extension/chat-types';
import { SessionId, type TextDeltaEvent } from '@ptah-extension/shared';
import { StreamingHandlerService } from './streaming-handler.service';
import { SessionManager } from './session-manager.service';
import { EventDeduplicationService } from './event-deduplication.service';
import { BatchedUpdateService } from './batched-update.service';
import { MessageFinalizationService } from './message-finalization.service';
import { PermissionHandlerService } from './permission-handler.service';
import { BackgroundAgentStore } from './background-agent.store';
import { AgentMonitorStore } from './agent-monitor.store';
import {
  StreamingAccumulatorCore,
  type AccumulatorContext,
} from './accumulator-core.service';

const WS_A = '/ws/a';
const WS_B = '/ws/b';

function textDelta(
  sessionId: string,
  messageId: string,
  delta: string,
): TextDeltaEvent {
  return {
    id: `evt-${messageId}-${delta}`,
    eventType: 'text_delta',
    timestamp: 1,
    sessionId,
    messageId,
    blockIndex: 0,
    delta,
    source: 'stream',
  } as TextDeltaEvent;
}

function textOf(state: StreamingState | null | undefined): string {
  if (!state) return '';
  return [...state.textAccumulators.values()].join('');
}

describe('StreamingHandlerService — cross-workspace delta isolation (Bug 1)', () => {
  let handler: StreamingHandlerService;
  let tabManager: TabManagerService;
  let registry: ConversationRegistry;
  let binding: TabSessionBinding;

  beforeEach(() => {
    localStorage.clear();

    // Deterministic accumulator: append the delta into textAccumulators of the
    // exact StreamingState it was handed. This makes "which tab got the text"
    // directly observable.
    const accumulator = {
      process: jest.fn(
        (
          state: StreamingState,
          event: TextDeltaEvent,
          _ctx: AccumulatorContext,
        ) => {
          const key = `${event.messageId}-block-${event.blockIndex}`;
          const prev = state.textAccumulators.get(key) ?? '';
          state.textAccumulators.set(key, prev + (event.delta ?? ''));
          return { stateMutated: true, eventType: event.eventType };
        },
      ),
    } as unknown as StreamingAccumulatorCore;

    const modelRefreshMock: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      providers: [
        StreamingHandlerService,
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshMock },
        { provide: StreamingAccumulatorCore, useValue: accumulator },
        // Synchronous, side-effect-free batching so in-place state mutation is
        // immediately observable on the tab objects.
        {
          provide: BatchedUpdateService,
          useValue: { scheduleUpdate: jest.fn(), flushSync: jest.fn() },
        },
        {
          provide: SessionManager,
          useValue: { setSessionId: jest.fn(), setStatus: jest.fn() },
        },
        {
          provide: EventDeduplicationService,
          useValue: { cleanupSession: jest.fn() },
        },
        {
          provide: MessageFinalizationService,
          useValue: { finalizeCurrentMessage: jest.fn() },
        },
        {
          provide: PermissionHandlerService,
          useValue: { consumeHardDenyToolUseIds: jest.fn(() => new Set()) },
        },
        { provide: BackgroundAgentStore, useValue: {} },
        { provide: AgentMonitorStore, useValue: {} },
      ],
    });

    handler = TestBed.inject(StreamingHandlerService);
    tabManager = TestBed.inject(TabManagerService);
    registry = TestBed.inject(ConversationRegistry);
    binding = TestBed.inject(TabSessionBinding);
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it("routes session A's deltas to A's background partition, never to B's active tab", () => {
    const sessA = SessionId.create();
    const sessB = SessionId.create();

    // Workspace A: a streaming tab bound to session A. Register + bind the
    // conversation exactly as StreamRouter would, so cross-workspace resolution
    // takes the partition (routeBackgroundEvent) path once A is backgrounded.
    tabManager.switchWorkspace(WS_A);
    const tabIdA = tabManager.createTab('A');
    tabManager.attachSession(tabIdA, sessA);
    tabManager.markStreaming(tabIdA);
    tabManager.setStreamingState(tabIdA, createEmptyStreamingState());
    const convA = registry.create(sessA);
    binding.bind(tabIdA, convA);

    // Workspace B active: its own streaming tab + live session B.
    tabManager.switchWorkspace(WS_B);
    const tabIdB = tabManager.createTab('B');
    tabManager.attachSession(tabIdB, sessB);
    tabManager.markStreaming(tabIdB);
    tabManager.setStreamingState(tabIdB, createEmptyStreamingState());
    const convB = registry.create(sessB);
    binding.bind(tabIdB, convB);

    // B streams its own content (active path, routed by tab id).
    handler.processStreamEvent(textDelta(sessB, 'msg-b', 'B-only'), tabIdB);

    // A streams concurrently while backgrounded (no tab id — arrives by session).
    handler.processStreamEvent(textDelta(sessA, 'msg-a', 'A-only'));

    // OUTCOME 1: B's active tab renders ONLY B's text — A never leaked in.
    const activeB = tabManager.tabs().find((t) => t.id === tabIdB);
    expect(activeB?.claudeSessionId).toBe(sessB);
    expect(textOf(activeB?.streamingState)).toBe('B-only');

    // OUTCOME 2: A's delta landed in A's BACKGROUND partition TabState.
    const bgA = tabManager.getWorkspaceTabs(WS_A).find((t) => t.id === tabIdA);
    expect(bgA?.claudeSessionId).toBe(sessA);
    expect(textOf(bgA?.streamingState)).toBe('A-only');
    expect(bgA?.status).toBe('streaming');
  });
});
