import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NativeDrawerComponent } from '@ptah-extension/ui';
import {
  SPEC_ROOT,
  type ExcludedTaskFolder,
  type TaskStatus,
  type TasksSweepResult,
} from '@ptah-extension/shared';
import {
  TASK_STATUS_LABELS,
  taskExclusionReasonLabel,
} from '../task-presentation';

const FOCUSABLE = 'button:not([disabled])';

/**
 * TaskSweepDialogComponent
 *
 * The retention-sweep preview and report. DESTRUCTIVE, so the preview is the
 * contract: the confirm button names the exact count and the table names every
 * folder. Folders git has never seen are marked and skipped by the host, so
 * they never count towards the confirm.
 *
 * Rendered inside an `@if` on the store's sweep plan; focus returns to the
 * opener when the plan is cleared.
 */
@Component({
  selector: 'ptah-task-sweep-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeyDown($event)' },
  template: `
    <dialog
      class="modal modal-open"
      aria-labelledby="task-sweep-title"
      data-testid="tasks-sweep-dialog"
    >
      <div
        #box
        class="modal-box max-w-2xl bg-surface-2 border border-surface-border rounded-box p-5 text-base-content shadow-[var(--elev-shadow-raised)]"
      >
        <h2 id="task-sweep-title" class="mb-1 text-lg font-semibold">
          @if (plan().previewOnly) {
            Delete finished tasks older than {{ days() }} days?
          } @else {
            Swept {{ plan().deleted.length }} finished task(s)
          }
        </h2>

        @if (plan().previewOnly) {
          <p class="mb-3 text-sm text-base-content-muted">
            This deletes the folders from disk. Committed folders stay
            recoverable with <span class="font-mono">git show</span>; anything
            git has not seen is skipped rather than destroyed.
          </p>
        }

        @if (plan().candidates.length === 0) {
          <p class="text-sm" data-testid="tasks-sweep-empty">
            Nothing has aged out. No finished task is older than
            {{ days() }} days.
          </p>
        } @else {
          <div
            class="max-h-72 overflow-y-auto rounded-box border border-surface-border bg-surface-1"
          >
            <table class="w-full text-sm">
              <tbody>
                @for (item of plan().candidates; track item.taskId) {
                  <tr
                    class="border-b border-surface-border last:border-b-0"
                    [attr.data-testid]="'tasks-sweep-row-' + item.taskId"
                  >
                    <td class="px-3 py-2 font-mono text-xs">
                      {{ item.taskId }}
                    </td>
                    <td class="px-3 py-2">{{ statusLabel(item.status) }}</td>
                    <td class="px-3 py-2 tabular-nums text-base-content-muted">
                      {{ item.ageDays }}d old
                    </td>
                    <td class="px-3 py-2">
                      @if (!item.committed) {
                        <span
                          class="badge badge-ghost border-surface-border text-base-content"
                          title="git has no copy of this folder, so deleting it could not be undone. It will be skipped."
                          >not in git — skipped</span
                        >
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        @if (!plan().previewOnly && plan().skipped.length > 0) {
          <p
            class="mt-3 text-sm text-base-content"
            role="status"
            data-testid="tasks-sweep-skipped"
          >
            {{ plan().skipped.length }} folder(s) were left alone — see the
            badges above.
          </p>
        }

        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            data-testid="tasks-sweep-close"
            (click)="closed.emit()"
          >
            @if (plan().previewOnly) {
              Cancel
            } @else {
              Close
            }
          </button>
          @if (plan().previewOnly && deletableCount() > 0) {
            <button
              type="button"
              class="btn btn-error btn-sm h-9 min-h-9"
              [disabled]="sweeping()"
              data-testid="tasks-sweep-confirm"
              (click)="confirmed.emit()"
            >
              @if (sweeping()) {
                <span
                  class="loading loading-spinner loading-xs"
                  aria-hidden="true"
                ></span>
              }
              Delete {{ deletableCount() }} folder(s)
            </button>
          }
        </div>
      </div>
      <button
        type="button"
        class="modal-backdrop"
        tabindex="-1"
        aria-label="Close"
        (click)="closed.emit()"
      ></button>
    </dialog>
  `,
})
export class TaskSweepDialogComponent {
  public readonly plan = input.required<TasksSweepResult>();
  public readonly days = input(7);
  public readonly sweeping = input(false);

  public readonly closed = output<void>();
  public readonly confirmed = output<void>();

