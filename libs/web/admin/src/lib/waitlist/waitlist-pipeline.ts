import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';
import {
  ArrowRight,
  BadgeCheck,
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
  AdminListQuery,
  AdminListResponse,
  AdminStatsResponse,
} from '../services/admin-api.service';
import { ApproveWaitlistModal } from '../components/approve-waitlist-modal/approve-waitlist-modal';
import type { BadgeVariant } from '@ptah-web/panel-ui';
import { EmptyState } from '@ptah-web/panel-ui';
import { SelectionToolbar } from '@ptah-web/panel-ui';
import { StatusBadge } from '@ptah-web/panel-ui';

/** The five pipeline stages, synced to the `?tab=` query param. */
export type WaitlistTab = 'new' | 'invited' | 'approved' | 'converted' | 'all';

/** Minimal row shape read from `GET /admin/waitlist` — a subset of the model. */
export interface WaitlistRow {
  id: string;
  email: string;
  source: string | null;
  createdAt: string | null;
  notifiedAt: string | null;
  approvedAt: string | null;
  convertedAt: string | null;
}

/**
 * WaitlistPipeline — the Approve queue for the Builders waitlist. Route
 * `/admin/waitlist`.
 *
 * ⚠️ THERE IS NO INVITE PATH HERE ANY MORE. The founding cohort is free, so the
 * paid-discount invite flow and its modal were deleted in TASK_2026_201 rather
 * than repointed. The one action this page offers is "Approve to Founding
 * Cohort": a free 1-year Builders licence, placement in the `Founding Members`
 * cohort and one welcome email per person.
 *
 * A segmented-tab queue (New | Invited | Approved | Converted | All) rather
 * than a kanban: stage transitions are system-driven (an approval stamps
 * `approvedAt`, a Paddle checkout stamps `convertedAt`), so a draggable board
 * would imply an affordance that doesn't exist. The active tab is URL-driven
 * via `?tab=` so `/admin/waitlist?tab=approved` deep-links correctly.
 *
 * Stage → backend filter mapping (allowlisted server-side):
 *   New = `notified:false` · Invited = `notified:true` · Approved =
 *   `approved:true` · Converted = `converted:true` · All = no filter.
 *
 * ⚠️ ACCEPTED TAB OVERLAP. `ListQueryDto.filter` carries exactly ONE
 * `field:value` pair, so `new` cannot express "not notified AND not approved".
 * A row approved without ever being invited therefore shows under both **New**
 * and **Approved**. That is why the stage chip renders on EVERY tab, not only
 * on `all`: the chip states the row's true stage wherever it appears, which
 * makes the overlap self-explaining instead of misleading. A `stage:` preset
 * filter is the clean fix and is a recorded follow-up.
 *
 * Approve is offered on **New** and **Invited** alike — a row does not have to
 * be mailed anything before it can be approved.
 */
@Component({
  selector: 'ptah-admin-waitlist-pipeline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    LucideAngularModule,
    StatusBadge,
    EmptyState,
    SelectionToolbar,
    ApproveWaitlistModal,
  ],
  templateUrl: './waitlist-pipeline.html',
})
export class WaitlistPipeline {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(AdminApiService);

  // --- Icons (design spec §7.6) -------------------------------------------
  protected readonly KeyRoundIcon = KeyRound;
  protected readonly ArrowRightIcon = ArrowRight;
  protected readonly PartyPopperIcon = PartyPopper;
  protected readonly MailCheckIcon = MailCheck;
  protected readonly BadgeCheckIcon = BadgeCheck;
  protected readonly SparklesIcon = Sparkles;
  protected readonly InboxIcon = Inbox;

  protected readonly tabs: readonly { key: WaitlistTab; label: string }[] = [
    { key: 'new', label: 'New' },
    { key: 'invited', label: 'Invited' },
    { key: 'approved', label: 'Approved' },
    { key: 'converted', label: 'Converted' },
    { key: 'all', label: 'All' },
  ];

