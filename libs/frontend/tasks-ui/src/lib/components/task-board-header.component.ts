import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import {
  Columns3,
  Command,
  Ellipsis,
  EyeOff,
  FileText,
  List,
  LucideAngularModule,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-angular';
import {
  TASK_VIEW_MODES,
  TASK_VIEW_MODE_LABELS,
  type TaskViewMode,
} from '../services/task-view-mode.service';

/** Shared focus ring from the design spec's token map. */
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * TaskBoardHeaderComponent
 *
 * The Tasks board title row: heading and counts, the board/list switch, the
 * command-palette trigger, the Manage (maintenance) menu and New Task.
 *
 * Presentational only. Every flag it renders is read from `TasksStore` by the
 * parent and every action is an output, so the gating rules (no workspace,
 * busy, loading, sweeping) live in exactly one place.
 *
 * The maintenance actions write into `.ptah/specs`, so they are disabled when
 * `canWrite` is false. The palette trigger stays enabled: it is how a user
 * discovers what the surface can do, and its own entries are gated.
 */
@Component({
  selector: 'ptah-task-board-header',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block flex-shrink-0',
    '(keydown.escape)': 'onEscape($event)',
  },
  template: `
    <header
      class="flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface-1 border-b border-surface-border px-4 py-3"
    >
      <div class="flex min-w-0 items-baseline gap-3">
        <h1 class="text-xl font-semibold text-base-content">Tasks</h1>
        @if (totalCount() > 0) {
          <span
            class="text-sm text-base-content-muted tabular-nums"
            data-testid="tasks-header-counts"
            title="Board totals — active = In Progress + In Review"
          >
            {{ totalCount() }} tasks · {{ activeCount() }} active ·
            {{ doneCount() }} done
          </span>
        }
      </div>

      <div class="hidden flex-1 min-[760px]:block"></div>

      <div class="flex flex-wrap items-center gap-2">
        <div
          class="flex items-center gap-1"
          role="group"
          aria-label="Task layout"
        >
          @for (option of viewModes; track option) {
            <button
              type="button"
              [class]="modeButtonClass(option)"
              [attr.aria-pressed]="mode() === option"
              [attr.data-testid]="'tasks-view-mode-' + option"
              [title]="modeTitle(option)"
              (click)="modeChange.emit(option)"
            >
              <lucide-angular
                [img]="option === 'kanban' ? Columns3Icon : ListIcon"
                class="h-4 w-4"
                aria-hidden="true"
              />
              {{ modeLabel(option) }}
            </button>
          }
        </div>

        <button
          type="button"
          class="btn btn-ghost btn-sm gap-1.5 border border-surface-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          aria-haspopup="dialog"
          [attr.aria-expanded]="paletteOpen()"
          data-testid="tasks-palette-trigger"
          title="Open the command palette (Ctrl+K / Cmd+K)"
          (click)="openPalette.emit()"
        >
          <lucide-angular
            [img]="CommandIcon"
            class="h-4 w-4"
            aria-hidden="true"
          />
          Commands
        </button>

        <details
          #manage
          class="dropdown dropdown-end"
          data-testid="tasks-maintenance-menu"
        >
          <summary
            class="btn btn-ghost btn-sm gap-1.5 border border-surface-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
            aria-label="Manage tasks: reindex, registry, tidy finished, excluded folders"
          >
            <lucide-angular
              [img]="EllipsisIcon"
              class="h-4 w-4"
              aria-hidden="true"
            />
            Manage
          </summary>
          <ul
            class="dropdown-content menu z-40 mt-1 w-60 gap-0.5 bg-surface-2 border border-surface-border rounded-box p-1 text-sm text-base-content shadow-[var(--elev-shadow-raised)]"
          >
            <li>
              <button
                type="button"
                class="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                data-testid="tasks-reindex"
                [disabled]="busy() || loading() || !canWrite()"
                title="Reindex .ptah/specs"
                (click)="closeMenu(manage); reindex.emit()"
              >
                <lucide-angular
                  [img]="RefreshCwIcon"
                  class="h-4 w-4"
                  aria-hidden="true"
                  [class.animate-spin]="busy() || loading()"
                />
                Reindex
              </button>
            </li>
            <li>
              <button
                type="button"
                class="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                data-testid="tasks-registry"
                [disabled]="busy() || !canWrite()"
                title="Regenerate registry.md"
                (click)="closeMenu(manage); generateRegistry.emit()"
              >
                <lucide-angular
                  [img]="FileTextIcon"
                  class="h-4 w-4"
                  aria-hidden="true"
                />
                Generate registry
              </button>
            </li>
            <li>
              <button
                type="button"
                class="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                data-testid="tasks-sweep-trigger"
                aria-haspopup="dialog"
                [disabled]="busy() || sweeping() || !canWrite()"
                title="Preview which finished tasks would be deleted"
                (click)="closeMenu(manage); openSweep.emit()"
              >
                <lucide-angular
                  [img]="Trash2Icon"
                  class="h-4 w-4"
                  aria-hidden="true"
                />
                Tidy finished…
              </button>
            </li>
            <li>
              <button
                type="button"
                class="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
                data-testid="tasks-maintenance-excluded"
                aria-haspopup="dialog"
                (click)="closeMenu(manage); openExclusions.emit()"
              >
                <lucide-angular
                  [img]="EyeOffIcon"
                  class="h-4 w-4"
                  aria-hidden="true"
                />
                Excluded folders ({{ excludedCount() }})
              </button>
            </li>
          </ul>
        </details>

        <button
          type="button"
          class="btn btn-primary btn-sm h-9 min-h-9 gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          data-testid="tasks-create-trigger"
          [disabled]="!canWrite()"
          (click)="createTask.emit()"
        >
          <lucide-angular [img]="PlusIcon" class="h-4 w-4" aria-hidden="true" />
          New Task
        </button>
      </div>
    </header>
  `,
})
export class TaskBoardHeaderComponent {
  public readonly totalCount = input(0);
  public readonly activeCount = input(0);
  public readonly doneCount = input(0);
  public readonly mode = input.required<TaskViewMode>();
  public readonly paletteOpen = input(false);
  /** False with no workspace open — every write action is then refused. */
  public readonly canWrite = input(false);
  public readonly busy = input(false);
  public readonly loading = input(false);
  public readonly sweeping = input(false);
  public readonly excludedCount = input(0);

