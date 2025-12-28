import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { LucideAngularModule, X, Edit3, Loader2 } from 'lucide-angular';
import { TabState } from '../../services/chat.types';

/**
 * TabItemComponent - Individual tab in tab bar
 *
 * Complexity Level: 1 (Simple component)
 * Patterns: Signal-based inputs/outputs, DaisyUI styling
 *
 * Displays tab title (truncated if too long), status indicator
 * (spinner for streaming, edit icon for draft), close button,
 * and active tab styling (border highlight).
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
      <!-- Status indicator -->
      @if (tab().status === 'streaming' || tab().status === 'resuming') {
      <lucide-angular
        [img]="LoaderIcon"
        class="w-3 h-3 text-primary animate-spin"
      />
      } @else if (tab().status === 'draft') {
      <lucide-angular [img]="EditIcon" class="w-3 h-3 text-warning" />
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

  readonly tabSelect = output<string>();
  readonly tabClose = output<string>();

  readonly XIcon = X;
  readonly EditIcon = Edit3;
  readonly LoaderIcon = Loader2;

  protected onClose(event: Event): void {
    event.stopPropagation();
    this.tabClose.emit(this.tab().id);
  }
}
