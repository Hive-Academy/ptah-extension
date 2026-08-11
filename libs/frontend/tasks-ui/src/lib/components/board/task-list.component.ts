import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleX,
  GitBranch,
  ListTree,
  LucideAngularModule,
  MoreVertical,
  Play,
  Plus,
  User,
} from 'lucide-angular';
import {
  TASK_STATUSES,
  type TaskChildRollup,
  type TaskGraph,
  type TaskSpecSummary,
  type TaskStatus,
} from '@ptah-extension/shared';
import type {
  TaskBoardColumn,
  TaskBulkOutcome,
} from '../../services/tasks-store.service';
import {
  TASK_ESTIMATE_LABELS,
  TASK_STATUS_BADGE,
  TASK_STATUS_LABELS,
  labelChipClass,
  taskEstimateBadge,
  taskTypeBadge,
} from '../../task-presentation';
import { isTextEntryTarget } from '../keyboard-target';
import type {
  TaskSelectionToggle,
  TaskStartRequest,
  TaskStatusChange,
} from './task-card.component';

/** One status group, resolved for rendering. */
interface TaskListGroup {
  readonly status: TaskStatus;
  readonly label: string;
  readonly badgeClass: string;
  readonly tasks: readonly TaskSpecSummary[];
  readonly shown: number;
  readonly total: number;
  /** How many of this status the active filter is hiding. */
  readonly hidden: number;
  readonly countTitle: string;
  readonly collapsed: boolean;
  /** Terminal statuses cannot be started — the row hides its launch controls. */
  readonly terminal: boolean;
}

/**
 * How many label chips a row shows before rolling the rest into `+N`.
 *
 * ONE, against the card's three. The card gives labels a line of their own; the
 * row shares one cell with the id and the title, and every chip is taken
 * straight off the title — three of them cut "The stale-content symptom…" down
 * to "The sta…", which is a row that has stopped identifying its own task. The
 * overflow chip still names every label it stands for.
 */
const MAX_VISIBLE_LABELS = 1;

/**
 * TaskListComponent
 *
 * The Tasks surface as ONE vertically-scrolling list of status groups, each a
 * table of ~40px rows — the alternative to `TaskBoardComponent`'s six-column
 * Kanban, selected by `TaskViewModeService`.
 *
 * ## It consumes the board model unchanged
 *
 * Same `TaskBoardColumn[]` input, same six outputs, same selection / pending /
 * outcome inputs as the board. The two are interchangeable at the host, which
 * is what keeps `TasksViewComponent`'s wiring one `@if` rather than a fork: a
 * facet added to the filter, or a new bulk state, reaches both layouts without
 * either of them being taught about it.
 *
 * ## Why a row is ~40px and a card is ~166px
 *
 * The card spends its height on a two-line title, a badge row of its own, and a
 * footer carrying Isolate and Start. The row spends none: the title is one
 * line, the badges are columns, and the launch controls sit in a cell of a row
 * whose height is already set by its tallest text. Nothing was dropped to get
 * there — every affordance the card carries is reachable here.
 *
 * ## Isolation is a menu item, not a per-row toggle
 *
 * The card holds `isolate` as local state that Start then reads. A row has no
 * width to spend on a toggle whose value is invisible until you look at it, and
 * a per-row boolean that survives between clicks is state a user has to
 * remember. The `⋮` menu offers "Start isolated" as a distinct action instead,
 * so the intent is carried by the thing that was clicked.
 *
 * ## Two sticky levels, which is the point of the layout
 *
 * The group header pins at `top-0` and the column header row at `top-8`, both
 * inside this component's single scroll container. Scrolling three hundred rows
 * therefore never costs the user the status they are looking at or the meaning
 * of the column they are reading — the failure that the Kanban's per-column
 * scroll leaves open once a column is longer than the viewport.
 */
