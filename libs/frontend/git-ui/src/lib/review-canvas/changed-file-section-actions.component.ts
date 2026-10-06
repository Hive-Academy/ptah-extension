import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Minus, Plus, Undo2 } from 'lucide-angular';
import {
  SECTION_BULK_ACTION,
  type StatusSection,
} from './changed-file-tree-rows';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]';

const ICON_BUTTON = `btn btn-ghost btn-xs p-0.5 h-auto min-h-0 ${FOCUS_RING}`;

/**
 * ChangedFileSectionActionsComponent — the controls of one section header of
 * the changed-file tree: unstage all (Staged), or discard all and stage all
 * (Changes). Presentational, like {@link ChangedFileRowActionsComponent}: the
 * tree decides availability and tab order, asks before discarding and runs
 * every action.
 *
 * The host carries `data-row-action`, so a click here never toggles the
 * section.
 */
@Component({
  selector: 'ptah-changed-file-section-actions',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex shrink-0', 'data-row-action': '' },
  template: `
    @if (section() === 'unstaged') {
      <button
        #discardAllButton
        type="button"
        [class]="iconButton"
        title="Discard all changes"
        aria-label="Discard all changes"
        data-testid="tree-discard-all"
        [tabIndex]="controlTabIndex()"
        [disabled]="!canRun()"
        (click)="discardAll.emit(discardAllButton)"
      >
        <lucide-angular
          [img]="Undo2Icon"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        />
      </button>
    }
    <button
      type="button"
      [class]="iconButton"
      [title]="bulk[section()].title"
      [attr.aria-label]="bulk[section()].label"
      [attr.data-testid]="bulk[section()].testId"
      [tabIndex]="controlTabIndex()"
      [disabled]="!canRun()"
      [attr.aria-busy]="busy() || null"
      (click)="bulkAction.emit()"
    >
      <lucide-angular
        [img]="section() === 'staged' ? MinusIcon : PlusIcon"
        class="h-3.5 w-3.5"
        aria-hidden="true"
      />
    </button>
  `,
})
export class ChangedFileSectionActionsComponent {
  readonly section = input.required<StatusSection>();
  /** 0 on the focused row (its controls follow it in the tab order), else -1. */
  readonly controlTabIndex = input(-1);
  /** Nothing runs in the workspace, so a section-wide action may start. */
  readonly canRun = input(false);
  /** The section's own call is in flight. */
  readonly busy = input(false);

  /** Stage all (Changes) or unstage all (Staged) was pressed. */
  readonly bulkAction = output<void>();
  /** Discard all was pressed; carries the button, where the dialog returns focus. */
  readonly discardAll = output<HTMLElement>();

  protected readonly PlusIcon = Plus;
  protected readonly MinusIcon = Minus;
  protected readonly Undo2Icon = Undo2;
  protected readonly iconButton = ICON_BUTTON;
  protected readonly bulk = SECTION_BULK_ACTION;
}
