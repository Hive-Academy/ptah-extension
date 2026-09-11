import { Injectable, inject } from '@angular/core';
import { SessionId } from '@ptah-extension/shared';
import {
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
  type ConversationId,
  type TabId,
} from '@ptah-extension/chat-state';
import type { TabState } from '@ptah-extension/chat-types';

/** The id a compaction's lifecycle state is stored under, plus its thread. */
export interface CompactionLifecycleKey {
  readonly key: SessionId;
  readonly conversationId: ConversationId | null;
}

/**
 * One PostCompact advisory. `key` is where the compaction's lifecycle state
 * lives; `incomingSessionId` is the id the advisory arrived with. They differ
 * after an SDK session rotation, which is the case this record exists for.
 */
export interface PostCompactAdvisory {
  readonly originTabId: TabId;
  readonly incomingSessionId: SessionId;
  readonly conversationId: ConversationId | null;
  readonly generation: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
  fallbackApplied: boolean;
  /** The fallback reload came back as an unverified (stale) snapshot. */
  fallbackStale: boolean;
  staleRetryTimeoutId: ReturnType<typeof setTimeout> | null;
  staleRetryScheduled: boolean;
}

/**
 * CompactionAdvisoryCorrelator — correlates the PostCompact advisory with the
 * compaction it belongs to, across SDK session-id rotation.
 *
 * Extracted from `CompactionLifecycleService` (facade rule): the lifecycle
 * keeps its public API and state machine; this collaborator owns the advisory
 * records, the resolution of a replaceable session id to the id the lifecycle
 * state is keyed by, the delayed fallback with its ownership re-check, and the
 * single retry of a stale fallback snapshot.
 *
 * Why resolution is needed: timers, advisories and generations are keyed by
 * the session id `compaction_start` carried. A tab can rotate to a new SDK id
 * before PostCompact arrives, and PostCompact can carry either id. The
 * conversation registry already relates every alias the router appended, so a
 * compaction started under A and completed under B resolves to A's state.
 */
@Injectable({ providedIn: 'root' })
export class CompactionAdvisoryCorrelator {
  /**
   * PostCompact is advisory: the SDK hook proves compaction finished, but only
   * the streamed compact_boundary carries authoritative token metadata. Give
   * that stream a short turn before recovering the visible transcript. The
   * same wait spaces the one retry of a stale fallback snapshot.
   */
  static readonly POST_COMPACT_BOUNDARY_WAIT_MS = 250;
  private static readonly MAX_POST_COMPACT_ADVISORY_SESSIONS = 256;

  private readonly tabManager = inject(TabManagerService);
  private readonly conversationRegistry = inject(ConversationRegistry);
  private readonly tabSessionBinding = inject(TabSessionBinding);

  private readonly advisories = new Map<SessionId, PostCompactAdvisory>();

  /**
   * Resolve the id a compaction's lifecycle state is keyed by. Pure read:
   * never creates a binding or conversation.
   *
   * 1. `incoming` itself when it already owns advisory or lifecycle state;
   * 2. otherwise another session of the same conversation that does;
   * 3. otherwise `incoming`.
   */
  resolveLifecycleKey(
    incoming: SessionId,
    hasLifecycleState: (sessionId: SessionId) => boolean,
  ): CompactionLifecycleKey {
    const conversation = this.conversationOfSession(incoming);
    const conversationId = conversation?.id ?? null;
    const owns = (sessionId: SessionId): boolean =>
      this.advisories.has(sessionId) || hasLifecycleState(sessionId);
    if (owns(incoming)) return { key: incoming, conversationId };
    const aliases = conversation ? [...conversation.sessions].reverse() : [];
    for (const alias of aliases) {
      if (alias !== incoming && owns(alias)) {
        return { key: alias, conversationId };
      }
    }
    return { key: incoming, conversationId };
  }

