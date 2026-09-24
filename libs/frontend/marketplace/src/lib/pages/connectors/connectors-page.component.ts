import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { filter, map } from 'rxjs';
import {
  ArrowLeft,
  CircleAlert,
  KeyRound,
  LucideAngularModule,
  RotateCw,
  Search,
} from 'lucide-angular';
import {
  PTAH_CONNECTORS,
  ptahConnectorCategoryLabel,
  type PtahConnector,
  type PtahConnectorCategory,
} from '@ptah-extension/shared';
import {
  BrandMarkComponent,
  CatalogCardComponent,
  CatalogCardSkeletonComponent,
  CatalogGridComponent,
  NativeDrawerComponent,
} from '@ptah-extension/ui';

import {
  ConnectorLinksStore,
  type ConnectorLinksState,
} from '../../data/connector-links.store';
import { HarnessHealthStore } from '../../harness/harness-health.store';
import { harnessTargetLabel } from '../../harness/harness-health.model';
import { MarketplaceLayout } from '../../layout/marketplace-layout';
import { marketplaceRouteLink } from '../../shell/marketplace-route-url';
import {
  CONNECTOR_CATEGORY_QUERY_PARAM,
  CategoryBentoComponent,
  connectorCategoryQueryParams,
} from '../../ui/category-bento.component';
import { ConnectorCardActionsComponent } from '../../ui/connector-card-actions.component';
import { ConnectorCardStatusComponent } from '../../ui/connector-card-status.component';
import {
  connectorCardState,
  type ConnectorCardAction,
  type ConnectorCardState,
} from '../../ui/connector-card-state';
import {
  FeaturedConnectorsComponent,
  selectFeaturedConnectors,
  type ConnectorActionRequest,
  type FeaturedConnectorView,
  type FeaturedConnectorsState,
} from '../../ui/featured-connectors.component';
import {
  StorefrontHeroComponent,
  type StackTileState,
} from '../../ui/storefront-hero.component';
import type { TargetMarkItem } from '../../ui/target-marks.component';
import { ConnectorActionsTracker } from './connector-actions';
import {
  CLI_TILE_ID,
  CONNECTOR_ID_PARAM,
  connectorDetailPlacement,
  connectorStackTiles,
  filterConnectors,
  isTypingTarget,
  parseConnectorCategory,
  placeActionError,
  usedConnectorCategories,
  type ActionErrorPlacement,
  type ConnectorActionOrigin,
  type TrackedActionError,
} from './connector-cards';

/** The card activators of the page, in DOM order, for ↑/↓. */
const CARD_ACTIVATOR_SELECTOR = '[data-testid="catalog-card-activator"]';

/** Skeleton cards shown while the first connection read is in flight. */
const SKELETON_COUNT = 6;

/** A page-level action error, with the connector label for its wording. */
interface PageActionError extends TrackedActionError {
  readonly label: string;
}

/**
 * ConnectorsPageComponent — the catalogue storefront (plan C9), at
 * `/marketplace/connectors` with `?category=<id>`.
 *
 * ## What it renders
 *
 * - Compact and regular: a page header (`<h1>Connectors</h1>`), the search
 *   field, the category filter and the full grid of `ptah-catalog-card`s.
 * - Wide: the storefront — `ptah-storefront-hero` (its title is the `<h1>`),
 *   `ptah-featured-connectors` (the first six not-connected `oauth-dcr`
 *   entries, {@link selectFeaturedConnectors}), `ptah-category-bento`, then
 *   the same full grid.
 *
 * Each card carries the brand mark and category/sign-in meta; its status and
 * actions are the shared `ptah-connector-card-status` /
 * `ptah-connector-card-actions` content over `connectorCardState` (the same
 * as the featured row and the detail). The card title opens the detail.
 *
 * ## Detail placement (the page owns it)
 *
 * The detail is a child route. At compact and regular it renders in an
 * overlay `ptah-native-drawer` (focus trap, Esc, backdrop); at wide it takes
 * the whole page — the list is removed, a "Back to connectors" link sits
 * above it, the detail moves focus to its own `<h1>`, and Esc returns to the
 * list with focus on the card that opened it (or the grid heading when a
 * filter has since hidden that card). Open ⇔ the active child route has a
 * `connectorId` (router state, read on `NavigationEnd`).
 *
 * ## Data
 *
 * `ensure()` on the links store only — the page's RPC set is the link reads.
 * At wide the hero also needs the detected CLIs: the root
 * `HarnessHealthStore` is read if loaded, else asked once (`harness:health`,
 * the backend's cached report; accepted by the orchestrator). A failed read
 * shows "No CLI detected" and a "CLIs detected" tile in its error state whose
 * Retry asks again.
 *
 * ## Keyboard
 *
 * ↑/↓ move between card titles, Enter opens the focused card (a native
 * button), Esc closes the detail. `/` (the shell) focuses the search field.
 */
