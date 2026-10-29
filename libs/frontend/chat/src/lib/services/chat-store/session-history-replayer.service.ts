/**
 * SessionHistoryReplayer — replays a `chat:resume` transcript into one tab
 * without holding the renderer for the whole history (TASK_2026_437 C15).
 *
 * `SessionLoaderService.switchSession` owns WHAT a resume writes (stats, CLI
 * cards, failure branches). This collaborator owns HOW the history events
 * reach the tab:
 *
 * - **Claims.** Every `switchSession` claims its tab. A newer claim on the
 *   same tab supersedes the older one; the older replay stops at its next
 *   check and writes nothing further.
 * - **Chunks.** A history of at most {@link REPLAY_CHUNK_SIZE} events replays
 *   in one synchronous pass. A longer one yields a macrotask after EVERY
 *   chunk — the last included, so finalization runs in its own turn. 2,000
 *   events yield 8 times. The tab stays `resuming` until finalization.
 * - **Admission.** Replay chunks and finalization use one global FIFO slot.
 *   Its fast path intentionally returns no Promise so an uncontended replay
 *   enters synchronously; a contended replay re-checks its claim and tab
 *   binding when admitted. Every exit releases the slot, with one macrotask
 *   and one paint opportunity before the next waiter.
 * - **Replay-tab signal.** {@link replay} publishes a tab from entry through
 *   its claim-keyed `finally`. Consumers read {@link isReplaying}; an older
 *   replay can never clear a newer replay's motion-suppression ownership.
 * - **Live-event fence.** From {@link claim} to {@link release} — the
 *   `chat:resume` round trip AND every event-loop turn between chunks — a live
 *   turn for the same session can deliver `chat:chunk` events (an
 *   `activate: true` resume starts or joins the live query on the backend
 *   before its reply arrives). They are buffered, not interleaved with
 *   history, and delivered in arrival order right after finalization — before
 *   the caller marks the session `loaded` — or, on every other exit, when the
 *   caller releases the claim. See {@link deferLiveEvent} for matching, the
 *   bound, and the superseded, failed and closed-tab cases.
 * - **Yield failures.** `yieldToMacrotask` rejects when the channel post
 *   throws; the rejection leaves {@link replay} like a throwing chunk does, so
 *   the caller's failure branch runs and {@link release} opens the fence. On a
 *   host without `MessageChannel` (jsdom) it resolves on a microtask: the
 *   chunks still run in order with every claim check, only without a real
 *   event-loop turn between them — and so without live events to fence.
 */

import { Injectable, inject, signal } from '@angular/core';
import { LoggingService, yieldToMacrotask } from '@ptah-extension/core';
import { isTerminalTurnPhase } from '@ptah-extension/shared';
import type {
  FlatStreamEventUnion,
  ExecutionNode,
  SessionId,
  SubagentRecord,
} from '@ptah-extension/shared';
import {
  HistoryMessageBuilder,
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  PersistedContentFilter,
  type BlockSignature,
} from './persisted-content-filter';
import { patchHistoryToolResult } from './history-tool-result-patch';
import type { ToolResultEvent } from '@ptah-extension/shared';

/** One `switchSession`'s hold on a tab. */
export interface ReplayClaim {
  readonly tabId: string;
  readonly claim: number;
}

/** Snapshot content and its tab-local delivery callback. */
export interface ReplayLiveSeed {
  readonly events: readonly FlatStreamEventUnion[];
  readonly apply: (events: readonly FlatStreamEventUnion[]) => void;
  readonly liveSeedBlocks?: Readonly<Record<string, number>>;
}

/** Inputs produced by a verified history read for one claim. */
export interface PersistedFilterInputs {
  readonly ownerByEvent: ReadonlyMap<FlatStreamEventUnion, string> | null;
  readonly syntheticResults?: ReadonlySet<FlatStreamEventUnion> | null;
  readonly prefixMark: number | null;
}

/** A temporary hold that does not supersede the tab's replay claim. */
export interface FenceReservation {
  readonly sessionId: string;
  readonly claim: number;
  released: boolean;
}

interface BufferedLiveEvent {
  readonly deliver: (excludeTabIds?: ReadonlySet<string>) => void;
  readonly event: FlatStreamEventUnion;
  readonly arrival: number;
}

interface HistoryIndex {
  readonly history: Map<string, BlockSignature[]>;
  readonly toolResults: Map<
    string,
    { output: unknown; isError: boolean; synthetic: boolean }
  >;
  readonly toolIds: Set<string>;
}

/** `superseded`: a newer resume claimed the tab, or the tab closed or rebound. */
export type HistoryReplayOutcome = 'replayed' | 'superseded';

/** Result of replaying a side-effect-free older-history page. */
export type OlderHistoryReplayOutcome = 'prepended' | 'superseded';

/**
 * One buffer per SESSION, not per tab: the tab path fans a session's event out
 * to every active tab bound to that session (`StreamingHandlerService`
 * `processStreamEvent`), so an event addressed to a sibling tile would land in
 * the replaying tab too. A shared buffer also keeps the session's live events
 * in one arrival order when two tabs replay the same session at once.
 */
interface LiveEventFence {
  readonly sessionId: string;
  /** Claim numbers of the resumes holding this fence open. */
  readonly holders: Set<number>;
  readonly buffered: BufferedLiveEvent[];
  /** Set once the bound is hit; later events for the session bypass the fence. */
  overflowed: boolean;
}

