import { Injectable, inject, signal } from '@angular/core';
import { parseLaneKey } from '@ptah-extension/chat';
import { CanvasStore } from '../canvas.store';

/** State shared by the board, its cards and the single detail overlay. */
@Injectable()
export class CanvasDetailService {
  private readonly canvasStore = inject(CanvasStore);
  private readonly _detailTabId = signal<string | null>(null);
  private readonly _laneKey = signal('orchestrator');

  readonly detailTabId = this._detailTabId.asReadonly();
  readonly laneKey = this._laneKey.asReadonly();

  open(tabId: string, laneKey = 'orchestrator'): void {
    if (!this.canvasStore.tiles().some((tile) => tile.tabId === tabId)) return;
    if (laneKey !== 'orchestrator' && !parseLaneKey(laneKey)) return;
    this.canvasStore.focusTile(tabId);
    this._detailTabId.set(tabId);
    this._laneKey.set(laneKey);
  }

  toggle(tabId: string, laneKey?: string): void {
    if (
      this._detailTabId() === tabId &&
      (laneKey === undefined || this._laneKey() === laneKey)
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
    this._laneKey.set('orchestrator');
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
