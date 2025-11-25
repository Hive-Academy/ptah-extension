import {
  Component,
  input,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import type { ExecutionNode } from '@ptah-extension/shared';

/**
 * ThinkingBlockComponent - Collapsible extended thinking content
 *
 * Complexity Level: 2 (Molecule with internal state)
 * Patterns: Composition, Signal-based collapse state
 *
 * Uses DaisyUI collapse component with arrow indicator.
 * Collapsed by default to reduce visual clutter.
 */
@Component({
  selector: 'ptah-thinking-block',
  standalone: true,
  imports: [MarkdownModule],
  template: `
    <div class="collapse collapse-arrow bg-base-300 rounded-md my-2">
      <input
        type="checkbox"
        [checked]="!isCollapsed()"
        (change)="toggleCollapse()"
        [attr.aria-expanded]="!isCollapsed()"
        [attr.aria-controls]="'thinking-' + node().id"
      />

      <div
        class="collapse-title min-h-0 py-2 px-3 text-sm font-medium flex items-center gap-2"
      >
        <span class="badge badge-info badge-sm">🧠 thinking</span>
        <span class="text-base-content/80">Extended Thinking</span>
      </div>

      <div
        class="collapse-content px-3 pb-3"
        [attr.id]="'thinking-' + node().id"
      >
        <div class="prose prose-sm prose-invert max-w-none">
          <markdown [data]="node().content || ''" />
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThinkingBlockComponent {
  readonly node = input.required<ExecutionNode>();
  readonly isCollapsed = signal(true); // Collapsed by default

  protected toggleCollapse(): void {
    this.isCollapsed.update((val) => !val);
  }
}