/** The fence a tab's current claim holds. */
interface HeldFence {
  readonly claim: number;
  readonly sessionId: string;
}

/** One replay waiting for the global replay-and-finalize slot. */
interface ReplayAdmissionWaiter {
  readonly tabId: string;
  readonly resolve: () => void;
  readonly reject: (reason: Error) => void;
  readonly warningTimer: ReturnType<typeof setTimeout>;
}

@Injectable({ providedIn: 'root' })
export class SessionHistoryReplayer {
  private readonly tabManager = inject(TabManagerService);
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly sessionManager = inject(SessionManager);
  private readonly historyMessageBuilder = inject(HistoryMessageBuilder);
  private readonly logger = inject(LoggingService);

  /** History replay chunk size. */
  static readonly REPLAY_CHUNK_SIZE = 250;

  /**
   * Most live events one fence buffers. A fence spans the `chat:resume` round
   * trip (usually under a second, bounded by the resume timeout) plus a few
   * event-loop turns of replay; the bound exists so a slow or stuck resume
   * cannot grow the buffer without limit.
   */
  static readonly LIVE_EVENT_FENCE_LIMIT = 2000;

  /** A wait beyond this threshold indicates a stuck or unusually slow replay. */
  private static readonly ADMISSION_WAIT_WARNING_MS = 10_000;

  /** Latest claim per tab id. A plain map: nothing renders from it. */
  private readonly claims = new Map<string, number>();
  private claimCounter = 0;

  /** Claim currently publishing replay motion suppression for each tab. */
  private readonly replayingClaims = new Map<string, number>();
  private readonly _replayingTabIds = signal<ReadonlySet<string>>(new Set());
  readonly replayingTabIds = this._replayingTabIds.asReadonly();

  /** Open fences by session id. Every claim opens or joins one. */
  private readonly fences = new Map<string, LiveEventFence>();
  /** Which fence each tab's current claim holds, by tab id. */
  private readonly heldFences = new Map<string, HeldFence>();
  private readonly overflowedHolders = new Set<number>();
  private readonly seeds = new Map<number, ReplayLiveSeed | (() => void)>();
  private readonly filterInputs = new Map<number, PersistedFilterInputs>();
  private readonly historyIndexes = new Map<number, HistoryIndex>();
  private readonly persistedFilters = new Map<string, PersistedContentFilter>();
  private readonly filterToolIds = new WeakMap<
    PersistedContentFilter,
    ReadonlySet<string>
  >();
  private readonly terminalFilters = new WeakSet<PersistedContentFilter>();
  private arrivalCounter = 0;

  /** Global FIFO admission for the replay-and-finalize phase only. */
  private replayAdmissionActive = false;
  private readonly replayAdmissionQueue: ReplayAdmissionWaiter[] = [];

  /**
   * Claim `tabId` for one resume of `sessionId` and open (or join) that
   * session's live-event fence. An older resume still holding the tab is
   * superseded; its queued streaming flush is dropped so it cannot land over
   * the state the new resume is about to install, and its fence hold passes to
   * this claim.
   */
  claim(
    tabId: string,
    sessionId: SessionId,
    liveSeed?: ReplayLiveSeed | (() => void),
  ): ReplayClaim {
    if (this.claims.has(tabId)) {
      this.streamingHandler.clearPendingUpdates(tabId);
      const previous = this.claims.get(tabId);
      if (previous !== undefined) {
        this.seeds.delete(previous);
        this.filterInputs.delete(previous);
        this.historyIndexes.delete(previous);
      }
    }
    this.retirePersistedFilter(tabId);
    const claimNumber = ++this.claimCounter;
    this.claims.set(tabId, claimNumber);
    const claim = { tabId, claim: claimNumber };
    if (liveSeed) this.seeds.set(claimNumber, liveSeed);
    // The fence opens here, not when the replay starts: an `activate: true`
    // resume starts (or joins) the live query on the backend before the
    // `chat:resume` reply arrives, so live chunks can reach the renderer
    // during the RPC round trip. The caller MUST pair every claim with
    // `release` in a `finally`, which is what guarantees the fence closes.
    this.openFence(claim, sessionId);
    return claim;
  }

  isCurrent(claim: ReplayClaim | null): boolean {
    return claim !== null && this.claims.get(claim.tabId) === claim.claim;
  }

  isReplaying(tabId: string): boolean {
    return this.replayingTabIds().has(tabId);
  }

  /**
   * End a resume's hold on its tab, whatever its outcome. Releases the claim
   * if it is still the current one, and leaves the fence its claim still holds
   * (every exit but a completed replay, which left it at finalization) —
   * delivering the buffer if no other claim holds it. Idempotent.
   */
  release(claim: ReplayClaim | null): void {
    if (claim === null) return;
    try {
      this.closeFence(claim);
    } finally {
      this.seeds.delete(claim.claim);
      this.filterInputs.delete(claim.claim);
      this.historyIndexes.delete(claim.claim);
      this.overflowedHolders.delete(claim.claim);
      if (this.isCurrent(claim)) this.claims.delete(claim.tabId);
    }
  }

