import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { LucideAngularModule, X } from 'lucide-angular';
import { TabState } from '../../../services/chat.types';

/**
 * TabItemComponent - Individual tab in tab bar
 *
 * Complexity Level: 1 (Simple component)
 * Patterns: Signal-based inputs/outputs, DaisyUI styling
 *
 * Displays tab title (truncated if too long), streaming indicator
 * (DaisyUI spinner), close button, and active tab styling.
 *
 * NOTE: Streaming indicator uses dedicated `isStreaming` input from
 * TabManagerService.isTabStreaming() - completely isolated from tab.status
 * state machine. This is visual-only with zero side effects.
 */
@Component({
  selector: 'ptah-tab-item',
  standalone: true,
  imports: [LucideAngularModule, NgClass],
  template: `
    <div
      class="group flex items-center gap-1 px-3 py-1.5 cursor-pointer border-r border-base-300 max-w-[200px] min-w-[100px]"
      [ngClass]="{
        'bg-base-100 border-b-2 border-b-primary': isActive(),
        'bg-base-200 hover:bg-base-300': !isActive()
      }"
      (click)="tabSelect.emit(tab().id)"
    >
      <!-- Streaming indicator (visual only - DaisyUI spinner) -->
      @if (isStreaming()) {
      <span class="loading loading-spinner loading-xs text-primary"></span>
      }

      <!-- Tab title -->
      <span class="truncate text-sm flex-1" [title]="tab().title">
        {{ tab().title || 'New Chat' }}
      </span>

      <!-- Close button -->
      <button
        class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100"
        (click)="onClose($event)"
        [title]="'Close tab'"
      >
        <lucide-angular [img]="XIcon" class="w-3 h-3" />
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

  readonly XIcon = X;

  protected onClose(event: Event): void {
    event.stopPropagation();
    this.tabClose.emit(this.tab().id);
  }
}