@Component({
  selector: 'ptah-connectors-page',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    LucideAngularModule,
    BrandMarkComponent,
    CatalogCardComponent,
    CatalogCardSkeletonComponent,
    CatalogGridComponent,
    NativeDrawerComponent,
    StorefrontHeroComponent,
    FeaturedConnectorsComponent,
    CategoryBentoComponent,
    ConnectorCardStatusComponent,
    ConnectorCardActionsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ConnectorActionsTracker],
  host: {
    class: 'block',
    'data-testid': 'connectors-page',
    '(keydown)': 'onKeyDown($event)',
  },
  templateUrl: './connectors-page.component.html',
})
export class ConnectorsPageComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly harness = inject(HarnessHealthStore);
  private readonly layout = inject(MarketplaceLayout);
  protected readonly links = inject(ConnectorLinksStore);
  protected readonly tracker = inject(ConnectorActionsTracker);

  protected readonly SearchIcon = Search;
  protected readonly AlertIcon = CircleAlert;
  protected readonly RetryIcon = RotateCw;
  protected readonly KeyIcon = KeyRound;
  protected readonly BackIcon = ArrowLeft;

  protected readonly connectors = PTAH_CONNECTORS;
  protected readonly categories = usedConnectorCategories(PTAH_CONNECTORS);
  protected readonly categoryLabel = ptahConnectorCategoryLabel;
  protected readonly skeletonSlots = Array.from(
    { length: SKELETON_COUNT },
    (_, index) => index,
  );
  protected readonly smitheryKeyLink = marketplaceRouteLink({
    page: 'servers',
    source: 'smithery',
  });
  protected readonly customUrlLink = marketplaceRouteLink({
    page: 'servers',
    source: 'custom-url',
  });

  private readonly gridHeading =
    viewChild<ElementRef<HTMLElement>>('gridHeading');

  /** The search box text; page-local (filters are not navigation). */
  protected readonly query = signal('');

  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });

  /** The `?category=` filter; `null` is "All". */
  protected readonly category = computed(() =>
    parseConnectorCategory(
      this.queryParamMap().get(CONNECTOR_CATEGORY_QUERY_PARAM),
    ),
  );

  /** The connector the open detail shows, from the active child route. */
  protected readonly detailId = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.readDetailId()),
    ),
    { initialValue: this.readDetailId() },
  );

  protected readonly wide = computed(() => this.layout.tier() === 'wide');
  protected readonly placement = computed(() =>
    connectorDetailPlacement(this.layout.tier()),
  );
  protected readonly detailOpen = computed(() => this.detailId() !== null);
  /** Wide + a detail: the detail takes the page and the list is removed. */
  protected readonly fullPageDetail = computed(
    () => this.detailOpen() && this.placement() === 'page',
  );

  /**
   * True until the first connection read settles: the grid shows skeletons
   * rather than a Connect button on a connector that may be connected.
   */
  protected readonly firstLoad = linkedSignal<ConnectorLinksState, boolean>({
    source: this.links.state,
    computation: (state, previous) =>
      previous?.value === false
        ? false
        : state === 'idle' || state === 'loading',
  });

  protected readonly visibleConnectors = computed(() =>
    filterConnectors(this.connectors, this.query(), this.category()),
  );

  protected readonly featuredItems = computed<FeaturedConnectorView[]>(() =>
    selectFeaturedConnectors(this.connectors, this.links.links()).map(
      (connector) => {
        const link = this.links.linkOf(connector);
        return {
          connector,
          status: link.status,
          detail: link.detail ?? null,
          busy: this.links.isBusy(connector),
          polling: this.links.isPolling(connector),
          managedElsewhere: link.managedElsewhere === true,
        };
      },
    ),
  );

  /** Every action error with the one place it renders. */
  private readonly placedErrors = computed(() => {
    const listShown = !this.fullPageDetail() && !this.firstLoad();
    const surfaces = {
      featuredIds:
        listShown && this.wide()
          ? new Set(this.featuredItems().map((item) => item.connector.id))
          : new Set<string>(),
      gridIds: listShown
        ? new Set(this.visibleConnectors().map((c) => c.id))
        : new Set<string>(),
      detailId: this.detailId(),
    };
    return this.tracker.actionErrors().map((error) => ({
      error,
      placement: placeActionError(error, surfaces),
    }));
  });

  private errorsAt(place: ActionErrorPlacement): TrackedActionError[] {
    return this.placedErrors()
      .filter((placed) => placed.placement === place)
      .map((placed) => placed.error);
  }

  protected readonly featuredErrors = computed(() => this.errorsAt('featured'));

  /** Errors with no card on screen, each named by its connector. */
  protected readonly pageErrors = computed<PageActionError[]>(() =>
    this.errorsAt('page').map((error) => ({
      ...error,
      label:
        this.connectors.find((c) => c.id === error.connectorId)?.label ??
        error.connectorId,
    })),
  );

  protected readonly gridCards = computed<ConnectorCardState[]>(() => {
    const smitheryUnavailable = this.links.smitheryUnavailable();
    const timedOut = this.tracker.timedOutIds();
    const errors = new Map(
      this.errorsAt('grid').map((e) => [e.connectorId, e.message] as const),
    );
    return this.visibleConnectors().map((connector) => {
      const link = this.links.linkOf(connector);
      return connectorCardState(connector, {
        status: link.status,
        detail: link.detail ?? null,
        managedElsewhere: link.managedElsewhere === true,
        busy: this.links.isBusy(connector),
        polling: this.links.isPolling(connector),
        smitheryUnavailable,
        timedOut: timedOut.has(connector.id),
        error: errors.get(connector.id) ?? null,
      });
    });
  });

  protected readonly featuredState = computed<FeaturedConnectorsState>(() => {
    if (this.firstLoad()) return 'loading';
    return this.links.state() === 'error' ? 'error' : 'ready';
  });

  private readonly harnessAsked = signal(false);

  /** The harness read's outcome for the hero: detected CLIs, or its state. */
  private readonly harnessView = computed<{
    readonly state: StackTileState;
    readonly targets: TargetMarkItem[] | null;
  }>(() => {
    const health = this.harness.health();
    if (health !== null) {
      const targets = health.targets
        .filter((target) => target.detected)
        .map((target) => ({
          target: target.target,
          label: harnessTargetLabel(target.target),
        }));
      return { state: 'ready', targets };
    }
    if (!this.harnessAsked() || this.harness.loading()) {
      return { state: 'loading', targets: null };
    }
    // Answered with no report (no pass has run), or failed: either way no
    // CLI is known. A failure also puts the CLI tile in its error state.
    return {
      state: this.harness.error() === null ? 'ready' : 'error',
      targets: [],
    };
  });

  /** Detected CLIs for the hero; `null` only while the read is in flight. */
  protected readonly syncedTargets = computed(() => this.harnessView().targets);

  protected readonly stackTiles = computed(() => {
    const harness = this.harnessView();
    return connectorStackTiles(
      this.links.state(),
      this.links.links(),
      this.connectors.length,
      {
        state: harness.state,
        count: harness.targets === null ? null : harness.targets.length,
      },
    );
  });

  /** The last detail opened, to put focus back on its card after a full-page close. */
  private lastDetailId: string | null = null;

  public constructor() {
    void this.links.ensure();

    // The hero needs the detected CLIs, and only at wide. Ask once; the root
    // store keeps the answer for every other page. The CLI tile's Retry asks
    // again after a failure.
    effect(() => {
      if (!this.wide() || this.harness.health() !== null) return;
      untracked(() => {
        if (this.harnessAsked() || this.harness.loading()) return;
        this.harnessAsked.set(true);
        void this.harness.refresh();
      });
    });

    effect(() => {
      const id = this.detailId();
      const fullPage = this.placement() === 'page';
      untracked(() => {
        if (id !== null) {
          this.lastDetailId = id;
          return;
        }
        const previous = this.lastDetailId;
        this.lastDetailId = null;
        // The drawer restores focus itself; the full page re-creates the
        // list, so focus goes back to the card that opened the detail.
        if (previous !== null && fullPage) {
          afterNextRender(() => this.focusCard(previous), {
            injector: this.injector,
          });
        }
      });
    });
  }

  // ── Template handlers ──────────────────────────────────────────────────────

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected clearFilters(): void {
    this.query.set('');
    this.selectCategory(null);
  }

  protected selectCategory(category: PtahConnectorCategory | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams:
        category === null
          ? { [CONNECTOR_CATEGORY_QUERY_PARAM]: null }
          : connectorCategoryQueryParams(category),
      queryParamsHandling: 'merge',
    });
  }

  /** A bento tile: filter the grid and bring it into view. */
  protected browseCategory(category: PtahConnectorCategory): void {
    this.selectCategory(category);
    this.revealGrid();
  }

  /** "Browse all connectors": clear the category and bring the grid into view. */
  protected browseAll(): void {
    if (this.category() !== null) this.selectCategory(null);
    this.revealGrid();
  }

  protected openDetail(connector: PtahConnector): void {
    void this.router.navigate([connector.id], {
      relativeTo: this.route,
      queryParamsHandling: 'preserve',
    });
  }

  protected closeDetail(): void {
    void this.router.navigate(['./'], {
      relativeTo: this.route,
      queryParamsHandling: 'preserve',
    });
  }

  protected onFeaturedAction(request: ConnectorActionRequest): void {
    void this.act(request.action, request.connector, 'featured');
  }

  protected onGridAction(
    action: ConnectorCardAction,
    card: ConnectorCardState,
  ): void {
    void this.act(action, card.connector, 'grid');
  }

  protected retryTimedOut(card: ConnectorCardState): void {
    if (card.locked) return;
    void this.tracker.retry(card.connector, 'grid');
  }

  protected retryLoad(): void {
    void this.links.reload();
  }

  /** A hero tile's Retry: the CLI tile re-reads harness health, the rest the links. */
  protected retryTile(id: string): void {
    if (id === CLI_TILE_ID) {
      void this.harness.refresh();
      return;
    }
    this.retryLoad();
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      if (!this.fullPageDetail() || isTypingTarget(event.target)) return;
      event.preventDefault();
      this.closeDetail();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      this.moveCardFocus(event, event.key === 'ArrowDown' ? 1 : -1);
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** One action; an `oauth-app` Connect opens the detail, where its setup form is. */
  private async act(
    action: ConnectorCardAction,
    connector: PtahConnector,
    origin: ConnectorActionOrigin,
  ): Promise<void> {
    const outcome = await this.tracker.run(action, connector, origin);
    if (outcome.kind === 'needs-setup') this.openDetail(connector);
  }

  private readDetailId(): string | null {
    return (
      this.route.firstChild?.snapshot.paramMap.get(CONNECTOR_ID_PARAM) ?? null
    );
  }

  private moveCardFocus(event: KeyboardEvent, step: 1 | -1): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.matches(CARD_ACTIVATOR_SELECTOR)) return;
    const activators = this.cardActivators();
    const index = activators.indexOf(target);
    const next = activators[index + step];
    if (index === -1 || next === undefined) return;
    event.preventDefault();
    next.focus();
  }

  private cardActivators(): HTMLElement[] {
    return Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        CARD_ACTIVATOR_SELECTOR,
      ),
    ).filter((el) => el.closest('[hidden], [inert], [role="dialog"]') === null);
  }

  /**
   * Focus the grid card of `connectorId`; when a filter has since hidden it,
   * the grid heading, so focus never falls back to `<body>`.
   */
  private focusCard(connectorId: string): void {
    const card = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        '[data-grid-connector]',
      ),
    ).find((el) => el.getAttribute('data-grid-connector') === connectorId);
    const activator = card?.querySelector<HTMLElement>(CARD_ACTIVATOR_SELECTOR);
    if (activator) {
      activator.focus();
      return;
    }
    this.gridHeading()?.nativeElement.focus();
  }

  /** Scroll the full grid into view and move focus to its heading. */
  private revealGrid(): void {
    afterNextRender(
      () => {
        const heading = this.gridHeading()?.nativeElement;
        if (!heading) return;
        heading.scrollIntoView?.({ block: 'start' });
        heading.focus();
      },
      { injector: this.injector },
    );
  }
}