  /** Hold a session fence while a resync waits for another load to finish. */
  reserveFence(sessionId: SessionId): FenceReservation {
    const reservation = {
      sessionId,
      claim: ++this.claimCounter,
      released: false,
    };
    const fence = this.getOrCreateFence(sessionId);
    fence.holders.add(reservation.claim);
    if (fence.overflowed) this.overflowedHolders.add(reservation.claim);
    return reservation;
  }

  /** Release a reservation once; a joined claim continues to hold the fence. */
  releaseReservation(reservation: FenceReservation): void {
    if (reservation.released) return;
    reservation.released = true;
    this.leaveFence(reservation);
    this.overflowedHolders.delete(reservation.claim);
  }

  /** Whether this holder witnessed a fence bound, including before joining it. */
  overflowedDuring(holder: ReplayClaim | FenceReservation): boolean {
    return this.overflowedHolders.has(holder.claim);
  }

  /** Arrival boundary used to distinguish events buffered before a snapshot. */
  liveArrivalMark(): number {
    return this.arrivalCounter;
  }

  /** Attach verified history ownership and the snapshot prefix boundary to a claim. */
  setPersistedFilterInputs(
    claim: ReplayClaim,
    inputs: PersistedFilterInputs,
  ): void {
    if (this.isCurrent(claim)) this.filterInputs.set(claim.claim, inputs);
  }

  /** Retire a tab's filter before a new resync or claim replaces its state. */
  retirePersistedFilter(tabId: string): void {
    const filter = this.persistedFilters.get(tabId);
    if (!filter) return;
    this.persistedFilters.delete(tabId);
    const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
    try {
      filter.retire(!tab || tab.claudeSessionId !== filter.sessionId);
    } catch (error: unknown) {
      this.logger.warn(
        'SessionHistoryReplayer',
        'persisted filter retirement failed',
        error,
      );
    }
  }

