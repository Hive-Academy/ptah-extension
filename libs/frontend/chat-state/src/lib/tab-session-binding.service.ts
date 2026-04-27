/**
 * TabSessionBinding — TASK_2026_106 Phase 1.
 *
 * Single source of truth for the `TabId ↔ ConversationId` relation.
 *
 *   - Forward edge: each tab is bound to *exactly one* conversation
 *     (or zero, before binding / after unbinding).
 *   - Reverse edge: each conversation can be bound to *many* tabs
 *     simultaneously — this is the multi-tab fan-out that today's
 *     `findTabBySessionId` cannot represent.
 *
 * Pure data: this service knows nothing about streaming, the SDK, or the
 * tab manager. The future StreamRouter (Phase 2) is the only consumer that
 * combines this with `ConversationRegistry`.
 *
 * Phase 1 ships this service in additive mode — no caller writes to it yet.
 */

import { Injectable, computed, signal } from '@angular/core';
import { ConversationId, TabId } from './identity/ids';

@Injectable({ providedIn: 'root' })
export class TabSessionBinding {
  private readonly _byTab = signal<ReadonlyMap<TabId, ConversationId>>(
    new Map(),
  );
  private readonly _byConversation = signal<
    ReadonlyMap<ConversationId, ReadonlySet<TabId>>
  >(new Map());

  /** Total number of bound tabs. */
  readonly boundTabCount = computed(() => this._byTab().size);

  /** Total number of distinct conversations that have at least one bound tab. */
  readonly boundConversationCount = computed(() => this._byConversation().size);

  /**
   * Bind a tab to a conversation. If the tab is already bound to a different
   * conversation, the prior binding is replaced (and the tab removed from
   * the old conversation's reverse set). Re-binding to the same conversation
   * is a no-op.
   */
  bind(tabId: TabId, convId: ConversationId): void {
    const prevConv = this._byTab().get(tabId);
    if (prevConv === convId) return;

    this._byTab.update((prev) => {
      const next = new Map(prev);
      next.set(tabId, convId);
      return next;
    });

    this._byConversation.update((prev) => {
      const next = new Map<ConversationId, ReadonlySet<TabId>>();
      for (const [k, v] of prev) {
        next.set(k, v);
      }

      // Remove from previous conversation's set.
      if (prevConv) {
        const oldSet = next.get(prevConv);
        if (oldSet) {
          const trimmed = new Set(oldSet);
          trimmed.delete(tabId);
          if (trimmed.size === 0) {
            next.delete(prevConv);
          } else {
            next.set(prevConv, trimmed);
          }
        }
      }

      // Add to the new conversation's set.
      const existing = next.get(convId);
      const updated = new Set<TabId>(existing ?? []);
      updated.add(tabId);
      next.set(convId, updated);
      return next;
    });
  }

  /**
   * Unbind a tab. Cleans up the reverse-edge entry, removing the
   * conversation from the reverse map if no tabs remain. No-op if the tab
   * is not bound (idempotent on close races).
   */
  unbind(tabId: TabId): void {
    const convId = this._byTab().get(tabId);
    if (!convId) return;

    this._byTab.update((prev) => {
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });

    this._byConversation.update((prev) => {
      const next = new Map<ConversationId, ReadonlySet<TabId>>();
      for (const [k, v] of prev) {
        next.set(k, v);
      }
      const set = next.get(convId);
      if (!set) return next;
      const trimmed = new Set(set);
      trimmed.delete(tabId);
      if (trimmed.size === 0) {
        next.delete(convId);
      } else {
        next.set(convId, trimmed);
      }
      return next;
    });
  }

  /** Conversation a tab is bound to, or null if unbound. */
  conversationFor(tabId: TabId): ConversationId | null {
    return this._byTab().get(tabId) ?? null;
  }

  /**
   * All tabs currently bound to a conversation. Returns an empty array if
   * the conversation has no bound tabs (or doesn't exist). The returned
   * array is a fresh copy — callers may iterate freely.
   */
  tabsFor(convId: ConversationId): readonly TabId[] {
    const set = this._byConversation().get(convId);
    return set ? Array.from(set) : [];
  }

  /** True iff at least one tab is bound to the conversation. */
  hasBoundTabs(convId: ConversationId): boolean {
    const set = this._byConversation().get(convId);
    return !!set && set.size > 0;
  }
}
