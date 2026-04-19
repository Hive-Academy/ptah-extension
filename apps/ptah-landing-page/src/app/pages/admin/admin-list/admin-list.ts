import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { combineLatest, debounceTime, of, startWith, switchMap } from 'rxjs';

import {
  AdminApiService,
  AdminBulkEmailResponse,
  AdminListQuery,
  AdminListResponse,
  AdminModelKey,
} from '../../../services/admin-api.service';
import { ADMIN_MODEL_SPECS, AdminModelSpec } from '../admin-models.config';
import { BulkEmailModal } from '../components/bulk-email-modal/bulk-email-modal';
import {
  DataTable,
  DataTablePageEvent,
  DataTableSortEvent,
} from '../components/data-table/data-table';

/**
 * AdminList — generic list page for any admin model.
 *
 * Route: `/admin/:model`. Reads the `:model` param reactively, pairs it with
 * an internal query signal (page/pageSize/sortBy/sortOrder/search), and
 * pipes through `AdminApiService.list` with a 300ms debounce on the search
 * box.
 *
 * Bulk-email hook: when the model's `AdminModelSpec.supportsBulkEmail === true`
 * the list renders the "Email Selected" button, tracks selection via the
 * DataTable, and emits `bulkEmailRequested(userIds)`. The modal itself is
 * created in Batch 5 — this component just exposes the hook.
 */
@Component({
  selector: 'ptah-admin-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DataTable, BulkEmailModal],
  templateUrl: './admin-list.html',
  styleUrls: ['./admin-list.css'],
})
export class AdminList {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(AdminApiService);

  private readonly table = viewChild<DataTable>('table');

  // --- Route-driven model signal -------------------------------------------

  /** The `:model` route param as a signal. May be null on transient states. */
  protected readonly model = toSignal(this.route.paramMap, {
    initialValue: null,
  });

  /** Resolved UI spec for the current model, or undefined for unknown slugs. */
  protected readonly spec = computed<AdminModelSpec | undefined>(() => {
    const paramMap = this.model();
    const key = paramMap?.get('model') ?? null;
    if (!key) return undefined;
    return ADMIN_MODEL_SPECS.find((s) => s.key === key);
  });

  /** Narrowed `AdminModelKey` — undefined when the slug is invalid. */
  protected readonly modelKey = computed<AdminModelKey | undefined>(() => {
    const s = this.spec();
    return s ? (s.key as AdminModelKey) : undefined;
  });

  // --- Mutable query state -------------------------------------------------

  protected readonly page = signal<number>(1);
  protected readonly pageSize = signal<number>(25);
  protected readonly sortBy = signal<string | undefined>(undefined);
  protected readonly sortOrder = signal<'asc' | 'desc'>('desc');

  /** Raw search input (not debounced — the stream debounces it). */
  protected readonly search = signal<string>('');

  /** Tracks the bulk-email selection for models with `supportsBulkEmail`. */
  protected readonly selectedIds = signal<readonly string[]>([]);

  /** Whether the bulk-email modal is open. */
  protected readonly bulkEmailOpen = signal<boolean>(false);

  /** Most recent bulk-email result — drives the success toast. */
  protected readonly bulkEmailToast = signal<AdminBulkEmailResponse | null>(
    null,
  );

  /** Debounced search observable for use inside the list fetch chain. */
  private readonly search$ = toObservable(this.search).pipe(
    startWith(this.search()),
    debounceTime(300),
  );

  /** Streams model + page + pageSize + sort + search → list API call. */
  private readonly response$ = combineLatest([
    toObservable(this.modelKey),
    toObservable(this.page),
    toObservable(this.pageSize),
    toObservable(this.sortBy),
    toObservable(this.sortOrder),
    this.search$,
  ]).pipe(
    switchMap(([key, page, pageSize, sortBy, sortOrder, search]) => {
      if (!key) return of<AdminListResponse | null>(null);
      const q: AdminListQuery = {
        page,
        pageSize,
        sortBy,
        sortOrder,
        search: search.trim() ? search.trim() : undefined,
      };
      return this.api.list(key, q);
    }),
  );

  protected readonly response = toSignal<AdminListResponse | null>(
    this.response$,
    { initialValue: null },
  );

  protected readonly rows = computed<readonly unknown[]>(
    () => this.response()?.data ?? [],
  );

  protected readonly total = computed<number>(
    () => this.response()?.total ?? 0,
  );

  public constructor() {
    // Reset query + selection when the route model changes so we never show
    // stale page-3 data or carry selections across models.
    effect(() => {
      // Reading `modelKey()` subscribes us to its changes.
      this.modelKey();
      this.page.set(1);
      this.sortBy.set(undefined);
      this.sortOrder.set('desc');
      this.search.set('');
      this.selectedIds.set([]);
      this.bulkEmailOpen.set(false);
      this.bulkEmailToast.set(null);
      this.table()?.clearSelection();
    });
  }

  // --- DataTable event handlers --------------------------------------------

  protected onSortChange(e: DataTableSortEvent): void {
    this.sortBy.set(e.sortBy);
    this.sortOrder.set(e.sortOrder);
    this.page.set(1);
  }

  protected onPageChange(e: DataTablePageEvent): void {
    this.page.set(e.page);
    this.pageSize.set(e.pageSize);
  }

  protected onRowClick(id: string): void {
    const key = this.modelKey();
    if (!key || !id) return;
    this.router.navigate(['/admin', key, id]);
  }

  protected onSelectionChange(ids: readonly string[]): void {
    this.selectedIds.set(ids);
  }

  protected onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.search.set(target?.value ?? '');
    this.page.set(1);
  }

  /**
   * Hook for the "Email Selected" button. Opens the bulk-email modal
   * with the currently selected user IDs.
   */
  protected onBulkEmailClick(): void {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    this.bulkEmailToast.set(null);
    this.bulkEmailOpen.set(true);
  }

  /** User dismissed the modal (X / Cancel / backdrop). */
  protected onBulkEmailClose(): void {
    this.bulkEmailOpen.set(false);
  }

  /**
   * Modal reported a successful bulk send. Show a toast, clear the table
   * selection, and close the modal after a short delay so the user sees
   * the success summary first.
   */
  protected onBulkEmailSent(result: AdminBulkEmailResponse): void {
    this.bulkEmailToast.set(result);
    this.selectedIds.set([]);
    this.table()?.clearSelection();
    setTimeout(() => {
      this.bulkEmailOpen.set(false);
    }, 1200);
    setTimeout(() => {
      // Dismiss the toast after it has been visible for a few seconds.
      if (this.bulkEmailToast() === result) {
        this.bulkEmailToast.set(null);
      }
    }, 6000);
  }
}
