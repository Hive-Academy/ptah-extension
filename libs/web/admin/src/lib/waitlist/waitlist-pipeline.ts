import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  signal,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  catchError,
  combineLatest,
  debounceTime,
  map,
  of,
  Subject,
  Subscription,
  switchMap,
} from 'rxjs';
import {
  BadgeCheck,
  Download,
  Inbox,
  KeyRound,
  LucideAngularModule,
  MailCheck,
  PartyPopper,
  Sparkles,
} from 'lucide-angular';

import {
  AdminApiService,
  AdminApproveWaitlistResponse,
  AdminStatsResponse,
} from '../services/admin-api.service';
import { ApproveWaitlistModal } from '../components/approve-waitlist-modal/approve-waitlist-modal';
import { EmptyState, SelectionToolbar } from '@ptah-web/panel-ui';

import { WaitlistDetailsDrawer } from './waitlist-details-drawer';
import { WaitlistFilterBar } from './waitlist-filter-bar';
import {
  defaultSortOrder,
  needsWaitlistQueryCanonicalization,
  parseWaitlistQuery,
  serializeWaitlistQuery,
  SortOrder,
  WaitlistFilterQuery,
  WaitlistListQuery,
  WaitlistListResponse,
  WaitlistListRow,
  WaitlistPageSize,
  WaitlistSortField,
  WaitlistSource,
  WaitlistStage,
  WaitlistStageCounts,
} from './waitlist-query-state';
import { WaitlistRowComponent } from './waitlist-row';
import { WaitlistSelectionState } from './waitlist-selection.state';

type ListStreamResult =
  | { status: 'success'; data: WaitlistListResponse }
  | { status: 'invalid_date'; message: string }
  | { status: 'error' };

const EXPORT_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  WAITLIST_EXPORT_LIMIT_EXCEEDED:
    'This export is too large. Narrow the filters and try again.',
  WAITLIST_EXPORT_UNAVAILABLE:
    'Waitlist export is temporarily unavailable. Please try again.',
  WAITLIST_EXPORT_AUDIT_FAILED:
    'Waitlist export is temporarily unavailable. Please try again.',
};

function extractApiErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const shaped = err as {
    code?: unknown;
    error?: { code?: unknown };
  };
  if (typeof shaped.error?.code === 'string') return shaped.error.code;
  return typeof shaped.code === 'string' ? shaped.code : null;
}

function mapExportError(err: unknown): string {
  const fallback = 'Failed to export waitlist CSV. Please try again.';
  const code = extractApiErrorCode(err);
  return code ? (EXPORT_ERROR_MESSAGES[code] ?? fallback) : fallback;
}

function isInvalidDateRangeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    status?: number;
    error?: { code?: string; message?: string };
    message?: string;
  };
  if (e.status === 400) {
    if (e.error?.code === 'INVALID_DATE_RANGE') return true;
    if (
      typeof e.error?.message === 'string' &&
      e.error.message.includes('INVALID_DATE_RANGE')
    ) {
      return true;
    }
    if (
      typeof e.message === 'string' &&
      e.message.includes('INVALID_DATE_RANGE')
    ) {
      return true;
    }
  }
  return false;
}

function extractDateErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { error?: { message?: string }; message?: string };
    if (
      typeof e.error?.message === 'string' &&
      e.error.message !== 'INVALID_DATE_RANGE'
    ) {
      return e.error.message;
    }
  }
  return 'createdFrom must be before or equal to createdTo';
}

