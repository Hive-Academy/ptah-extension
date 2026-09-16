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
import { yieldToMacrotask } from '@ptah-extension/core';
import type {
  FlatStreamEventUnion,
  SessionId,
  SubagentRecord,
} from '@ptah-extension/shared';
import {
  HistoryMessageBuilder,
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';

/** One `switchSession`'s hold on a tab. */
export interface ReplayClaim {
  readonly tabId: string;
  readonly claim: number;
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
  readonly buffered: Array<() => void>;
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
  claim(tabId: string, sessionId: SessionId): ReplayClaim {
    if (this.claims.has(tabId)) {
      this.streamingHandler.clearPendingUpdates(tabId);
    }
    const claimNumber = ++this.claimCounter;
    this.claims.set(tabId, claimNumber);
    const claim = { tabId, claim: claimNumber };
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
    this.closeFence(claim);
    if (this.isCurrent(claim)) {
      this.claims.delete(claim.tabId);
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
          this.streamingHandler.processStreamEvent(
            events[index],
            tabId,
            sessionId,
            { isReplay: true, fanOut: false },
          );
        }
        if (!chunked) continue;
        await yieldToMacrotask();
        if (!this.canContinueReplay(tabId, claim, sessionId)) {
          return 'superseded';
        }
      }

      this.streamingHandler.finalizeSessionHistory(tabId, resumableSubagents);
      this.closeFence(claim);
      return 'replayed';
    } finally {
      this.markReplayFinished(claim);
      this.releaseReplayAdmission();
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
    deliver: () => void,
  ): boolean {
    const fence = this.findFence(event, tabId, sessionId);
    if (!fence || fence.overflowed) return false;
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
      this.deliverAll(fence.buffered.splice(0));
      return false;
    }
    fence.buffered.push(deliver);
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
    fence.holders.add(claim.claim);
    const previous = this.heldFences.get(claim.tabId);
    this.heldFences.set(claim.tabId, { claim: claim.claim, sessionId });
    if (previous) this.leaveFence(previous);
  }

  /** Drop `claim`'s hold, if its tab's hold is still this claim's. */
  private closeFence(claim: ReplayClaim): void {
    const held = this.heldFences.get(claim.tabId);
    if (!held || held.claim !== claim.claim) return;
    this.heldFences.delete(claim.tabId);
    this.leaveFence(held);
  }

  /** The last holder leaving a fence delivers its buffer in arrival order. */
  private leaveFence(held: HeldFence): void {
    const fence = this.fences.get(held.sessionId);
    if (!fence) return;
    fence.holders.delete(held.claim);
    if (fence.holders.size > 0) return;
    this.fences.delete(held.sessionId);
    this.deliverAll(fence.buffered);
  }

  /** One throwing delivery must not strand the events queued behind it. */
  private deliverAll(deliveries: ReadonlyArray<() => void>): void {
    for (const deliver of deliveries) {
      try {
        deliver();
      } catch (error: unknown) {
        console.error(
          '[SessionHistoryReplayer] buffered live event failed to apply',
          error,
        );
      }
    }
  }
}
