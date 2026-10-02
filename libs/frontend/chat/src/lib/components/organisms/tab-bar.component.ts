import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  viewChild,
  ElementRef,
  DestroyRef,
  afterNextRender,
  Injector,
  NgZone,
  untracked,
} from '@angular/core';
import {
  LucideAngularModule,
  Bot,
  ChevronLeft,
  ChevronRight,
} from 'lucide-angular';
import type { TabAgentOrigin } from '@ptah-extension/chat-types';
import {
  AwaitingBackgroundIndicatorComponent,
  TabItemComponent,
} from '@ptah-extension/chat-ui';
import {
  SessionLivenessRegistry,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { WorkflowSessionClaimService } from '@ptah-extension/chat-routing';
import { FloatingUIService } from '@ptah-extension/ui';

/** Text of the agent badge's tooltip, for the one badge it is shown for. */
interface AgentBadgeTip {
  readonly tabId: string;
  readonly by: string;
  readonly branch: string;
  readonly path: string;
}

/** Instance counter so each tab bar's tooltip id is unique in the page. */
let nextTabBarId = 0;

/**
 * Shorten a worktree path to its last two segments (`…/.worktrees/x`), keeping
 * the separator the path uses. The banner of the tab shows the full path.
 */
export function tailPath(path: string, segments = 2): string {
  const separator = path.includes('\\') ? '\\' : '/';
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  if (parts.length <= segments) return path;
  return `…${separator}${parts.slice(-segments).join(separator)}`;
}

/**
 * TabBarComponent - Chrome-style scrollable tab bar
 *
 * Scroll-arrow buttons appear when tabs overflow their container.
 * Hidden native scrollbar, smooth scroll-by on arrow click.
 *
 * Patterns: Signal-based state, viewChild, afterNextRender
 */
@Component({
  selector: 'ptah-tab-bar',
  standalone: true,
  imports: [
    AwaitingBackgroundIndicatorComponent,
    TabItemComponent,
    LucideAngularModule,
  ],
  host: { class: 'block min-w-0 overflow-hidden h-full' },
  providers: [FloatingUIService],
  template: `
    <div class="relative flex items-center h-full">
      <!-- Left scroll arrow -->
      @if (canScrollLeft()) {
        <button
          class="tab-scroll-arrow tab-scroll-arrow-left"
          aria-label="Scroll tabs left"
          (click)="scrollLeft()"
        >
          <lucide-angular [img]="ChevronLeftIcon" class="w-3.5 h-3.5" />
        </button>
      }

      <!-- Scrollable tab container -->
      <div
        #tabContainer
        class="flex items-center h-full px-1 gap-1.5 overflow-x-auto tab-scroll-container"
        (scroll)="onScroll()"
      >
        @for (tab of tabs(); track tab.id) {
          <ptah-tab-item
            [tab]="tab"
            [isActive]="tab.id === activeTabId()"
            [isStreaming]="tabManager.isTabStreaming(tab.id)"
            [livenessStatus]="livenessFor(tab.claudeSessionId)"
            (tabSelect)="onSelectTab($event)"
            (tabClose)="onCloseTab($event)"
            (viewModeToggle)="onToggleViewMode($event)"
          >
            @if (tab.agentOrigin; as origin) {
              <!-- Agent-started tab (TASK_2026_584), inside its own tab before
                   the title: activating the badge opens the parent tab.
                   Icon only, so the title keeps its width; the 12px icon plus
                   6px padding gives a 24x24 hit area, and the negative block
                   margin keeps the tab height unchanged. Focusable even when
                   the parent is gone so the label and the tooltip still tell a
                   keyboard user where it came from. -->
              <button
                tabItemLeading
                type="button"
                class="inline-flex items-center justify-center p-1.5 -my-1 -ml-1 rounded text-base-content flex-shrink-0"
                [class.cursor-pointer]="tabTitles().has(origin.parentTabId)"
                [class.cursor-default]="!tabTitles().has(origin.parentTabId)"
                [class.opacity-60]="!tabTitles().has(origin.parentTabId)"
                [attr.aria-label]="agentBadgeLabel(origin.parentTabId)"
                [attr.aria-disabled]="
                  tabTitles().has(origin.parentTabId) ? null : 'true'
                "
                [attr.aria-describedby]="
                  visibleBadgeTip()?.tabId === tab.id ? badgeTipId : null
                "
                (click)="onAgentBadge($event, origin.parentTabId)"
                (mouseenter)="showBadgeTip($event, tab.id, origin)"
                (focus)="showBadgeTip($event, tab.id, origin)"
                (mouseleave)="hideBadgeTip()"
                (blur)="hideBadgeTip()"
                (keydown.escape)="hideBadgeTip()"
                data-test="tab-bar-agent-badge"
              >
                <lucide-angular
                  [img]="BotIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
              </button>
            }
          </ptah-tab-item>
        }
      </div>

      <!-- Right scroll arrow -->
      @if (canScrollRight()) {
        <button
          class="tab-scroll-arrow tab-scroll-arrow-right"
          aria-label="Scroll tabs right"
          (click)="scrollRight()"
        >
          <lucide-angular [img]="ChevronRightIcon" class="w-3.5 h-3.5" />
        </button>
      }

      @if (awaitingBackgroundTab(); as awaitingTab) {
        <div
          class="flex items-center pl-2 pr-1 flex-shrink-0"
          [attr.data-test]="'tab-bar-awaiting-background-slot'"
        >
          <ptah-awaiting-background-indicator
            [taskCount]="awaitingTab.pendingBackgroundTasks?.length ?? 0"
            [tasks]="awaitingTab.pendingBackgroundTasks ?? []"
            [crons]="awaitingTab.pendingSessionCrons ?? []"
          />
        </div>
      }

      <!-- One tooltip for the whole bar, shown for the hovered or focused
           agent badge. Fixed-positioned by Floating UI so the tab strip's
           overflow does not clip it. -->
      @if (visibleBadgeTip(); as tip) {
        <div
          #badgeTooltip
          role="tooltip"
          [id]="badgeTipId"
          class="z-50 max-w-xs px-2 py-1 rounded border border-base-300 bg-base-200 text-base-content text-[11px] leading-snug shadow-lg pointer-events-none"
          style="position: fixed; visibility: hidden"
          data-test="tab-bar-agent-badge-tooltip"
        >
          <div class="truncate">Started by {{ tip.by }}</div>
          <div class="font-mono truncate">{{ tip.branch }}</div>
          <div class="font-mono truncate">{{ tip.path }}</div>
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabBarComponent {
  protected readonly tabManager = inject(TabManagerService);
  private readonly liveness = inject(SessionLivenessRegistry);
  private readonly claims = inject(WorkflowSessionClaimService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  private readonly floatingUI = inject(FloatingUIService);

  readonly tabs = computed(() =>
    this.tabManager.tabs().filter((t) => this.claims.surfaceFor(t.id) === null),
  );
  readonly activeTabId = this.tabManager.activeTabId;
  readonly awaitingBackgroundTab = computed(() => {
    const activeId = this.activeTabId();
    if (!activeId) return null;
    const tab = this.tabs().find((t) => t.id === activeId);
    // Both are "agent idle, session live": background work in flight, or a
    // session cron that will wake the session (TASK_2026_360).
    return tab?.status === 'awaiting-background' || tab?.status === 'sleeping'
      ? tab
      : null;
  });

  /**
   * Title by tab id over every tab in the active set (claimed ones included,
   * a parent may be one). Read by the agent badge; one map per tab-set
   * change rather than a scan per badge per check.
   */
  protected readonly tabTitles = computed(
    () =>
      new Map<string, string>(
        this.tabManager.tabs().map((t) => [t.id, t.title || 'New Chat']),
      ),
  );

  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly BotIcon = Bot;

  private readonly tabContainerRef =
    viewChild<ElementRef<HTMLDivElement>>('tabContainer');
  private readonly badgeTooltipRef =
    viewChild<ElementRef<HTMLDivElement>>('badgeTooltip');

  /** The agent badge tooltip's content while one badge shows it, else null. */
  protected readonly badgeTip = signal<AgentBadgeTip | null>(null);
  protected readonly badgeTipId = `ptah-tab-bar-agent-tip-${nextTabBarId++}`;
  /** The tooltip, dropped as soon as its tab leaves the bar. */
  protected readonly visibleBadgeTip = computed(() => {
    const tip = this.badgeTip();
    return tip && this.tabs().some((t) => t.id === tip.tabId) ? tip : null;
  });

  protected readonly canScrollLeft = signal(false);
  protected readonly canScrollRight = signal(false);

  /** Timer ID for debouncing scroll-into-view on tab changes */
  private scrollTimerId: ReturnType<typeof setTimeout> | null = null;

  /** ResizeObserver for detecting container size changes */
  private resizeObserver: ResizeObserver | null = null;

  /** Bound wheel handler reference for cleanup */
  private wheelHandler: ((e: WheelEvent) => void) | null = null;

  constructor() {
    // The tooltip's tab left the bar while it was open: release Floating
    // UI's autoUpdate listeners along with the tooltip.
    effect(() => {
      if (this.badgeTip() !== null && this.visibleBadgeTip() === null) {
        untracked(() => this.hideBadgeTip());
      }
    });
    effect(() => {
      this.tabs(); // track dependency
      const activeId = this.activeTabId();
      if (this.scrollTimerId) clearTimeout(this.scrollTimerId);
      this.scrollTimerId = setTimeout(() => {
        this.scrollActiveTabIntoView(activeId);
        this.checkScroll();
        this.scrollTimerId = null;
      }, 0);
    });
    afterNextRender(
      () => {
        this.setupWheelListener();
        this.setupResizeObserver();
      },
      { injector: this.injector },
    );

    this.destroyRef.onDestroy(() => this.cleanup());
  }

  protected livenessFor(
    sessionId: string | null,
  ): import('@ptah-extension/chat-state').LivenessStatus | undefined {
    if (!sessionId) return undefined;
    return this.liveness.statuses().get(sessionId);
  }

  protected onScroll(): void {
    this.checkScroll();
  }

  protected scrollLeft(): void {
    const el = this.tabContainerRef()?.nativeElement;
    if (el) {
      el.scrollBy({ left: -200, behavior: 'smooth' });
    }
  }

  protected scrollRight(): void {
    const el = this.tabContainerRef()?.nativeElement;
    if (el) {
      el.scrollBy({ left: 200, behavior: 'smooth' });
    }
  }

  protected onSelectTab(tabId: string): void {
    this.tabManager.switchTab(tabId);
  }

  protected onCloseTab(tabId: string): void {
    this.tabManager.closeTab(tabId);
  }

  protected onToggleViewMode(tabId: string): void {
    this.tabManager.toggleTabViewMode(tabId);
  }

  /** Accessible name of the icon-only badge: the tooltip's first line. */
  protected agentBadgeLabel(parentTabId: string): string {
    return `Started by ${this.agentBadgeBy(parentTabId)}`;
  }

  private agentBadgeBy(parentTabId: string): string {
    return (
      this.tabTitles().get(parentTabId) ??
      'an agent session (parent tab closed)'
    );
  }

  /**
   * Show the tooltip for one agent badge, on hover or keyboard focus, and
   * anchor it to that badge once it is rendered.
   */
  protected showBadgeTip(
    event: Event,
    tabId: string,
    origin: TabAgentOrigin,
  ): void {
    const anchor = event.currentTarget;
    if (!(anchor instanceof HTMLElement)) return;
    this.badgeTip.set({
      tabId,
      by: this.agentBadgeBy(origin.parentTabId),
      branch: origin.branch,
      path: tailPath(origin.worktreePath),
    });
    afterNextRender(
      () => {
        const tooltip = this.badgeTooltipRef()?.nativeElement;
        if (!tooltip || !anchor.isConnected) return;
        void this.floatingUI.position(anchor, tooltip, {
          placement: 'bottom-start',
          offset: 4,
        });
      },
      { injector: this.injector },
    );
  }

  protected hideBadgeTip(): void {
    if (this.badgeTip() === null) return;
    this.floatingUI.cleanup();
    this.badgeTip.set(null);
  }

  /**
   * Switch to the parent tab; a no-op when it is no longer open. Never
   * selects the child tab the badge sits in.
   */
  protected onAgentBadge(event: Event, parentTabId: string): void {
    event.stopPropagation();
    if (!this.tabTitles().has(parentTabId)) return;
    this.hideBadgeTip();
    this.tabManager.switchTab(parentTabId);
  }

  /**
   * Register wheel listener with { passive: false } so preventDefault() works.
   * Angular template `(wheel)` bindings are passive by default in Chromium,
   * which silently ignores preventDefault().
   */
  private setupWheelListener(): void {
    const el = this.tabContainerRef()?.nativeElement;
    if (!el) return;

    this.wheelHandler = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      event.preventDefault();
      el.scrollBy({ left: event.deltaY, behavior: 'auto' });
      this.ngZone.run(() => this.checkScroll());
    };

    el.addEventListener('wheel', this.wheelHandler, { passive: false });
  }

  /** Watch for container resizes to keep scroll arrows in sync */
  private setupResizeObserver(): void {
    const el = this.tabContainerRef()?.nativeElement;
    if (!el) return;

    this.resizeObserver = new ResizeObserver(() => {
      this.ngZone.run(() => this.checkScroll());
    });
    this.resizeObserver.observe(el);
  }

  /** Scroll the active tab into view within the container */
  private scrollActiveTabIntoView(activeId: string | null): void {
    if (!activeId) return;
    const container = this.tabContainerRef()?.nativeElement;
    if (!container) return;

    const tabElements = container.querySelectorAll('ptah-tab-item');
    const tabs = this.tabs();
    const activeIndex = tabs.findIndex((t) => t.id === activeId);
    if (activeIndex < 0 || activeIndex >= tabElements.length) return;

    const tabEl = tabElements[activeIndex] as HTMLElement;
    const containerRect = container.getBoundingClientRect();
    const tabRect = tabEl.getBoundingClientRect();

    if (tabRect.right > containerRect.right) {
      container.scrollBy({
        left: tabRect.right - containerRect.right + 8,
        behavior: 'smooth',
      });
    } else if (tabRect.left < containerRect.left) {
      container.scrollBy({
        left: tabRect.left - containerRect.left - 8,
        behavior: 'smooth',
      });
    }
  }

  private checkScroll(): void {
    const el = this.tabContainerRef()?.nativeElement;
    if (!el) return;
    this.canScrollLeft.set(el.scrollLeft > 0);
    this.canScrollRight.set(
      el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    );
  }

  private cleanup(): void {
    if (this.scrollTimerId) {
      clearTimeout(this.scrollTimerId);
      this.scrollTimerId = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.wheelHandler) {
      const el = this.tabContainerRef()?.nativeElement;
      if (el) el.removeEventListener('wheel', this.wheelHandler);
      this.wheelHandler = null;
    }
  }
}
