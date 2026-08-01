import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  catchError,
  combineLatest,
  debounceTime,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import { KeyRound, LucideAngularModule, Plus } from 'lucide-angular';

import {
  AdminApiService,
  AdminListQuery,
  AdminListResponse,
  IssueComplimentaryLicenseResponse,
} from '../services/admin-api.service';
import {
  ADMIN_MODEL_SPECS,
  BadgeVariant,
  FieldSpec,
} from '../admin-models.config';
import { EmptyState } from '../components/empty-state/empty-state';
import { IssueCompLicenseModalComponent } from '../components/issue-comp-license-modal/issue-comp-license-modal';
import { StatusBadge } from '../components/status-badge/status-badge';

/** Window (days) inside which an active license is flagged "expiring soon" (§4.3.1). */
const EXPIRING_SOON_DAYS = 14;

/**
 * LicensesList — bespoke issuance & lifecycle queue for the `licenses` model
 * (design spec §4.3).
 *
 * Route: `/admin/licenses`. A queue-shaped list (default sort `expiresAt asc`
 * so lapsing licenses surface first) with:
 *   - a primary "Issue Complimentary License" action that opens the shared
 *     modal in its `search` mode (pick any user, no prior user lookup);
 *   - client-side row polish: an expiring-soon accent/badge (≤14 days),
 *     `status`/`source` rendered through the shared `StatusBadge` + badgeMap.
 *
 * The `licenses` model has NO backend `filterableFields`, so this view never
 * sends a `filter` param (that would 400). The `?search=/?plan=/?status=`
 * hand-off params are folded into the client full-text search box only —
 * `plan`/`status` are searchable free-text on this model, so joining them
 * into `search` is a valid prefill, not a fabricated filter.
 */
@Component({
  selector: 'ptah-admin-licenses-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    LucideAngularModule,
    EmptyState,
    StatusBadge,
    IssueCompLicenseModalComponent,
  ],
  templateUrl: './licenses-list.html',
})
export class LicensesList {
  private readonly api = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly issueModal = viewChild(IssueCompLicenseModalComponent);

  protected readonly KeyRoundIcon = KeyRound;
  protected readonly PlusIcon = Plus;

  /** Only list-column fields from the shared licenses spec (drives the header). */
  protected readonly columns: readonly FieldSpec[] = (
    ADMIN_MODEL_SPECS.find((s) => s.key === 'licenses')?.fields ?? []
  ).filter((f) => f.listColumn === true);

  private readonly statusBadgeMap = badgeMapFor('status');
  private readonly sourceBadgeMap = badgeMapFor('source');

  protected readonly page = signal<number>(1);
  protected readonly pageSize = signal<number>(25);
  protected readonly sortBy = signal<string>('expiresAt');
  protected readonly sortOrder = signal<'asc' | 'desc'>('asc');
  protected readonly search = signal<string>('');

  /** Bumped after issuance to force a re-fetch of the current page. */
  private readonly refreshTick = signal<number>(0);

  /** Toast copy after a successful issuance. */
  protected readonly issuedToast = signal<string | null>(null);

  /** Fetch error message (null when the last fetch succeeded / is in flight). */
  protected readonly loadError = signal<string | null>(null);

  private readonly search$ = toObservable(this.search).pipe(
    startWith(this.search()),
    debounceTime(300),
  );

