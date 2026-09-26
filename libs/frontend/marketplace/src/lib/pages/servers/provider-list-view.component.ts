import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  type Signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs';
import { CircleAlert, LucideAngularModule, X } from 'lucide-angular';
import {
  KeyboardNavigationService,
  NativeDrawerComponent,
} from '@ptah-extension/ui';

import {
  MarketplaceInventoryStore,
  removalIdOf,
  type InventoryRemovalRef,
  type InventoryRemovalResult,
} from '../../data/marketplace-inventory.store';
import {
  applyProviderView,
  providerFilterOptions,
  type ProviderFilter,
  type ProviderSort,
} from '../../data/provider-filtering';
import type { ProviderRow } from '../../data/provider-row';
import { MarketplaceLayout } from '../../layout/marketplace-layout';
import { marketplaceRouteLink } from '../../shell/marketplace-route-url';
import {
  BulkActionBarComponent,
  type BulkActionResult,
} from '../../ui/bulk-action-bar.component';
import { DirectRemovalConfirmComponent } from '../../ui/direct-removal-confirm.component';
import { DockedInspectorComponent } from '../../ui/docked-inspector.component';
import { ProviderCardListComponent } from '../../ui/provider-card-list.component';
import { ProviderFiltersComponent } from '../../ui/provider-filters.component';
import {
  ProviderTableComponent,
  isProviderRowSelectable,
} from '../../ui/provider-table.component';
import {
  findGroupByRef,
  injectProviderRows,
} from '../../data/installed-provider-rows';

/** One block of rows: the whole list, or one origin group at wide. */
export interface ProviderListSection {
  readonly id: string;
  /** Group header; `null` for the ungrouped list. */
  readonly heading: string | null;
  readonly rows: readonly ProviderRow[];
}

/**
 * A removal waiting for the user to confirm a `direct` config edit. It holds
 * WHAT is pending, not a snapshot of rows: the rows shown and removed are
 * re-derived live ({@link ProviderListViewComponent.confirmView}), so a
 * filter or selection change made while it is open can never remove a row
 * the confirmation does not show.
 */
type PendingConfirm =
  { readonly mode: 'single'; readonly ref: string } | { readonly mode: 'bulk' };

/** What the open confirmation shows, and what "Remove anyway" removes. */
interface ConfirmView {
  /** Everything the confirmed action removes. */
  readonly rows: readonly ProviderRow[];
  /** The rows Ptah did not write, whose config files are named. */
  readonly direct: readonly ProviderRow[];
  /** Bulk: how many rows the run removes; `null` for a single removal. */
  readonly selectedCount: number | null;
}

const EMPTY_FILTER: ProviderFilter = {
  search: '',
  origin: null,
  target: null,
  status: null,
};

/** Keys that move the active row. */
const NAV_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/** A row's open control, in the table and in the card list. */
const OPEN_CONTROL =
  'button[data-testid="provider-row-open"], button[data-testid="provider-card-open"]';

const MISSING_REASON = 'It is no longer installed.';

const BULK_FAILED_REASON = 'The removal could not run.';

/** Per-instance prefix for group heading ids. */
let nextListViewId = 0;

/**
 * The bulk bar's outcome for one `removeMany` run: every `removed` counts,
 * everything else (failed, refused) is a failure with the store's message.
 * `missing` are rows that vanished between selection and removal.
 */
export function bulkRemovalResult(
  results: readonly InventoryRemovalResult[],
  missing: readonly ProviderRow[] = [],
): BulkActionResult {
  let removed = 0;
  const failed: { name: string; reason: string }[] = [];
  for (const { ref, outcome } of results) {
    if (outcome.status === 'removed') {
      removed += 1;
      continue;
    }
    failed.push({ name: removalName(ref), reason: outcome.message });
  }
  for (const row of missing) {
    failed.push({ name: row.title, reason: MISSING_REASON });
  }
  return { removed, failed };
}

function removalName(ref: InventoryRemovalRef): string {
  switch (ref.kind) {
    case 'server':
      return ref.group.serverKey;
    case 'community-skill':
      return ref.name;
    case 'marketplace-plugin':
      return ref.listing.name;
  }
}