  /**
   * Replay `events` into the claimed tab, then finalize it.
   *
   * After each yield the replay stops (`superseded`) when a newer resume
   * claimed the tab, or the tab closed or was rebound to another session. A
   * closed tab's queued flush is dropped and the session status settles
   * `loaded`; a rebound tab's queue belongs to its new owner and is left
   * alone. A throw propagates with the fence still open: the caller settles
   * the failure first, then {@link release} delivers the buffered events.
   */
  async replay(
    events: readonly FlatStreamEventUnion[],
    claim: ReplayClaim,
    sessionId: SessionId,
    resumableSubagents: SubagentRecord[] | undefined,
  ): Promise<HistoryReplayOutcome> {
    const { tabId } = claim;
    const chunkSize = SessionHistoryReplayer.REPLAY_CHUNK_SIZE;
    const chunked = events.length > chunkSize;
    const index: HistoryIndex = {
      history: new Map(),
      toolResults: new Map(),
      toolIds: new Set(),
    };
    this.historyIndexes.set(claim.claim, index);
    this.markReplayStarted(claim);
    const admission = this.acquireReplayAdmission(tabId);

    try {
      if (admission) await admission;
      if (admission && !this.canContinueReplay(tabId, claim, sessionId)) {
        return 'superseded';
      }

      for (let start = 0; start < events.length; start += chunkSize) {
        const end = Math.min(start + chunkSize, events.length);
        for (let index = start; index < end; index++) {
          const event = events[index];
          this.streamingHandler.processStreamEvent(event, tabId, sessionId, {
            isReplay: true,
            fanOut: false,
          });
          this.indexHistoryEvent(claim, event);
        }
        if (!chunked) continue;
        await yieldToMacrotask();
        if (!this.canContinueReplay(tabId, claim, sessionId)) {
          return 'superseded';
        }
      }

      const seed = this.seeds.get(claim.claim);
      const historyToolIds = this.historyIndexes.get(claim.claim)?.toolIds;
      const seededSubagents =
        seed && typeof seed !== 'function'
          ? seed.events.filter(
              (event) =>
                event.eventType === 'agent_start' &&
                event.parentToolUseId &&
                historyToolIds?.has(event.parentToolUseId),
            )
          : [];
      const historyState = seededSubagents?.length
        ? this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab.streamingState
        : undefined;
      this.streamingHandler.finalizeSessionHistory(tabId, resumableSubagents);
      if (seededSubagents?.length) {
        const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
        const tools = new Map(
          events
            .filter((event) => event.eventType === 'tool_start')
            .map((event) => [event.toolCallId, event] as const),
        );
        const starts = new Map(
          events
            .filter((event) => event.eventType === 'message_start')
            .map((event) => [event.messageId, event] as const),
        );
        const owners = new Set<string>();
        for (const seeded of seededSubagents) {
          if (seeded.eventType !== 'agent_start') continue;
          let toolId: string | undefined = seeded.parentToolUseId;
          const visited = new Set<string>();
          let resolved = false;
          while (toolId && !visited.has(toolId)) {
            visited.add(toolId);
            const start = starts.get(tools.get(toolId)?.messageId ?? '');
            if (!start) break;
            if (!start.parentToolUseId) {
              if (tab?.messages.some((message) => message.id === start.id)) {
                owners.add(start.messageId);
                resolved = true;
              }
              break;
            }
            toolId = start.parentToolUseId;
          }
          if (!resolved)
            this.logger.warn(
              'SessionHistoryReplayer',
              'seeded subagent history owner not found',
              { parentToolUseId: seeded.parentToolUseId },
            );
        }
        if (historyState && owners.size) {
          const missingOwnerIds = [...owners].filter(
            (id) => !historyState.messageEventIds.includes(id),
          );
          for (const id of missingOwnerIds) owners.delete(id);
          if (!owners.size)
            this.logger.warn(
              'SessionHistoryReplayer',
              'seeded subagent history owners missing from message events',
              { tabId, ownerIds: missingOwnerIds },
            );
        }
        if (!owners.size || !historyState || !tab) {
          if (owners.size)
            this.logger.warn(
              'SessionHistoryReplayer',
              'seeded subagent history state not found',
            );
        } else {
          const messageIds = new Set(owners);
          const ownerStarts = new Set(
            [...starts.values()]
              .filter((start) => owners.has(start.messageId))
              .map((start) => start.id),
          );
          const ownerPositions = historyState.messageEventIds.flatMap(
            (id, index) => (owners.has(id) ? [index] : []),
          );
          const firstOwner = Math.min(...ownerPositions);
          const lastOwner = Math.max(...ownerPositions);
          for (const id of historyState.messageEventIds.slice(
            firstOwner + 1,
            lastOwner,
          )) {
            const start = starts.get(id);
            if (start?.role === 'user' && !start.parentToolUseId)
              messageIds.add(id);
          }
          const resyncOwnerPredecessors = new Map<string, string | null>();
          let predecessor: string | null = null;
          for (const message of tab.messages) {
            if (ownerStarts.has(message.id))
              resyncOwnerPredecessors.set(message.id, predecessor);
            else predecessor = message.id;
          }
          const toolIds = new Set<string>();
          let changed = true;
          while (changed) {
            changed = false;
            for (const event of events) {
              if (
                event.eventType === 'tool_start' &&
                messageIds.has(event.messageId) &&
                !toolIds.has(event.toolCallId)
              ) {
                toolIds.add(event.toolCallId);
                changed = true;
              }
              if (
                event.eventType === 'message_start' &&
                event.parentToolUseId &&
                toolIds.has(event.parentToolUseId) &&
                !messageIds.has(event.messageId)
              ) {
                messageIds.add(event.messageId);
                changed = true;
              }
            }
          }
          const belongs = (key: string): boolean =>
            [...messageIds, ...toolIds].some(
              (id) => key === id || key.startsWith(`${id}-`),
            );
          const filteredEvents = new Map(
            [...historyState.events].filter(([, event]) =>
              messageIds.has(event.messageId),
            ),
          );
          let latestTodo:
            | Extract<(typeof events)[number], { eventType: 'tool_start' }>
            | undefined;
          for (const event of filteredEvents.values()) {
            if (
              event.eventType === 'tool_start' &&
              event.toolName === 'TodoWrite' &&
              !event.parentToolUseId &&
              (!latestTodo || event.timestamp >= latestTodo.timestamp)
            ) {
              latestTodo = event;
            }
          }
          const todoInput =
            latestTodo &&
            historyState.latestTodoWrite?.toolCallId === latestTodo.toolCallId
              ? historyState.latestTodoWrite.input
              : latestTodo?.toolInput;
          const orderedOwners = historyState.messageEventIds.filter((id) =>
            owners.has(id),
          );
          const liveState = {
            ...historyState,
            resyncOwnerPredecessors,
            events: filteredEvents,
            latestTodoWrite: latestTodo
              ? {
                  toolCallId: latestTodo.toolCallId,
                  timestamp: latestTodo.timestamp,
                  ...(todoInput && Object.keys(todoInput).length
                    ? { input: todoInput }
                    : {}),
                }
              : undefined,
            messageEventIds: historyState.messageEventIds.filter((id) =>
              messageIds.has(id),
            ),
            toolCallMap: new Map(
              [...historyState.toolCallMap]
                .filter(([id]) => toolIds.has(id))
                .map(([id, ids]): [string, string[]] => [id, [...ids]]),
            ),
            textAccumulators: new Map(
              [...historyState.textAccumulators].filter(([key]) =>
                belongs(key),
              ),
            ),
            toolInputAccumulators: new Map(
              [...historyState.toolInputAccumulators].filter(([key]) =>
                belongs(key),
              ),
            ),
            eventsByMessage: new Map(
              [...historyState.eventsByMessage]
                .filter(([id]) => messageIds.has(id))
                .map(([id, entries]): [string, (typeof entries)[number][]] => [
                  id,
                  [...entries],
                ]),
            ),
            currentMessageId: orderedOwners.at(-1) ?? null,
          };
          this.tabManager.setMessages(
            tabId,
            tab.messages.filter((message) => !ownerStarts.has(message.id)),
          );
          this.tabManager.setStreamingState(tabId, liveState);
        }
      }
      this.closeFence(claim);
      return 'replayed';
    } finally {
      this.markReplayFinished(claim);
      this.releaseReplayAdmission();
    }
  }

