import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  DOCUMENT,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ActivatedRoute,
  NavigationEnd,
  PRIMARY_OUTLET,
  Router,
} from '@angular/router';
import { filter } from 'rxjs';
import {
  ArrowLeft,
  Brain,
  CalendarClock,
  LucideAngularModule,
  MessagesSquare,
  RadioTower,
  Sparkles,
  type LucideIconData,
} from 'lucide-angular';

import {
  AppStateManager,
  SurfaceRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  ThothStatusService,
  type ThothGatewayBadge,
} from '@ptah-extension/dashboard';
import { MemoryCuratorTabComponent } from '@ptah-extension/memory-curator-ui';
import { SkillSynthesisTabComponent } from '@ptah-extension/skill-synthesis-ui';
import { CronSchedulerTabComponent } from '@ptah-extension/cron-scheduler-ui';
import { MessagingGatewayTabComponent } from '@ptah-extension/messaging-gateway-ui';

/** Tab identifiers for the Thoth hub, in rail order. */
export const THOTH_TAB_IDS = ['memory', 'skills', 'cron', 'gateway'] as const;

/** Tab identifiers for the Thoth hub. */
export type ThothActiveTabId = (typeof THOTH_TAB_IDS)[number];

/** Whether `value` names a Thoth tab — the `/thoth/:tab` segment rule. */
export function isThothTabId(value: unknown): value is ThothActiveTabId {
  return (
    typeof value === 'string' &&
    (THOTH_TAB_IDS as readonly string[]).includes(value)
  );
}

/** The surface route id this shell is mounted under (`/thoth/:tab`). */
const THOTH_SURFACE_PATH = 'thoth';

interface ThothTabSpec {
  readonly id: ThothActiveTabId;
  readonly label: string;
  readonly icon: LucideIconData;
  /** When true, this tab requires the Electron desktop platform. */
  readonly electronOnly: boolean;
}

/**
 * ThothShellComponent — the standalone Thoth page hosting the agentic
 * platform features (Memory, Skills, Schedules, Messaging). Renders a left
 * navigation rail on wide layouts that collapses to a horizontal strip on
 * narrow ones (VS Code sidebar).
 *
 * The URL decides the tab: the shell is mounted by `THOTH_ROUTES` over a
 * component-less `:tab` child, and renders the tab body itself from that
 * param. That is why the template has no `<router-outlet>` — nothing below the
 * shell has a component to activate. The last settled tab is recorded per
 * workspace in {@link AppStateManager.thothActiveTab}, which `/thoth`'s
 * redirect reads.
 */
