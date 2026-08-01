import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  catchError,
  combineLatest,
  debounceTime,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import {
  ChevronRight,
  LucideAngularModule,
  Megaphone,
  Plus,
} from 'lucide-angular';

import {
  AdminApiService,
  AdminListQuery,
  AdminListResponse,
} from '../../services/admin-api.service';
import { ADMIN_MODEL_SPECS } from '../../admin-models.config';
import { EmptyState } from '../../components/empty-state/empty-state';
import { StatusBadge } from '../../components/status-badge/status-badge';
import { asCampaignRow, CampaignRowVm, toCampaignRowVm } from './campaign-row';
import { relativeDate } from './relative-time';

/**
 * CampaignHistoryList — bespoke performance-record list for the
 * `marketing-campaigns` model (design spec §5.1), replacing the generic
 * `AdminList` on route `/admin/marketing-campaigns`.
 *
 * A compact row list (the same pattern as the Hub's Recent Campaigns), not a
 * dense counts table: name + client-derived `StatusBadge` + colored
 * delivery/bounce/complaint rates + relative date + chevron, each row a real
 * navigation to `/admin/marketing-campaigns/:id`. Server-side search +
 * pagination reuse the shared model's `searchPlaceholder`.
 *
 * The model stays `readOnly: true` — no edit surface is added.
 */
@Component({
  selector: 'ptah-admin-campaign-history-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideAngularModule, EmptyState, StatusBadge],
  templateUrl: './campaign-history-list.html',
})
export class CampaignHistoryList {
  private readonly api = inject(AdminApiService);

  protected readonly MegaphoneIcon = Megaphone;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly PlusIcon = Plus;

  /** Reused from the shared model spec so copy stays in one place. */
  protected readonly searchPlaceholder =
    ADMIN_MODEL_SPECS.find((s) => s.key === 'marketing-campaigns')
      ?.searchPlaceholder ?? 'Search campaigns…';

  protected readonly page = signal<number>(1);
  protected readonly pageSize = signal<number>(25);
  protected readonly search = signal<string>('');

  /** Bumped by Retry to force a re-fetch of the current query. */
  private readonly refreshTick = signal<number>(0);

  protected readonly loadError = signal<string | null>(null);

  private readonly search$ = toObservable(this.search).pipe(
    startWith(this.search()),
    debounceTime(300),
  );

  private readonly response$ = combineLatest([
    toObservable(this.page),
    toObservable(this.pageSize),
    this.search$,
    toObservable(this.refreshTick),
  ]).pipe(
    switchMap(([page, pageSize, search]) => {
      const q: AdminListQuery = {
        page,
        pageSize,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        search: search.trim() ? search.trim() : undefined,
      };
      this.loadError.set(null);
      return this.api
        .list<Record<string, unknown>>('marketing-campaigns', q)
        .pipe(
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

  /** Rows projected into the shared compact-row view-model. */
  protected readonly rows = computed<CampaignRowVm[]>(() =>
    (this.response()?.data ?? []).map((r) => toCampaignRowVm(asCampaignRow(r))),
  );

  protected readonly total = computed<number>(
    () => this.response()?.total ?? 0,
  );
  protected readonly totalPages = computed<number>(() => {
    const ps = Math.max(1, this.pageSize());
    return Math.max(1, Math.ceil(this.total() / ps));
  });

  /** True once the fetch resolved with zero rows (and no error). */
  protected readonly isEmpty = computed<boolean>(
    () =>
      !this.loading() && this.loadError() === null && this.rows().length === 0,
  );

  protected readonly skeletonRows = Array.from({ length: 5 });

  protected relative(iso: string | null): string {
    return relativeDate(iso);
  }

  protected onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    this.search.set(target?.value ?? '');
    this.page.set(1);
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
}

/** Best-effort HTTP error → message extraction (mirrors licenses-list). */
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
  return 'Failed to load campaigns.';
}