  private indexHistoryEvent(
    claim: ReplayClaim,
    event: FlatStreamEventUnion,
  ): void {
    const index = this.historyIndexes.get(claim.claim);
    if (!index) return;
    const inputs = this.filterInputs.get(claim.claim);
    const owner = inputs?.ownerByEvent?.get(event);
    if (owner) {
      let signature: BlockSignature | undefined;
      if (event.eventType === 'text_delta')
        signature = { kind: 'text', value: event.delta };
      else if (event.eventType === 'thinking_delta')
        signature = { kind: 'thinking', value: event.delta };
      else if (event.eventType === 'tool_start')
        signature = { kind: 'tool', value: event.toolCallId };
      if (signature) {
        const blocks = index.history.get(owner) ?? [];
        blocks.push(signature);
        index.history.set(owner, blocks);
      }
    }
    if (event.eventType === 'tool_start') index.toolIds.add(event.toolCallId);
    if (event.eventType === 'tool_result') {
      index.toolResults.set(event.toolCallId, {
        output: event.output,
        isError: event.isError,
        synthetic:
          inputs?.syntheticResults === null ||
          inputs?.syntheticResults === undefined ||
          inputs.syntheticResults.has(event),
      });
    }
  }

  /**
   * Build and atomically prepend one older-history page.
   *
   * Unlike {@link replay}, this path never publishes replay motion state and
   * never opens or closes a live-event fence. A current resume claim always
   * wins, and the tab binding and cursor are checked after admission and after
   * every macrotask yield before any messages are committed.
   */
  async replayOlderPage(
    events: readonly FlatStreamEventUnion[],
    tabId: string,
    sessionId: SessionId,
    requestCursor: string,
    nextCursor: string | null,
    resumableSubagents: readonly SubagentRecord[] | undefined,
  ): Promise<OlderHistoryReplayOutcome> {
    if (!this.canReplayOlderPage(tabId, sessionId, requestCursor)) {
      return 'superseded';
    }

    const cacheKey = `history-page-${tabId}`;
    const admission = this.acquireReplayAdmission(tabId);
    try {
      if (admission) await admission;
      if (!this.canReplayOlderPage(tabId, sessionId, requestCursor)) {
        return 'superseded';
      }

      const chunkSize = SessionHistoryReplayer.REPLAY_CHUNK_SIZE;
      const chunked = events.length > chunkSize;
      let pageState = this.historyMessageBuilder.createPageState();
      for (let start = 0; start < events.length; start += chunkSize) {
        pageState = this.historyMessageBuilder.accumulate(
          pageState,
          events.slice(start, start + chunkSize),
          sessionId,
        );
        if (!chunked) continue;
        await yieldToMacrotask();
        if (!this.canReplayOlderPage(tabId, sessionId, requestCursor)) {
          return 'superseded';
        }
      }

      const messages = this.historyMessageBuilder.build(pageState, {
        cacheKey,
        releaseCacheAfterBuild: false,
        sessionId,
        resumableSubagents,
      });
      this.tabManager.prependHistoryMessages(tabId, messages, nextCursor);
      return 'prepended';
    } finally {
      this.historyMessageBuilder.clearCache(cacheKey);
      this.releaseReplayAdmission();
    }
  }

  private markReplayStarted(claim: ReplayClaim): void {
    this.replayingClaims.set(claim.tabId, claim.claim);
    const replaying = new Set(this._replayingTabIds());
    replaying.add(claim.tabId);
    this._replayingTabIds.set(replaying);
  }

  private markReplayFinished(claim: ReplayClaim): void {
    if (this.replayingClaims.get(claim.tabId) !== claim.claim) return;
    this.replayingClaims.delete(claim.tabId);
    const replaying = new Set(this._replayingTabIds());
    replaying.delete(claim.tabId);
    this._replayingTabIds.set(replaying);
  }

  /**
   * Enter the global replay slot. `null` is the synchronous fast path: callers
   * must not await it, so an uncontended one-chunk replay keeps its old timing.
   */
  private acquireReplayAdmission(tabId: string): Promise<void> | null {
    if (!this.replayAdmissionActive && this.replayAdmissionQueue.length === 0) {
      this.replayAdmissionActive = true;
      return null;
    }

    return new Promise<void>((resolve, reject) => {
      const warningTimer = setTimeout(() => {
        console.warn(
          '[SessionHistoryReplayer] replay admission wait exceeded 10 seconds',
          { tabId, queueLength: this.replayAdmissionQueue.length },
        );
      }, SessionHistoryReplayer.ADMISSION_WAIT_WARNING_MS);
      this.replayAdmissionQueue.push({ tabId, resolve, reject, warningTimer });
    });
  }

  /** Release the slot on every replay exit and start any required handoff. */
  private releaseReplayAdmission(): void {
    if (this.replayAdmissionQueue.length === 0) {
      this.replayAdmissionActive = false;
      return;
    }

    const next = this.replayAdmissionQueue[0];
    this.replayAdmissionQueue.splice(0, 1);
    void this.handoffReplayAdmission(next);
  }

  /** Resolve or reject the waiter whose admission this handoff owns. */
  private async handoffReplayAdmission(
    next: ReplayAdmissionWaiter,
  ): Promise<void> {
    try {
      await yieldToMacrotask();
      await this.yieldToPaint();
      next.resolve();
    } catch (error: unknown) {
      next.reject(
        new Error(`Replay admission handoff failed for tab ${next.tabId}`, {
          cause: error,
        }),
      );
    } finally {
      clearTimeout(next.warningTimer);
    }
  }

