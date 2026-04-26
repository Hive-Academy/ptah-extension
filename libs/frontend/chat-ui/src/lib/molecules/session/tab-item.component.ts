import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
} from '@angular/core';
import { LucideAngularModule, X, Minimize2, Maximize2 } from 'lucide-angular';
import { TabState } from '@ptah-extension/chat-types';

/**
 * TabItemComponent - Chrome-style individual tab
 *
 * TASK_2025_248: Restyled with rounded-t-lg corners, CSS class-based
 * active/inactive states (.tab-item-active, .tab-item-inactive),
 * and a smaller hover-reveal close button.
 *
 * Complexity Level: 1 (Simple component)
 * Patterns: Signal-based inputs/outputs, DaisyUI styling
 */
@Component({
  selector: 'ptah-tab-item',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div
      class="group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer rounded-t-lg max-w-[200px] min-w-[100px] transition-colors duration-150 select-none"
      [class.tab-item-active]="isActive()"
      [class.tab-item-inactive]="!isActive()"
      (click)="tabSelect.emit(tab().id)"
    >
      <!-- Streaming indicator (visual only - DaisyUI spinner) -->
      @if (isStreaming()) {
        <span class="loading loading-spinner loading-xs text-primary"></span>
      }

      <!-- Tab title -->
      <span class="truncate text-xs flex-1" [title]="tab().title">
        {{ tab().title || 'New Chat' }}
      </span>

      <!-- View mode toggle (hover-reveal) -->
      <button
        class="btn btn-ghost btn-xs btn-circle w-4 h-4 min-h-0 p-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        (click)="onToggleViewMode($event)"
        [title]="
          isCompactMode() ? 'Switch to full view' : 'Switch to compact view'
        "
      >
        <lucide-angular
          [img]="isCompactMode() ? MaximizeIcon : MinimizeIcon"
          class="w-2.5 h-2.5"
        />
      </button>

      <!-- Close button (hover-reveal) -->
      <button
        class="btn btn-ghost btn-xs btn-circle w-4 h-4 min-h-0 p-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
        (click)="onClose($event)"
        title="Close tab"
      >
        <lucide-angular [img]="XIcon" class="w-2.5 h-2.5" />
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabItemComponent {
  readonly tab = input.required<TabState>();
  readonly isActive = input.required<boolean>();
  /** Visual streaming indicator - isolated from tab.status state machine */
  readonly isStreaming = input<boolean>(false);

  readonly tabSelect = output<string>();
  readonly tabClose = output<string>();
  readonly viewModeToggle = output<string>();

  readonly XIcon = X;
  readonly MinimizeIcon = Minimize2;
  readonly MaximizeIcon = Maximize2;

  readonly isCompactMode = computed(
    () => (this.tab().viewMode ?? 'full') === 'compact',
  );

  protected onClose(event: Event): void {
    event.stopPropagation();
    this.tabClose.emit(this.tab().id);
  }

  protected onToggleViewMode(event: Event): void {
    event.stopPropagation();
    this.viewModeToggle.emit(this.tab().id);
  }
}
