import {
  Component,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { LucideAngularModule, ChevronDown, Brain } from 'lucide-angular';
import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * ThinkingBlockComponent - Collapsible extended thinking content
 *
 * Complexity Level: 2 (Molecule with internal state)
 * Patterns: Composition, Signal-based collapse state
 *
 * Custom button-based toggle with chevron icon.
 * Collapsed by default to reduce visual clutter.
 */
@Component({
  selector: 'ptah-thinking-block',
  standalone: true,
  imports: [MarkdownModule, LucideAngularModule],
  template: `
    <div class="bg-base-300 rounded-md my-2 border border-base-300/50">
      <!-- Header (clickable to toggle) -->
      <button
        type="button"
        class="w-full py-2 px-3 text-sm font-medium flex items-center gap-2 hover:bg-base-200/50 transition-colors cursor-pointer rounded-t-md"
        (click)="toggleCollapse()"
        [attr.aria-expanded]="!isCollapsed()"
        [attr.aria-controls]="'thinking-' + node().id"
      >
        <!-- Expand/Collapse icon -->
        <lucide-angular
          [img]="ChevronIcon"
          class="w-4 h-4 flex-shrink-0 text-base-content/50 transition-transform"
          [class.rotate-0]="!isCollapsed()"
          [class.-rotate-90]="isCollapsed()"
        />
        <lucide-angular [img]="BrainIcon" class="w-4 h-4 text-secondary" />
        <span class="text-base-content/80">Extended Thinking</span>
      </button>

      <!-- Collapsible content -->
      @if (!isCollapsed()) {
      <div
        class="px-3 pb-3 border-t border-base-200/50"
        [attr.id]="'thinking-' + node().id"
      >
        <div class="prose prose-sm prose-invert max-w-none pt-2">
          <markdown [data]="node().content || ''" />
        </div>
      </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThinkingBlockComponent {
  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = signal(true); // Collapsed by default

  // Icons
  readonly ChevronIcon = ChevronDown;
  readonly BrainIcon = Brain;

  protected toggleCollapse(): void {
    this.isCollapsed.update((val) => !val);
  }
}
