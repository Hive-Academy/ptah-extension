import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
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
} from '../services/admin-api.service';
import { BulkEmailModal } from '../components/bulk-email-modal/bulk-email-modal';
import { EmptyState } from '../components/empty-state/empty-state';
import { SelectionToolbar } from '../components/selection-toolbar/selection-toolbar';
import { StatusBadge } from '../components/status-badge/status-badge';

/** Row shape read from `GET /admin/users` (subset used by the list). */
interface UserRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  emailVerified: boolean;
  createdAt: string | null;
}

/**
 * UsersList — enhanced people directory (design spec §4.4.1). Route
 * `/admin/users`.
 *
 * Stays close to the generic table's columns (email / name / verified / joined)
 * but upgrades two things: `emailVerified` renders through the shared
 * `StatusBadge`, and the bulk-email action moves from a static
 * disabled-until-selected header button into the contextual `SelectionToolbar`.
 * Row click drills into the bespoke `/admin/users/:id` profile.
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
  ],
  templateUrl: './users-list.html',
})
export class UsersList {
  private readonly router = inject(Router);
  private readonly api = inject(AdminApiService);

  protected readonly page = signal<number>(1);
  protected readonly pageSize = signal<number>(25);
  protected readonly search = signal<string>('');

  protected readonly selectedIds = signal<readonly string[]>([]);

  protected readonly bulkEmailOpen = signal<boolean>(false);
  protected readonly bulkEmailToast = signal<AdminBulkEmailResponse | null>(
    null,
  );

  private readonly search$ = toObservable(this.search).pipe(
    startWith(this.search()),
    debounceTime(300),
  );

  private readonly response$ = combineLatest([
    toObservable(this.page),
    toObservable(this.pageSize),
    this.search$,
  ]).pipe(
    switchMap(([page, pageSize, search]) => {
      const q: AdminListQuery = {
        page,
        pageSize,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        search: search.trim() ? search.trim() : undefined,
      };
      return this.api.list<UserRow>('users', q).pipe(
        map((r): AdminListResponse<UserRow> | 'error' => r),
        catchError(() => of<'error'>('error')),
      );
    }),
  );

  private readonly responseRaw = toSignal<
    AdminListResponse<UserRow> | 'error' | null
  >(this.response$, { initialValue: null });

  protected readonly loading = computed<boolean>(
    () => this.responseRaw() === null,
  );
  protected readonly loadError = computed<boolean>(
    () => this.responseRaw() === 'error',
  );
  protected readonly rows = computed<readonly UserRow[]>(() => {
    const r = this.responseRaw();
    return r && r !== 'error' ? r.data : [];
  });
  protected readonly total = computed<number>(() => {
    const r = this.responseRaw();
    return r && r !== 'error' ? r.total : 0;
  });
  protected readonly totalPages = computed<number>(() => {
    const r = this.responseRaw();
    return r && r !== 'error' ? r.totalPages : 0;
  });

  protected readonly allSelected = computed<boolean>(() => {
    const rows = this.rows();
    return rows.length > 0 && rows.every((r) => this.isSelected(r.id));
  });

  protected onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.search.set(target?.value ?? '');
    this.page.set(1);
  }

  protected onRowClick(id: string): void {
    if (!id) return;
    this.router.navigate(['/admin', 'users', id]);
  }

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
      this.selectedIds.set(this.rows().map((r) => r.id));
    }
  }

  protected clearSelection(): void {
    this.selectedIds.set([]);
  }

  protected displayName(row: UserRow): string {
    const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
    return name || '—';
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