@Component({
  selector: 'ptah-task-list',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block h-full min-h-0',
    '(keydown)': 'onKeyDown($event)',
  },
  template: `
    <div class="h-full overflow-y-auto">
      @for (group of groups(); track group.status) {
        <section [attr.aria-label]="group.label + ' group'">
          <!-- Pinned at top-0 of THIS scroll container. The status a user is
               reading must not leave the screen because the group under it is
               long — that is the whole reason the list groups at all. -->
          <header
            class="sticky top-0 z-30 flex h-8 items-center gap-2 border-b border-base-300 bg-base-100 px-3"
          >
            <button
              type="button"
              class="flex items-center gap-1.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
              [attr.aria-expanded]="!group.collapsed"
              [attr.data-testid]="'task-list-group-' + group.status"
              [title]="
                (group.collapsed ? 'Expand ' : 'Collapse ') + group.label
              "
              (click)="toggleGroup(group.status)"
            >
              <lucide-angular
                [img]="group.collapsed ? ChevronRightIcon : ChevronDownIcon"
                class="h-3 w-3"
                aria-hidden="true"
              />
              <span class="badge badge-xs" [class]="group.badgeClass">{{
                group.label
              }}</span>
            </button>
            <!-- Filtered over indexed, on the same rule the Kanban column
                 uses: the second number appears ONLY while a filter is hiding
                 something. -->
            <span
              class="font-mono text-xs tabular-nums text-base-content"
              [attr.data-testid]="'task-list-count-' + group.status"
              [title]="group.countTitle"
            >
              @if (group.hidden > 0) {
                {{ group.shown }} of {{ group.total }}
              } @else {
                {{ group.shown }}
              }
            </span>
            <div class="flex-1"></div>
            <!-- Creates the task IN THIS STATUS, which is why it exists as a
                 per-group control at all. tasks:create carries the status,
                 so the task lands in the group whose button was pressed — a
                 plus that silently dropped everything into Backlog would be an
                 affordance that lies about where it puts things. -->
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square"
              [attr.data-testid]="'task-list-add-' + group.status"
              [attr.aria-label]="'New task in ' + group.label"
              [title]="'New task in ' + group.label"
              (click)="createInStatus.emit(group.status)"
            >
              <lucide-angular [img]="PlusIcon" class="h-3 w-3" />
            </button>
          </header>

          @if (!group.collapsed) {
            @if (group.tasks.length === 0) {
              <p
                class="px-3 py-2 text-[11px] text-base-content"
                [attr.data-testid]="'task-list-empty-' + group.status"
              >
                @if (group.hidden > 0) {
                  {{ group.hidden }} hidden by the filter
                } @else {
                  No tasks
                }
              </p>
            } @else {
              <table class="w-full table-fixed border-collapse text-xs">
                <thead>
                  <!-- position:sticky is on each TH, never on the TR:
                       Chromium — the only engine this ships on — ignores it on
                       a table row, and a header that silently fails to pin is
                       the exact defect this layout exists to fix. top-8 clears
                       the h-8 group header above it, so the two pin as a pair
                       rather than one sliding under the other. -->
                  <!-- Widths are PERCENTAGES summing to 100, applied inline.
                       Fixed px widths do not survive a resizable pane: the
                       eight sized columns summed past the pane, table-fixed
                       gave the one unsized column (Task) the ~8px that were
                       left, and the id and title spilled across Description.
                       Percentages scale together, so every column narrows and
                       none of them collapses. Caught by the Electron visual
                       pass; jsdom has no layout and cannot see it. -->
                  <tr
                    class="text-left text-[10px] uppercase tracking-wide text-base-content"
                  >
                    <th
                      scope="col"
                      class="sticky top-8 z-20 bg-base-200 px-2 py-1 font-medium"
                      [style.width.%]="compact() ? 8 : 4"
                    >
                      <span class="sr-only">Select</span>
                    </th>
                    <th
                      scope="col"
                      class="sticky top-8 z-20 bg-base-200 px-2 py-1 font-medium"
                      [style.width.%]="compact() ? 52 : 30"
                    >
                      Task
                    </th>
                    @if (!compact()) {
                      <th
                        scope="col"
                        class="sticky top-8 z-20 bg-base-200 px-2 py-1 font-medium"
                        [style.width.%]="16"
                      >
                        Description
                      </th>
                    }
                    <th
                      scope="col"
                      class="sticky top-8 z-20 bg-base-200 px-2 py-1 font-medium"
                      [style.width.%]="compact() ? 18 : 8"
                    >
                      Type
                    </th>
                    @if (!compact()) {
                      <th
                        scope="col"
                        class="sticky top-8 z-20 bg-base-200 px-2 py-1 font-medium"
                        [style.width.%]="6"
                      >
                        <!-- "Size", not "Estimate": at 6% the longer word
                             clipped to "ESTIMAT", and a header that cannot
                             finish its own word is worse than a shorter one
                             that means the same thing. -->
                        Size
                      </th>
                      <th
                        scope="col"
                        class="sticky top-8 z-20 bg-base-200 px-2 py-1 font-medium"
                        [style.width.%]="10"
                      >
                        Updated
                      </th>
                      <th
                        scope="col"
                        class="sticky top-8 z-20 bg-base-200 px-2 py-1 font-medium"
                        [style.width.%]="9"
                      >
                        Executor
                      </th>
                      <th
                        scope="col"
                        class="sticky top-8 z-20 bg-base-200 px-2 py-1 font-medium"
                        [style.width.%]="8"
                      >
                        Progress
                      </th>
                    }
                    <th
                      scope="col"
                      class="sticky top-8 z-20 bg-base-200 px-2 py-1 font-medium"
                      [style.width.%]="compact() ? 22 : 9"
                    >
                      <span class="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  @for (task of group.tasks; track task.id) {
                    <!-- Open and checked are shown on DIFFERENT properties, on
                         the same rule TaskCardComponent documents: a left
                         accent for the task whose detail panel is open, a
                         filled surface for one a bulk write would touch. They
                         are independent, so a row can carry both without
                         either being ambiguous, and the checkbox states the
                         second one redundantly (WCAG 1.4.1). -->
                    <tr
                      class="border-b border-base-300/60 border-l-2 border-l-transparent transition-colors hover:bg-base-200/60 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
                      [class.border-l-primary]="task.id === selectedTaskId()"
                      [class.bg-primary]="task.id === selectedTaskId()"
                      [class.bg-opacity-10]="task.id === selectedTaskId()"
                      [class.bg-base-200]="
                        selection().has(task.id) && task.id !== selectedTaskId()
                      "
                      [attr.tabindex]="rovingTabIndex(task.id)"
                      [attr.data-task-id]="task.id"
                      [attr.aria-label]="'Open task ' + task.id"
                      [attr.aria-selected]="selection().has(task.id)"
                      (click)="onRowClick(task.id, $event)"
                      (keydown.enter)="onRowEnter(task.id, $event)"
                      (keydown.space)="onRowSpace(task.id, $event)"
                    >
                      <!-- 24x24 hit area around a 16px box: SC 2.5.8's floor
                           on the control a user hits repeatedly while building
                           a selection, without spending a 24px box's worth of
                           row height on it. Disabled while its own write is in
                           flight, so the board cannot show an unchecked row
                           for a task being written right now. -->
                      <td class="px-2 py-1.5 align-middle">
                        <span class="flex h-6 w-6 items-center justify-center">
                          <input
                            type="checkbox"
                            class="checkbox checkbox-xs"
                            data-testid="task-row-select"
                            [attr.tabindex]="rovingTabIndex(task.id)"
                            [checked]="selection().has(task.id)"
                            [disabled]="pending().has(task.id)"
                            [attr.aria-label]="selectAriaLabel(task)"
                            [title]="selectAriaLabel(task)"
                            (click)="onCheckboxClick(task.id, $event)"
                          />
                        </span>
                      </td>

                      <!-- overflow-hidden is load-bearing, not tidiness: the
                           cell holds shrink-0 badges, and without it they
                           paint straight over the next column instead of
                           being clipped by their own cell. -->
                      <td class="overflow-hidden px-2 py-1.5 align-middle">
                        <div class="flex min-w-0 items-center gap-1.5">
                          <span
                            class="shrink-0 font-mono text-[10px] text-base-content-muted"
                            >{{ task.id }}</span
                          >
                          <span
                            class="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight"
                            [title]="task.title"
                            >{{ task.title }}</span
                          >
                          @if (pending().has(task.id)) {
                            <span
                              class="loading loading-spinner loading-xs shrink-0"
                              data-testid="task-row-pending"
                              role="status"
                              [attr.aria-label]="'Updating ' + task.id"
                            ></span>
                          }
                          @if (!task.frontmatterValid) {
                            <span
                              class="shrink-0 text-warning"
                              title="Frontmatter has validation warnings"
                              [attr.aria-label]="
                                task.validationIssues.length +
                                ' validation warning(s)'
                              "
                            >
                              <lucide-angular
                                [img]="AlertTriangleIcon"
                                class="h-3 w-3"
                              />
                            </span>
                          }
                          <!-- How the LAST bulk run left this row, for the two
                               states that both leave it checked. The word is
                               the signal, never the colour. -->
                          @if (outcomes().get(task.id); as outcome) {
                            <span
                              class="badge badge-xs badge-outline shrink-0 gap-0.5 text-base-content"
                              [attr.data-testid]="'task-row-outcome-' + outcome"
                              [title]="outcomeTitle(task, outcome)"
                              [attr.aria-label]="outcomeTitle(task, outcome)"
                            >
                              <lucide-angular
                                [img]="
                                  outcome === 'failed'
                                    ? CircleXIcon
                                    : CircleDashedIcon
                                "
                                class="h-2.5 w-2.5"
                                aria-hidden="true"
                              />
                              @if (outcome === 'failed') {
                                refused
                              } @else {
                                not attempted
                              }
                            </span>
                          }
                          <!-- Scanning metadata, dropped in the rail for the
                               same reason the columns are: 52% of a 440px
                               pane is not a width these fit in, and a chip
                               that squeezes the title down to one character
                               costs more than it tells. -->
                          @if (!compact() && task.dependsOn.length > 0) {
                            <span
                              class="badge badge-xs badge-ghost shrink-0 gap-0.5"
                              [title]="
                                'Depends on: ' + task.dependsOn.join(', ')
                              "
                            >
                              <lucide-angular
                                [img]="GitBranchIcon"
                                class="h-2.5 w-2.5"
                              />
                              {{ task.dependsOn.length }}
                            </span>
                          }
                          @for (
                            label of compact() ? [] : visibleLabels(task);
                            track label
                          ) {
                            <span
                              class="badge badge-xs max-w-[6rem] shrink-0 truncate border font-normal"
                              [class]="chipClass(label)"
                              [title]="'Label: ' + label"
                              >{{ label }}</span
                            >
                          }
                          @if (!compact() && hiddenLabelCount(task) > 0) {
                            <span
                              class="badge badge-xs badge-ghost shrink-0 font-normal tabular-nums"
                              [title]="hiddenLabelsTitle(task)"
                              [attr.aria-label]="hiddenLabelsTitle(task)"
                              data-testid="task-row-labels-overflow"
                              >+{{ hiddenLabelCount(task) }}</span
                            >
                          }
                        </div>
                      </td>

                      @if (!compact()) {
                        <td
                          class="truncate px-2 py-1.5 align-middle text-base-content-muted"
                          [title]="task.description ?? ''"
                        >
                          {{ task.description ?? '—' }}
                        </td>
                      }

                      <td class="px-2 py-1.5 align-middle">
                        <span class="badge badge-xs" [class]="typeClass(task)">
                          {{ task.type ?? 'no type' }}
                        </span>
                      </td>

                      @if (!compact()) {
                        <td class="px-2 py-1.5 align-middle">
                          @if (task.estimate; as estimate) {
                            <span
                              class="badge badge-xs"
                              [class]="estimateClass(estimate)"
                              [title]="estimateTitle(estimate)"
                              data-testid="task-row-estimate"
                              >{{ estimate }}</span
                            >
                          } @else {
                            <span class="text-base-content-muted">—</span>
                          }
                        </td>

                        <td
                          class="whitespace-nowrap px-2 py-1.5 align-middle tabular-nums text-base-content-muted"
                          [title]="updatedTitle(task)"
                          data-testid="task-row-updated"
                        >
                          {{ updatedLabel(task) }}
                        </td>

                        <td class="px-2 py-1.5 align-middle">
                          @if (task.executor; as executor) {
                            <span
                              class="flex min-w-0 items-center gap-1"
                              [title]="'Executor: ' + executor"
                            >
                              <lucide-angular
                                [img]="UserIcon"
                                class="h-2.5 w-2.5 shrink-0"
                                aria-hidden="true"
                              />
                              <span class="truncate">{{ executor }}</span>
                            </span>
                          } @else {
                            <span class="text-base-content-muted">—</span>
                          }
                        </td>

                        <!-- The rollup is a CONTROL, not a readout: it narrows
                             the board to this task's sub-tasks, exactly as the
                             card's does. The bar is aria-hidden decoration
                             over a button whose accessible name states both
                             the counts and what pressing it does. -->
                        <td class="px-2 py-1.5 align-middle">
                          @if (rollup(task); as counts) {
                            <button
                              type="button"
                              class="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 hover:bg-base-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
                              [attr.tabindex]="rovingTabIndex(task.id)"
                              [title]="rollupActionTitle(task, counts)"
                              data-testid="task-row-rollup"
                              (click)="
                                $event.stopPropagation();
                                filterChildren.emit(task.id)
                              "
                            >
                              <span class="sr-only">{{
                                rollupActionTitle(task, counts)
                              }}</span>
                              <lucide-angular
                                [img]="ListTreeIcon"
                                class="h-2.5 w-2.5 shrink-0"
                                aria-hidden="true"
                              />
                              <progress
                                class="progress progress-primary h-1.5 w-full"
                                [value]="counts.done"
                                [max]="counts.total"
                                aria-hidden="true"
                              ></progress>
                              <span
                                class="shrink-0 tabular-nums"
                                aria-hidden="true"
                                data-testid="task-row-rollup-glyph"
                                >{{ counts.done }}/{{ counts.total }}</span
                              >
                            </button>
                          } @else {
                            <span class="text-base-content-muted">—</span>
                          }
                        </td>
                      }

                      <!-- Start stays on the row because it is the ONLY launch
                           path in this lib — neither the detail panel nor the
                           bulk bar can start a task. It costs no height here:
                           the cell is as tall as the row already is. -->
                      <td class="px-2 py-1.5 align-middle">
                        <div class="flex items-center justify-end gap-0.5">
                          @if (!group.terminal) {
                            <!-- btn-ghost with an explicit hover PAIR, not
                                 hover:btn-primary. A daisyui component class
                                 behind a variant brings its own background
                                 without its own foreground, which is how the
                                 card's hover:badge-primary landed at 4.14:1
                                 on the default theme. -->
                            <button
                              type="button"
                              class="btn btn-ghost btn-xs gap-1 px-1.5 hover:bg-primary hover:text-primary-content"
                              [attr.tabindex]="rovingTabIndex(task.id)"
                              [attr.aria-label]="'Start task ' + task.id"
                              [title]="'Start task ' + task.id"
                              data-testid="task-row-start"
                              (click)="
                                $event.stopPropagation();
                                onStart(task.id, false)
                              "
                            >
                              <lucide-angular
                                [img]="PlayIcon"
                                class="h-3 w-3"
                                aria-hidden="true"
                              />
                              Start
                            </button>
                          }
                          <div class="dropdown dropdown-end">
                            <button
                              type="button"
                              class="btn btn-ghost btn-xs btn-square"
                              [attr.tabindex]="rovingTabIndex(task.id)"
                              aria-label="Task actions"
                              title="Task actions"
                              (click)="$event.stopPropagation()"
                            >
                              <lucide-angular
                                [img]="MoreVerticalIcon"
                                class="h-3 w-3"
                              />
                            </button>
                            <ul
                              [attr.tabindex]="rovingTabIndex(task.id)"
                              class="dropdown-content menu menu-xs z-40 w-52 rounded-box border border-base-content/10 bg-base-200 p-1 shadow"
                            >
                              @if (!group.terminal) {
                                <li>
                                  <button
                                    type="button"
                                    [attr.tabindex]="rovingTabIndex(task.id)"
                                    data-testid="task-row-start-isolated"
                                    title="Run implementation in an isolated git worktree — the agent delegates file-editing work to worktree-isolated subagents, keeping changes off the main working tree until reviewed"
                                    (click)="
                                      $event.stopPropagation();
                                      onStart(task.id, true)
                                    "
                                  >
                                    Start isolated
                                  </button>
                                </li>
                              }
                              <li class="menu-title px-2 py-1 text-[10px]">
                                Move to
                              </li>
                              @for (option of statusOptions; track option) {
                                <li>
                                  <button
                                    type="button"
                                    class="justify-between"
                                    [attr.tabindex]="rovingTabIndex(task.id)"
                                    [class.active]="option === task.status"
                                    (click)="
                                      $event.stopPropagation();
                                      onStatusPick(task, option)
                                    "
                                  >
                                    {{ statusLabel(option) }}
                                  </button>
                                </li>
                              }
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          }
        </section>
      }
    </div>
  `,
})
export class TaskListComponent {
  public readonly columns = input.required<TaskBoardColumn[]>();
  public readonly selectedTaskId = input<string | null>(null);
  /** The multi-selection — see `TaskColumnComponent.selection`. */
  public readonly selection = input<ReadonlySet<string>>(new Set());
  /** Ids with a bulk write in flight. */
  public readonly pending = input<ReadonlySet<string>>(new Set());
  /** Last-run outcomes — see `TaskColumnComponent.outcomes`. */
  public readonly outcomes = input<ReadonlyMap<string, TaskBulkOutcome>>(
    new Map(),
  );
  /** Forwarded to the rollup and nothing else; see `TaskCardComponent.graph`. */
  public readonly graph = input<TaskGraph | null>(null);
  /**
   * Render the narrow variant: Task, Type and the actions, nothing else.
   *
   * Set while the detail panel is open, where the list is a navigation rail
   * beside the task being read rather than the table being scanned. It drops
   * columns rather than shrinking them, because five columns squeezed into a
   * 380px pane are five columns nobody can read.
   */
  public readonly compact = input(false);

