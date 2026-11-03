import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import {
  ClipboardList,
  FilterX,
  FolderOpen,
  LucideAngularModule,
  Plus,
} from 'lucide-angular';
import { SPEC_ROOT } from '@ptah-extension/shared';

/** The four whole-board states that replace the lanes. */
export type TaskBoardStateKind =
  'loading' | 'no-workspace' | 'empty' | 'filtered-empty';

/**
 * TaskBoardStatesComponent
 *
 * The panels shown instead of the board: first load, no folder open, no tasks,
 * and a filter that hides every task.
 *
 * The three empty cases stay distinct because each has a different recovery:
 * - no workspace — open a folder (offers only "Check again"; a create button
 *   here could only earn the host's WORKSPACE_NOT_OPEN refusal);
 * - no tasks — create the first one;
 * - filtered-empty — clear the filter (no create CTA: the tasks exist, they are
 *   only hidden).
 *
 * Glyphs are decorative and `aria-hidden`; the sentence beside each carries
 * the meaning, in `text-base-content-muted` rather than an alpha modifier.
 */
@Component({
  selector: 'ptah-task-board-states',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-1 min-h-0 min-w-0' },
  template: `
    @switch (kind()) {
      @case ('loading') {
        <div
          class="flex flex-1 flex-col items-center justify-center gap-3 p-6"
          role="status"
          aria-busy="true"
          aria-label="Loading tasks"
          data-testid="tasks-loading"
        >
          <span
            class="loading loading-spinner loading-md"
            aria-hidden="true"
          ></span>
          <p class="text-sm text-base-content-muted">Loading tasks…</p>
        </div>
      }
      @case ('no-workspace') {
        <div
          class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
          data-testid="tasks-no-workspace"
        >
          <lucide-angular
            [img]="FolderOpenIcon"
            class="h-10 w-10 text-base-content-muted"
            aria-hidden="true"
          />
          <div class="flex max-w-sm flex-col gap-1">
            <h2 class="text-base font-semibold text-base-content">
              No folder is open
            </h2>
            <p class="text-sm text-base-content-muted">
              The board reads tasks from
              <span class="font-mono">{{ specRoot }}</span> inside the open
              folder. Open one and its board loads here — nothing needs to be
              created first.
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm border border-surface-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            data-testid="tasks-no-workspace-retry"
            [disabled]="busy()"
            (click)="retry.emit()"
          >
            Check again
          </button>
        </div>
      }
      @case ('empty') {
        <div
          class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
          data-testid="tasks-empty"
        >
          <lucide-angular
            [img]="ClipboardListIcon"
            class="h-10 w-10 text-base-content-muted"
            aria-hidden="true"
          />
          <div class="flex max-w-sm flex-col gap-1">
            <h2 class="text-base font-semibold text-base-content">
              @if (!specsDirExists()) {
                No .ptah/specs directory yet
              } @else {
                No tasks on the board
              }
            </h2>
            <p class="text-sm text-base-content-muted">
              Create a task to generate a
              <span class="font-mono">task.md</span> with valid frontmatter — it
              becomes the first card on the board.
            </p>
          </div>
          <button
            type="button"
            class="btn btn-primary btn-sm h-9 min-h-9 gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            data-testid="tasks-empty-create"
            (click)="create.emit()"
          >
            <lucide-angular
              [img]="PlusIcon"
              class="h-4 w-4"
              aria-hidden="true"
            />
            Create your first task
          </button>
        </div>
      }
      @case ('filtered-empty') {
        <div
          class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
          data-testid="tasks-filtered-empty"
        >
          <lucide-angular
            [img]="FilterXIcon"
            class="h-10 w-10 text-base-content-muted"
            aria-hidden="true"
          />
          <div class="flex max-w-sm flex-col gap-1">
            <h2 class="text-base font-semibold text-base-content">
              No tasks match the current filter
            </h2>
            <p class="text-sm text-base-content-muted">
              All {{ totalIndexed() }} indexed task(s) are still on the board —
              the active filter is hiding every one of them. Remove a chip
              above, or clear the filter.
            </p>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-sm border border-surface-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            data-testid="tasks-filtered-empty-clear"
            (click)="clearFilter.emit()"
          >
            Clear the filter
          </button>
        </div>
      }
    }
  `,
})
export class TaskBoardStatesComponent {
  public readonly kind = input.required<TaskBoardStateKind>();
  /** Distinguishes "no specs directory yet" from "directory with no tasks". */
  public readonly specsDirExists = input(true);
  public readonly totalIndexed = input(0);
  /** Disables "Check again" while a load is already in flight. */
  public readonly busy = input(false);

  public readonly retry = output<void>();
  public readonly create = output<void>();
  public readonly clearFilter = output<void>();

  protected readonly specRoot = SPEC_ROOT;

  protected readonly ClipboardListIcon = ClipboardList;
  protected readonly FilterXIcon = FilterX;
  protected readonly FolderOpenIcon = FolderOpen;
  protected readonly PlusIcon = Plus;
}
