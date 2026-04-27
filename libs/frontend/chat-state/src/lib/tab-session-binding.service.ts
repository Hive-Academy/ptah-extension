/**
 * TabSessionBinding — TASK_2026_106 Phase 1.
 *
 * Single source of truth for the `TabId ↔ ConversationId` relation, plus
 * (TASK_2026_107 Phase 1) the parallel `SurfaceId ↔ ConversationId` relation
 * for non-tab consumers (wizard analysis phases, harness operations).
 *
 *   - Forward edge (tab):     each tab is bound to *exactly one* conversation.
 *   - Reverse edge (tab):     each conversation can be bound to many tabs.
 *   - Forward edge (surface): each surface is bound to *exactly one* conversation.
 *   - Reverse edge (surface): each conversation can be bound to many surfaces.
 *
 * The two key spaces (TabId, SurfaceId) are deliberately disjoint — surfaces
 * never leak into tab enumeration (`tabsFor` ignores them) and vice versa.
 * This keeps consumers that care about UI tabs (tabs panel, navbar,
 * persistence) from accidentally enumerating wizard/harness surfaces.
 *
 * Pure data: this service knows nothing about streaming, the SDK, or the
 * tab manager. The future StreamRouter (Phase 2) is the only consumer that
 * combines this with `ConversationRegistry`.
 *
 * Phase 1 ships this service in additive mode — no caller writes to it yet.
 */

import { Injectable, computed, signal } from '@angular/core';
import { ConversationId, SurfaceId, TabId } from './identity/ids';

@Injectable({ providedIn: 'root' })
export class TabSessionBinding {
  private readonly _byTab = signal<ReadonlyMap<TabId, ConversationId>>(
    new Map(),
  );
  private readonly _byConversation = signal<
    ReadonlyMap<ConversationId, ReadonlySet<TabId>>
  >(new Map());

  // TASK_2026_107 Phase 1 — parallel surface-keyed maps.
  private readonly _bySurface = signal<ReadonlyMap<SurfaceId, ConversationId>>(
    new Map(),
  );
  private readonly _byConversationSurface = signal<
    ReadonlyMap<ConversationId, ReadonlySet<SurfaceId>>
  >(new Map());

  /** Total number of bound tabs. */
  readonly boundTabCount = computed(() => this._byTab().size);

  /** Total number of bound surfaces. */
  readonly boundSurfaceCount = computed(() => this._bySurface().size);

  /**
   * Total number of distinct conversations that have at least one bound tab
   * OR at least one bound surface. A conversation referenced by both a tab
   * and a surface is counted once.
   */
  readonly boundConversationCount = computed(() => {
    const tabConvs = this._byConversation();
    const surfaceConvs = this._byConversationSurface();
    if (surfaceConvs.size === 0) return tabConvs.size;
    if (tabConvs.size === 0) return surfaceConvs.size;
    const union = new Set<ConversationId>(tabConvs.keys());
    for (const conv of surfaceConvs.keys()) union.add(conv);
    return union.size;
  });

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
   *
   * Surfaces are deliberately NOT included — call `surfacesFor` for those.
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

  // ---------------------------------------------------------------------
  // TASK_2026_107 Phase 1 — surface bindings (parallel, additive).
  //
  // Mirrors bind/unbind/conversationFor/tabsFor exactly, keyed by SurfaceId.
  // No caller wired in yet.
  // ---------------------------------------------------------------------

  /**
   * Bind a surface to a conversation. If the surface is already bound to a
   * different conversation, the prior binding is replaced. Re-binding to the
   * same conversation is a no-op.
   */
  bindSurface(surfaceId: SurfaceId, convId: ConversationId): void {
    const prevConv = this._bySurface().get(surfaceId);
    if (prevConv === convId) return;

    this._bySurface.update((prev) => {
      const next = new Map(prev);
      next.set(surfaceId, convId);
      return next;
    });

    this._byConversationSurface.update((prev) => {
      const next = new Map<ConversationId, ReadonlySet<SurfaceId>>();
      for (const [k, v] of prev) {
        next.set(k, v);
      }

      // Remove from previous conversation's set.
      if (prevConv) {
        const oldSet = next.get(prevConv);
        if (oldSet) {
          const trimmed = new Set(oldSet);
          trimmed.delete(surfaceId);
          if (trimmed.size === 0) {
            next.delete(prevConv);
          } else {
            next.set(prevConv, trimmed);
          }
        }
      }

      // Add to the new conversation's set.
      const existing = next.get(convId);
      const updated = new Set<SurfaceId>(existing ?? []);
      updated.add(surfaceId);
      next.set(convId, updated);
      return next;
    });
  }

  /**
   * Unbind a surface. Cleans up the reverse-edge entry, removing the
   * conversation from the reverse map if no surfaces remain. No-op if the
   * surface is not bound (idempotent on close races).
   */
  unbindSurface(surfaceId: SurfaceId): void {
    const convId = this._bySurface().get(surfaceId);
    if (!convId) return;

    this._bySurface.update((prev) => {
      const next = new Map(prev);
      next.delete(surfaceId);
      return next;
    });

    this._byConversationSurface.update((prev) => {
      const next = new Map<ConversationId, ReadonlySet<SurfaceId>>();
      for (const [k, v] of prev) {
        next.set(k, v);
      }
      const set = next.get(convId);
      if (!set) return next;
      const trimmed = new Set(set);
      trimmed.delete(surfaceId);
      if (trimmed.size === 0) {
        next.delete(convId);
      } else {
        next.set(convId, trimmed);
      }
      return next;
    });
  }

  /** Conversation a surface is bound to, or null if unbound. */
  conversationForSurface(surfaceId: SurfaceId): ConversationId | null {
    return this._bySurface().get(surfaceId) ?? null;
  }

  /**
   * All surfaces currently bound to a conversation. Returns an empty array
   * if the conversation has no bound surfaces (or doesn't exist). The
   * returned array is a fresh copy — callers may iterate freely.
   *
   * Tabs are deliberately NOT included — call `tabsFor` for those.
   */
  surfacesFor(convId: ConversationId): readonly SurfaceId[] {
    const set = this._byConversationSurface().get(convId);
    return set ? Array.from(set) : [];
  }

  /** True iff at least one surface is bound to the conversation. */
  hasBoundSurfaces(convId: ConversationId): boolean {
    const set = this._byConversationSurface().get(convId);
    return !!set && set.size > 0;
  }
}