  public readonly modeChange = output<TaskViewMode>();
  public readonly openPalette = output<void>();
  public readonly reindex = output<void>();
  public readonly generateRegistry = output<void>();
  public readonly openSweep = output<void>();
  public readonly openExclusions = output<void>();
  public readonly createTask = output<void>();

  protected readonly viewModes = TASK_VIEW_MODES;

  private readonly manageMenu =
    viewChild.required<ElementRef<HTMLDetailsElement>>('manage');

  protected readonly Columns3Icon = Columns3;
  protected readonly ListIcon = List;
  protected readonly CommandIcon = Command;
  protected readonly EllipsisIcon = Ellipsis;
  protected readonly EyeOffIcon = EyeOff;
  protected readonly FileTextIcon = FileText;
  protected readonly PlusIcon = Plus;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly Trash2Icon = Trash2;

  protected modeLabel(mode: TaskViewMode): string {
    return TASK_VIEW_MODE_LABELS[mode];
  }

  protected modeTitle(mode: TaskViewMode): string {
    return mode === 'kanban'
      ? 'Kanban — six status columns of cards'
      : 'List — one scrolling table, grouped by status';
  }

  /** Active mode reads from `aria-pressed` and the selected surface. */
  protected modeButtonClass(mode: TaskViewMode): string {
    const active = this.mode() === mode ? ' bg-surface-3' : '';
    return `btn btn-ghost btn-sm gap-1.5 ${FOCUS}${active}`;
  }

  /** Escape closes an open Manage menu and returns focus to its summary. */
  protected onEscape(event: Event): void {
    const menu = this.manageMenu().nativeElement;
    if (!menu.open) return;
    event.preventDefault();
    event.stopPropagation();
    this.closeMenu(menu, true);
  }

  /**
   * Close the native disclosure after an action, so the menu never stays open
   * over a dialog it just launched. Escape also returns focus to the summary.
   */
  protected closeMenu(menu: HTMLDetailsElement, refocus = false): void {
    if (!menu.open) return;
    menu.open = false;
    if (refocus) menu.querySelector('summary')?.focus();
  }
}