  /** Only committed folders are deleted; the confirm names that count. */
  protected readonly deletableCount = computed(
    () => this.plan().candidates.filter((c) => c.committed).length,
  );

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  public constructor() {
    const opener = inject(DOCUMENT).activeElement;
    afterNextRender(() =>
      this.box().nativeElement.querySelector<HTMLElement>(FOCUSABLE)?.focus(),
    );
    inject(DestroyRef).onDestroy(() => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    });
  }

  protected statusLabel(status: TaskStatus): string {
    return TASK_STATUS_LABELS[status];
  }

  protected onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!this.sweeping()) this.closed.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = Array.from(
      this.box().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && event.target === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && event.target === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

/** One excluded folder plus the sentence explaining its typed reason. */
interface ExcludedFolderRow extends ExcludedTaskFolder {
  readonly reasonLabel: string;
}

/**
 * TaskMaintenanceDialogComponent
 *
 * The maintenance surfaces the Manage menu opens: the retention-sweep dialog
 * and the excluded-folders drawer.
 *
 * The drawer lists EVERY skipped folder by name with its typed reason. A count
 * alone tells a user that folders vanished without telling them which, or why.
 */
@Component({
  selector: 'ptah-task-maintenance-dialog',
  standalone: true,
  imports: [NativeDrawerComponent, TaskSweepDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sweep(); as plan) {
      <ptah-task-sweep-dialog
        [plan]="plan"
        [days]="sweepDays()"
        [sweeping]="sweeping()"
        (closed)="sweepClosed.emit()"
        (confirmed)="sweepConfirmed.emit()"
      />
    }

    <ptah-native-drawer
      [isOpen]="exclusionsOpen()"
      ariaLabel="Folders excluded from the board"
      widthClass="w-full max-w-xl"
      (closed)="exclusionsClosed.emit()"
    >
      <div drawer-header class="flex flex-col gap-0.5">
        <h2 class="text-base font-semibold text-base-content">
          {{ excludedCount() }} folder(s) skipped
        </h2>
        <p class="text-sm text-base-content-muted">
          These sub-folders of
          <span class="font-mono">{{ specRoot }}</span> exist on disk but never
          reach the board.
        </p>
      </div>

      @if (rows().length > 0) {
        <ul class="flex flex-col gap-2" data-testid="tasks-excluded-list">
          @for (folder of rows(); track folder.folderName) {
            <li
              class="flex flex-col gap-1 rounded-box border border-surface-border bg-surface-2 px-3 py-2"
              data-testid="tasks-excluded-row"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="break-all font-mono text-xs text-base-content"
                  data-testid="tasks-excluded-name"
                >
                  {{ folder.folderName }}
                </span>
                <span
                  class="badge badge-ghost border-surface-border font-mono text-xs text-base-content"
                >
                  {{ folder.reason }}
                </span>
              </div>
              <p
                class="text-sm text-base-content-muted"
                data-testid="tasks-excluded-reason"
              >
                {{ folder.reasonLabel }}
              </p>
            </li>
          }
        </ul>
      } @else if (namesUnavailable()) {
        <p
          class="text-sm text-base-content-muted"
          data-testid="tasks-excluded-unnamed"
        >
          This host reported {{ excludedCount() }} skipped folder(s) but did not
          name them. Run Reindex; if the list stays empty the host predates the
          named-exclusion contract and must be updated.
        </p>
      } @else {
        <p class="text-sm text-base-content-muted">
          Nothing is being skipped — every task folder on disk is on the board.
        </p>
      }
    </ptah-native-drawer>
  `,
})
export class TaskMaintenanceDialogComponent {
  public readonly sweep = input<TasksSweepResult | null>(null);
  public readonly sweepDays = input(7);
  public readonly sweeping = input(false);
  public readonly exclusionsOpen = input(false);
  public readonly excludedCount = input(0);
  public readonly excludedFolders = input<readonly ExcludedTaskFolder[]>([]);
  /** The host reported a count but no names (pre-contract host). */
  public readonly namesUnavailable = input(false);

  public readonly sweepClosed = output<void>();
  public readonly sweepConfirmed = output<void>();
  public readonly exclusionsClosed = output<void>();

  protected readonly specRoot = SPEC_ROOT;

  protected readonly rows = computed<readonly ExcludedFolderRow[]>(() =>
    this.excludedFolders().map((folder) => ({
      ...folder,
      reasonLabel: taskExclusionReasonLabel(folder.reason),
    })),
  );
}
