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
    <div
      class="card card-border my-3 border-secondary/20 bg-gradient-to-br from-secondary/5 to-transparent shadow-sm"
    >
      <!-- Card header (clickable to toggle) -->
      <button
        type="button"
        class="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-secondary/5 transition-colors cursor-pointer rounded-t-2xl"
        (click)="toggleCollapse()"
        [attr.aria-expanded]="!isCollapsed()"
        [attr.aria-controls]="'thinking-' + node().id"
      >
        <!-- Expand/Collapse chevron -->
        <lucide-angular
          [img]="ChevronIcon"
          class="w-3.5 h-3.5 flex-shrink-0 text-secondary/60 transition-transform duration-200"
          [class.rotate-0]="!isCollapsed()"
          [class.-rotate-90]="isCollapsed()"
        />

        <!-- Brain icon with glow ring -->
        <div
          class="w-6 h-6 rounded-full bg-secondary/15 flex items-center justify-center flex-shrink-0"
        >
          <lucide-angular
            [img]="BrainIcon"
            class="w-3.5 h-3.5 text-secondary"
          />
        </div>

        <span class="text-xs font-semibold tracking-wide text-secondary/90"
          >Extended Thinking</span
        >

        <!-- Collapsed preview hint -->
        @if (isCollapsed()) {
          <span class="text-[10px] text-base-content/30 ml-auto">
            click to expand
          </span>
        }
      </button>

      <!-- Collapsible body -->
      @if (!isCollapsed()) {
        <div
          class="card-body px-4 pt-0 pb-4"
          [attr.id]="'thinking-' + node().id"
        >
          <div
            class="divider my-0 before:bg-secondary/10 after:bg-secondary/10"
          ></div>
          <div
            class="prose prose-sm prose-invert max-w-none text-base-content/70 leading-relaxed"
          >
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
