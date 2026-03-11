/**
 * BatchedUpdateService - RAF-based batched UI updates
 *
 * Extracted from StreamingHandlerService to handle:
 * - Scheduling batched UI updates using requestAnimationFrame
 * - Flushing pending updates to TabManager
 * - Performance optimization to reduce signal updates
 *
 * Part of StreamingHandlerService refactoring for better maintainability.
 */

import { Injectable, inject } from '@angular/core';
import { TabManagerService } from '../tab-manager.service';
import type { StreamingState } from '../chat.types';

@Injectable({ providedIn: 'root' })
export class BatchedUpdateService {
  private readonly tabManager = inject(TabManagerService);

  /**
   * PERFORMANCE OPTIMIZATION: Batched UI updates using requestAnimationFrame
   * Instead of updating TabManager 100+ times/sec, we batch updates and flush once per frame.
   * This dramatically reduces signal updates and change detection cycles.
   */
  private pendingTabUpdates = new Map<string, StreamingState>();
  private rafId: number | null = null;

  /**
   * PERFORMANCE OPTIMIZATION: Schedule batched UI update
   * Instead of calling tabManager.updateTab() on every event (100+/sec),
   * we accumulate changes and flush once per animation frame (~60/sec max).
   *
   * @param tabId - Tab ID to update
   * @param state - Current streaming state (will be cloned on flush)
   */
  scheduleUpdate(tabId: string, state: StreamingState): void {
    // Store reference to current state (we'll clone it on flush)
    this.pendingTabUpdates.set(tabId, state);

    // Schedule flush if not already scheduled
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => this.flushPendingUpdates());
    }
  }

  /**
   * PERFORMANCE OPTIMIZATION: Flush all pending tab updates
   * Called once per animation frame to batch multiple streaming events
   * into a single signal update.
   */
  private flushPendingUpdates(): void {
    this.rafId = null;

    // Process all pending updates
    for (const [tabId, state] of this.pendingTabUpdates) {
      // Create shallow copy of state to trigger signal change detection
      // This happens once per frame instead of 100+ times per frame
      this.tabManager.updateTab(tabId, {
        streamingState: { ...state },
      });
    }

    // Clear pending updates
    this.pendingTabUpdates.clear();
  }

  /**
   * Force immediate flush of pending updates
   * Use when you need the UI to update immediately (e.g., before finalization)
   */
  flushSync(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.flushPendingUpdates();
  }

  /**
   * Check if there are pending updates for a specific tab
   */
  hasPendingUpdates(tabId: string): boolean {
    return this.pendingTabUpdates.has(tabId);
  }

  /**
   * Clear pending updates for a specific tab (e.g., when tab is closed)
   */
  clearPendingUpdates(tabId: string): void {
    this.pendingTabUpdates.delete(tabId);
  }
}