  public readonly taskSelect = output<string>();
  /** Space on the focused row — toggles its selection. */
  public readonly taskToggle = output<string>();
  /** A checkbox / Ctrl-click / Shift-click gesture. */
  public readonly selectionToggle = output<TaskSelectionToggle>();
  /** Escape with focus in the list; the host decides what it means. */
  public readonly escapePressed = output<void>();
  public readonly statusChange = output<TaskStatusChange>();
  public readonly startTask = output<TaskStartRequest>();
  /** A rollup click: narrow the board to THAT task's sub-tasks. */
  public readonly filterChildren = output<string>();
  /** A group's `+`: open the create flow with THAT status pre-selected. */
  public readonly createInStatus = output<TaskStatus>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Statuses the user has folded away. Collapsed is a VIEW state, never a filter. */
  private readonly _collapsed = signal<ReadonlySet<TaskStatus>>(new Set());
  private readonly _focusedTaskId = signal<string | null>(null);

  protected readonly statusOptions = TASK_STATUSES;

  protected readonly groups = computed<readonly TaskListGroup[]>(() => {
    const collapsed = this._collapsed();
    return this.columns().map((column) => {
      const label = TASK_STATUS_LABELS[column.status];
      const shown = column.tasks.length;
      const total = column.total;
      // Clamped, on the same rule the Kanban column uses: a payload whose
      // indexed total is smaller than the rendered list must fall back to the
      // plain count rather than let the header claim a negative number.
      const hidden = Math.max(0, total - shown);
      return {
        status: column.status,
        label,
        badgeClass: TASK_STATUS_BADGE[column.status],
        tasks: column.tasks,
        shown,
        total,
        hidden,
        countTitle:
          hidden === 0
            ? `${shown} ${label} task(s)`
            : `${shown} of ${total} ${label} task(s) — ${hidden} hidden by the active filter`,
        collapsed: collapsed.has(column.status),
        terminal: column.status === 'done' || column.status === 'cancelled',
      };
    });
  });

