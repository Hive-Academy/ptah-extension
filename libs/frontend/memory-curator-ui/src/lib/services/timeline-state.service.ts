import { Injectable, computed, inject, signal } from '@angular/core';
import { AppStateManager } from '@ptah-extension/core';
import type {
  MemoryIndexRow,
  MemSearchIndexDateRange,
  MemSearchIndexParams,
  MemoryTypeWire,
} from '@ptah-extension/shared';

import { MemoryRpcService } from './memory-rpc.service';

/**
 * TimelineStateService
 *
 * Signal-based state container scoped to the Memory tab's Timeline view.
 *
 * Owns:
 *   - Filter signals: `query`, `typeFilter`, `conceptFilter`, `fileFilter`,
 *     `dateRange`, `anchorId`.
 *   - Result signals: `rows`, `bm25Only`, `loading`, `error`.
 *   - Paging signal: `topK` (effective ceiling on the next searchIndex call;
 *     infinite-scroll grows this by `PAGE_SIZE` until the backend returns
 *     fewer rows than requested).
 *
 * Side effects go through {@link MemoryRpcService}. The service itself is
 * pure UI state — components subscribe via the readonly signals.
 */
export const TIMELINE_PAGE_SIZE = 50;

@Injectable({ providedIn: 'root' })
export class TimelineStateService {
  private readonly rpc = inject(MemoryRpcService);
  private readonly appState = inject(AppStateManager);

  private readonly _query = signal<string>('');
  private readonly _typeFilter = signal<readonly MemoryTypeWire[]>([]);
  private readonly _conceptFilter = signal<readonly string[]>([]);
  private readonly _fileFilter = signal<readonly string[]>([]);
  private readonly _dateRange = signal<MemSearchIndexDateRange | null>(null);
  private readonly _anchorId = signal<string | null>(null);

  private readonly _rows = signal<readonly MemoryIndexRow[]>([]);
  private readonly _bm25Only = signal<boolean>(false);
  private readonly _topK = signal<number>(TIMELINE_PAGE_SIZE);
  private readonly _exhausted = signal<boolean>(false);
  private readonly _loading = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  public readonly query = this._query.asReadonly();
  public readonly typeFilter = this._typeFilter.asReadonly();
  public readonly conceptFilter = this._conceptFilter.asReadonly();
  public readonly fileFilter = this._fileFilter.asReadonly();
  public readonly dateRange = this._dateRange.asReadonly();
  public readonly anchorId = this._anchorId.asReadonly();
  public readonly rows = this._rows.asReadonly();
  public readonly bm25Only = this._bm25Only.asReadonly();
  public readonly topK = this._topK.asReadonly();
  public readonly exhausted = this._exhausted.asReadonly();
  public readonly loading = this._loading.asReadonly();
  public readonly error = this._error.asReadonly();

  public readonly hasActiveFilters = computed<boolean>(() => {
    return (
      this._query().trim().length > 0 ||
      this._typeFilter().length > 0 ||
      this._conceptFilter().length > 0 ||
      this._fileFilter().length > 0 ||
      this._dateRange() !== null
    );
  });

  public setQuery(value: string): void {
    this._query.set(value);
  }

  public setTypeFilter(value: readonly MemoryTypeWire[]): void {
    this._typeFilter.set(value);
  }

  public toggleType(value: MemoryTypeWire): void {
    const current = this._typeFilter();
    this._typeFilter.set(
      current.includes(value)
        ? current.filter((t) => t !== value)
        : [...current, value],
    );
  }

  public setConceptFilter(value: readonly string[]): void {
    this._conceptFilter.set(value);
  }

  public setFileFilter(value: readonly string[]): void {
    this._fileFilter.set(value);
  }

  public setDateRange(value: MemSearchIndexDateRange | null): void {
    this._dateRange.set(value);
  }

  public setAnchorId(value: string | null): void {
    this._anchorId.set(value);
  }

  public reset(): void {
    this._query.set('');
    this._typeFilter.set([]);
    this._conceptFilter.set([]);
    this._fileFilter.set([]);
    this._dateRange.set(null);
    this._anchorId.set(null);
    this._rows.set([]);
    this._topK.set(TIMELINE_PAGE_SIZE);
    this._exhausted.set(false);
    this._error.set(null);
  }

  /** Run `mem:searchIndex` with the current filter blob; replaces `rows`. */
  public async search(): Promise<void> {
    this._topK.set(TIMELINE_PAGE_SIZE);
    this._exhausted.set(false);
    await this.runSearch(TIMELINE_PAGE_SIZE);
  }

  /** Grow the result window by `TIMELINE_PAGE_SIZE` (infinite scroll). */
  public async loadMore(): Promise<void> {
    if (this._loading() || this._exhausted()) {
      return;
    }
    const next = this._topK() + TIMELINE_PAGE_SIZE;
    this._topK.set(next);
    await this.runSearch(next);
  }

  /**
   * Drill down on a single row via `mem:timeline`. Replaces `rows` with the
   * neighbour window and marks the row as the active anchor.
   */
  public async drillToTimeline(anchorId: string): Promise<void> {
    this._anchorId.set(anchorId);
    this._loading.set(true);
    this._error.set(null);
    try {
      const workspaceRoot = this.getWorkspaceRoot();
      const result = await this.rpc.timeline({
        anchorId,
        before: 5,
        after: 5,
        ...(workspaceRoot !== null ? { workspaceRoot } : {}),
      });
      this._rows.set(result.rows);
      this._exhausted.set(true);
    } catch (err) {
      this._error.set(toErrorMessage(err));
    } finally {
      this._loading.set(false);
    }
  }

  private async runSearch(topK: number): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const params = this.buildParams(topK);
      const result = await this.rpc.searchIndex(params);
      this._rows.set(result.rows);
      this._bm25Only.set(result.bm25Only);
      this._exhausted.set(result.rows.length < topK);
    } catch (err) {
      this._error.set(toErrorMessage(err));
    } finally {
      this._loading.set(false);
    }
  }

  private buildParams(topK: number): MemSearchIndexParams {
    const workspaceRoot = this.getWorkspaceRoot();
    const query = this._query().trim();
    const type = this._typeFilter();
    const concepts = this._conceptFilter();
    const files = this._fileFilter();
    const dateRange = this._dateRange();
    return {
      topK,
      ...(workspaceRoot !== null ? { workspaceRoot } : {}),
      ...(query.length > 0 ? { query } : {}),
      ...(type.length > 0 ? { type } : {}),
      ...(concepts.length > 0 ? { concepts } : {}),
      ...(files.length > 0 ? { files } : {}),
      ...(dateRange !== null ? { dateRange } : {}),
    };
  }

  private getWorkspaceRoot(): string | null {
    return this.appState.workspaceInfo()?.path ?? null;
  }
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown timeline error';
}
