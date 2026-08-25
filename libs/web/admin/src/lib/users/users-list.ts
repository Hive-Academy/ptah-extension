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
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';

import {
  AdminApiService,
  AdminBulkEmailResponse,
  AdminListQuery,
  AdminListResponse,
  IssueComplimentaryLicenseResponse,
} from '../services/admin-api.service';
import { BulkEmailModal } from '../components/bulk-email-modal/bulk-email-modal';
import { EmptyState } from '@ptah-web/panel-ui';
import { IssueCompLicenseModalComponent } from '../components/issue-comp-license-modal/issue-comp-license-modal';
import { SelectionToolbar } from '@ptah-web/panel-ui';
import { StatusBadge } from '@ptah-web/panel-ui';
import {
  Entitlement,
  UserWithBilling,
  deriveEntitlement,
  planLabel,
  planVariant,
  subscriptionLabel,
  subscriptionVariant,
} from './entitlement';

/** A user row paired with its derived license ↔ subscription state. */
interface UserRow {
  user: UserWithBilling;
  entitlement: Entitlement;
}

/**
 * The entitlement lenses. Values MUST match the `entitlement` preset keys in
 * the backend allowlist (`ADMIN_MODELS.users.filterableFields`) — an unknown
 * key is rejected with 400, it does not silently return everything.
 */
const LENSES = [
  { key: '', label: 'All' },
  { key: 'builders', label: 'Builders' },
  { key: 'community', label: 'Community' },
  { key: 'subscriber', label: 'Paddle subscriber' },
  { key: 'pastDue', label: 'Past due' },
  { key: 'unlinked', label: 'Unlinked' },
  { key: 'none', label: 'No license' },
] as const;

type LensKey = (typeof LENSES)[number]['key'];

/**
 * UsersList — the people directory AND the merged revenue surface.
 *
 * This view absorbed the former `/admin/licenses` and `/admin/subscriptions`
 * tabs. Instead of three lists keyed by three different ids, there is one list
 * keyed by the person: every row carries the user's effective license and their
 * live Paddle subscription side by side, so "who has a license and who has a
 * subscription" is answerable without a join in the operator's head.
 *
 * Both extra columns come free — `ADMIN_MODELS.users.include` ships the
 * `licenses` and `subscriptions` relations on the existing list endpoint, so
 * this is still ONE request per page, not one per row.
 *
 * The lens row maps to `?filter=entitlement:<preset>`, evaluated server-side
 * against the whole table (client-side filtering would only ever see the
 * current page). `unlinked` is the reconciliation lens: users holding a license
 * that claims a Paddle origin while having no subscription at all.
 */
@Component({
  selector: 'ptah-admin-users-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    StatusBadge,
    EmptyState,
    SelectionToolbar,
    BulkEmailModal,
    IssueCompLicenseModalComponent,
  ],
  templateUrl: './users-list.html',
})
export class UsersList {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(AdminApiService);

  private readonly issueModal = viewChild(IssueCompLicenseModalComponent);

  protected readonly lenses = LENSES;

  protected readonly page = signal<number>(1);
  protected readonly pageSize = signal<number>(25);
  protected readonly search = signal<string>('');
  protected readonly lens = signal<LensKey>('');

  protected readonly selectedIds = signal<readonly string[]>([]);

  protected readonly bulkEmailOpen = signal<boolean>(false);
  protected readonly bulkEmailToast = signal<AdminBulkEmailResponse | null>(
    null,
  );
  protected readonly issuedToast = signal<string | null>(null);

  /** Bumped after issuance so the current page re-fetches with the new license. */
  private readonly refreshTick = signal<number>(0);

  private readonly search$ = toObservable(this.search).pipe(
    startWith(this.search()),
    debounceTime(300),
  );

  private readonly response$ = combineLatest([
    toObservable(this.page),
    toObservable(this.pageSize),
    this.search$,
    toObservable(this.lens),
    toObservable(this.refreshTick),
  ]).pipe(
    switchMap(([page, pageSize, search, lens]) => {
      const q: AdminListQuery = {
        page,
        pageSize,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        search: search.trim() ? search.trim() : undefined,
        filter: lens ? `entitlement:${lens}` : undefined,
      };
      return this.api.list<UserWithBilling>('users', q).pipe(
        map((r): AdminListResponse<UserWithBilling> | 'error' => r),
        catchError(() => of<'error'>('error')),
      );
    }),
  );