  /**
   * Tabs a PostCompact advisory applies to: those owning the incoming id, then
   * those owning the resolved key, then every tab bound to the conversation.
   * Only an id unknown to every tab and conversation yields none.
   */
  tabsForCompaction(
    lifecycle: CompactionLifecycleKey & { readonly incoming: SessionId },
  ): readonly TabState[] {
    const direct = this.tabManager.findTabsBySessionId(lifecycle.incoming);
    if (direct.length > 0) return direct;
    if (lifecycle.key !== lifecycle.incoming) {
      const byKey = this.tabManager.findTabsBySessionId(lifecycle.key);
      if (byKey.length > 0) return byKey;
    }
    if (!lifecycle.conversationId) return [];
    const allTabs = this.tabManager.tabs();
    return this.tabSessionBinding
      .tabsFor(lifecycle.conversationId)
      .map((tabId) => allTabs.find((tab) => tab.id === tabId))
      .filter((tab): tab is TabState => tab != null);
  }

  /**
   * The advisory's origin: the tab that owns the incoming id, else the first
   * tab the compaction started on that still exists, else the first candidate.
   */
  originTabFor(
    tabs: readonly TabState[],
    incoming: SessionId,
    startedTabIds: readonly TabId[],
  ): TabId {
    const owner = tabs.find((tab) => tab.claudeSessionId === incoming);
    if (owner) return owner.id;
    const survivor = startedTabIds.find((tabId) =>
      tabs.some((tab) => tab.id === tabId),
    );
    return survivor ?? tabs[0].id;
  }

  has(key: SessionId): boolean {
    return this.advisories.has(key);
  }

  get(key: SessionId): PostCompactAdvisory | undefined {
    return this.advisories.get(key);
  }

  /** Drop a record and every timer it holds. */
  delete(key: SessionId): void {
    const advisory = this.advisories.get(key);
    if (!advisory) return;
    this.clearTimers(advisory);
    this.advisories.delete(key);
  }

  clearAll(): void {
    for (const advisory of this.advisories.values()) this.clearTimers(advisory);
    this.advisories.clear();
  }

  /**
   * Drop advisories `tabId` originated. The sweep keys off the record's own
   * `originTabId`, not off the live tab list — a CLOSED tab is already gone
   * from `tabs()`. A pending (timed) advisory dies with its tab; a
   * `fallbackApplied` record survives only while another tab still owns the
   * session, so a late boundary can merge its metrics there (PR #493 review D).
   */
  dropForTab(tabId: TabId): void {
    for (const [key, advisory] of this.advisories) {
      if (advisory.originTabId !== tabId) continue;
      const pending = advisory.timeoutId !== null;
      const stillOwnedElsewhere = this.tabManager
        .findTabsBySessionId(advisory.incomingSessionId)
        .some((candidate) => candidate.id !== tabId);
      if (pending || !stillOwnedElsewhere) this.delete(key);
    }
  }

  /**
   * Arm the fallback: if no compact_boundary settles this compaction within
   * the wait, re-check the origin's ownership and apply one targeted reload
   * through `onFallback`. The record is retained afterwards so a late boundary
   * can merge metrics without a second reload or count increment.
   */
  schedule(params: {
    readonly key: SessionId;
    readonly incoming: SessionId;
    readonly conversationId: ConversationId | null;
    readonly originTabId: TabId;
    readonly generation: number;
    readonly onFallback: (originTabId: TabId) => void;
  }): void {
    const advisory: PostCompactAdvisory = {
      originTabId: params.originTabId,
      incomingSessionId: params.incoming,
      conversationId: params.conversationId,
      generation: params.generation,
      timeoutId: null,
      fallbackApplied: false,
      fallbackStale: false,
      staleRetryTimeoutId: null,
      staleRetryScheduled: false,
    };
    const timeoutId = setTimeout(() => {
      if (this.advisories.get(params.key) !== advisory) return;
      if (advisory.timeoutId !== timeoutId) return;
      advisory.timeoutId = null;

      // Re-read ownership immediately before fallback mutation. A closed tab,
      // or one rebound to an unrelated conversation, is no longer an owner.
      const origin = this.tabManager
        .tabs()
        .find((tab) => tab.id === advisory.originTabId);
      if (!origin || !this.stillOwnsCompaction(origin, params.key, advisory)) {
        this.advisories.delete(params.key);
        console.info(
          '[ChatStore] PostCompact advisory fallback skipped; originating tab no longer owns session',
          { sessionId: advisory.incomingSessionId, tabId: advisory.originTabId },
        );
        return;
      }

      advisory.fallbackApplied = true;
      console.info(
        '[ChatStore] PostCompact advisory fallback applying one targeted reload without boundary metrics',
        { sessionId: advisory.incomingSessionId, tabId: origin.id },
      );
      params.onFallback(origin.id);
      this.advisories.set(params.key, advisory);
    }, CompactionAdvisoryCorrelator.POST_COMPACT_BOUNDARY_WAIT_MS);
    advisory.timeoutId = timeoutId;
    this.advisories.set(params.key, advisory);
    this.trim();
  }