  /**
   * Every REACHABLE row id, top to bottom.
   *
   * Rows inside a collapsed group are excluded, so the arrow keys cannot move
   * focus onto something the user cannot see — and the roving tab stop cannot
   * land there either, which would give the list a tab stop with no visible
   * target.
   */
  private readonly navigationOrder = computed<readonly string[]>(() =>
    this.groups()
      .filter((group) => !group.collapsed)
      .flatMap((group) => group.tasks.map((task) => task.id)),
  );

  /**
   * The row carrying `tabindex="0"`, falling back to the first reachable row.
   *
   * Same contract as the board's: collapsing the group that held the focus, or
   * filtering its row away, must leave the list with a way in from the keyboard
   * rather than zero tab stops.
   */
  protected readonly focusedTaskId = computed<string | null>(() => {
    const order = this.navigationOrder();
    const explicit = this._focusedTaskId();
    if (explicit !== null && order.includes(explicit)) return explicit;
    return order[0] ?? null;
  });

  protected rovingTabIndex(taskId: string): number {
    return this.focusedTaskId() === taskId ? 0 : -1;
  }

  protected statusLabel(status: TaskStatus): string {
    return TASK_STATUS_LABELS[status];
  }

  protected typeClass(task: TaskSpecSummary): string {
    return taskTypeBadge(task.type);
  }

