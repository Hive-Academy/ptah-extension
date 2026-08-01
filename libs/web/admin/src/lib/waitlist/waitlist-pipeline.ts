import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, combineLatest, map, of, switchMap } from 'rxjs';
import {
  ArrowRight,
  Inbox,
  KeyRound,
  LucideAngularModule,
  MailCheck,
  PartyPopper,
  Sparkles,
  UserPlus,
} from 'lucide-angular';

import {
  AdminApiService,
  AdminInviteWaitlistResponse,
  AdminListQuery,
  AdminListResponse,
  AdminStatsResponse,
} from '../services/admin-api.service';
import { EmptyState } from '../components/empty-state/empty-state';
import { IssueCompLicenseModalComponent } from '../components/issue-comp-license-modal/issue-comp-license-modal';
import { SelectionToolbar } from '../components/selection-toolbar/selection-toolbar';
import { StatusBadge } from '../components/status-badge/status-badge';
import { WaitlistInviteModal } from '../components/waitlist-invite-modal/waitlist-invite-modal';

/** The four pipeline stages, synced to the `?tab=` query param. */
type WaitlistTab = 'new' | 'invited' | 'converted' | 'all';

/** Minimal row shape read from `GET /admin/waitlist` — a subset of the model. */
interface WaitlistRow {
  id: string;
  email: string;
  source: string | null;
  createdAt: string | null;
  notifiedAt: string | null;
  convertedAt: string | null;
}

/**
 * WaitlistPipeline — bespoke Invite → Approve queue for the Builders waitlist
 * (design spec §4.2). Route `/admin/waitlist`.
 *
 * A segmented-tab queue (New | Invited | Converted | All) rather than a kanban:
 * stage transitions are system-driven (an invite send stamps `notifiedAt`, a
 * Paddle checkout stamps `convertedAt`), so a draggable board would imply an
 * affordance that doesn't exist. The active tab is URL-driven via `?tab=` so
 * Overview's deep link `/admin/waitlist?tab=new` lands correctly.
 *
 * Stage → backend filter mapping (allowlisted server-side):
 *   New = `notified:false` · Invited = `notified:true` · Converted =
 *   `converted:true` · All = no filter.
 *
 * Reuses the shared `StatusBadge`, `EmptyState`, and `SelectionToolbar`
 * primitives and the existing `WaitlistInviteModal` / `IssueCompLicenseModal`
 * (bound mode) — no new modals.
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
    WaitlistInviteModal,
    IssueCompLicenseModalComponent,
  ],
  templateUrl: './waitlist-pipeline.html',
})
export class WaitlistPipeline {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(AdminApiService);

  protected readonly compLicenseModal = viewChild(
    IssueCompLicenseModalComponent,
  );

  // --- Icons (design spec §7.6) -------------------------------------------
  protected readonly UserPlusIcon = UserPlus;
  protected readonly KeyRoundIcon = KeyRound;
  protected readonly ArrowRightIcon = ArrowRight;
  protected readonly PartyPopperIcon = PartyPopper;
  protected readonly MailCheckIcon = MailCheck;
  protected readonly SparklesIcon = Sparkles;
  protected readonly InboxIcon = Inbox;

  protected readonly tabs: readonly { key: WaitlistTab; label: string }[] = [
    { key: 'new', label: 'New' },
    { key: 'invited', label: 'Invited' },
    { key: 'converted', label: 'Converted' },
    { key: 'all', label: 'All' },
  ];

  /** Active tab — URL-driven, so deep links and back/forward stay in sync. */
  protected readonly tab = toSignal(
    this.route.queryParamMap.pipe(map((p) => this.normalizeTab(p.get('tab')))),
    { initialValue: this.normalizeTab(null) },
  );

  protected readonly page = signal<number>(1);
  protected readonly pageSize = signal<number>(25);

  /** Row selection (New tab only) — feeds the SelectionToolbar bulk invite. */
  protected readonly selectedIds = signal<readonly string[]>([]);

  /** Recipients handed to the invite modal at open time (drives its mode). */
  protected readonly inviteRecipients = signal<readonly string[]>([]);
  protected readonly waitlistInviteOpen = signal<boolean>(false);
  protected readonly inviteToast = signal<AdminInviteWaitlistResponse | null>(
    null,
  );

  /** Email bound to the Approve → Builders modal for the Invited tab. */
  protected readonly approveEmail = signal<string>('');
  protected readonly approvedAt = signal<number | null>(null);

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
      case 'converted':
        return 'converted:true';
      default:
        return undefined;
    }
  });

  /**
   * Default sort per tab. Kept to `createdAt` (always sortable) to avoid a 400
   * from a non-allowlisted sort field: New surfaces oldest-waiting first so the
   * "Invite oldest N" batch matches the visible order; other tabs show newest
   * first.
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
  protected readonly summaryConverted = computed<number>(
    () => this.stats()?.waitlist.converted ?? 0,
  );
  protected readonly summaryTotal = computed<number>(
    () => this.stats()?.waitlist.total ?? 0,
  );

  /** Number of oldest rows the persistent quick-action invites (matches modal default). */
  protected readonly quickInviteBatch = 25;

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

  private normalizeTab(raw: string | null): WaitlistTab {
    return raw === 'invited' || raw === 'converted' || raw === 'all'
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

  // --- Selection (New tab) -------------------------------------------------
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

  // --- Invite flow ---------------------------------------------------------
  /** From the SelectionToolbar — invite the explicitly selected rows. */
  protected onSendFoundingInvites(): void {
    if (this.selectedIds().length === 0) return;
    this.inviteToast.set(null);
    this.inviteRecipients.set(this.selectedIds());
    this.waitlistInviteOpen.set(true);
  }

  /** Persistent quick action — invite the N oldest un-invited rows (no selection). */
  protected onInviteOldest(): void {
    this.inviteToast.set(null);
    this.inviteRecipients.set([]);
    this.waitlistInviteOpen.set(true);
  }

  protected onInviteClose(): void {
    this.waitlistInviteOpen.set(false);
  }

  protected onInviteSent(result: AdminInviteWaitlistResponse): void {
    this.inviteToast.set(result);
    this.clearSelection();
    this.refreshTick.update((v) => v + 1);
    this.fetchStats();
    setTimeout(() => this.waitlistInviteOpen.set(false), 1200);
    setTimeout(() => {
      if (this.inviteToast() === result) this.inviteToast.set(null);
    }, 6000);
  }

  // --- Approve → Builders (Invited tab) ------------------------------------
  protected onApprove(row: WaitlistRow): void {
    this.approveEmail.set(row.email);
    // Wait a tick so the [email] input flows into the modal before it opens.
    queueMicrotask(() => this.compLicenseModal()?.open());
  }

  protected onApproved(): void {
    this.approvedAt.set(Date.now());
    this.refreshTick.update((v) => v + 1);
    this.fetchStats();
    setTimeout(() => this.approvedAt.set(null), 6000);
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

  // --- Derived stage (All tab chip) ----------------------------------------
  protected stageLabel(row: WaitlistRow): string {
    if (row.convertedAt) return 'Converted';
    if (row.notifiedAt) return 'Invited';
    return 'New';
  }

  protected stageVariant(row: WaitlistRow): 'success' | 'info' | 'ghost' {
    if (row.convertedAt) return 'success';
    if (row.notifiedAt) return 'info';
    return 'ghost';
  }
}