/**
 * True when a key belongs to a field the user types in (search, dropdown
 * filter text), so the list must not treat it as navigation. Checkboxes are
 * not typing fields: arrows on a row checkbox move between rows.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return target.type !== 'checkbox' && target.type !== 'radio';
  }
  return (
    target.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

/**
 * ProviderListViewComponent — the installed-servers list shared by the
 * Overview and the Installed servers page (plan C7).
 *
 * ## What it owns
 *
 * - **Page-local view state.** Filter, sort, selection and the keyboard-active
 *   row are signals here. They survive a detail opening and closing, and a
 *   tier flip, because this component stays mounted: only its template
 *   branches change (A1, `marketplace-layout.spec.ts`).
 * - **Presentation by tier.** A table at regular and wide, cards at compact;
 *   origin groups with counted headers at wide when {@link groupByOrigin}.
 * - **Detail placement.** The detail is the routed child `:serverRef` of the
 *   page's route. It is open exactly when the router's active child carries a
 *   `serverRef` (read from router state on every `NavigationEnd`, never from
 *   outlet events). The outlet sits in a modal `NativeDrawer` at compact and
 *   regular (focus trapped, Escape handled by the drawer) and in a
 *   `DockedInspector` at wide (no focus move; Escape handled here). Closing
 *   navigates back to the list route.
 * - **Keyboard.** ↑/↓/Home/End move the active row (through the ui
 *   `KeyboardNavigationService`) and focus its open control; Enter opens it;
 *   Esc cancels a pending confirmation, else closes the docked detail and
 *   returns focus to the active row.
 * - **Removal.** One row or the selection, through the inventory store. A
 *   `direct` row (a config file Ptah did not write) is never removed without
 *   the inline confirmation naming its files. The bulk outcome (N removed,
 *   M failed with reasons) is computed here and handed to the bulk bar.
 * - **Projected content.** Whatever the page places inside the element
 *   renders in the list column under the rows, beside the docked detail at
 *   wide and outside the row keyboard region. The Installed servers page puts
 *   its "Use in sessions" toggles there, narrowed by {@link activeFilter}.
 *
 * It never calls `ensure()`: the page decides which slices load.
 */