  protected estimateClass(
    estimate: NonNullable<TaskSpecSummary['estimate']>,
  ): string {
    return taskEstimateBadge(estimate);
  }

  protected estimateTitle(
    estimate: NonNullable<TaskSpecSummary['estimate']>,
  ): string {
    return `Estimate: ${TASK_ESTIMATE_LABELS[estimate]}`;
  }

  protected chipClass(label: string): string {
    return labelChipClass(label);
  }

  protected visibleLabels(task: TaskSpecSummary): string[] {
    return task.labels.slice(0, MAX_VISIBLE_LABELS);
  }

  protected hiddenLabelCount(task: TaskSpecSummary): number {
    return Math.max(0, task.labels.length - MAX_VISIBLE_LABELS);
  }

  protected hiddenLabelsTitle(task: TaskSpecSummary): string {
    const hidden = task.labels.slice(MAX_VISIBLE_LABELS);
    return `${hidden.length} more label(s): ${hidden.join(', ')}`;
  }

  protected selectAriaLabel(task: TaskSpecSummary): string {
    return this.selection().has(task.id)
      ? `Deselect task ${task.id}`
      : `Select task ${task.id}`;
  }

  protected outcomeTitle(
    task: TaskSpecSummary,
    outcome: TaskBulkOutcome,
  ): string {
    return outcome === 'failed'
      ? `The last bulk change was refused for ${task.id}. It is still selected — see the summary above for the reason.`
      : `The last bulk change never reached ${task.id} — it was cancelled first, so nothing was written. It is still selected.`;
  }

