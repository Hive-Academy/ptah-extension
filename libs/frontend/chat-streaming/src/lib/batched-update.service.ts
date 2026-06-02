/**
 * BatchedUpdateService - RAF-based batched UI updates
 *
 * Extracted from StreamingHandlerService to handle:
 * - Scheduling batched UI updates using requestAnimationFrame
 * - Flushing pending updates to TabManager
 * - Performance optimization to reduce signal updates
 *
 * Part of StreamingHandlerService refactoring for better maintainability.
 *
 * Visibility gating: state writes are always accumulated, but the flush to
 * TabManager (which drives execution-tree rebuilds + markdown re-derive in
 * downstream computed signals) is deferred for tabs that the user cannot
 * see — either because they are not the active tab, or because the
 * document is hidden (Electron window minimized / loses focus). Deferred
 * flushes drain through `pendingFlush` when the tab becomes active and via
 * a `visibilitychange` listener when the document regains visibility.
 */

import {
  DestroyRef,
  Injectable,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { StreamingState } from '@ptah-extension/chat-types';

@Injectable({ providedIn: 'root' })
export class BatchedUpdateService {
  private readonly tabManager = inject(TabManagerService);
  private readonly destroyRef = inject(DestroyRef);

  private pendingTabUpdates = new Map<string, StreamingState>();
  private deferredTabUpdates = new Map<string, StreamingState>();
  private pendingFlush = new Set<string>();
  private rafId: number | null = null;
  private visibilityListener: (() => void) | null = null;

  constructor() {
    if (typeof document !== 'undefined') {
      const listener = () => {
        if (document.visibilityState === 'visible') {
          this.drainDeferred();
        }
      };
      document.addEventListener('visibilitychange', listener);
      this.visibilityListener = listener;
    }

    effect(() => {
      const activeId = this.tabManager.activeTabId();
      if (!activeId) return;
      untracked(() => {
        this.drainDeferredForTab(activeId);
      });
    });

    effect(() => {
      const visible = this.tabManager.visibleTabIds();
      if (visible.size === 0) return;
      untracked(() => {
        this.drainDeferred();
      });
    });

    this.destroyRef.onDestroy(() => {
      if (this.visibilityListener && typeof document !== 'undefined') {
        document.removeEventListener(
          'visibilitychange',
          this.visibilityListener,
        );
      }
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.pendingTabUpdates.clear();
      this.deferredTabUpdates.clear();
      this.pendingFlush.clear();
    });
  }

  scheduleUpdate(tabId: string, state: StreamingState): void {
    if (this.shouldDefer(tabId)) {
      this.deferredTabUpdates.set(tabId, state);
      this.pendingFlush.add(tabId);
      return;
    }
    this.pendingTabUpdates.set(tabId, state);
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.flushPendingUpdates());
    }
  }

  private shouldDefer(tabId: string): boolean {
    return !this.canFlush(tabId);
  }

  /**
   * A tab may flush when the document is visible AND the tab is on-screen:
   * present in the visible set (Orchestra Canvas tiles) or — when no tile has
   * registered (single-tab webview) — the active tab.
   */
  private canFlush(tabId: string): boolean {
    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden'
    ) {
      return false;
    }
    const visible = this.tabManager.visibleTabIds();
    if (visible.size > 0) return visible.has(tabId);
    const activeId = this.tabManager.activeTabId();
    return !activeId || activeId === tabId;
  }

  private flushPendingUpdates(): void {
    this.rafId = null;
    for (const [tabId, state] of this.pendingTabUpdates) {
      this.tabManager.setStreamingState(tabId, { ...state });
    }
    this.pendingTabUpdates.clear();
  }

  private drainDeferred(): void {
    if (this.deferredTabUpdates.size === 0) {
      this.pendingFlush.clear();
      return;
    }
    let scheduled = false;
    for (const tabId of [...this.deferredTabUpdates.keys()]) {
      if (!this.canFlush(tabId)) continue;
      const state = this.deferredTabUpdates.get(tabId);
      this.deferredTabUpdates.delete(tabId);
      this.pendingFlush.delete(tabId);
      if (!state) continue;
      this.pendingTabUpdates.set(tabId, state);
      scheduled = true;
    }
    if (scheduled && this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.flushPendingUpdates());
    }
  }

  private drainDeferredForTab(tabId: string): void {
    if (!this.pendingFlush.has(tabId)) return;
    if (!this.canFlush(tabId)) return;
    const state = this.deferredTabUpdates.get(tabId);
    this.pendingFlush.delete(tabId);
    this.deferredTabUpdates.delete(tabId);
    if (!state) return;
    this.pendingTabUpdates.set(tabId, state);
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.flushPendingUpdates());
    }
  }

  flushSync(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.deferredTabUpdates.size > 0) {
      for (const [tabId, state] of this.deferredTabUpdates) {
        this.pendingTabUpdates.set(tabId, state);
      }
      this.deferredTabUpdates.clear();
      this.pendingFlush.clear();
    }
    this.flushPendingUpdates();
  }

  hasPendingUpdates(tabId: string): boolean {
    return (
      this.pendingTabUpdates.has(tabId) || this.deferredTabUpdates.has(tabId)
    );
  }

  clearPendingUpdates(tabId: string): void {
    this.pendingTabUpdates.delete(tabId);
    this.deferredTabUpdates.delete(tabId);
    this.pendingFlush.delete(tabId);
  }
}
