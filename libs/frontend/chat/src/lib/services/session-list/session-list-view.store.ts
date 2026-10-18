import { Injectable, computed, inject, signal } from '@angular/core';
import { ChatStore } from '../chat.store';
import type { SessionListQuery } from '../chat-store/session-loader.service';

/**
 * Query view state of the previous-sessions list (TASK_2026_679).
 *
 * Root-scoped so the search text, the date range and the date panel survive
 * the modal closing and reopening (Req 2.9). Reading this state never asks
 * the host for a new page: only {@link setListQuery} and a {@link clearFilters}
 * that drops server filters do. Grouping depends on component-layer labels
 * and stays in the modal.
 */
@Injectable({ providedIn: 'root' })
export class SessionListViewStore {
  private readonly chatStore = inject(ChatStore);

  private readonly _searchQuery = signal('');
  private readonly _dateFrom = signal('');
  private readonly _dateTo = signal('');
  private readonly _dateFilterOpen = signal(false);

  readonly searchQuery = this._searchQuery.asReadonly();
  /** Inclusive start day, `YYYY-MM-DD` (date input value), or empty. */
  readonly dateFrom = this._dateFrom.asReadonly();
  /** Inclusive end day, `YYYY-MM-DD` (date input value), or empty. */
  readonly dateTo = this._dateTo.asReadonly();
  readonly dateFilterOpen = this._dateFilterOpen.asReadonly();

  /**
   * Whether the host serves session organization (TASK_2026_580). When false
   * (VS Code) the search text filters the loaded rows here.
   */
  readonly organizationAvailable = this.chatStore.organizationAvailable;
  /** The query the server answers; the filter bar's seed. */
  readonly listQuery = this.chatStore.listQuery;

  /** Filters applied here, over the loaded pages. */
  readonly hasClientFilters = computed(() => {
    const dateActive = this._dateFrom().length > 0 || this._dateTo().length > 0;
    // With organization the search text goes to the server instead.
    return this.organizationAvailable()
      ? dateActive
      : dateActive || this._searchQuery().length > 0;
  });

  /** Filters the server applied to the rows (organization hosts only). */
  readonly hasServerFilters = computed(() => {
    if (!this.organizationAvailable()) return false;
    const q = this.listQuery();
    return (
      (q.status?.length ?? 0) > 0 ||
      (q.priority?.length ?? 0) > 0 ||
      !!q.taskId ||
      q.pinned !== undefined ||
      q.hasPr !== undefined ||
      !!q.text
    );
  });

  readonly hasActiveFilters = computed(
    () => this.hasClientFilters() || this.hasServerFilters(),
  );

  /** The loaded rows after the client filters (name text without organization, date range). */
  readonly filteredSessions = computed(() => {
    const sessions = this.chatStore.sessions();
    const query = this.organizationAvailable()
      ? ''
      : this._searchQuery().toLowerCase().trim();
    const fromStr = this._dateFrom();
    const toStr = this._dateTo();

    if (!query && !fromStr && !toStr) {
      return sessions;
    }
    let fromMs = 0;
    let toMs = 0;
    if (fromStr) {
      const [y, m, d] = fromStr.split('-').map(Number);
      fromMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    }
    if (toStr) {
      const [y, m, d] = toStr.split('-').map(Number);
      toMs = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    }

    return sessions.filter((session) => {
      if (query && !(session.name || '').toLowerCase().includes(query)) {
        return false;
      }
      if (fromMs && session.lastActivityAt < fromMs) {
        return false;
      }
      if (toMs && session.lastActivityAt > toMs) {
        return false;
      }

      return true;
    });
  });

  setSearchQuery(value: string): void {
    this._searchQuery.set(value);
  }

  setDateFrom(value: string): void {
    this._dateFrom.set(value);
  }

  setDateTo(value: string): void {
    this._dateTo.set(value);
  }

  toggleDateFilter(): void {
    this._dateFilterOpen.update((open) => !open);
  }

  /** The filter bar settled on a new query; the server answers it. */
  setListQuery(query: SessionListQuery): void {
    this.chatStore.setListQuery(query);
  }

  /**
   * Clear every search and filter input and close the date panel. The chosen
   * sort and grouping are a view preference and are kept; the host is asked
   * for a new page only when server filters were active.
   */
  clearFilters(): void {
    this._searchQuery.set('');
    this._dateFrom.set('');
    this._dateTo.set('');
    this._dateFilterOpen.set(false);
    if (this.hasServerFilters()) {
      const { sort, groupBy } = this.listQuery();
      this.chatStore.setListQuery({
        sort,
        ...(groupBy !== undefined ? { groupBy } : {}),
      });
    }
  }
}
