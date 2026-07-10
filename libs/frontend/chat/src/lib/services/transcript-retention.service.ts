import {
  Injectable,
  Signal,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';

/**
 * Hard bound on the number of retained (hidden-but-alive) transcript DOM trees
 * kept mounted at once. Beyond this cap the least-recently-active non-active tab
 * is disposed. Single constant so profiling can dial it down without touching
 * the eviction logic.
 */
export const RETAINED_TRANSCRIPT_CAP = 8;

/**
 * TranscriptRetentionService — component-scoped LRU registry of tab ids whose
 * transcript should stay mounted (keep-alive) even when not the active tab.
 *
 * Provided in `ChatViewComponent`'s `providers` (NOT `providedIn: 'root'`) so
 * each main-panel instance owns its own retention window, mirroring the
 * component-scoped `CanvasStore` precedent.
 *
 * The exposed `retainedTabIds` array keeps INSERTION order (never reordered on
 * recency touches) so the parent's `@for (tabId of retainedTabIds(); track
 * tabId)` never moves a live DOM node — recency only drives eviction, tracked
 * in a separate monotonic-counter map.
 */
@Injectable()
export class TranscriptRetentionService {
  private readonly _tabManager = inject(TabManagerService);
  private readonly _treeBuilder = inject(ExecutionTreeBuilderService);

  /** Insertion-ordered retained ids (stable for `@for` track). */
  private readonly _retainedTabIds = signal<readonly string[]>([]);
  readonly retainedTabIds: Signal<readonly string[]> =
    this._retainedTabIds.asReadonly();

  /** Monotonic recency map: tabId → last-touched tick. Drives LRU eviction. */
  private readonly _recency = new Map<string, number>();
  private _clock = 0;

  constructor() {
    // Active-tab change → retain + refresh recency.
    effect(() => {
      const activeId = this._tabManager.activeTabId();
      if (activeId) {
        untracked(() => this.touch(activeId));
      }
    });

    // Tab closed → drop the retained transcript and its tree-memo cache.
    effect(() => {
      const closed = this._tabManager.closedTab();
      if (closed) {
        untracked(() => this.dispose(closed.tabId));
      }
    });

    // Workspace removed → drop every retained id that no longer resolves in any
    // partition (the removed workspace's tabs are gone from the store).
    effect(() => {
      const removed = this._tabManager.removedWorkspace$();
      if (removed) {
        untracked(() => this.disposeUnresolvable());
      }
    });
  }

  /**
   * Retain `tabId` (or refresh its recency if already retained) and evict the
   * least-recently-active non-active tab once the cap is exceeded. The touched
   * (active) tab is never evicted.
   */
  touch(tabId: string): void {
    this._recency.set(tabId, ++this._clock);
    const current = this._retainedTabIds();
    if (!current.includes(tabId)) {
      this._retainedTabIds.set([...current, tabId]);
    }
    this.evictOverCap(tabId);
  }

  /**
   * Drop `tabId` from the retained set and clear its execution-tree memo cache
   * so the builder's `tab-${tabId}` entry doesn't leak after the DOM is gone.
   */
  dispose(tabId: string): void {
    this._recency.delete(tabId);
    const current = this._retainedTabIds();
    if (current.includes(tabId)) {
      this._retainedTabIds.set(current.filter((id) => id !== tabId));
    }
    this._treeBuilder.clearForTab(tabId);
  }

  private evictOverCap(activeTabId: string): void {
    while (this._retainedTabIds().length > RETAINED_TRANSCRIPT_CAP) {
      let lruId: string | null = null;
      let lruTick = Number.POSITIVE_INFINITY;
      for (const id of this._retainedTabIds()) {
        if (id === activeTabId) continue;
        const tick = this._recency.get(id) ?? 0;
        if (tick < lruTick) {
          lruTick = tick;
          lruId = id;
        }
      }
      if (lruId === null) break;
      this.dispose(lruId);
    }
  }

  private disposeUnresolvable(): void {
    for (const id of [...this._retainedTabIds()]) {
      if (!this._tabManager.findTabByIdAcrossWorkspaces(id)) {
        this.dispose(id);
      }
    }
  }
}
