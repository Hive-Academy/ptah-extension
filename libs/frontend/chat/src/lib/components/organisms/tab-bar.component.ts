import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  effect,
  viewChild,
  ElementRef,
  DestroyRef,
  afterNextRender,
  Injector,
  NgZone,
} from '@angular/core';
import { LucideAngularModule, ChevronLeft, ChevronRight } from 'lucide-angular';
import { TabItemComponent } from '@ptah-extension/chat-ui';
import { TabManagerService } from '@ptah-extension/chat-state';

/**
 * TabBarComponent - Chrome-style scrollable tab bar
 *
 * TASK_2025_248: Replaced simple overflow-x-auto container with
 * scroll-arrow buttons that appear when tabs overflow their container.
 * Hidden native scrollbar, smooth scroll-by on arrow click.
 *
 * Complexity Level: 2 (Scroll detection + arrow rendering)
 * Patterns: Signal-based state, viewChild, afterNextRender
 */
@Component({
  selector: 'ptah-tab-bar',
  standalone: true,
  imports: [TabItemComponent, LucideAngularModule],
  host: { class: 'block min-w-0 overflow-hidden h-full' },
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
            (tabSelect)="onSelectTab($event)"
            (tabClose)="onCloseTab($event)"
            (viewModeToggle)="onToggleViewMode($event)"
          />
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
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabBarComponent {
  protected readonly tabManager = inject(TabManagerService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);

  readonly tabs = this.tabManager.tabs;
  readonly activeTabId = this.tabManager.activeTabId;

  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ChevronRightIcon = ChevronRight;

  private readonly tabContainerRef =
    viewChild<ElementRef<HTMLDivElement>>('tabContainer');

  protected readonly canScrollLeft = signal(false);
  protected readonly canScrollRight = signal(false);

  /** Timer ID for debouncing scroll-into-view on tab changes */
  private scrollTimerId: ReturnType<typeof setTimeout> | null = null;

  /** ResizeObserver for detecting container size changes */
  private resizeObserver: ResizeObserver | null = null;

  /** Bound wheel handler reference for cleanup */
  private wheelHandler: ((e: WheelEvent) => void) | null = null;

  constructor() {
    // Re-check scroll state when tabs change and scroll active tab into view
    effect(() => {
      this.tabs(); // track dependency
      const activeId = this.activeTabId();
      // Clear previous timer to prevent stale callbacks on rapid switching
      if (this.scrollTimerId) clearTimeout(this.scrollTimerId);
      this.scrollTimerId = setTimeout(() => {
        this.scrollActiveTabIntoView(activeId);
        this.checkScroll();
        this.scrollTimerId = null;
      }, 0);
    });

    // Setup non-passive wheel listener and ResizeObserver after first render
    afterNextRender(
      () => {
        this.setupWheelListener();
        this.setupResizeObserver();
      },
      { injector: this.injector },
    );

    this.destroyRef.onDestroy(() => this.cleanup());
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