@Component({
  selector: 'ptah-admin-waitlist-pipeline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [WaitlistSelectionState],
  imports: [
    LucideAngularModule,
    EmptyState,
    SelectionToolbar,
    ApproveWaitlistModal,
    WaitlistFilterBar,
    WaitlistRowComponent,
    WaitlistDetailsDrawer,
  ],
  templateUrl: './waitlist-pipeline.html',
})
export class WaitlistPipeline implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(AdminApiService);
  public readonly selection = inject(WaitlistSelectionState);

  // --- Icons ---
  protected readonly KeyRoundIcon = KeyRound;
  protected readonly PartyPopperIcon = PartyPopper;
  protected readonly MailCheckIcon = MailCheck;
  protected readonly BadgeCheckIcon = BadgeCheck;
  protected readonly SparklesIcon = Sparkles;
  protected readonly InboxIcon = Inbox;
  protected readonly DownloadIcon = Download;

  // --- Search debouncer ---
  private readonly searchInput$ = new Subject<string>();
  private matchingSelectionSubscription: Subscription | null = null;

  // --- State signals derived from URL ---
  private readonly rawQueryParams = toSignal(this.route.queryParams, {
    initialValue: this.route.snapshot.queryParams,
  });

  protected readonly currentQuery = toSignal(
    this.route.queryParamMap.pipe(map((params) => parseWaitlistQuery(params))),
    { initialValue: parseWaitlistQuery({}) },
  );

  protected readonly stage = computed<WaitlistStage>(
    () => this.currentQuery().stage ?? 'new',
  );
  protected readonly search = computed<string>(
    () => this.currentQuery().search ?? '',
  );
  protected readonly source = computed<WaitlistSource | undefined>(
    () => this.currentQuery().source,
  );
  protected readonly createdFrom = computed<string | undefined>(
    () => this.currentQuery().createdFrom,
  );
  protected readonly createdTo = computed<string | undefined>(
    () => this.currentQuery().createdTo,
  );
  protected readonly sortBy = computed<WaitlistSortField>(
    () => this.currentQuery().sortBy ?? 'createdAt',
  );
  protected readonly sortOrder = computed<SortOrder>(
    () => this.currentQuery().sortOrder ?? defaultSortOrder(this.stage()),
  );
  protected readonly page = computed<number>(
    () => this.currentQuery().page ?? 1,
  );
  protected readonly pageSize = computed<WaitlistPageSize>(
    () => this.currentQuery().pageSize ?? 25,
  );

  /** Refresh tick after mutations or manual retry */
  private readonly refreshTick = signal<number>(0);

  /** Overview stats */
  protected readonly stats = signal<AdminStatsResponse | null>(null);

  /** Export in-progress flag */
  protected readonly exporting = signal<boolean>(false);
  protected readonly exportError = signal<string | null>(null);

  // --- Approve flow ---
  protected readonly approveIds = signal<readonly string[]>([]);
  protected readonly approveOpen = signal<boolean>(false);
  protected readonly approveToast = signal<AdminApproveWaitlistResponse | null>(
    null,
  );

  // --- Details drawer flow ---
  public readonly drawerOpen = signal<boolean>(false);
  public readonly activeEntryId = signal<string | null>(null);
  private drawerOpenerEl: HTMLElement | null = null;

  // --- Server request stream ---
  private readonly response$ = combineLatest([
    toObservable(this.currentQuery),
    toObservable(this.refreshTick),
  ]).pipe(
    switchMap(([q]) =>
      this.api.listWaitlist(q).pipe(
        map((res): ListStreamResult => ({ status: 'success', data: res })),
        catchError((err: unknown) => {
          if (isInvalidDateRangeError(err)) {
            return of<ListStreamResult>({
              status: 'invalid_date',
              message: extractDateErrorMessage(err),
            });
          }
          return of<ListStreamResult>({ status: 'error' });
        }),
      ),
    ),
  );

  private readonly responseRaw = toSignal<ListStreamResult | null>(
    this.response$,
    { initialValue: null },
  );

  protected readonly loading = computed<boolean>(
    () => this.responseRaw() === null,
  );
  protected readonly loadError = computed<boolean>(
    () => this.responseRaw()?.status === 'error',
  );
  protected readonly dateRangeError = computed<string | null>(() => {
    const r = this.responseRaw();
    return r?.status === 'invalid_date' ? r.message : null;
  });

  protected readonly rows = computed<readonly WaitlistListRow[]>(() => {
    const r = this.responseRaw();
    return r?.status === 'success' ? r.data.data : [];
  });

  protected readonly total = computed<number>(() => {
    const r = this.responseRaw();
    return r?.status === 'success' ? r.data.total : 0;
  });

  protected readonly totalPages = computed<number>(() => {
    const r = this.responseRaw();
    return r?.status === 'success' ? r.data.totalPages : 0;
  });

  protected readonly counts = computed<WaitlistStageCounts>(() => {
    const r = this.responseRaw();
    if (r?.status === 'success') {
      return r.data.counts;
    }
    return {
      all: 0,
      pending: 0,
      new: 0,
      invited: 0,
      approved: 0,
      converted: 0,
    };
  });

  protected readonly tabs: readonly { key: WaitlistStage; label: string }[] = [
    { key: 'new', label: 'New' },
    { key: 'invited', label: 'Invited' },
    { key: 'approved', label: 'Approved' },
    { key: 'converted', label: 'Converted' },
    { key: 'all', label: 'All' },
  ];

  /** Page-level selection state helper: none | all | mixed */
  protected readonly pageSelectStatus = computed<'none' | 'all' | 'mixed'>(() =>
    this.selection.pageStatus(this.rows()),
  );

  public constructor() {
    this.fetchStats();

    // Canonicalize invalid or legacy query params in URL
    effect(() => {
      const q = this.currentQuery();
      const rawParams =
        this.rawQueryParams() ?? this.route.snapshot.queryParams;
      if (needsWaitlistQueryCanonicalization(rawParams, q)) {
        untracked(() => {
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: serializeWaitlistQuery(q),
            replaceUrl: true,
          });
        });
      }
    });

    // A non-empty result set can become shorter while an old deep link still
    // points beyond its last page. Canonicalize once to the last valid page.
    effect(() => {
      const response = this.responseRaw();
      const requestedPage = this.page();
      if (
        response?.status !== 'success' ||
        response.data.data.length > 0 ||
        response.data.total <= 0 ||
        response.data.totalPages < 1 ||
        requestedPage <= response.data.totalPages
      ) {
        return;
      }

      const lastPage = response.data.totalPages;
      untracked(() => {
        this.navigateWithFilters({ page: lastPage }, { replaceUrl: true });
      });
    });

    // Handle debounced search changes (uses replaceUrl to prevent flooding history)
    this.searchInput$.pipe(debounceTime(300)).subscribe((searchVal) => {
      const next = searchVal.trim().length > 0 ? searchVal.trim() : undefined;
      if (next === this.currentQuery().search) return;

      this.navigateWithFilters(
        {
          search: next,
          page: 1,
        },
        { replaceUrl: true },
      );
      this.clearSelection();
    });
  }

  public ngOnDestroy(): void {
    this.cancelMatchingSelection();
  }

  private fetchStats(): void {
    this.api.getStats().subscribe({
      next: (s) => this.stats.set(s),
      error: () => this.stats.set(null),
    });
  }

  // --- Navigation & Query updates ---

  public setStage(s: WaitlistStage): void {
    if (s === this.stage()) return;
    this.clearSelection();
    this.navigateWithFilters({
      stage: s,
      page: 1,
      sortOrder: defaultSortOrder(s),
    });
  }

  protected onSearchChange(search: string): void {
    this.searchInput$.next(search);
  }

  protected onSourceChange(source: WaitlistSource | undefined): void {
    this.clearSelection();
    this.navigateWithFilters({ source, page: 1 });
  }

  protected onCreatedFromChange(createdFrom: string | undefined): void {
    this.clearSelection();
    this.navigateWithFilters({ createdFrom, page: 1 });
  }

  protected onCreatedToChange(createdTo: string | undefined): void {
    this.clearSelection();
    this.navigateWithFilters({ createdTo, page: 1 });
  }

  protected onSortByChange(sortBy: WaitlistSortField): void {
    this.clearSelection();
    this.navigateWithFilters({ sortBy, page: 1 });
  }

  protected onSortOrderChange(sortOrder: SortOrder): void {
    this.clearSelection();
    this.navigateWithFilters({ sortOrder, page: 1 });
  }

  protected onPageSizeChange(pageSize: WaitlistPageSize): void {
    this.navigateWithFilters({ pageSize, page: 1 });
  }

  public onPageChange(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      // Retain selection across page changes!
      this.navigateWithFilters({ page });
    }
  }

  /**
   * Clears all optional filters (search, source, date range, sort, page, pageSize)
   * while STRICTLY RETAINING the active stage.
   */
  public onClearFilters(): Promise<boolean> {
    this.clearSelection();
    const currentStage = this.stage();
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: serializeWaitlistQuery({
        stage: currentStage,
        sortBy: 'createdAt',
        sortOrder: defaultSortOrder(currentStage),
        page: 1,
        pageSize: 25,
      }),
    });
  }

  private navigateWithFilters(
    patch: Partial<WaitlistListQuery>,
    extras?: { replaceUrl?: boolean },
  ): Promise<boolean> {
    const updated: WaitlistListQuery = {
      ...this.currentQuery(),
      ...patch,
    };

    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: serializeWaitlistQuery(updated),
      replaceUrl: extras?.replaceUrl ?? false,
    });
  }

  // --- Selection & Matching ---

  protected onToggleRow(row: WaitlistListRow): void {
    this.cancelMatchingSelection();
    this.selection.toggleRow(row);
  }

  protected onTogglePageSelection(): void {
    this.cancelMatchingSelection();
    this.selection.selectPage(this.rows());
  }

  protected onClearSelection(): void {
    this.clearSelection();
  }

  /**
   * "Select all matching" action: fetches up to 50 server-resolved eligible ids.
   */
  public onSelectMatching(): void {
    this.cancelMatchingSelection();
    const filterQuery = this.getCurrentFilterQuery();

    this.matchingSelectionSubscription = this.api
      .resolveEligibleWaitlistIds(filterQuery)
      .subscribe({
        next: (res) => {
          if (this.isCurrentFilterQuery(filterQuery)) {
            this.selection.selectMatching(res);
          }
        },
        error: () => this.selection.handleTransportFailure(),
      });
  }

  private getCurrentFilterQuery(): WaitlistFilterQuery {
    return {
      stage: this.stage(),
      search: this.search() || undefined,
      source: this.source(),
      createdFrom: this.createdFrom(),
      createdTo: this.createdTo(),
      sortBy: this.sortBy(),
      sortOrder: this.sortOrder(),
    };
  }

  private isCurrentFilterQuery(captured: WaitlistFilterQuery): boolean {
    const current = this.getCurrentFilterQuery();
    return (
      captured.stage === current.stage &&
      captured.search === current.search &&
      captured.source === current.source &&
      captured.createdFrom === current.createdFrom &&
      captured.createdTo === current.createdTo &&
      captured.sortBy === current.sortBy &&
      captured.sortOrder === current.sortOrder
    );
  }

  private clearSelection(): void {
    this.cancelMatchingSelection();
    this.selection.clear();
  }

  private cancelMatchingSelection(): void {
    this.matchingSelectionSubscription?.unsubscribe();
    this.matchingSelectionSubscription = null;
  }

  // --- CSV Export ---

  public onExportCsv(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.exportError.set(null);

    const filterQuery: WaitlistFilterQuery = {
      stage: this.stage(),
      search: this.search() || undefined,
      source: this.source(),
      createdFrom: this.createdFrom(),
      createdTo: this.createdTo(),
      sortBy: this.sortBy(),
      sortOrder: this.sortOrder(),
    };

    this.api.exportWaitlistCsv(filterQuery).subscribe({
      next: ({ blob, filename }) => {
        this.exporting.set(false);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      },
      error: (err: unknown) => {
        this.exporting.set(false);
        this.exportError.set(mapExportError(err));
        setTimeout(() => this.exportError.set(null), 6000);
      },
    });
  }

  // --- Approve flow ---

  protected onApproveSelected(): void {
    if (this.selection.count() === 0) return;
    this.approveToast.set(null);
    this.approveIds.set(this.selection.selectedIds());
    this.approveOpen.set(true);
  }

  protected onApproveRow(row: WaitlistListRow): void {
    this.approveToast.set(null);
    this.approveIds.set([row.id]);
    this.approveOpen.set(true);
  }

  protected onApproveId(id: string): void {
    this.approveToast.set(null);
    this.approveIds.set([id]);
    this.approveOpen.set(true);
  }

  protected onApproveClose(): void {
    this.approveOpen.set(false);
  }

  public onApproveDone(result: AdminApproveWaitlistResponse): void {
    this.approveToast.set(result);
    this.selection.handleApprovalResult(result);
    this.refreshTick.update((v) => v + 1);
    this.fetchStats();

    setTimeout(() => {
      if (this.approveToast() === result) {
        this.approveToast.set(null);
      }
    }, 8000);
  }

  // --- Details drawer flow ---

  public onOpenDetails(event: {
    row: WaitlistListRow;
    triggerEl: HTMLElement;
  }): void {
    this.drawerOpenerEl = event.triggerEl;
    this.activeEntryId.set(event.row.id);
    this.drawerOpen.set(true);
  }

  public onDrawerClosed(): void {
    this.drawerOpen.set(false);
    this.activeEntryId.set(null);

    // Restore focus to opener button
    if (this.drawerOpenerEl) {
      this.drawerOpenerEl.focus();
      this.drawerOpenerEl = null;
    }
  }

  public retry(): void {
    this.refreshTick.update((v) => v + 1);
  }
}