@Component({
  selector: 'ptah-provider-list-view',
  standalone: true,
  imports: [
    RouterOutlet,
    LucideAngularModule,
    NativeDrawerComponent,
    BulkActionBarComponent,
    DirectRemovalConfirmComponent,
    DockedInspectorComponent,
    ProviderCardListComponent,
    ProviderFiltersComponent,
    ProviderTableComponent,
  ],
  providers: [KeyboardNavigationService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block min-w-0',
    'data-testid': 'provider-list-view',
    '[attr.data-tier]': 'tier()',
    '(keydown)': 'onKeydown($event)',
  },
  templateUrl: './provider-list-view.component.html',
})
export class ProviderListViewComponent {
  private readonly inventory = inject(MarketplaceInventoryStore);
  private readonly layout = inject(MarketplaceLayout);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly keyboardNav = inject(KeyboardNavigationService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** Names the list (its region and table caption). */
  public readonly heading = input<string>('Installed servers');

  /** Group rows by origin, with counted headers, at the wide tier. */
  public readonly groupByOrigin = input<boolean>(false);

  /** Show the origin segmented control in the filter bar. */
  public readonly showOriginFilter = input<boolean>(true);

  protected readonly ErrorIcon = CircleAlert;
  protected readonly CloseIcon = X;
  private readonly idPrefix = `ptah-provider-list-${nextListViewId++}`;

  // ── View state ─────────────────────────────────────────────────────────────

  protected readonly filter = signal<ProviderFilter>(EMPTY_FILTER);

  /**
   * The filter the user set in the bar, for page content projected under the
   * rows that must narrow with them (the Installed servers "Use in sessions"
   * panel). Read-only: only the filter bar changes it.
   */
  public readonly activeFilter: Signal<ProviderFilter> =
    this.filter.asReadonly();

  protected readonly sort = signal<ProviderSort>({
    key: 'name',
    direction: 'asc',
  });
  protected readonly selection = signal<ReadonlySet<string>>(new Set());
  protected readonly activeRef = signal<string | null>(null);
  protected readonly bulkBusy = signal(false);
  protected readonly bulkResult = signal<BulkActionResult | null>(null);
  protected readonly pendingConfirm = signal<PendingConfirm | null>(null);
  /** A single-row removal that failed or was refused. */
  protected readonly notice = signal<string | null>(null);

  private readonly detailRef = signal<string | null>(null);

  // ── Derived ────────────────────────────────────────────────────────────────

  protected readonly tier = this.layout.tier;
  protected readonly compact = computed(() => this.tier() === 'compact');
  /** The detail docks beside the list at wide; elsewhere it is a drawer. */
  protected readonly docked = computed(() => this.tier() === 'wide');

  private readonly allRows = injectProviderRows();

  protected readonly filterOptions = computed(() =>
    providerFilterOptions(this.allRows()),
  );

  protected readonly visibleRows = computed(() =>
    applyProviderView(this.allRows(), this.filter(), this.sort()),
  );

  /** The table's load state: an idle slice is about to load. */
  protected readonly listState = computed((): 'loading' | 'ready' | 'error' => {
    const state = this.inventory.installed().state;
    if (state === 'ready') return 'ready';
    return state === 'error' ? 'error' : 'loading';
  });

  protected readonly listError = computed(
    () => this.inventory.installed().error ?? null,
  );

  protected readonly sections = computed((): readonly ProviderListSection[] => {
    const rows = this.visibleRows();
    const grouped =
      this.groupByOrigin() &&
      this.docked() &&
      this.listState() === 'ready' &&
      rows.length > 0;
    if (!grouped) return [{ id: 'all', heading: null, rows }];
    return providerFilterOptions(rows).origins.map((origin) => ({
      id: origin.value,
      heading: origin.label,
      rows: rows.filter((row) => row.origin === origin.value),
    }));
  });

  /** Rows in on-screen order: the keyboard walks this. */
  private readonly navOrder = computed(() =>
    this.sections().flatMap((section) => section.rows),
  );

  /**
   * The selection the bulk action works on: selected rows that are visible
   * and removable. A row hidden by a filter is never removed unseen, and a
   * removed row drops out without a write.
   */
  protected readonly effectiveSelection = computed(() => {
    const selected = this.selection();
    return this.visibleRows().filter(
      (row) => selected.has(row.ref) && isProviderRowSelectable(row),
    );
  });

  /**
   * Refs of every row in the running bulk removal, from start to end. The
   * store's `pendingIds` holds only the row `removeMany` is on right now; the
   * rows still queued behind it must be disabled too, or a single Remove could
   * race the run.
   */
  private readonly queuedRefs = signal<ReadonlySet<string>>(new Set());

  /** Rows whose removal is running or queued: their buttons are disabled. */
  protected readonly busyRefs = computed((): ReadonlySet<string> => {
    const queued = this.queuedRefs();
    const pending = this.inventory.pendingIds();
    return queued.size === 0 ? pending : new Set([...queued, ...pending]);
  });

  protected readonly confirmView = computed((): ConfirmView | null => {
    const pending = this.pendingConfirm();
    if (pending === null) return null;
    if (pending.mode === 'single') {
      const row = this.allRows().find((r) => r.ref === pending.ref);
      return row?.removal.kind === 'confirm-direct'
        ? { rows: [row], direct: [row], selectedCount: null }
        : null;
    }
    const rows = this.effectiveSelection();
    const direct = rows.filter((row) => row.removal.kind === 'confirm-direct');
    return direct.length === 0
      ? null
      : { rows, direct, selectedCount: rows.length };
  });

  protected readonly detailOpen = computed(() => this.detailRef() !== null);

  protected readonly openRow = computed(() => {
    const ref = this.detailRef();
    return this.allRows().find((row) => row.ref === ref) ?? null;
  });

  protected readonly drawerLabel = computed(() => {
    const row = this.openRow();
    return row === null ? 'Server details' : `${row.title} details`;
  });

  protected readonly filtersActive = computed(() => {
    const current = this.filter();
    return (
      (current.search ?? '').trim() !== '' ||
      !!current.origin ||
      !!current.target ||
      !!current.status
    );
  });

  protected readonly emptyTitle = computed(() =>
    this.filtersActive()
      ? 'No servers match these filters'
      : 'No MCP servers installed yet',
  );

  protected readonly emptyDetail = computed(() =>
    this.filtersActive()
      ? 'Clear the filters to see every installed server.'
      : 'Connect an app or add an MCP server from a source.',
  );

  protected readonly emptyActionLabel = computed(() =>
    this.filtersActive() ? 'Clear filters' : 'Browse connectors',
  );

  public constructor() {
    this.syncDetailFromRouter();
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.syncDetailFromRouter());
  }

