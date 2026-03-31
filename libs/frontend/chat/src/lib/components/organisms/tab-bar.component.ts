import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  effect,
  viewChild,
  ElementRef,
} from '@angular/core';
import { LucideAngularModule, ChevronLeft, ChevronRight } from 'lucide-angular';
import { TabItemComponent } from '../molecules/session/tab-item.component';
import { TabManagerService } from '../../services/tab-manager.service';

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

  readonly tabs = this.tabManager.tabs;
  readonly activeTabId = this.tabManager.activeTabId;

  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ChevronRightIcon = ChevronRight;

  private readonly tabContainerRef =
    viewChild<ElementRef<HTMLDivElement>>('tabContainer');

  readonly canScrollLeft = signal(false);
  readonly canScrollRight = signal(false);

  constructor() {
    // Re-check scroll state when tabs change (schedule after DOM update)
    effect(() => {
      this.tabs(); // track dependency
      setTimeout(() => this.checkScroll(), 0);
    });
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

  private checkScroll(): void {
    const el = this.tabContainerRef()?.nativeElement;
    if (!el) return;
    this.canScrollLeft.set(el.scrollLeft > 0);
    this.canScrollRight.set(
      el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    );
  }
}