  /** Yield until the next frame, with a timer fallback for hidden windows. */
  private yieldToPaint(): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      let frameId: number | undefined;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (frameId !== undefined) cancelAnimationFrame(frameId);
        clearTimeout(timerId);
        resolve();
      };

      const timerId = setTimeout(finish, 50);
      if (typeof requestAnimationFrame === 'function') {
        frameId = requestAnimationFrame(finish);
      }
    });
  }

  /** Preserve the existing post-yield claim, caller-tab and binding checks. */
  private canContinueReplay(
    tabId: string,
    claim: ReplayClaim,
    sessionId: SessionId,
  ): boolean {
    if (!this.isCurrent(claim)) return false;
    const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
    if (!tab) {
      this.streamingHandler.clearPendingUpdates(tabId);
      this.sessionManager.setStatus('loaded');
      return false;
    }
    if (tab.claudeSessionId !== sessionId) {
      this.sessionManager.setStatus('loaded');
      return false;
    }
    return true;
  }

  /** Older pages are valid only while no resume owns the tab and its cursor matches. */
  canReplayOlderPage(
    tabId: string,
    sessionId: SessionId,
    requestCursor: string,
  ): boolean {
    if (this.claims.has(tabId)) return false;
    const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
    return (
      tab?.claudeSessionId === sessionId &&
      tab.olderHistoryCursor === requestCursor
    );
  }

  /**
   * Offer a live `chat:chunk` event to the fence of a tab whose resume is in
   * progress (claimed, not yet released). Returns `true` when the event was buffered —
   * `deliver` then runs later, in arrival order — and `false` when the caller
   * must deliver it now.
   *
   * An event matches the fence its `tabId`'s replay holds, else the fence of
   * its session (the payload `sessionId` or the event's own). Matching by
   * session is what stops canvas fan-out: an event addressed to a sibling
   * tile of the same session waits too, because the tab path would also
   * write it into the replaying tab.
   *
   * The buffer is delivered — never dropped, so the fence only ever changes
   * WHEN an event applies, not WHETHER — once no claim holds the fence any
   * more:
   * - after a completed replay: right after finalization, before the caller
   *   marks the session `loaded` (or after the last of several tabs resuming
   *   the same session finishes);
   * - superseded by a newer resume of the same tab: the newer claim of the
   *   same session takes over the hold; a newer claim of another session
   *   releases it, and the events go to the normal path — they belong to a
   *   live turn, not to the stale history;
   * - every other exit — a failed or timed-out `chat:resume`, an empty
   *   transcript, a stale compaction snapshot, a throw between claim and
   *   replay, a throwing chunk or yield: on release, once the caller has
   *   applied its failure branch;
   * - the tab closed or rebound: on release, to the normal path, which routes
   *   them exactly as it would have without the fence.
   *
   * A live event the resumed history also contains overlaps it with or
   * without the fence (unfenced it would land before the history in the same
   * streaming state); that overlap stays with `EventDeduplicationService`
   * (`messageId` / `toolCallId` keys, `history` outranks `stream`).
   *
   * Bound: at {@link LIVE_EVENT_FENCE_LIMIT} buffered events the fence warns,
   * delivers the buffer at once and lets later events through, so live events
   * stay in order among themselves at the cost of interleaving with history.
   *
   * Only `chat:chunk` passes through here. The out-of-band pushes
   * (`chat:error`, `session:turnEnded`, `session:turnFailed`) stamp tab fields
   * or present an error; finalization, status and the spinner are driven by
   * the in-stream `turn_state` event, which is a `chat:chunk` and so is fenced.
   */
  deferLiveEvent(
    event: FlatStreamEventUnion,
    tabId: string | undefined,
    sessionId: string | undefined,
    deliver: (excludeTabIds?: ReadonlySet<string>) => void,
  ): boolean {
    const fence = this.findFence(event, tabId, sessionId);
    if (!fence || fence.overflowed)
      return this.deliverAfterClose(event, sessionId, deliver);
    if (
      fence.buffered.length >= SessionHistoryReplayer.LIVE_EVENT_FENCE_LIMIT
    ) {
      console.warn(
        '[SessionHistoryReplayer] live-event fence bound reached; delivering without the fence',
        {
          sessionId: fence.sessionId,
          buffered: fence.buffered.length,
          limit: SessionHistoryReplayer.LIVE_EVENT_FENCE_LIMIT,
        },
      );
      fence.overflowed = true;
      for (const holder of fence.holders) this.overflowedHolders.add(holder);
      this.deliverAll(fence.buffered.splice(0), fence.sessionId);
      return this.deliverAfterClose(event, sessionId, deliver);
    }
    fence.buffered.push({ deliver, event, arrival: this.arrivalCounter++ });
    return true;
  }

  private deliverAfterClose(
    event: FlatStreamEventUnion,
    sessionId: string | undefined,
    deliver: (excludeTabIds?: ReadonlySet<string>) => void,
  ): boolean {
    const { excluded, consulted } = this.exclusions(
      event,
      sessionId ?? event.sessionId,
    );
    if (!consulted) return false;
    if (excluded.size > 0) deliver(excluded);
    else deliver();
    return true;
  }

  private findFence(
    event: FlatStreamEventUnion,
    tabId: string | undefined,
    sessionId: string | undefined,
  ): LiveEventFence | undefined {
    const held = tabId ? this.heldFences.get(tabId) : undefined;
    if (held) return this.fences.get(held.sessionId);
    for (const candidate of [sessionId, event.sessionId]) {
      const fence = candidate ? this.fences.get(candidate) : undefined;
      if (fence) return fence;
    }
    return undefined;
  }

  /**
   * Join (or open) the fence for `sessionId`. The tab's previous hold — a
   * superseded replay — is left only after the new hold is in place, so a
   * buffer for the same session stays closed across the hand-over.
   */
  private openFence(claim: ReplayClaim, sessionId: string): void {
    const fence = this.getOrCreateFence(sessionId);
    fence.holders.add(claim.claim);
    if (fence.overflowed) this.overflowedHolders.add(claim.claim);
    const previous = this.heldFences.get(claim.tabId);
    this.heldFences.set(claim.tabId, { claim: claim.claim, sessionId });
    if (previous) this.leaveFence(previous);
  }

  private getOrCreateFence(sessionId: string): LiveEventFence {
    let fence = this.fences.get(sessionId);
    if (!fence) {
      fence = {
        sessionId,
        holders: new Set(),
        buffered: [],
        overflowed: false,
      };
      this.fences.set(sessionId, fence);
    }
    return fence;
  }

  /** Drop `claim`'s hold, if its tab's hold is still this claim's. */
  private closeFence(
    claim: ReplayClaim,
  ): readonly FlatStreamEventUnion[] | undefined {
    const held = this.heldFences.get(claim.tabId);
    if (!held || held.claim !== claim.claim) return;
    const seed = this.seeds.get(claim.claim);
    const needsBoundTab =
      seed !== undefined || this.filterInputs.has(claim.claim);
    const tab = needsBoundTab
      ? this.tabManager.findTabByIdAcrossWorkspaces(claim.tabId)?.tab
      : undefined;
    const valid =
      this.isCurrent(claim) &&
      (!needsBoundTab || tab?.claudeSessionId === held.sessionId);
    let filterRegistrationFailed = false;
    try {
      if (valid && !this.overflowedHolders.has(claim.claim)) {
        try {
          this.registerPersistedFilter(claim, held.sessionId);
        } catch (error: unknown) {
          console.warn(
            '[SessionHistoryReplayer] persisted filter registration failed',
            error,
          );
          this.retirePersistedFilter(claim.tabId);
          filterRegistrationFailed = true;
        }
      }
      this.seeds.delete(claim.claim);
      if (valid && seed) {
        try {
          if (typeof seed === 'function') seed();
          else {
            if (filterRegistrationFailed) {
              seed.apply(seed.events);
              return seed.events;
            }
            let filter = this.persistedFilters.get(claim.tabId);
            const kept: FlatStreamEventUnion[] = [];
            for (const event of seed.events) {
              if (
                !filter ||
                !seed.liveSeedBlocks ||
                !event.messageId ||
                !Object.hasOwn(seed.liveSeedBlocks, event.messageId) ||
                event.eventType === 'tool_result' ||
                event.eventType === 'turn_state' ||
                event.eventType.startsWith('compaction_') ||
                event.eventType.startsWith('background_') ||
                (event.eventType === 'message_start' && event.role === 'user')
              ) {
                kept.push(event);
                continue;
              }
              try {
                if (filter.decide(event) === 'keep') kept.push(event);
              } catch (error: unknown) {
                console.warn(
                  '[SessionHistoryReplayer] persisted filter failed; delivering seed',
                  error,
                );
                this.retirePersistedFilter(claim.tabId);
                filter = undefined;
                kept.push(event);
              }
            }
            seed.apply(kept);
            return kept;
          }
        } catch (error: unknown) {
          console.error(
            '[SessionHistoryReplayer] live seed failed to apply',
            error,
          );
        }
      }
    } finally {
      this.heldFences.delete(claim.tabId);
      this.leaveFence(held);
    }
    return undefined;
  }

  private registerPersistedFilter(claim: ReplayClaim, sessionId: string): void {
    for (const [tabId, filter] of this.persistedFilters) {
      const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
      if (!tab || tab.claudeSessionId !== filter.sessionId)
        this.retirePersistedFilter(tabId);
    }
    const inputs = this.filterInputs.get(claim.claim);
    const index = this.historyIndexes.get(claim.claim);
    if (
      !inputs ||
      !index ||
      (index.history.size === 0 &&
        index.toolIds.size === 0 &&
        inputs.prefixMark === null)
    )
      return;
    const seed = this.seeds.get(claim.claim);
    const seedEvents = seed && typeof seed !== 'function' ? seed.events : [];
    if (
      seed &&
      typeof seed !== 'function' &&
      seedEvents.length === 0 &&
      Object.keys(seed.liveSeedBlocks ?? {}).length === 0 &&
      index.history.size === 0 &&
      index.toolIds.size === 0
    )
      return;
    const lastTurnState = [...seedEvents]
      .reverse()
      .find((event) => event.eventType === 'turn_state' && !event.retirementOnly);
    if (
      lastTurnState?.eventType === 'turn_state' &&
      isTerminalTurnPhase(lastTurnState.phase)
    )
      return;
    const seedMessageIds = new Set<string>();
    const seedBlockKeys = new Set<string>();
    for (const event of seedEvents) {
      if (event.eventType === 'message_start')
        seedMessageIds.add(event.messageId);
      if (
        event.eventType === 'text_delta' ||
        event.eventType === 'thinking_delta' ||
        event.eventType === 'thinking_start' ||
        event.eventType === 'signature_delta'
      ) {
        seedBlockKeys.add(
          `${event.messageId}|${event.eventType === 'text_delta' ? 'text' : 'thinking'}|${event.blockIndex}`,
        );
      } else if (
        event.eventType === 'tool_start' ||
        event.eventType === 'tool_delta'
      ) {
        seedBlockKeys.add(`${event.messageId}|tool|${event.toolCallId}`);
      }
    }
    const seedStartK = new Map<string, number>(
      seed && typeof seed !== 'function'
        ? Object.entries(seed.liveSeedBlocks ?? {})
        : [],
    );
    const tabId = claim.tabId;
    const filter = new PersistedContentFilter({
      tabId,
      sessionId,
      history: index.history,
      historyToolResults: index.toolResults,
      historyToolIds: index.toolIds,
      prefixMark: inputs.prefixMark,
      seedMessageIds,
      seedStartK,
      seedBlockKeys,
      deliverToTab: (event) =>
        this.streamingHandler.processStreamEvent(event, tabId, sessionId, {
          fanOut: false,
        }),
      reconcileHistoryToolResult: (event) =>
        this.reconcileHistoryToolResult(tabId, event),
    });
    this.filterToolIds.set(filter, index.toolIds);
    this.persistedFilters.set(tabId, filter);
  }

  private reconcileHistoryToolResult(
    tabId: string,
    event: ToolResultEvent,
  ): boolean {
    const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
    if (!tab) return false;
    const patched = patchHistoryToolResult(tab.messages, event);
    if (patched === tab.messages) {
      const hasNode = (node: ExecutionNode): boolean =>
        (node.type === 'tool' && node.toolCallId === event.toolCallId) ||
        node.children.some(hasNode);
      if (
        tab.messages.some(
          (message) =>
            message.streamingState && hasNode(message.streamingState),
        )
      )
        return true;
      console.warn(
        '[SessionHistoryReplayer] history tool result could not be reconciled',
      );
      return false;
    }
    this.tabManager.setMessages(tabId, [...patched]);
    return true;
  }

  /** The last holder leaving a fence delivers its buffer in arrival order. */
  private leaveFence(held: HeldFence): void {
    const fence = this.fences.get(held.sessionId);
    if (!fence) return;
    fence.holders.delete(held.claim);
    if (fence.holders.size > 0) return;
    this.fences.delete(held.sessionId);
    for (let index = 0; index < fence.buffered.length; index++) {
      this.deliverOne(fence.buffered[index], held.sessionId);
      const next = this.fences.get(held.sessionId);
      if (next && next !== fence) {
        const remaining = fence.buffered.slice(index + 1);
        if (
          remaining.length + next.buffered.length >
          SessionHistoryReplayer.LIVE_EVENT_FENCE_LIMIT
        ) {
          next.overflowed = true;
          for (const holder of next.holders) this.overflowedHolders.add(holder);
          this.deliverAll(
            [...remaining, ...next.buffered.splice(0)],
            held.sessionId,
          );
        } else {
          next.buffered.unshift(...remaining);
        }
        return;
      }
    }
  }

  /** One throwing delivery must not strand the events queued behind it. */
  private deliverAll(
    deliveries: ReadonlyArray<BufferedLiveEvent>,
    sessionId: string,
  ): void {
    for (const entry of deliveries) this.deliverOne(entry, sessionId);
  }

  private deliverOne(
    entry: BufferedLiveEvent,
    sessionId: string | undefined,
  ): void {
    try {
      const { excluded } = this.exclusions(
        entry.event,
        sessionId,
        entry.arrival,
      );
      if (excluded.size > 0) entry.deliver(excluded);
      else entry.deliver();
    } catch (error: unknown) {
      console.error(
        '[SessionHistoryReplayer] buffered live event failed to apply',
        error,
      );
    }
  }

  private exclusions(
    event: FlatStreamEventUnion,
    sessionId: string | undefined,
    arrival?: number,
  ): { excluded: Set<string>; consulted: boolean } {
    const excluded = new Set<string>();
    let consulted = false;
    for (const [tabId, filter] of this.persistedFilters) {
      if (filter.sessionId !== sessionId) continue;
      const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
      if (!tab || tab.claudeSessionId !== sessionId) {
        this.retirePersistedFilter(tabId);
        continue;
      }
      if (
        this.terminalFilters.has(filter) &&
        (event.eventType !== 'tool_result' ||
          !this.filterToolIds.get(filter)?.has(event.toolCallId))
      )
        continue;
      consulted = true;
      let decision: ReturnType<PersistedContentFilter['decide']>;
      try {
        decision = filter.decide(event, arrival);
      } catch (error: unknown) {
        console.warn(
          '[SessionHistoryReplayer] persisted filter failed; delivering live event',
          error,
        );
        this.retirePersistedFilter(tabId);
        continue;
      }
      if (decision !== 'keep') excluded.add(tabId);
      if (
        event.eventType === 'compaction_complete' ||
        (event.eventType === 'turn_state' && !event.retirementOnly && isTerminalTurnPhase(event.phase))
      ) {
        this.terminalFilters.add(filter);
      }
    }
    return { excluded, consulted };
  }
}