  // ── Filters, sort, selection ────────────────────────────────────────────────

  protected setFilter(next: ProviderFilter): void {
    this.filter.set(next);
  }

  protected emptyAction(): void {
    if (this.filtersActive()) {
      this.filter.set(EMPTY_FILTER);
      return;
    }
    void this.router.navigate(marketplaceRouteLink({ page: 'connectors' }));
  }

  protected retry(): void {
    void this.inventory.retry('installed');
  }

  protected clearSelection(): void {
    this.selection.set(new Set());
  }

  protected sectionCaption(section: ProviderListSection): string {
    return section.heading === null
      ? this.heading()
      : `${section.heading} servers`;
  }

  protected sectionHeadingId(section: ProviderListSection): string {
    return `${this.idPrefix}-${section.id}`;
  }

  // ── Detail ─────────────────────────────────────────────────────────────────

  protected open(row: ProviderRow): void {
    this.activeRef.set(row.ref);
    void this.router.navigate([row.ref], { relativeTo: this.route });
  }

  /** Back to the list route; the docked frame hands focus back to the row. */
  protected closeDetail(): void {
    const refocus = this.docked();
    void this.router
      .navigate(['./'], { relativeTo: this.route })
      .then((navigated) => {
        if (navigated && refocus) this.focusActiveRowAfterRender();
      });
  }

  private syncDetailFromRouter(): void {
    // While the router is still activating this page (the constructor runs
    // then), the child route exists but has no snapshot yet; the NavigationEnd
    // of that same navigation syncs again once it has one.
    const ref =
      this.route.firstChild?.snapshot?.paramMap.get('serverRef') ?? null;
    this.detailRef.set(ref);
    if (ref !== null) this.activeRef.set(ref);
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  protected onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'Escape') {
      if (this.confirmView() !== null) {
        event.preventDefault();
        this.pendingConfirm.set(null);
      } else if (this.detailOpen() && this.docked()) {
        event.preventDefault();
        this.closeDetail();
      }
      return;
    }