  protected rollup(task: TaskSpecSummary): TaskChildRollup | null {
    return this.graph()?.rollup.get(task.id) ?? null;
  }

  protected rollupActionTitle(
    task: TaskSpecSummary,
    counts: TaskChildRollup,
  ): string {
    return (
      `Sub-tasks: ${counts.done} done · ${counts.open} open · ` +
      `${counts.cancelled} cancelled (${counts.total} total) — show only these sub-tasks`
    );
  }

  /**
   * The `updated` timestamp as `YYYY-MM-DD`, or an em dash.
   *
   * ISO rather than a localized `Intl` format, for three reasons that all
   * showed up at once. It is the shortest unambiguous form — "Aug 10, 2026"
   * wrapped this column onto two lines in the Electron pass and put 8px of
   * dead height on EVERY row. It sorts lexicographically, matching the column
   * the user sorts by. And it renders identically on every machine, where the
   * localized form varied with the host locale and made the date assertions
   * environment-dependent.
   *
   * `updated` is `string | null` on the contract and crosses the host bridge,
   * so an unparseable value is treated the same as an absent one rather than
   * rendered as `Invalid Date`.
   */
  protected updatedLabel(task: TaskSpecSummary): string {
    const parsed = this.parseUpdated(task);
    return parsed === null ? '—' : parsed.toISOString().slice(0, 10);
  }