  /** Active tab — URL-driven, so deep links and back/forward stay in sync. */
  protected readonly tab = toSignal(
    this.route.queryParamMap.pipe(map((p) => this.normalizeTab(p.get('tab')))),
    { initialValue: this.normalizeTab(null) },
  );

  /**
   * Tabs where rows can be approved — drives both the row checkbox and the
   * per-row Approve button. **New is included**: a row does not have to be
   * mailed the (deleted) paid invite before it can be granted free access.
   */
  protected readonly approvableTab = computed<boolean>(
    () => this.tab() === 'new' || this.tab() === 'invited',
  );

  protected readonly page = signal<number>(1);
  protected readonly pageSize = signal<number>(25);

  /** Row selection (New + Invited) — feeds the SelectionToolbar bulk approve. */
  protected readonly selectedIds = signal<readonly string[]>([]);

  // --- Approve flow --------------------------------------------------------
  /** Ids handed to the approve modal at open time (one row, or the selection). */
  protected readonly approveIds = signal<readonly string[]>([]);
  protected readonly approveOpen = signal<boolean>(false);
  protected readonly approveToast = signal<AdminApproveWaitlistResponse | null>(
    null,
  );

  /** Bumped after a mutation to force a re-fetch of the current tab/page. */
  private readonly refreshTick = signal<number>(0);

  /** Overview funnel stats — drives the header summary strip. */
  protected readonly stats = signal<AdminStatsResponse | null>(null);

  /** Server-side filter for the active tab (undefined = no filter = All). */
  protected readonly filter = computed<string | undefined>(() => {
    switch (this.tab()) {
      case 'new':
        return 'notified:false';
      case 'invited':
        return 'notified:true';
      case 'approved':
        return 'approved:true';
      case 'converted':
        return 'converted:true';
      default:
        return undefined;
    }
  });

  /**
   * Default sort per tab. Kept to `createdAt` (always sortable) to avoid a 400
   * from a non-allowlisted sort field: New surfaces oldest-waiting first so the
   * longest-waiting people are approved first; other tabs show newest first.
   */
  private readonly sort = computed<{
    sortBy: string;
    sortOrder: 'asc' | 'desc';
  }>(() => ({
    sortBy: 'createdAt',
    sortOrder: this.tab() === 'new' ? 'asc' : 'desc',
  }));

  private readonly response$ = combineLatest([
    toObservable(this.filter),
    toObservable(this.sort),
    toObservable(this.page),
    toObservable(this.pageSize),
    toObservable(this.refreshTick),
  ]).pipe(
    switchMap(([filter, sort, page, pageSize]) => {
      const q: AdminListQuery = {
        page,
        pageSize,
        sortBy: sort.sortBy,
        sortOrder: sort.sortOrder,
        filter,
      };
      return this.api.list<WaitlistRow>('waitlist', q).pipe(
        map((r): AdminListResponse<WaitlistRow> | 'error' => r),
        catchError(() => of<'error'>('error')),
      );
    }),
  );

  private readonly responseRaw = toSignal<
    AdminListResponse<WaitlistRow> | 'error' | null
  >(this.response$, { initialValue: null });

  protected readonly loading = computed<boolean>(
    () => this.responseRaw() === null,
  );
  protected readonly loadError = computed<boolean>(
    () => this.responseRaw() === 'error',
  );

