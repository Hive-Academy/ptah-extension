import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  takeUntilDestroyed,
  toObservable,
  toSignal,
} from '@angular/core/rxjs-interop';
import {
  catchError,
  combineLatest,
  concatMap,
  debounceTime,
  finalize,
  from,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import {
  AlertTriangle,
  CheckCircle2,
  LucideAngularModule,
  Wrench,
} from 'lucide-angular';

import {
  AdminApiService,
  AdminListQuery,
  AdminListResponse,
} from '../../../services/admin-api.service';
import { DetailDrawer } from '../components/detail-drawer/detail-drawer';
import { EmptyState } from '../components/empty-state/empty-state';
import { SelectionToolbar } from '../components/selection-toolbar/selection-toolbar';
import { StatusBadge } from '../components/status-badge/status-badge';

/** Retry count at/above which a webhook is flagged "High retries" (§4.5). */
const HIGH_RETRY_THRESHOLD = 3;

type ResolvedFilter = 'unresolved' | 'resolved' | 'all';

/**
 * WebhooksTriage — bespoke ops-triage queue for failed webhooks (spec §4.5).
 *
 * Route: `/admin/failed-webhooks`. Leads with the "needs a human" queue by
 * defaulting to the `resolved:false` server filter (an allowlisted
 * `filterableField`), sorted `attemptedAt desc`.
 *
 * NOTE on sort: the spec's ideal `resolved asc, attemptedAt desc` compound
 * sort is not expressible through the single-`sortBy` list API. Since
 * `resolved` IS a live `filterableField`, we drive the unresolved/resolved
 * split with the filter tabs instead and sort each view by `attemptedAt desc`
 * — the visual split the spec's fallback calls for.
 *
 * Row click opens the shared `DetailDrawer` (stackTrace mono block, collapsible
 * rawPayload rendered as TEXT — never `[innerHTML]`) with Mark-Resolved + Copy.
 * Bulk resolve loops the single-record PATCH (no bulk endpoint exists), capped
 * at the page size, with a live progress toast.
 */
@Component({
  selector: 'ptah-admin-webhooks-triage',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    LucideAngularModule,
    DetailDrawer,
    EmptyState,
    SelectionToolbar,
    StatusBadge,
  ],
  templateUrl: './webhooks-triage.html',
})
export class WebhooksTriage {
  private readonly api = inject(AdminApiService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly WrenchIcon = Wrench;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly CheckCircle2Icon = CheckCircle2;

  protected readonly page = signal<number>(1);
  protected readonly pageSize = signal<number>(25);
  protected readonly search = signal<string>('');
  protected readonly resolvedFilter = signal<ResolvedFilter>('unresolved');

  /** Bumped after a (single or bulk) resolve to re-fetch the current page. */
  private readonly refreshTick = signal<number>(0);

  protected readonly loadError = signal<string | null>(null);

  /** Row currently shown in the slide-over drawer (null = closed). */
  protected readonly selected = signal<Record<string, unknown> | null>(null);
  protected readonly drawerOpen = computed<boolean>(
    () => this.selected() !== null,
  );

  /** Selected row ids for bulk resolve. */
  private readonly selectedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly selectedCount = computed<number>(
    () => this.selectedIds().size,
  );

  // --- Bulk-resolve progress ---
  protected readonly bulkRunning = signal<boolean>(false);
  protected readonly bulkTotal = signal<number>(0);
  protected readonly bulkDone = signal<number>(0);

  /** One-off single-resolve toast. */
  protected readonly resolveToast = signal<string | null>(null);

  private readonly search$ = toObservable(this.search).pipe(
    startWith(this.search()),
    debounceTime(300),
  );

  private readonly response$ = combineLatest([
    toObservable(this.page),
    toObservable(this.pageSize),
    this.search$,
    toObservable(this.resolvedFilter),
    toObservable(this.refreshTick),
  ]).pipe(
    switchMap(([page, pageSize, search, filter]) => {
      const q: AdminListQuery = {
        page,
        pageSize,
        sortBy: 'attemptedAt',
        sortOrder: 'desc',
        search: search.trim() ? search.trim() : undefined,
        filter:
          filter === 'unresolved'
            ? 'resolved:false'
            : filter === 'resolved'
              ? 'resolved:true'
              : undefined,
      };
      this.loadError.set(null);
      return this.api.list<Record<string, unknown>>('failed-webhooks', q).pipe(
        catchError((err: unknown) => {
          this.loadError.set(extractError(err));
          return of<AdminListResponse<Record<string, unknown>> | null>(null);
        }),
      );
    }),
  );

  protected readonly response = toSignal<AdminListResponse<
    Record<string, unknown>
  > | null>(this.response$, { initialValue: null });

  protected readonly loading = computed<boolean>(
    () => this.response() === null && this.loadError() === null,
  );
  protected readonly rows = computed<readonly Record<string, unknown>[]>(
    () => this.response()?.data ?? [],
  );
  protected readonly total = computed<number>(
    () => this.response()?.total ?? 0,
  );
  protected readonly totalPages = computed<number>(() => {
    const ps = Math.max(1, this.pageSize());
    return Math.max(1, Math.ceil(this.total() / ps));
  });

  protected readonly isEmpty = computed<boolean>(
    () =>
      !this.loading() && this.loadError() === null && this.rows().length === 0,
  );

  protected readonly filterTabs: readonly {
    key: ResolvedFilter;
    label: string;
  }[] = [
    { key: 'unresolved', label: 'Unresolved' },
    { key: 'resolved', label: 'Resolved' },
    { key: 'all', label: 'All' },
  ];

  protected readonly pageSizeOptions: readonly number[] = [10, 25, 50, 100];
  protected readonly skeletonRows = Array.from({ length: 8 });

  // --- Drawer content projections ---

  /** Pretty-printed rawPayload as TEXT (no `[innerHTML]`; §4.5 constraint). */
  protected readonly prettyPayload = computed<string>(() => {
    const row = this.selected();
    if (!row) return '';
    return prettyJson(row['rawPayload']);
  });

  /** Drawer header title — the event type, or a stable fallback. */
  protected readonly drawerTitle = computed<string>(() => {
    const t = this.selected()?.['eventType'];
    return typeof t === 'string' && t ? t : 'Webhook detail';
  });

  protected readonly selectedStackTrace = computed<string>(() => {
    const row = this.selected();
    const st = row?.['stackTrace'];
    return typeof st === 'string' && st.trim()
      ? st
      : 'No stack trace recorded.';
  });

  // --- Row helpers ---

  protected rowId(row: Record<string, unknown>): string {
    const id = row['id'];
    return typeof id === 'string' ? id : String(id ?? '');
  }

  protected isResolved(row: Record<string, unknown>): boolean {
    return row['resolved'] === true;
  }

  protected retryCount(row: Record<string, unknown>): number {
    const v = row['retryCount'];
    return typeof v === 'number' ? v : Number(v ?? 0);
  }

  protected isHighRetry(row: Record<string, unknown>): boolean {
    return this.retryCount(row) >= HIGH_RETRY_THRESHOLD;
  }

  protected asDate(value: unknown): string | number | Date | null {
    if (value == null) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') return value;
    return null;
  }

  protected truncate(value: unknown, max = 120): string {
    if (value == null) return '—';
    const text = String(value);
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  // --- Filter / paging ---

  protected setFilter(filter: ResolvedFilter): void {
    if (this.resolvedFilter() === filter) return;
    this.resolvedFilter.set(filter);
    this.page.set(1);
    this.clearSelection();
  }

  protected onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.search.set(target?.value ?? '');
    this.page.set(1);
  }

  protected onPageSizeChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const size = target ? Number(target.value) : this.pageSize();
    if (Number.isFinite(size) && size > 0) {
      this.pageSize.set(size);
      this.page.set(1);
    }
  }