  protected updatedTitle(task: TaskSpecSummary): string {
    const parsed = this.parseUpdated(task);
    return parsed === null
      ? 'This task records no update time.'
      : `Last updated ${parsed.toISOString()}`;
  }

  private parseUpdated(task: TaskSpecSummary): Date | null {
    const raw = task.updated;
    if (raw === null || raw === undefined || raw === '') return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /** Fold a status away, or bring it back. */
  protected toggleGroup(status: TaskStatus): void {
    const next = new Set(this._collapsed());
    if (!next.delete(status)) next.add(status);
    this._collapsed.set(next);
  }

  private setCollapsed(status: TaskStatus, collapsed: boolean): boolean {
    const current = this._collapsed();
    if (current.has(status) === collapsed) return false;
    const next = new Set(current);
    if (collapsed) next.add(status);
    else next.delete(status);
    this._collapsed.set(next);
    return true;
  }

  /**
   * A click on the row: open it, unless a modifier says otherwise.
   *
   * Ctrl/Cmd-click toggles the selection, Shift-click extends it, and neither
   * also opens the detail panel — the same three-intent split
   * `TaskCardComponent` documents, because a list and a board that disagree
   * about what Ctrl-click means is worse than either choice.
   */
  protected onRowClick(taskId: string, event: MouseEvent): void {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      this._focusedTaskId.set(taskId);
      this.selectionToggle.emit({ taskId, range: event.shiftKey });
      return;
    }
    this._focusedTaskId.set(taskId);
    this.taskSelect.emit(taskId);
  }

  protected onCheckboxClick(taskId: string, event: MouseEvent): void {
    event.stopPropagation();
    this._focusedTaskId.set(taskId);
    this.selectionToggle.emit({ taskId, range: event.shiftKey });
  }

