import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, ChevronRight } from 'lucide-angular';

/**
 * ExpandableContentComponent - Expand/collapse button with content size display
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Reusable collapsible content pattern
 *
 * Features:
 * - Display line count and character count
 * - Show "Show content" when collapsed, "Hide content" when expanded
 * - Rotate chevron icon 90 degrees when expanded
 * - Emit click event for parent to handle
 */
@Component({
  selector: 'ptah-expandable-content',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <button
      type="button"
      class="btn btn-xs btn-ghost gap-1 h-4 min-h-4 px-1"
      (click)="toggleClicked.emit($event)"
    >
      <lucide-angular
        [img]="ChevronRightIcon"
        class="w-3 h-3 transition-transform"
        [class.rotate-90]="isExpanded()"
      />
      {{ isExpanded() ? 'Hide' : 'Show' }} content ({{ getContentSize() }})
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExpandableContentComponent {
  readonly content = input.required<string>();
  readonly isExpanded = input.required<boolean>();
  readonly toggleClicked = output<Event>();

  readonly ChevronRightIcon = ChevronRight;

  /**
   * Get human-readable content size
   */
  protected getContentSize(): string {
    const lines = this.content().split('\n').length;
    const chars = this.content().length;
    return `${lines} lines, ${chars} chars`;
  }
}
