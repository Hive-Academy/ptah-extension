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

import { Injectable, inject } from '@angular/core';
import { yieldToMacrotask } from '@ptah-extension/core';
import type {
  FlatStreamEventUnion,
  SessionId,
  SubagentRecord,
} from '@ptah-extension/shared';
import {
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

@Injectable({ providedIn: 'root' })
export class SessionHistoryReplayer {
  private readonly tabManager = inject(TabManagerService);
  private readonly streamingHandler = inject(StreamingHandlerService);
  private readonly sessionManager = inject(SessionManager);

  /** History replay chunk size. */
  static readonly REPLAY_CHUNK_SIZE = 250;

  /**
   * Most live events one fence buffers. A fence spans the `chat:resume` round
   * trip (usually under a second, bounded by the resume timeout) plus a few
   * event-loop turns of replay; the bound exists so a slow or stuck resume
   * cannot grow the buffer without limit.
   */
  static readonly LIVE_EVENT_FENCE_LIMIT = 2000;

  /** Latest claim per tab id. A plain map: nothing renders from it. */
  private readonly claims = new Map<string, number>();
  private claimCounter = 0;

  /** Open fences by session id. Every claim opens or joins one. */
  private readonly fences = new Map<string, LiveEventFence>();
  /** Which fence each tab's current claim holds, by tab id. */
  private readonly heldFences = new Map<string, HeldFence>();

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
      if (!this.isCurrent(claim)) return 'superseded';
      const tab = this.tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab;
      if (!tab) {
        this.streamingHandler.clearPendingUpdates(tabId);
        this.sessionManager.setStatus('loaded');
        return 'superseded';
      }
      if (tab.claudeSessionId !== sessionId) {
        this.sessionManager.setStatus('loaded');
        return 'superseded';
      }
    }

    this.streamingHandler.finalizeSessionHistory(tabId, resumableSubagents);
    this.closeFence(claim);
    return 'replayed';
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
