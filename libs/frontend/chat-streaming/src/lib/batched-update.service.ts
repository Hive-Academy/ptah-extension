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
import { SURFACE_ACTIVE } from '@ptah-extension/core';

@Injectable({ providedIn: 'root' })
export class BatchedUpdateService {
  private readonly tabManager = inject(TabManagerService);
  private readonly destroyRef = inject(DestroyRef);
  // Root-scoped ingestion serves BOTH chat layouts. The app-level provider
  // reports whether the shared chat address is active; element providers are
  // deliberately narrower for the individual rendered trees.
  // Non-optional on purpose. This library is `scope:webview`, so the only host
  // is the webview, which binds the token at the composition root. An optional
  // inject would fall back to "always active" and silently never defer a flush
  // — the gate would be dead with no error and no failing test.
  private readonly surfaceActive = inject(SURFACE_ACTIVE);

  private pendingTabUpdates = new Map<string, StreamingState>();
  private deferredTabUpdates = new Map<string, StreamingState>();
  private pendingFlush = new Set<string>();
  private rafId: number | null = null;
  private frameGeneration = 0;
  private visibilityListener: (() => void) | null = null;

  constructor() {
    effect(() => {
      const active = this.surfaceActive();
      untracked(() => {
        if (!active) {
          this.frameGeneration++;
          if (this.rafId !== null) cancelAnimationFrame(this.rafId);
          this.rafId = null;
          for (const [tabId, state] of this.pendingTabUpdates) {
            // Newest state wins, matching `scheduleUpdate`'s own deferral at
            // the top of this class. The previous `if (!has(tabId))` guard
            // meant the opposite — keep the OLDER entry, discard this one —
            // and `StreamingState` is a whole snapshot rather than a delta, so
            // that is content loss, not a slightly stale frame.
            //
            // The two maps look mutually exclusive today (`shouldDefer` is
            // `!canFlush`, so a non-flushable tab never enters
            // `pendingTabUpdates`, and `drainDeferred` removes a tab from
            // `deferredTabUpdates` as soon as it can flush), so no reachable
            // sequence was found where the guard actually bit. It is corrected
            // anyway: the invariant is cheap to state, it cannot regress
            // behaviour, and it stops the next change to `canFlush` turning a
            // latent inconsistency into silent data loss.
            this.deferredTabUpdates.set(tabId, state);
            this.pendingFlush.add(tabId);
          }
          this.pendingTabUpdates.clear();
        } else {
          this.drainDeferred();
        }
      });
    });
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
      this.frameGeneration++;
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
      this.pendingTabUpdates.delete(tabId);
      this.deferredTabUpdates.set(tabId, state);
      this.pendingFlush.add(tabId);
      return;
    }
    this.deferredTabUpdates.delete(tabId);
    this.pendingFlush.delete(tabId);
    this.pendingTabUpdates.set(tabId, state);
    if (this.rafId === null) {
      this.scheduleFrame();
    }
  }

  private shouldDefer(tabId: string): boolean {
    return !this.canFlush(tabId);
  }

  private scheduleFrame(): void {
    const generation = ++this.frameGeneration;
    this.rafId = requestAnimationFrame(() => {
      if (generation !== this.frameGeneration) return;
      this.flushPendingUpdates();
    });
  }

  /**
   * Whether ANY tab on this surface could be observed right now.
   *
   * Split out from `canFlush` because the two halves of that predicate are not
   * equally waivable. This half means "nobody can see anything" — the surface
   * is not the addressed one, or the window is minimized. The other half is a
   * per-tab selection, and that is the only part a tab's own event may waive.
   */
  private surfaceObservable(): boolean {
    if (!this.surfaceActive()) return false;
    return !(
      typeof document !== 'undefined' && document.visibilityState === 'hidden'
    );
  }

  /**
   * A tab may flush when the document is visible AND the tab is on-screen:
   * present in the visible set (Orchestra Canvas tiles) or — when no tile has
   * registered (single-tab webview) — the active tab.
   */
  private canFlush(tabId: string): boolean {
    if (!this.surfaceObservable()) return false;
    const visible = this.tabManager.visibleTabIds();
    if (visible.size > 0) return visible.has(tabId);
    const activeId = this.tabManager.activeTabId();
    return !activeId || activeId === tabId;
  }

  private flushPendingUpdates(force = false): void {
    this.rafId = null;
    for (const [tabId, state] of this.pendingTabUpdates) {
      if (!force && !this.canFlush(tabId)) {
        this.deferredTabUpdates.set(tabId, state);
        this.pendingFlush.add(tabId);
        continue;
      }
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
      this.scheduleFrame();
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
      this.scheduleFrame();
    }
  }

  /**
   * Force the queued updates out to `TabManager` in this tick.
   *
   * Two distinct callers, two distinct contracts:
   *
   * - **With `originTabId`** (per-event, hot): the ORIGIN tab escapes the
   *   per-tab selection ONLY, never `surfaceObservable`. Every other tab
   *   (deferred, or pending but since inactivated/hidden) is kept or moved to
   *   deferred and drains through the normal `visibilitychange` / active-tab /
   *   visible-set paths. `agent_start` raises `agentStartFlushNeeded` on EVERY
   *   agent spawn, so the un-gated version made one hidden tab's agent spawn
   *   flush all three sessions' deferred trees — the gate at `canFlush` exists
   *   precisely to stop that work, and this call was the hole in it.
   *
   *   The origin's exemption is deliberately narrow. It exists so a tab that
   *   is streaming in the background is not starved by the active-tab rule —
   *   a per-tab concern. It is NOT a licence to publish into a surface nobody
   *   is looking at: with the surface unaddressed or the window minimized,
   *   forcing the origin through still pays for the execution-tree rebuild and
   *   markdown re-derive in the downstream computed signals, which is the
   *   entire cost this gate exists to avoid. So the origin waives the tab
   *   selection and nothing above it, and drains on reactivation instead.
   *
   * - **Without `originTabId`** (turn-end finalization): full drain, as before.
   *   `MessageFinalizationService` calls this immediately before it promotes
   *   the reply into `messages` and clears the tab's streaming state. A
   *   deferred entry left behind here holds the PRE-clear state object, so a
   *   later drain would re-install a finished turn's streaming content over
   *   the finalized message. Finalization is once per turn, not per event, so
   *   draining everything there costs nothing measurable.
   */
  /**
   * Whether a per-event `flushSync` may push this tab out in this tick. The
   * origin waives the per-tab selection; every tab, origin included, still
   * has to clear `surfaceObservable`.
   */
  private mayForce(tabId: string, originTabId: string): boolean {
    return tabId === originTabId
      ? this.surfaceObservable()
      : this.canFlush(tabId);
  }

  flushSync(originTabId?: string): void {
    this.frameGeneration++;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.deferredTabUpdates.size > 0) {
      for (const [tabId, state] of [...this.deferredTabUpdates]) {
        if (originTabId !== undefined && !this.mayForce(tabId, originTabId)) {
          continue;
        }
        this.pendingTabUpdates.set(tabId, state);
        this.deferredTabUpdates.delete(tabId);
        this.pendingFlush.delete(tabId);
      }
    }
    if (originTabId !== undefined) {
      for (const [tabId, state] of [...this.pendingTabUpdates]) {
        if (this.mayForce(tabId, originTabId)) continue;
        this.pendingTabUpdates.delete(tabId);
        this.deferredTabUpdates.set(tabId, state);
        this.pendingFlush.add(tabId);
      }
    }
    this.flushPendingUpdates(true);
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
