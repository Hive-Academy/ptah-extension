import {
  Component,
  input,
  output,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FILE_TREE_WINDOW_SIZE } from './file-tree-window';

/**
 * The reveal row that stands in for the siblings a {@link FileTreeWindow} is
 * holding back.
 *
 * Complexity Level: 1 (Simple presentational component)
 *
 * Shared by the root list and by every expanded directory rather than written
 * twice, because the two things that are easy to get wrong here are both
 * invisible: the row must be a real focusable control (a keyboard user has to
 * be able to reveal the rest), and it must carry role="treeitem" — it is a
 * direct child of role="tree" / a directory's child list, and a bare div there
 * is an unowned child, which is a critical aria-required-children failure.
 * Duplicating that in two templates is how one of the copies loses it.
 */
@Component({
  selector: 'ptah-file-tree-more-row',
  standalone: true,
  template: `
    <button
      type="button"
      role="treeitem"
      data-testid="editor-file-tree-more"
      class="flex items-center gap-1.5 px-2 py-0.5 w-full text-left cursor-pointer
             rounded text-xs italic opacity-60 hover:opacity-100
             hover:bg-base-300 transition-colors
             focus-visible:outline focus-visible:outline-2
             focus-visible:outline-offset-[-2px]
             focus-visible:outline-[oklch(var(--s))]"
      [style.padding-left.px]="depth() * 16 + 8"
      [attr.aria-label]="label()"
      (click)="revealMore.emit()"
    >
      <span class="w-4 flex-shrink-0"></span>
      <span class="truncate">{{ label() }}</span>
    </button>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTreeMoreRowComponent {
  /** How many siblings are being held back. Always > 0 where this renders. */
  readonly hiddenCount = input.required<number>();
  /** Indentation level of the siblings it stands for, not of its parent. */
  readonly depth = input<number>(0);

  readonly revealMore = output<void>();

  /**
   * Names both numbers: how many more arrive on the next click, and how many
   * remain in total. "Show 200 more (3,800 hidden)" is the difference between
   * a control someone uses and one they click twenty times wondering why.
   */
  protected readonly label = computed(() => {
    const hidden = this.hiddenCount();
    const next = Math.min(hidden, FILE_TREE_WINDOW_SIZE);
    const nextLabel = `Show ${next.toLocaleString()} more`;
    return hidden > next
      ? `${nextLabel} (${hidden.toLocaleString()} hidden)`
      : nextLabel;
  });
}