  private readonly responseRaw = toSignal<
    AdminListResponse<UserWithBilling> | 'error' | null
  >(this.response$, { initialValue: null });

  protected readonly loading = computed<boolean>(
    () => this.responseRaw() === null,
  );
  protected readonly loadError = computed<boolean>(
    () => this.responseRaw() === 'error',
  );
  protected readonly rows = computed<readonly UserRow[]>(() => {
    const r = this.responseRaw();
    if (!r || r === 'error') return [];
    return r.data.map((user) => ({
      user,
      entitlement: deriveEntitlement(user),
    }));
  });
  protected readonly total = computed<number>(() => {
    const r = this.responseRaw();
    return r && r !== 'error' ? r.total : 0;
  });
  protected readonly totalPages = computed<number>(() => {
    const r = this.responseRaw();
    return r && r !== 'error' ? r.totalPages : 0;
  });

  /** Rows on this page whose license/subscription state needs a human. */
  protected readonly flaggedCount = computed<number>(
    () =>
      this.rows().filter((r) => r.entitlement.discrepancies.length > 0).length,
  );

  protected readonly allSelected = computed<boolean>(() => {
    const rows = this.rows();
    return rows.length > 0 && rows.every((r) => this.isSelected(r.user.id));
  });

  public constructor() {
    // Hand-off params from the Overview tiles and the Waitlist pipeline. The
    // legacy `/admin/licenses?search=…` links redirect here with their query
    // string intact, so `search` is still honored; `filter` arrives already in
    // `entitlement:<preset>` form from the retargeted tiles.
    const qp = this.route.snapshot.queryParamMap;
    const search = qp.get('search')?.trim();
    if (search) this.search.set(search);

    const filter = qp.get('filter')?.trim();
    const preset = filter?.startsWith('entitlement:')
      ? filter.slice('entitlement:'.length)
      : null;
    if (preset && LENSES.some((l) => l.key === preset)) {
      this.lens.set(preset as LensKey);
    }
  }

  protected onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.search.set(target?.value ?? '');
    this.page.set(1);
  }

  protected setLens(key: LensKey): void {
    if (this.lens() === key) return;
    this.lens.set(key);
    this.page.set(1);
    this.clearSelection();
  }

  protected onRowClick(id: string): void {
    if (!id) return;
    this.router.navigate(['/admin', 'users', id]);
  }

  // --- Entitlement cells ---------------------------------------------------
  protected planLabel = planLabel;
  protected planVariant = planVariant;
  protected subscriptionLabel = subscriptionLabel;
  protected subscriptionVariant = subscriptionVariant;

  // --- Selection -----------------------------------------------------------
  protected isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  protected toggleSelected(id: string, event: Event): void {
    event.stopPropagation();
    this.selectedIds.update((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  protected toggleAll(): void {
    if (this.allSelected()) {
      this.selectedIds.set([]);
    } else {
      this.selectedIds.set(this.rows().map((r) => r.user.id));
    }
  }

  protected clearSelection(): void {
    this.selectedIds.set([]);
  }

  protected displayName(user: UserWithBilling): string {
    const name = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return name || '—';
  }

  // --- Issuance ------------------------------------------------------------
  /**
   * Opens the shared modal in `search` mode — it resolves its own recipient, so
   * issuance no longer needs a dedicated licenses page to start from.
   */
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

  // --- Bulk email ----------------------------------------------------------
  protected onEmailSelected(): void {
    if (this.selectedIds().length === 0) return;
    this.bulkEmailToast.set(null);
    this.bulkEmailOpen.set(true);
  }

  protected onBulkEmailClose(): void {
    this.bulkEmailOpen.set(false);
  }

  protected onBulkEmailSent(result: AdminBulkEmailResponse): void {
    this.bulkEmailToast.set(result);
    this.clearSelection();
    setTimeout(() => this.bulkEmailOpen.set(false), 1200);
    setTimeout(() => {
      if (this.bulkEmailToast() === result) this.bulkEmailToast.set(null);
    }, 6000);
  }

  // --- Pagination ----------------------------------------------------------
  protected prevPage(): void {
    if (this.page() > 1) this.page.update((p) => p - 1);
  }

  protected nextPage(): void {
    if (this.page() < this.totalPages()) this.page.update((p) => p + 1);
  }
}