@Component({
  selector: 'ptah-thoth-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    LucideAngularModule,
    MemoryCuratorTabComponent,
    SkillSynthesisTabComponent,
    CronSchedulerTabComponent,
    MessagingGatewayTabComponent,
  ],
  template: `
    <div class="flex h-full w-full flex-col bg-surface-0 lg:flex-row">
      <aside
        class="surface-1 flex shrink-0 flex-col lg:w-64"
        data-testid="thoth-section-nav"
      >
        <div class="flex items-center gap-2 px-3 pb-3 pt-4 lg:px-4">
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            aria-label="Back to chat"
            (click)="goBack()"
          >
            <lucide-angular
              [img]="ArrowLeftIcon"
              class="size-4"
              aria-hidden="true"
            />
          </button>
          <lucide-angular
            [img]="RadioTowerIcon"
            class="size-4 text-secondary"
            aria-hidden="true"
          />
          <div class="leading-tight">
            <h1 class="text-sm font-semibold text-base-content">Thoth</h1>
            <p class="text-[11px] text-base-content-muted">Agentic platform</p>
          </div>
        </div>

        <nav
          role="tablist"
          aria-label="Thoth feature tabs"
          class="flex gap-1.5 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-4"
        >
          @for (tab of visibleTabs(); track tab.id) {
            @let status = pillars()[tab.id];
            @let isActive = activeTab() === tab.id;
            <button
              type="button"
              role="tab"
              class="flex min-w-[8.5rem] flex-col gap-1.5 rounded-xl px-3 py-3 text-left transition-colors duration-150 lg:min-w-0"
              [class.surface-3]="isActive"
              [class.hover:bg-surface-2]="!isActive"
              [class.opacity-70]="!status.available"
              [attr.aria-selected]="isActive"
              [attr.aria-controls]="'thoth-panel-' + tab.id"
              [id]="'thoth-tab-' + tab.id"
              data-testid="dashboard-status-card"
              [attr.data-pillar]="tab.id"
              (click)="selectTab(tab.id)"
            >
              <div class="flex items-center gap-2">
                <lucide-angular
                  [img]="tab.icon"
                  class="size-4 shrink-0"
                  [class.text-secondary]="isActive"
                  [class.text-base-content-muted]="!isActive"
                  aria-hidden="true"
                />
                <span
                  data-testid="thoth-tab-label"
                  class="text-sm"
                  [class.font-medium]="isActive"
                  [class.text-base-content]="isActive"
                  [class.text-base-content-muted]="!isActive"
                  >{{ tab.label }}</span
                >
                @if (status.paused) {
                  <span
                    class="badge badge-warning badge-sm ml-auto text-xs font-medium"
                    data-testid="thoth-tab-paused"
                    >Paused</span
                  >
                }
              </div>

              @if (status.available) {
                <div class="flex items-baseline gap-1 pl-6">
                  <span
                    data-testid="dashboard-status-card-value"
                    class="text-xl font-semibold leading-none"
                    [class]="status.accent"
                    >{{ status.value }}</span
                  >
                  @if (status.unit) {
                    <span class="text-[11px] text-base-content-muted">{{
                      status.unit
                    }}</span>
                  }
                </div>
                @if (tab.id === 'gateway' && status.platforms.length > 0) {
                  <div class="flex flex-wrap items-center gap-1 pl-6">
                    @for (
                      platform of status.platforms;
                      track platform.platform
                    ) {
                      <span
                        [class]="badgeClassFor(platform.state)"
                        [attr.title]="platform.lastError ?? platform.state"
                        >{{ platform.platform }}</span
                      >
                    }
                  </div>
                } @else {
                  <span
                    class="truncate pl-6 text-[11px] text-base-content-muted"
                    >{{ status.desc }}</span
                  >
                }
              } @else {
                <span class="pl-6 text-[11px] text-base-content-muted">{{
                  status.desc
                }}</span>
              }
            </button>
          }
        </nav>
      </aside>

      <section
        class="flex-1 overflow-y-auto"
        data-testid="thoth-section-panel"
        role="tabpanel"
        [id]="'thoth-panel-' + activeTab()"
        [attr.aria-labelledby]="'thoth-tab-' + activeTab()"
      >
        <div class="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          @switch (activeTab()) {
            @case ('memory') {
              <ptah-memory-curator-tab (pausedChange)="onPausedChange()" />
            }
            @case ('skills') {
              <ptah-skill-synthesis-tab (pausedChange)="onPausedChange()" />
            }
            @case ('cron') {
              <ptah-cron-scheduler-tab />
            }
            @case ('gateway') {
              <ptah-messaging-gateway-tab />
            }
          }
        </div>
      </section>
    </div>
  `,
})
export class ThothShellComponent implements OnInit {
  private readonly appState = inject(AppStateManager);
  private readonly vscodeService = inject(VSCodeService);
  private readonly thothStatus = inject(ThothStatusService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly surfaceRouter = inject(SurfaceRouterService);

  /**
   * The `:tab` the Router last settled on below this shell, or `null` when the
   * shell is not mounted over a `:tab` child.
   *
   * Seeded synchronously from the snapshot, because
   * `SurfaceRouterService.remountActiveSurface` re-creates the shell on a
   * workspace switch with no navigation, so no `NavigationEnd` follows it.
   */
  private readonly routeTab = signal<ThothActiveTabId | null>(
    this.tabOfRoute(),
  );

  protected readonly RadioTowerIcon = RadioTower;
  protected readonly ArrowLeftIcon = ArrowLeft;

  /**
   * Per-pillar status tiles keyed by tab id, derived from
   * {@link ThothStatusService}. Powers the live numbers in each sidebar tile.
   */
  protected readonly pillars = this.thothStatus.pillars;

  public constructor() {
    // The Memory / Skills switches can change outside this view (tray menu,
    // a hand edit of ~/.ptah/settings.json) and nothing pushes that to the
    // webview, so re-read the two pause flags whenever the window comes back.
    const doc = inject(DOCUMENT);
    const view = doc.defaultView;
    const reread = (): void => void this.thothStatus.refreshPaused();
    const onVisibility = (): void => {
      if (doc.visibilityState === 'visible') reread();
    };
    view?.addEventListener('focus', reread);
    doc.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() => {
      view?.removeEventListener('focus', reread);
      doc.removeEventListener('visibilitychange', onVisibility);
    });

    // Tab memory is written at settle time only, never ahead of a navigation
    // (TASK_2026_317 rule, as `MarketplaceShellComponent` does). A remount runs
    // with the Router idle, so its seeded tab is already settled: record it now,
    // against the workspace the shell was re-created for. Constructed during a
    // navigation instead, the NavigationEnd below records it.
    const seeded = this.routeTab();
    if (seeded !== null && this.router.currentNavigation() === null) {
      this.appState.setThothActiveTab(seeded);
    }

    // Subscribed during construction, which happens while the Router is
    // activating this shell, so the NavigationEnd of the very navigation that
    // opened Thoth is recorded too.
    this.router.events
      .pipe(
        filter(
          (event): event is NavigationEnd => event instanceof NavigationEnd,
        ),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        if (!this.isThothUrl(event.urlAfterRedirects)) return;
        const tab = this.tabOfRoute();
        if (tab === null) return;
        this.routeTab.set(tab);
        this.appState.setThothActiveTab(tab);
      });
  }

  public ngOnInit(): void {
    void this.thothStatus.refreshIfNeeded();
  }

  /** A tab's master switch flipped: update the sidebar "Paused" badge. */
  protected onPausedChange(): void {
    void this.thothStatus.refreshPaused();
  }

  /** daisyUI badge classes for a gateway platform's connection state. */
  protected badgeClassFor(state: ThothGatewayBadge): string {
    switch (state) {
      case 'running':
        return 'badge badge-success badge-xs';
      case 'enabled':
        return 'badge badge-info badge-xs';
      case 'error':
        return 'badge badge-error badge-xs';
      case 'disabled':
      default:
        return 'badge badge-ghost badge-xs';
    }
  }

  /**
   * All four tabs and their platform requirements. Memory and Skill-Synthesis
   * depend on better-sqlite3 (native) + the embedder-worker, so they are
   * Electron-only alongside Cron and Gateway. Each tab component owns its own
   * desktop-only placeholder, mirroring the cron/gateway pattern.
   */
  protected readonly tabs: readonly ThothTabSpec[] = [
    { id: 'memory', label: 'Memory', icon: Brain, electronOnly: true },
    { id: 'skills', label: 'Skills', icon: Sparkles, electronOnly: true },
    { id: 'cron', label: 'Schedules', icon: CalendarClock, electronOnly: true },
    {
      id: 'gateway',
      label: 'Messaging',
      icon: MessagesSquare,
      electronOnly: true,
    },
  ];

  /** Whether the webview is running inside the Electron desktop app. */
  public readonly isElectron = computed(
    () => this.vscodeService.config()?.isElectron === true,
  );

  /**
   * Tabs visible in the current platform. Cron and Gateway tabs render in
   * both VS Code and Electron, but show a placeholder when not on Electron.
   * Keeping them visible (rather than hiding) preserves a stable tab order.
   */
  public readonly visibleTabs = computed(() => this.tabs);

  /**
   * The tab on screen: the settled `:tab` param. Without a `:tab` child (the
   * shell created outside `THOTH_ROUTES`) it falls back to the remembered tab
   * in {@link AppStateManager.thothActiveTab}, which is also what `/thoth`
   * redirects to.
   */
  public readonly activeTab = computed<ThothActiveTabId>(
    () => this.routeTab() ?? this.appState.thothActiveTab(),
  );

  /**
   * Navigate to a different tab and reload the sidebar tiles, so a count that
   * changed while the user was on another tab is not left frozen. The tab on
   * screen and its memory follow once the navigation settles. Re-clicking the
   * active tab changes nothing and fetches nothing.
   *
   * The tab switch replaces the URL rather than pushing it (decision D6), so
   * Back leaves Thoth instead of cycling through its tabs.
   */
  public selectTab(tabId: ThothActiveTabId): void {
    if (tabId === this.activeTab()) return;
    void this.surfaceRouter.navigateToSurface(THOTH_SURFACE_PATH, [tabId], {
      replaceUrl: true,
    });
    void this.thothStatus.refresh();
  }

  /** Leave Thoth and return to the chat view. */
  public goBack(): void {
    this.appState.setCurrentView('chat');
  }

  /** The valid `:tab` param of this shell's child route, if any. */
  private tabOfRoute(): ThothActiveTabId | null {
    const tab = this.route.snapshot.firstChild?.paramMap.get('tab');
    return isThothTabId(tab) ? tab : null;
  }

  /** Whether a settled URL is under `/thoth`. */
  private isThothUrl(url: string): boolean {
    const segments =
      this.router.parseUrl(url).root.children[PRIMARY_OUTLET]?.segments;
    return segments?.[0]?.path === THOTH_SURFACE_PATH;
  }
}