  /**
   * Enter on the ROW opens it.
   *
   * The guard is the point: the row wraps Start, the actions menu and the
   * rollup, and a keyboard activation on any of them is a `keydown` that
   * bubbles here BEFORE the synthesised click their own handlers stop. Without
   * it, Enter on the rollup would narrow the board AND open a detail panel for
   * a row that narrowing just hid.
   */
  protected onRowEnter(taskId: string, event: Event): void {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this._focusedTaskId.set(taskId);
    this.taskSelect.emit(taskId);
  }

  /** Space on the ROW toggles its selection. Same guard, same why. */
  protected onRowSpace(taskId: string, event: Event): void {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this._focusedTaskId.set(taskId);
    this.taskToggle.emit(taskId);
  }

  protected onStatusPick(task: TaskSpecSummary, status: TaskStatus): void {
    if (status === task.status) return;
    this.statusChange.emit({ taskId: task.id, status });
  }

  protected onStart(taskId: string, isolate: boolean): void {
    this.startTask.emit({ taskId, isolate });
  }

  /**
   * List navigation.
   *
   * Up/Down walk the flattened reachable order, so they cross a group boundary
   * without the user having to know one is there. Left/Right fold the current
   * group away and bring it back — the list's one two-dimensional axis, since
   * unlike the board there is no column to move sideways to.
   *
   * Bound to the HOST element, never `window` or `document`: a document-level
   * listener would move list focus while the user typed in the chat panel on
   * the other side of the webview.
   */
  protected onKeyDown(event: KeyboardEvent): void {
    if (isTextEntryTarget(event.target)) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.escapePressed.emit();
      return;
    }

    const order = this.navigationOrder();
    const focused = this.focusedTaskId();
    if (focused === null) return;
    const index = order.indexOf(focused);
    if (index === -1) return;

    let moved = false;
    switch (event.key) {
      case 'ArrowDown':
        moved = this.focusAt(order, index + 1);
        break;
      case 'ArrowUp':
        moved = this.focusAt(order, index - 1);
        break;
      case 'ArrowRight':
        moved = this.collapseFocusedGroup(false);
        break;
      case 'ArrowLeft':
        moved = this.collapseFocusedGroup(true);
        break;
      case 'Home':
        moved = this.focusAt(order, 0);
        break;
      case 'End':
        moved = this.focusAt(order, order.length - 1);
        break;
      default:
        return;
    }

    // `preventDefault` ONLY on consumption: a key the list did not act on has
    // to stay available to whatever scrolls the surface.
    if (moved) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /**
   * Fold or unfold the group holding the focused row.
   *
   * Folding moves the roving tab stop to the group HEADER, because the row it
   * was on is no longer rendered — leaving it there would focus nothing and
   * strand the keyboard mid-list.
   */
  private collapseFocusedGroup(collapse: boolean): boolean {
    const focused = this.focusedTaskId();
    if (focused === null) return false;
    const group = this.groups().find((candidate) =>
      candidate.tasks.some((task) => task.id === focused),
    );
    if (group === undefined) return false;
    if (!this.setCollapsed(group.status, collapse)) return false;
    if (collapse) this.focusGroupHeader(group.status);
    return true;
  }

  private focusAt(order: readonly string[], index: number): boolean {
    const target = order[index];
    if (target === undefined) return false;
    this._focusedTaskId.set(target);
    this.focusElement('data-task-id', target);
    return true;
  }

  private focusGroupHeader(status: TaskStatus): void {
    this.focusElement('data-testid', `task-list-group-${status}`);
  }

  /**
   * Focus the element carrying `attribute="value"`.
   *
   * Matched by reading the attribute off each candidate, NEVER by interpolating
   * the value into a selector string (BR-10): a task id is a folder name from
   * disk, and building `[data-task-id="${id}"]` would be interpolating
   * untrusted text into a selector grammar.
   */
  private focusElement(attribute: string, value: string): void {
    const candidates = this.host.nativeElement.querySelectorAll<HTMLElement>(
      `[${attribute}]`,
    );
    for (const candidate of Array.from(candidates)) {
      if (candidate.getAttribute(attribute) === value) {
        candidate.focus();
        return;
      }
    }
  }

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly CircleDashedIcon = CircleDashed;
  protected readonly CircleXIcon = CircleX;
  protected readonly GitBranchIcon = GitBranch;
  protected readonly ListTreeIcon = ListTree;
  protected readonly MoreVerticalIcon = MoreVertical;
  protected readonly PlayIcon = Play;
  protected readonly PlusIcon = Plus;
  protected readonly UserIcon = User;
}
