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
import { SESSION_CONTEXT } from '../tokens/session-context.token';

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
  /**
   * Present only when this instance is rendered inside a canvas tile (the tile
   * provides the tab id). Tile-mode `ChatViewComponent`s never read
   * `retainedTabIds()` (their `transcriptTabIds` computed renders exactly their
   * own tab), so a per-tile retention LRU is dead weight and its `clearForTab`
   * eviction would cross-invalidate the main panel's execution-tree cache. When
   * present the constructor stands up no effects.
   */
  private readonly _sessionContext = inject(SESSION_CONTEXT, {
    optional: true,
  });

  /** Insertion-ordered retained ids (stable for `@for` track). */
  private readonly _retainedTabIds = signal<readonly string[]>([]);
  readonly retainedTabIds: Signal<readonly string[]> =
    this._retainedTabIds.asReadonly();

  /** Monotonic recency map: tabId → last-touched tick. Drives LRU eviction. */
  private readonly _recency = new Map<string, number>();
  private _clock = 0;

  /** Last workspace-removal `seq` processed by this instance's removed-workspace
   *  effect, so each append-only emission is handled exactly once. */
  private _lastRemovedWorkspaceSeq = 0;

  constructor() {
    if (this._sessionContext) return;

    // Active-tab change → retain + refresh recency, and opportunistically prune
    // any retained id that no longer resolves. Piggybacking `disposeUnresolvable`
    // here keeps a race-proof backstop even if the append-only `removedWorkspace$`
    // emission is missed (e.g. a switch lands in the same flush before this
    // instance's removed-workspace effect first runs).
    effect(() => {
      const activeId = this._tabManager.activeTabId();
      untracked(() => {
        if (activeId) this.touch(activeId);
        this.disposeUnresolvable();
      });
    });

    // Tab closed → drop the retained transcript and its tree-memo cache. A
    // `reset` (/clear) close re-empties the tab in place — it survives, so it
    // must keep its retained slot (mirrors `orchestra-canvas.component.ts`).
    effect(() => {
      const closed = this._tabManager.closedTab();
      if (!closed || closed.kind === 'reset') return;
      untracked(() => this.dispose(closed.tabId));
    });

    // Workspace removed → prune every retained id that no longer resolves in
    // any partition. `removedWorkspace$` is append-only (never cleared), so we
    // track our own last-seen `seq` and handle each removal exactly once,
    // independent of effect-flush order across the other consumers. The
    // `activeTabId` effect above remains a backstop for the null-baseline case.
    effect(() => {
      const removed = this._tabManager.removedWorkspace$();
      if (removed && removed.seq > this._lastRemovedWorkspaceSeq) {
        this._lastRemovedWorkspaceSeq = removed.seq;
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
