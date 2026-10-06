import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Minus, Plus, Undo2 } from 'lucide-angular';
import type { EditorTarget } from '@ptah-extension/shared';
import {
  OpenInButtonComponent,
  type OpenInRequest,
} from '../open-in/open-in-button.component';
import type { TreeFile } from './changed-file-tree-rows';

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[oklch(var(--s))]';

const ICON_BUTTON = `btn btn-ghost btn-xs p-0.5 h-auto min-h-0 ${FOCUS_RING}`;

/**
 * ChangedFileRowActionsComponent — the controls of one file row of the
 * changed-file tree: stage or unstage and discard (status comparisons), the
 * persisted "Viewed" mark (branch review) and Open-in. Presentational: the
 * tree decides availability and tab order and runs every action.
 *
 * The host carries `data-row-action`, so a click here never selects the row.
 */
@Component({
  selector: 'ptah-changed-file-row-actions',
  standalone: true,
  imports: [LucideAngularModule, OpenInButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'flex shrink-0 items-center gap-0.5 group-hover:opacity-100 group-focus-within:opacity-100',
    'data-row-action': '',
  },
  template: `
    @if (mutable() && file().staged !== null) {
      @if (file().staged) {
        <button
          type="button"
          [class]="iconButton"
          title="Unstage"
          [attr.aria-label]="'Unstage ' + name()"
          data-testid="tree-unstage"
          [tabIndex]="controlTabIndex()"
          [disabled]="!canRun()"
          (click)="unstage.emit()"
        >
          <lucide-angular
            [img]="MinusIcon"
            class="h-3.5 w-3.5"
            aria-hidden="true"
          />
        </button>
      } @else {
        <button
          type="button"
          [class]="iconButton"
          title="Stage"
          [attr.aria-label]="'Stage ' + name()"
          data-testid="tree-stage"
          [tabIndex]="controlTabIndex()"
          [disabled]="!canRun()"
          (click)="stage.emit()"
        >
          <lucide-angular
            [img]="PlusIcon"
            class="h-3.5 w-3.5"
            aria-hidden="true"
          />
        </button>
      }
      <button
        type="button"
        [class]="iconButton"
        title="Discard changes"
        [attr.aria-label]="'Discard changes to ' + name()"
        data-testid="tree-discard"
        [tabIndex]="controlTabIndex()"
        [disabled]="!canRun()"
        (click)="onDiscard($event)"
      >
        <lucide-angular
          [img]="Undo2Icon"
          class="h-3.5 w-3.5"
          aria-hidden="true"
        />
      </button>
    }
    @if (showViewed()) {
      <input
        type="checkbox"
        class="checkbox checkbox-xs {{ focusRing }}"
        title="Viewed"
        [attr.aria-label]="'Viewed ' + name()"
        data-testid="tree-viewed"
        [tabIndex]="controlTabIndex()"
        [checked]="viewed()"
        (change)="viewedToggle.emit()"
      />
    }
    @if (showOpenIn()) {
      <ptah-open-in-button
        mode="icon-only"
        [targets]="editorTargets()"
        [path]="file().path"
        [root]="workspaceRoot()"
        (open)="openFile.emit($event)"
      />
    }
  `,
})
export class ChangedFileRowActionsComponent {
  readonly file = input.required<TreeFile>();
  /** The row's display name, for the accessible names. */
  readonly name = input.required<string>();
  /** 0 on the focused row (its controls follow it in the tab order), else -1. */
  readonly controlTabIndex = input(-1);
  /** No call in flight for the row or a bulk action over its workspace. */
  readonly canRun = input(false);
  /** `false` in the read-only worktree scope: no stage, unstage or discard. */
  readonly mutable = input(true);
  readonly showViewed = input(false);
  readonly viewed = input(false);
  /** Open-in reads a setting and listens on the document: focused row only. */
  readonly showOpenIn = input(false);
  readonly editorTargets = input<readonly EditorTarget[]>([]);
  readonly workspaceRoot = input('');

  readonly stage = output<void>();
  readonly unstage = output<void>();
  /** Discard was pressed; carries the button, where the dialog returns focus. */
  readonly discard = output<HTMLElement>();
  readonly viewedToggle = output<void>();
  readonly openFile = output<OpenInRequest>();

  protected readonly PlusIcon = Plus;
  protected readonly MinusIcon = Minus;
  protected readonly Undo2Icon = Undo2;
  protected readonly focusRing = FOCUS_RING;
  protected readonly iconButton = ICON_BUTTON;

  protected onDiscard(event: MouseEvent): void {
    const invoker = event.currentTarget;
    this.discard.emit(invoker instanceof HTMLElement ? invoker : document.body);
  }
}