  protected onPrev(): void {
    const next = Math.max(1, this.page() - 1);
    if (next !== this.page()) this.page.set(next);
  }

  protected onNext(): void {
    const next = Math.min(this.totalPages(), this.page() + 1);
    if (next !== this.page()) this.page.set(next);
  }

  protected retry(): void {
    this.refreshTick.update((v) => v + 1);
  }

  // --- Selection ---

  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  protected toggleRow(id: string, event: Event): void {
    event.stopPropagation();
    if (!id) return;
    const next = new Set(this.selectedIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedIds.set(next);
  }

  protected clearSelection(): void {
    if (this.selectedIds().size === 0) return;
    this.selectedIds.set(new Set());
  }

  // --- Drawer ---

  protected openDrawer(row: Record<string, unknown>): void {
    this.selected.set(row);
  }

  protected closeDrawer(): void {
    this.selected.set(null);
  }

  protected copyPayload(row: Record<string, unknown> | null): void {
    if (!row) return;
    navigator.clipboard.writeText(prettyJson(row['rawPayload']));
  }

  // --- Mutations ---

  /** Mark a single webhook resolved, stamping `resolvedAt` client-side (§4.5). */
  protected markResolved(row: Record<string, unknown> | null): void {
    if (!row) return;
    const id = this.rowId(row);
    if (!id) return;
    this.api
      .update('failed-webhooks', id, {
        resolved: true,
        resolvedAt: new Date().toISOString(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.closeDrawer();
          this.refreshTick.update((v) => v + 1);
          this.resolveToast.set('Webhook marked resolved.');
          setTimeout(() => this.resolveToast.set(null), 4000);
        },
        error: (err: unknown) => {
          this.resolveToast.set(extractError(err));
          setTimeout(() => this.resolveToast.set(null), 5000);
        },
      });
  }

  /**
   * Bulk resolve the selected rows via a sequential loop over the single-record
   * PATCH (no bulk endpoint exists), capped at the page size. Failures are
   * counted as processed so the progress bar always completes.
   */
  protected bulkResolve(): void {
    const ids = Array.from(this.selectedIds()).slice(0, this.pageSize());
    if (ids.length === 0 || this.bulkRunning()) return;

    const iso = new Date().toISOString();
    this.bulkTotal.set(ids.length);
    this.bulkDone.set(0);
    this.bulkRunning.set(true);

    from(ids)
      .pipe(
        concatMap((id) =>
          this.api
            .update('failed-webhooks', id, { resolved: true, resolvedAt: iso })
            .pipe(catchError(() => of(null))),
        ),
        finalize(() => {
          this.bulkRunning.set(false);
          this.clearSelection();
          this.refreshTick.update((v) => v + 1);
          setTimeout(() => this.bulkTotal.set(0), 4000);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => this.bulkDone.update((v) => v + 1),
      });
  }
}

/** Render an unknown payload (object or JSON string) as pretty JSON text. */
function prettyJson(value: unknown): string {
  if (value == null) return '(empty)';
  let source: unknown = value;
  if (typeof value === 'string') {
    try {
      source = JSON.parse(value);
    } catch {
      return value; // already a plain string — show verbatim
    }
  }
  try {
    return JSON.stringify(source, null, 2);
  } catch {
    return String(value);
  }
}

/** Best-effort HTTP error → message extraction. */
function extractError(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const anyErr = err as {
      error?: { message?: string | string[] };
      message?: string;
    };
    const inner = anyErr.error?.message;
    if (Array.isArray(inner)) return inner.join(', ');
    if (typeof inner === 'string') return inner;
    if (anyErr.message) return anyErr.message;
  }
  return 'Failed to load failed webhooks.';
}