    if (!this.inRowsRegion(event.target) || isTypingTarget(event.target)) {
      return;
    }
    if (NAV_KEYS.has(event.key)) {
      if (this.moveActive(event)) event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      // A focused button (open, remove, lock) already acts on Enter.
      const target = event.target as HTMLElement;
      if (target.closest('button, a[href]') !== null) return;
      const row = this.activeRow();
      if (row !== null) {
        event.preventDefault();
        this.open(row);
      }
    }
  }

  private moveActive(event: KeyboardEvent): boolean {
    const order = this.navOrder();
    if (order.length === 0) return false;
    // Re-configured on every key: the state is the active row's REF (rows
    // re-filter and re-sort between keys), so its index is re-seeded each time.
    this.keyboardNav.configure({ itemCount: order.length, wrap: false });
    const current = order.findIndex((row) => row.ref === this.activeRef());
    let index: number;
    if (current === -1) {
      index =
        event.key === 'ArrowUp' || event.key === 'End' ? order.length - 1 : 0;
    } else {
      this.keyboardNav.setActiveIndex(current);
      if (!this.keyboardNav.handleKeyDown(event)) return false;
      index = this.keyboardNav.activeIndex();
    }
    const next = order[index];
    this.activeRef.set(next.ref);
    this.focusRow(next.ref);
    return true;
  }

  private activeRow(): ProviderRow | null {
    const ref = this.activeRef();
    return this.navOrder().find((row) => row.ref === ref) ?? null;
  }

  private inRowsRegion(target: EventTarget | null): boolean {
    return (
      target instanceof Element && target.closest('[data-list-rows]') !== null
    );
  }

  private focusRow(ref: string): void {
    const rows = this.host.nativeElement.querySelectorAll<HTMLElement>(
      '[data-list-rows] [data-ref]',
    );
    const row = Array.from(rows).find(
      (candidate) => candidate.getAttribute('data-ref') === ref,
    );
    row?.querySelector<HTMLElement>(OPEN_CONTROL)?.focus();
  }

  private focusActiveRowAfterRender(): void {
    afterNextRender(
      () => {
        const ref = this.activeRef();
        if (ref !== null) this.focusRow(ref);
      },
      { injector: this.injector },
    );
  }

  // ── Removal ────────────────────────────────────────────────────────────────

  /** A row's remove / disconnect button. */
  protected requestRemove(row: ProviderRow): void {
    // A row queued in a running bulk removal is already being removed.
    if (this.busyRefs().has(row.ref)) return;
    this.notice.set(null);
    if (row.removal.kind === 'confirm-direct') {
      this.pendingConfirm.set({ mode: 'single', ref: row.ref });
      return;
    }
    void this.removeOne(row, false);
  }

  /** The bulk bar's action. */
  protected requestBulkRemoval(): void {
    const rows = this.effectiveSelection();
    if (rows.length === 0 || this.bulkBusy()) return;
    if (rows.some((row) => row.removal.kind === 'confirm-direct')) {
      this.pendingConfirm.set({ mode: 'bulk' });
      return;
    }
    void this.removeSelected(rows, false);
  }

  /** "Remove anyway": removes exactly what the confirmation shows now. */
  protected confirmRemoval(): void {
    const view = this.confirmView();
    const pending = this.pendingConfirm();
    this.pendingConfirm.set(null);
    if (view === null || pending === null) return;
    if (pending.mode === 'single') {
      void this.removeOne(view.rows[0], true);
    } else if (!this.bulkBusy()) {
      void this.removeSelected(view.rows, true);
    }
  }

  protected cancelConfirm(): void {
    this.pendingConfirm.set(null);
  }

  private async removeOne(row: ProviderRow, confirmed: boolean): Promise<void> {
    const group = findGroupByRef(this.inventory.installed().data, row.ref);
    if (group === null) {
      this.notice.set(`"${row.title}" is no longer installed.`);
      return;
    }
    const outcome = await this.inventory.removeServer(group, {
      confirmedDirect: confirmed,
    });
    if (outcome.status !== 'removed') this.notice.set(outcome.message);
  }

  private async removeSelected(
    rows: readonly ProviderRow[],
    confirmed: boolean,
  ): Promise<void> {
    const groups = this.inventory.installed().data;
    const refs: InventoryRemovalRef[] = [];
    const missing: ProviderRow[] = [];
    for (const row of rows) {
      const group = findGroupByRef(groups, row.ref);
      if (group === null) missing.push(row);
      else refs.push({ kind: 'server', group, confirmedDirect: confirmed });
    }

    this.bulkBusy.set(true);
    this.bulkResult.set(null);
    this.queuedRefs.set(new Set(refs.map(removalIdOf)));
    try {
      const results = await this.inventory.removeMany(refs);
      this.bulkResult.set(bulkRemovalResult(results, missing));
      const removed = new Set(
        results
          .filter((result) => result.outcome.status === 'removed')
          .map((result) => result.id),
      );
      this.selection.update(
        (current) => new Set([...current].filter((ref) => !removed.has(ref))),
      );
    } catch (error: unknown) {
      // degradation-audit: reported — the store reports per-item outcomes and
      // does not throw; if it ever does, every item is shown as failed in the
      // bulk bar instead of the run vanishing silently.
      console.warn('[ProviderListView] bulk removal threw:', error);
      this.bulkResult.set({
        removed: 0,
        failed: rows.map((row) => ({
          name: row.title,
          reason: BULK_FAILED_REASON,
        })),
      });
    } finally {
      this.queuedRefs.set(new Set());
      this.bulkBusy.set(false);
    }
  }
}