  protected readonly rows = computed<readonly WaitlistRow[]>(() => {
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

  // --- Header summary (funnel math, reused from Overview stats) ------------
  protected readonly summaryNew = computed<number>(() => {
    const s = this.stats();
    return s ? Math.max(0, s.waitlist.total - s.waitlist.notified) : 0;
  });
  protected readonly summaryInvited = computed<number>(
    () => this.stats()?.waitlist.notified ?? 0,
  );
  /**
   * `approved` is `.optional()` on the stats schema so a server predating the
   * approve endpoint still validates — it reads as 0 until that build ships.
   */
  protected readonly summaryApproved = computed<number>(
    () => this.stats()?.waitlist.approved ?? 0,
  );
  protected readonly summaryConverted = computed<number>(
    () => this.stats()?.waitlist.converted ?? 0,
  );
  protected readonly summaryTotal = computed<number>(
    () => this.stats()?.waitlist.total ?? 0,
  );

  public constructor() {
    // Reset selection + paging whenever the active tab changes. Untracked so
    // the reset doesn't itself re-trigger on unrelated view refreshes.
    effect(() => {
      this.tab();
      untracked(() => {
        this.page.set(1);
        this.selectedIds.set([]);
      });
    });

    this.fetchStats();
  }

  private fetchStats(): void {
    this.api.getStats().subscribe({
      next: (s) => this.stats.set(s),
      error: () => this.stats.set(null),
    });
  }

  /** Unknown/absent `?tab=` falls back to New. */
  protected normalizeTab(raw: string | null): WaitlistTab {
    return raw === 'invited' ||
      raw === 'approved' ||
      raw === 'converted' ||
      raw === 'all'
      ? raw
      : 'new';
  }

  protected setTab(t: WaitlistTab): void {
    if (t === this.tab()) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: t },
      queryParamsHandling: 'merge',
    });
  }

  // --- Selection (New + Invited) -------------------------------------------
  protected isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  protected toggleSelected(id: string): void {
    this.selectedIds.update((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  protected clearSelection(): void {
    this.selectedIds.set([]);
  }

  // --- Approve → Founding Cohort -------------------------------------------
  /** From the SelectionToolbar — approve every explicitly selected row. */
  protected onApproveSelected(): void {
    if (this.selectedIds().length === 0) return;
    this.approveToast.set(null);
    this.approveIds.set(this.selectedIds());
    this.approveOpen.set(true);
  }

  /** Per-row Approve — the same confirmation modal, opened with one id. */
  protected onApproveRow(row: WaitlistRow): void {
    this.approveToast.set(null);
    this.approveIds.set([row.id]);
    this.approveOpen.set(true);
  }

  protected onApproveClose(): void {
    this.approveOpen.set(false);
  }

  /**
   * The call returned 200. Individual rows may still have been skipped or have
   * failed — the tally is shown in the modal and echoed in the toast.
   *
   * The selection is cleared only on a returned response. A transport failure
   * never reaches here, so a failed request LEAVES THE SELECTION INTACT and the
   * admin can retry the same rows (R9.6).
   */
  protected onApproveDone(result: AdminApproveWaitlistResponse): void {
    this.approveToast.set(result);
    this.clearSelection();
    this.refreshTick.update((v) => v + 1);
    this.fetchStats();
    setTimeout(() => {
      if (this.approveToast() === result) this.approveToast.set(null);
    }, 8000);
  }

  // --- Pagination ----------------------------------------------------------
  protected prevPage(): void {
    if (this.page() > 1) this.page.update((p) => p - 1);
  }

  protected nextPage(): void {
    if (this.page() < this.totalPages()) this.page.update((p) => p + 1);
  }

  protected retry(): void {
    this.refreshTick.update((v) => v + 1);
  }

  // --- Derived stage chip (rendered on every tab) --------------------------
  /**
   * Ranked Converted → Approved → Invited → New. Converted outranks Approved
   * because a paid conversion is the terminal state; Approved outranks Invited
   * because the grant supersedes the (withdrawn) invite, which is reported but
   * never acted on.
   */
  protected stageLabel(row: WaitlistRow): string {
    if (row.convertedAt) return 'Converted';
    if (row.approvedAt) return 'Approved';
    if (row.notifiedAt) return 'Invited';
    return 'New';
  }

  /**
   * Same ranking as {@link stageLabel}, mapped onto the shared six-name
   * `BadgeVariant` vocabulary so all four stages stay visually distinct
   * without widening a presentation contract the member panel also uses.
   */
  protected stageVariant(row: WaitlistRow): BadgeVariant {
    if (row.convertedAt) return 'success';
    if (row.approvedAt) return 'info';
    if (row.notifiedAt) return 'neutral';
    return 'ghost';
  }
}