  /**
   * The fallback reload came back stale. Retry it exactly once after the
   * boundary wait; if it is still stale, log once and stop — the live
   * compact_boundary, if it arrives, reloads it (see `fallbackStale`).
   * `retry` resolves `true` when the retried snapshot is still stale.
   */
  scheduleStaleRetry(key: SessionId, retry: () => Promise<boolean>): void {
    const advisory = this.advisories.get(key);
    if (!advisory) return;
    advisory.fallbackStale = true;
    if (advisory.staleRetryScheduled) return;
    advisory.staleRetryScheduled = true;
    advisory.staleRetryTimeoutId = setTimeout(() => {
      advisory.staleRetryTimeoutId = null;
      if (this.advisories.get(key) !== advisory) return;
      void retry().then((stillStale) => {
        if (this.advisories.get(key) !== advisory) return;
        advisory.fallbackStale = stillStale;
        if (stillStale) {
          console.warn(
            '[ChatStore] PostCompact fallback snapshot is still unverified after one retry; a live compact_boundary will reload it',
            { sessionId: advisory.incomingSessionId },
          );
        }
      });
    }, CompactionAdvisoryCorrelator.POST_COMPACT_BOUNDARY_WAIT_MS);
  }

  /**
   * An origin still owns the compaction when it holds either id the
   * compaction is known by, or when its current session is an alias of the
   * same conversation (an SDK rotation the router already recorded). A tab
   * rebound to an unrelated session fails both.
   */
  private stillOwnsCompaction(
    origin: TabState,
    key: SessionId,
    advisory: PostCompactAdvisory,
  ): boolean {
    const current = origin.claudeSessionId;
    if (current === key || current === advisory.incomingSessionId) return true;
    if (!current || !advisory.conversationId) return false;
    return (
      this.tabSessionBinding.conversationFor(origin.id) ===
        advisory.conversationId &&
      this.conversationRegistry.findContainingSession(current)?.id ===
        advisory.conversationId
    );
  }

  /**
   * The conversation that knows `sessionId`: the one containing it anywhere in
   * its history, else the one bound to a tab currently owning it.
   */
  private conversationOfSession(sessionId: SessionId): {
    readonly id: ConversationId;
    readonly sessions: readonly SessionId[];
  } | null {
    const containing = this.conversationRegistry.findContainingSession(sessionId);
    if (containing) {
      return { id: containing.id, sessions: containing.sessions ?? [] };
    }
    const owner = this.tabManager
      .tabs()
      .find((tab) => tab.claudeSessionId === sessionId);
    const bound = owner ? this.tabSessionBinding.conversationFor(owner.id) : null;
    if (!bound) return null;
    const record = this.conversationRegistry.getRecord(bound);
    return { id: bound, sessions: record?.sessions ?? [] };
  }

  private clearTimers(advisory: PostCompactAdvisory): void {
    if (advisory.timeoutId) clearTimeout(advisory.timeoutId);
    if (advisory.staleRetryTimeoutId) clearTimeout(advisory.staleRetryTimeoutId);
    advisory.timeoutId = null;
    advisory.staleRetryTimeoutId = null;
  }

  /**
   * Bound the advisory map the same way the generation map is bounded: a
   * `fallbackApplied` record whose session never sees another boundary used to
   * accumulate without limit (PR #493 review D).
   */
  private trim(): void {
    while (
      this.advisories.size >
      CompactionAdvisoryCorrelator.MAX_POST_COMPACT_ADVISORY_SESSIONS
    ) {
      const oldest = this.advisories.keys().next().value;
      if (!oldest) return;
      this.delete(oldest);
    }
  }
}