  private readonly response$ = combineLatest([
    toObservable(this.page),
    toObservable(this.pageSize),
    toObservable(this.sortBy),
    toObservable(this.sortOrder),
    this.search$,
    toObservable(this.refreshTick),
  ]).pipe(
    switchMap(([page, pageSize, sortBy, sortOrder, search]) => {
      const q: AdminListQuery = {
        page,
        pageSize,
        sortBy,
        sortOrder,
        search: search.trim() ? search.trim() : undefined,
      };
      this.loadError.set(null);
      return this.api.list<Record<string, unknown>>('licenses', q).pipe(
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

  /** True once the initial fetch resolved with zero rows (and no error). */
  protected readonly isEmpty = computed<boolean>(
    () =>
      !this.loading() && this.loadError() === null && this.rows().length === 0,
  );

  protected readonly pageSizeOptions: readonly number[] = [10, 25, 50, 100];

  /** Skeleton row placeholders while the first page loads. */
  protected readonly skeletonRows = Array.from({ length: 8 });

  public constructor() {
    // Prefill the search box from the Overview/Waitlist hand-off params. All
    // three (`search`/`plan`/`status`) collapse into the client full-text box;
    // none are sent as backend filter params (licenses has no filter allowlist).
    const qp = this.route.snapshot.queryParamMap;
    const parts = ['search', 'plan', 'status']
      .map((k) => qp.get(k)?.trim())
      .filter((v): v is string => !!v);
    if (parts.length > 0) {
      this.search.set(Array.from(new Set(parts)).join(' '));
    }
  }

  protected onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.search.set(target?.value ?? '');
    this.page.set(1);
  }

  protected badgeMap(key: 'status' | 'source'): Record<string, BadgeVariant> {
    return key === 'status' ? this.statusBadgeMap : this.sourceBadgeMap;
  }

  protected rowId(row: Record<string, unknown>): string {
    const id = row['id'];
    return typeof id === 'string' ? id : String(id ?? '');
  }

  protected asDate(value: unknown): string | number | Date | null {
    if (value == null) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') return value;
    return null;
  }

  protected truncate(value: unknown, max = 32): string {
    if (value == null) return '—';
    const text = String(value);
    return text.length > max ? text.slice(0, max) + '…' : text;
  }

  /**
   * True when a license expires within {@link EXPIRING_SOON_DAYS} days (and has
   * not already lapsed). Null `expiresAt` (lifetime) is never "expiring".
   */
  protected isExpiringSoon(row: Record<string, unknown>): boolean {
    const raw = row['expiresAt'];
    if (raw == null) return false;
    const d = new Date(raw as string);
    if (isNaN(d.getTime())) return false;
    const days = (d.getTime() - Date.now()) / 86_400_000;
    return days >= 0 && days <= EXPIRING_SOON_DAYS;
  }

  protected onRowClick(row: Record<string, unknown>): void {
    const id = this.rowId(row);
    if (id) this.router.navigate(['/admin', 'licenses', id]);
  }

  protected openIssueModal(): void {
    this.issuedToast.set(null);
    this.issueModal()?.open();
  }

  protected onIssued(res: IssueComplimentaryLicenseResponse): void {
    this.issuedToast.set(`License ${res.license.licenseKey} issued.`);
    this.refreshTick.update((v) => v + 1);
    setTimeout(() => {
      if (this.issuedToast()?.startsWith(`License ${res.license.licenseKey}`)) {
        this.issuedToast.set(null);
      }
    }, 6000);
  }

  protected retry(): void {
    this.refreshTick.update((v) => v + 1);
  }

  protected onPrev(): void {
    const next = Math.max(1, this.page() - 1);
    if (next !== this.page()) this.page.set(next);
  }

  protected onNext(): void {
    const next = Math.min(this.totalPages(), this.page() + 1);
    if (next !== this.page()) this.page.set(next);
  }

  protected onPageSizeChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    const size = target ? Number(target.value) : this.pageSize();
    if (Number.isFinite(size) && size > 0) {
      this.pageSize.set(size);
      this.page.set(1);
    }
  }
}

/** Pull a field's `badgeMap` off the shared licenses spec (empty if absent). */
function badgeMapFor(key: string): Record<string, BadgeVariant> {
  const spec = ADMIN_MODEL_SPECS.find((s) => s.key === 'licenses');
  return spec?.fields.find((f) => f.key === key)?.badgeMap ?? {};
}

/** Best-effort HTTP error → message extraction (mirrors admin-detail). */
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
  return 'Failed to load licenses.';
}
