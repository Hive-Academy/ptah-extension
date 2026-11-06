import { Injectable, computed, signal } from '@angular/core';
import type { SendMessageOptions } from '@ptah-extension/chat-types';

/**
 * Where one follow-up is (TASK_2026_884):
 *
 * - `held`: kept in the renderer. A slash command typed during a turn (the
 *   backend never holds one), anything typed after such a command, a message
 *   for a tab whose session is not bound yet, or one held by the Command
 *   Center send lock. Sent when nothing older is pending and its trigger fires.
 * - `submitting`: the `chat:continue` (`queueIntent: 'next-turn'`) is in
 *   flight.
 * - `queued`: the backend accepted it and holds it for the next turn of its
 *   session.
 *
 * Terminal states (`delivered`, `steered`, `withdrawn`, `failed`) remove the
 * entry and are reported once to {@link QueuedFollowUpStore.onSettled}.
 */
export type QueuedFollowUpPhase = 'held' | 'submitting' | 'queued';

export type QueuedFollowUpOutcome =
  | 'delivered'
  | 'steered'
  | 'withdrawn'
  | 'failed';

export interface QueuedFollowUpEntry {
  readonly clientMessageId: string;
  /** The tab it was typed in. Captured once; never re-targeted. */
  readonly tabId: string;
  /**
   * The session captured when it was typed. `null` only for a tab whose new
   * session was not bound yet; such an entry adopts the first session bound
   * to its tab.
   */
  readonly sessionId: string | null;
  readonly content: string;
  readonly options?: SendMessageOptions;
  /** The Command Center owner that sent it, so its own send lock never holds it. */
  readonly ownerToken?: string;
  readonly isCommand: boolean;
  readonly phase: QueuedFollowUpPhase;
  /** Short user-facing note (for example after a refused "Send now"). */
  readonly note?: string;
}

/** Identity a caller keeps to follow one queued follow-up. */
export interface QueuedFollowUpRef {
  readonly clientMessageId: string;
  readonly tabId: string;
  readonly sessionId: string | null;
}

/**
 * Session-keyed mirror of the follow-ups a tab has waiting (TASK_2026_884).
 *
 * The backend owns delivery; this store only records what the renderer sent
 * (RPC receipts and `chat:queued-message-state` pushes) and what it still
 * holds itself. It never releases anything. FIFO: entries keep insertion
 * order. Plain signal state, no timers or observers.
 */
@Injectable({ providedIn: 'root' })
export class QueuedFollowUpStore {
  private readonly _entries = signal<readonly QueuedFollowUpEntry[]>([]);
  private readonly listeners = new Map<
    string,
    Array<(outcome: QueuedFollowUpOutcome) => void>
  >();

  readonly entries = this._entries.asReadonly();

  /** Tabs with an entry the renderer itself still holds. */
  readonly tabsWithHeldEntries = computed<readonly string[]>(() => {
    const tabs = new Set<string>();
    for (const entry of this._entries()) {
      if (entry.phase === 'held') tabs.add(entry.tabId);
    }
    return [...tabs];
  });

  get(clientMessageId: string): QueuedFollowUpEntry | null {
    return (
      this._entries().find((e) => e.clientMessageId === clientMessageId) ??
      null
    );
  }

  /** Every entry of the tab, FIFO. Reactive. */
  forTab(tabId: string): readonly QueuedFollowUpEntry[] {
    return this._entries().filter((e) => e.tabId === tabId);
  }

  /**
   * The entries a view of `tabId` showing `sessionId` owns, FIFO: those
   * captured for that session, plus not-yet-bound ones of the tab. An entry
   * of an earlier session of the same tab is not part of this view.
   */
  forView(tabId: string, sessionId: string | null): readonly QueuedFollowUpEntry[] {
    return this._entries().filter(
      (e) =>
        e.tabId === tabId &&
        (e.sessionId === null || e.sessionId === sessionId),
    );
  }

  /** Whether the tab's current view has anything waiting. Reactive. */
  hasPendingForView(tabId: string, sessionId: string | null): boolean {
    return this.forView(tabId, sessionId).length > 0;
  }

  /** Whether this follow-up is still waiting (any phase). Reactive. */
  isPending(clientMessageId: string): boolean {
    return this.get(clientMessageId) !== null;
  }

  add(entry: QueuedFollowUpEntry): void {
    this._entries.update((entries) => [...entries, entry]);
  }

  update(
    clientMessageId: string,
    patch: Partial<Pick<QueuedFollowUpEntry, 'phase' | 'note' | 'sessionId'>>,
  ): void {
    this._entries.update((entries) =>
      entries.map((e) =>
        e.clientMessageId === clientMessageId ? { ...e, ...patch } : e,
      ),
    );
  }

  /** Report one outcome of exactly this follow-up (once). */
  onSettled(
    clientMessageId: string,
    listener: (outcome: QueuedFollowUpOutcome) => void,
  ): void {
    const list = this.listeners.get(clientMessageId) ?? [];
    list.push(listener);
    this.listeners.set(clientMessageId, list);
  }

  /**
   * Remove the entry and notify its listeners. Returns the removed entry, or
   * `null` when it was already settled (a push and an RPC reply can both
   * report the same outcome).
   */
  settle(
    clientMessageId: string,
    outcome: QueuedFollowUpOutcome,
  ): QueuedFollowUpEntry | null {
    const entry = this.get(clientMessageId);
    if (!entry) return null;
    this._entries.update((entries) =>
      entries.filter((e) => e.clientMessageId !== clientMessageId),
    );
    const listeners = this.listeners.get(clientMessageId) ?? [];
    this.listeners.delete(clientMessageId);
    for (const listener of listeners) {
      try {
        listener(outcome);
      } catch (error) {
        console.warn('[QueuedFollowUpStore] settle listener failed', error);
      }
    }
    return entry;
  }

  /**
   * Add the backend's held items of one view that this renderer does not know
   * (a reload, or items queued before this window existed), FIFO, ahead of
   * anything the renderer still holds. A known item is left alone: its own
   * state push settles it, so a delivery is never mistaken for a loss.
   */
  reconcile(
    tabId: string,
    sessionId: string,
    items: ReadonlyArray<{ clientMessageId: string; content: string }>,
  ): void {
    const known = new Set(this._entries().map((e) => e.clientMessageId));
    const added: QueuedFollowUpEntry[] = items
      .filter((i) => !known.has(i.clientMessageId))
      .map((i) => ({
        clientMessageId: i.clientMessageId,
        tabId,
        sessionId,
        content: i.content,
        isCommand: false,
        phase: 'queued',
      }));
    if (added.length === 0) return;
    // Backend items are older than anything the renderer still holds.
    this._entries.update((entries) => {
      const firstLocal = entries.findIndex(
        (e) => e.tabId === tabId && e.phase !== 'queued',
      );
      if (firstLocal < 0) return [...entries, ...added];
      return [
        ...entries.slice(0, firstLocal),
        ...added,
        ...entries.slice(firstLocal),
      ];
    });
  }

  /** Forget every entry of a closed tab; listeners hear `withdrawn`. */
  removeTab(tabId: string): readonly QueuedFollowUpEntry[] {
    const removed = this.forTab(tabId);
    for (const entry of removed) this.settle(entry.clientMessageId, 'withdrawn');
    return removed;
  }
}
