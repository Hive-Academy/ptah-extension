import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { TabManagerService, parseLaneKey } from '@ptah-extension/chat';
import { CanvasStore } from '../canvas.store';

/** State shared by the board, its cards and the single detail overlay. */
@Injectable()
export class CanvasDetailService {
  private readonly canvasStore = inject(CanvasStore);
  private readonly tabManager = inject(TabManagerService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly _detailTabId = signal<string | null>(null);
  private readonly _laneKeys = signal<ReadonlyMap<string, string>>(new Map());
  private listeningForClose = false;

  readonly detailTabId = this._detailTabId.asReadonly();
  readonly laneKey = computed(() => this.laneKeyFor(this.detailTabId() ?? ''));

  laneKeyFor(tabId: string): string {
    return this._laneKeys().get(tabId) ?? 'orchestrator';
  }

  selectLaneFor(tabId: string, key: string): void {
    if (!this.canvasStore.tiles().some((tile) => tile.tabId === tabId)) return;
    if (key !== 'orchestrator' && !parseLaneKey(key)) return;
    if (this.laneKeyFor(tabId) === key) return;
    if (!this.listeningForClose) {
      this.listeningForClose = true;
      const unsubscribe = this.tabManager.onTabClosed((closed) => {
        if (!closed || closed.kind === 'reset') return;
        this._laneKeys.update((current) => {
          if (!current.has(closed.tabId)) return current;
          const next = new Map(current);
          next.delete(closed.tabId);
          return next;
        });
      });
      this.destroyRef.onDestroy(unsubscribe);
    }
    this._laneKeys.update((current) => new Map(current).set(tabId, key));
  }

  open(tabId: string, laneKey = 'orchestrator'): void {
    if (!this.canvasStore.tiles().some((tile) => tile.tabId === tabId)) return;
    if (laneKey !== 'orchestrator' && !parseLaneKey(laneKey)) return;
    this.canvasStore.focusTile(tabId);
    this.selectLaneFor(tabId, laneKey);
    if (this.canvasStore.boardFor(this.canvasStore.activeWorkspacePath() ?? '').mode === 'grid')
      this._detailTabId.set(tabId);
  }

  toggle(tabId: string, laneKey?: string): void {
    if (
      this._detailTabId() === tabId &&
      (laneKey === undefined || this.laneKeyFor(tabId) === laneKey)
    ) {
      this.close();
    } else {
      this.open(tabId, laneKey ?? 'orchestrator');
    }
  }

  selectLane(laneKey: string): void {
    const tabId = this._detailTabId();
    if (tabId) this.open(tabId, laneKey);
  }

  close(): void {
    this._detailTabId.set(null);
  }

  next(): void {
    this.step(1);
  }

  prev(): void {
    this.step(-1);
  }

  private step(direction: 1 | -1): void {
    const current = this._detailTabId();
    if (!current) return;
    const ids = [...this.canvasStore.tiles()]
      .sort((a, b) => a.order - b.order)
      .map((tile) => tile.tabId);
    const index = ids.indexOf(current);
    if (index < 0 || ids.length === 0) {
      this.close();
      return;
    }
    this.open(ids[(index + direction + ids.length) % ids.length]);
  }
}
