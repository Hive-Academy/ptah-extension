import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleX,
  Copy,
  CornerLeftUp,
  GitBranch,
  ListTree,
  LucideAngularModule,
  MoreVertical,
  Play,
  User,
} from 'lucide-angular';
import {
  TASK_STATUSES,
  type TaskChildRollup,
  type TaskGraph,
  type TaskSpecSummary,
  type TaskStatus,
} from '@ptah-extension/shared';
import type { TaskBulkOutcome } from '../../services/tasks-store.service';
import {
  TASK_ESTIMATE_LABELS,
  TASK_STATUS_LABELS,
  labelChipClass,
  taskEstimateBadge,
  taskTypeBadge,
} from '../../task-presentation';

/**
 * Payload emitted when the Start action fires. `isolate` requests
 * agent-managed worktree isolation (F-D1): the orchestrate prompt carries a
 * directive so the agent isolates its own work — the host creates no worktree.
 */
export interface TaskStartRequest {
  taskId: string;
  isolate: boolean;
}

/** Payload emitted when the user picks a new status from the card menu. */
export interface TaskStatusChange {
  taskId: string;
  status: TaskStatus;
}

/**
 * A request to change the MULTI-SELECTION (FR-C4.1) — never the detail panel.
 *
 * `range` carries the Shift modifier rather than a resolved list of ids,
 * because the card cannot see the board: what lies "between" two cards is a
 * property of the filtered, sorted, column-flattened order, which only the
 * store knows. The card reports the gesture; the store resolves what it means.
 */
export interface TaskSelectionToggle {
  readonly taskId: string;
  /** Shift was held — extend from the store's anchor instead of toggling one. */
  readonly range: boolean;
}

/**
 * Presentational task card. Pure `@Input`/`@Output`; owns only the local
 * worktree-isolation toggle UI state. The Start action emits {@link startTask};
 * `TaskStartService` (wired by `TasksViewComponent`) runs the launch flow.
 */
@Component({
  selector: 'ptah-task-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Checked and selected are shown DIFFERENTLY on purpose: a ring for the
         open task, a filled surface for a checked one. Sharing one treatment
         would make "I am reading this" and "a bulk action will write this"
         indistinguishable at a glance, on a board where only the second is
         destructive. The checkbox carries the state redundantly, so the
         surface is never the only visual signal (WCAG 1.4.1). -->
    <div
      class="card card-compact bg-base-100 border transition-colors cursor-pointer hover:border-primary/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
      [class.border-base-content]="selected()"
      [class.border-opacity-20]="!selected()"
      [class.ring-1]="selected()"
      [class.ring-primary]="selected()"
      [class.bg-base-200]="checked()"
      role="button"
      [attr.tabindex]="rovingTabIndex()"
      [attr.data-task-id]="task().id"
      [attr.aria-label]="'Open task ' + task().id"
      (click)="onCardClick($event)"
      (keydown.enter)="onCardEnter($event)"
      (keydown.space)="onCardSpace($event)"
    >
      <div class="card-body gap-1.5">
        <!-- Header row: checkbox + id + warning + status menu -->
        <div class="flex items-start justify-between gap-1">
          <!-- The multi-select checkbox (FR-C4.1). It is the DISCOVERABLE half
               of the selection model: Ctrl-click and Shift-click do the same
               job faster, but neither announces itself, and a selection model
               reachable only by modifier keys is one most users never find.

               It binds click rather than change, because the gesture needs the
               Shift modifier and a change event does not carry one. The native
               toggle still happens; the checked binding is re-applied from the
               store on the change-detection pass, so the store stays the only
               authority on what is selected. -->
          <!-- 24x24, not checkbox-xs's 16. SC 2.5.8's floor, and the third
               control in this task to be held to it after Batch 7's rollup
               (badge-xs 12px -> btn-xs 24px) and Batch 9's chip remove. It is
               also the control a user hits repeatedly while building a
               selection, so it is the one where an undersized target costs the
               most mis-clicks — and a mis-click here silently changes which
               carriers a bulk write lands on.

               Disabled while its own write is in flight: leaving it live
               allows an unchecked-and-spinning card, which claims the task is
               out of the run at the moment it is being written. -->
          <input
            type="checkbox"
            class="checkbox h-6 w-6 shrink-0"
            data-testid="task-card-select"
            [attr.tabindex]="rovingTabIndex()"
            [checked]="checked()"
            [disabled]="pending()"
            [attr.aria-label]="selectAriaLabel()"
            [title]="selectAriaLabel()"
            (click)="onCheckboxClick($event)"
          />
          <span
            class="text-[10px] font-mono text-base-content/50 truncate flex-1"
          >
            {{ task().id }}
          </span>
          <!-- A write for THIS card is in flight (FR-C4.11). Per-card rather
               than a board-wide busy state: a 120-task run takes several
               seconds, and "the whole board is busy" tells the user nothing
               about which twenty carriers are being written right now. -->
          @if (pending()) {
            <span
              class="loading loading-spinner loading-xs shrink-0"
              data-testid="task-card-pending"
              role="status"
              [attr.aria-label]="'Updating ' + task().id"
            ></span>
          }
          <!-- How the LAST run left this card, for the two states that both
               leave it checked. Without this, a cancelled 120-task run shows
               eighty cards in one visual state carrying two different
               meanings — one refused a write, the other was never asked — and
               the user cannot tell which of them Retry is for.

               The word is the signal, never the colour: "refused" and "not
               attempted" say it outright, and the glyph beside each is
               aria-hidden reinforcement (WCAG 1.4.1). -->
          @if (bulkOutcome(); as outcome) {
            <span
              class="badge badge-xs badge-outline gap-0.5 shrink-0 text-base-content"
              [attr.data-testid]="'task-card-outcome-' + outcome"
              [title]="outcomeTitle()"
              [attr.aria-label]="outcomeTitle()"
            >
              <lucide-angular
                [img]="outcome === 'failed' ? CircleXIcon : CircleDashedIcon"
                class="w-2.5 h-2.5"
                aria-hidden="true"
              />
              @if (outcome === 'failed') {
                refused
              } @else {
                not attempted
              }
            </span>
          }
          <div class="flex items-center gap-1 flex-shrink-0">
            @if (!task().frontmatterValid) {
              <span
                class="text-warning"
                title="Frontmatter has validation warnings"
                [attr.aria-label]="
                  task().validationIssues.length + ' validation warning(s)'
                "
              >
                <lucide-angular [img]="AlertTriangleIcon" class="w-3 h-3" />
              </span>
            }
            <div class="dropdown dropdown-end">
              <button
                type="button"
                [attr.tabindex]="rovingTabIndex()"
                class="btn btn-ghost btn-xs btn-square min-h-0 h-5 w-5 p-0"
                aria-label="Change status"
                title="Change status"
                (click)="$event.stopPropagation()"
              >
                <lucide-angular [img]="MoreVerticalIcon" class="w-3 h-3" />
              </button>
              <ul
                [attr.tabindex]="rovingTabIndex()"
                class="dropdown-content menu menu-xs z-20 bg-base-200 rounded-box shadow border border-base-content/10 w-36 p-1"
              >
                @for (option of statusOptions(); track option) {
                  <li>
                    <button
                      type="button"
                      class="justify-between"
                      [attr.tabindex]="rovingTabIndex()"
                      [class.active]="option === task().status"
                      (click)="$event.stopPropagation(); onStatusPick(option)"
                    >
                      {{ statusLabel(option) }}
                    </button>
                  </li>
                }
              </ul>
            </div>
          </div>
        </div>

        <!-- Parent breadcrumb (FR-B3.4). Rendered from the DECLARED parent —
             that is the only evidence of what the author meant. Whether it is
             navigable comes from the derived graph: a claim the graph refused
             (dangling / cycle / two levels deep) is shown as a non-interactive
             value beside the reason it was refused, never as a link that goes
             nowhere. -->
        @if (parentCrumb(); as crumb) {
          <div
            class="flex items-center gap-1 min-w-0"
            data-testid="task-card-parent"
            [attr.role]="crumb.navigable ? null : 'note'"
            [attr.aria-label]="crumb.navigable ? null : crumb.ariaLabel"
          >
            <lucide-angular
              [img]="CornerLeftUpIcon"
              class="w-2.5 h-2.5 shrink-0 text-base-content/50"
            />
            @if (crumb.navigable) {
              <button
                type="button"
                class="text-[10px] font-mono text-base-content/60 hover:text-primary hover:underline truncate"
                [attr.tabindex]="rovingTabIndex()"
                [attr.aria-label]="'Open parent task ' + crumb.id"
                [title]="'Open parent task ' + crumb.id"
                (click)="$event.stopPropagation(); selectTask.emit(crumb.id)"
              >
                {{ crumb.id }}
              </button>
            } @else {
              <span
                class="text-[10px] font-mono text-base-content/40 truncate"
                [title]="crumb.reason"
              >
                {{ crumb.id }}
              </span>
              <span
                class="text-[10px] text-warning flex-shrink-0"
                [title]="crumb.reason"
                >not linked</span
              >
            }
          </div>
        }

        <!-- Title -->
        <p class="text-sm font-medium leading-snug line-clamp-2">
          {{ task().title }}
        </p>

        <!-- Meta row: type + estimate + executor + depends_on + rollup + dup -->
        <div class="flex items-center flex-wrap gap-1">
          <span class="badge badge-xs" [class]="typeBadgeClass()">
            {{ task().type ?? 'no type' }}
          </span>
          @if (task().estimate; as estimate) {
            <span
              class="badge badge-xs"
              [class]="estimateBadgeClass()"
              [title]="estimateTitle()"
              data-testid="task-card-estimate"
            >
              {{ estimate }}
            </span>
          }
          @if (task().executor) {
            <span
              class="badge badge-xs badge-ghost gap-0.5 max-w-[7rem]"
              [title]="'Executor: ' + task().executor"
            >
              <lucide-angular [img]="UserIcon" class="w-2.5 h-2.5 shrink-0" />
              <span class="truncate">{{ task().executor }}</span>
            </span>
          }
          @if (task().dependsOn.length > 0) {
            <span
              class="badge badge-xs badge-ghost gap-0.5"
              [title]="'Depends on: ' + task().dependsOn.join(', ')"
            >
              <lucide-angular [img]="GitBranchIcon" class="w-2.5 h-2.5" />
              {{ task().dependsOn.length }}
            </span>
          }
          <!-- Child rollup (FR-B3.3): completed over total, and a CONTROL —
               clicking it narrows the board to this task's sub-tasks. It was
               rendered as a plain value until the filter existed to drive;
               that filter is the shared childrenOf facet, so the click edits
               the one spec every surface filters by rather than doing anything
               to the board directly. -->
          <!-- It is a btn, not a badge, and that is the whole point. The
               three badges beside it (executor, depends-on, duplicate) are
               inert spans sharing one recipe; a fourth that looked identical
               announced itself only on hover, which is no announcement at all
               to touch or to anyone scanning. btn-outline gives it a border
               at rest, .btn gives it cursor: pointer (.badge sets none),
               and btn-xs is 24px — SC 2.5.8's floor, against badge-xs's
               12px. Its colours are the base-content/base-100 pair at full
               opacity in both states, so they are audited on every theme;
               hover:badge-primary was 4.14:1 on anubis, the app default. -->
          @if (childRollup(); as rollup) {
            <button
              type="button"
              class="btn btn-outline btn-xs gap-1 px-1.5 font-normal tabular-nums focus-visible:outline-offset-2"
              [attr.tabindex]="rovingTabIndex()"
              [title]="rollupActionTitle()"
              data-testid="task-card-rollup"
              (click)="$event.stopPropagation(); filterChildren.emit(task().id)"
            >
              <lucide-angular
                [img]="ListTreeIcon"
                class="w-2.5 h-2.5"
                aria-hidden="true"
              />
              <!-- "1 / 3" is not an accessible name. The visible glyph stays
                   compact; the full sentence is what assistive tech reads —
                   and it now has to state what activating it DOES. -->
              <span class="sr-only">{{ rollupActionTitle() }}</span>
              <span aria-hidden="true" data-testid="task-card-rollup-glyph">
                {{ rollup.done }} / {{ rollup.total }}
              </span>
            </button>
          }
          <!-- Duplicate marker (FR-B4.4) — deliberately de-emphasised. -->
          @if (task().duplicates.length > 0) {
            <span
              class="badge badge-xs badge-ghost gap-0.5 opacity-60"
              [title]="'Duplicates: ' + task().duplicates.join(', ')"
              data-testid="task-card-duplicate"
            >
              <lucide-angular [img]="CopyIcon" class="w-2.5 h-2.5" />
              duplicate
            </span>
          }
        </div>

        <!-- Label chips. Colour is hashed from the label text and is never the
             sole carrier of meaning — every chip renders the text the author
             typed, verbatim, as an interpolation (NFR-4 / NFR-13).

             Bounded on both axes, because the board has exactly ONE column
             width (16rem) and no wider layout to fall back on: each chip is
             capped and truncated so one long unbroken label cannot escape the
             card, and the count is capped so a heavily-labelled task cannot
             push the card to twice the height of its neighbours. -->
        @if (task().labels.length > 0) {
          <div
            class="flex items-center flex-wrap gap-1 min-w-0"
            data-testid="task-card-labels"
          >
            @for (label of visibleLabels(); track $index) {
              <span
                class="badge badge-xs border font-normal max-w-[6rem] truncate"
                [class]="chipClass(label)"
                [title]="'Label: ' + label"
              >
                {{ label }}
              </span>
            }
            @if (hiddenLabels().length > 0) {
              <span
                class="badge badge-xs badge-ghost font-normal tabular-nums"
                [title]="hiddenLabelsTitle()"
                [attr.aria-label]="hiddenLabelsTitle()"
                data-testid="task-card-labels-overflow"
              >
                +{{ hiddenLabels().length }}
              </span>
            }
          </div>
        }

        <!-- Actions: agent-managed worktree isolation toggle + Start.
             Terminal tasks (done / cancelled) are not startable — show a
             completed footer instead of the launch controls. -->
        @if (!isTerminal()) {
          <div
            class="flex items-center justify-between pt-1 mt-0.5 border-t border-base-content/10"
          >
            <label
              class="label cursor-pointer gap-1 p-0"
              [title]="'Run implementation in an isolated git worktree — the agent delegates file-editing work to worktree-isolated subagents, keeping changes off the main working tree until reviewed'"
            >
              <input
                type="checkbox"
                class="toggle toggle-xs"
                [attr.tabindex]="rovingTabIndex()"
                [checked]="isolate()"
                (click)="$event.stopPropagation()"
                (change)="onIsolateToggle($event)"
                aria-label="Run implementation in an isolated git worktree"
              />
              <span class="text-[10px] text-base-content/60">Isolate</span>
            </label>
            <button
              type="button"
              class="btn btn-primary btn-xs gap-1"
              [attr.tabindex]="rovingTabIndex()"
              (click)="$event.stopPropagation(); onStart()"
              [attr.aria-label]="'Start task ' + task().id"
            >
              <lucide-angular [img]="PlayIcon" class="w-3 h-3" />
              Start
            </button>
          </div>

          <!-- Isolation hint (F-D1): the agent isolates its own implementation
               work in a worktree inside the workspace — the host creates nothing. -->
          @if (isolate()) {
            <p class="text-[10px] leading-tight text-base-content/50 mt-0.5">
              The agent isolates implementation in a dedicated git worktree,
              keeping changes off the main working tree until reviewed.
            </p>
          }
        } @else {
          <div
            class="flex items-center gap-1 pt-1 mt-0.5 border-t border-base-content/10 text-[10px]"
            [class.text-success]="task().status === 'done'"
            [class.text-base-content]="task().status !== 'done'"
            [class.text-opacity-50]="task().status !== 'done'"
          >
            <lucide-angular [img]="terminalIcon()" class="w-3 h-3" />
            {{ statusLabel(task().status) }}
          </div>
        }
      </div>
    </div>
  `,
})
export class TaskCardComponent {
  public readonly task = input.required<TaskSpecSummary>();
  /**
   * This card is the one the DETAIL PANEL is open on.
   *
   * Not the same thing as {@link checked}, and the two are deliberately not
   * merged: `selected` means "you are reading this", `checked` means "a bulk
   * action would write this". A card can be either, both, or neither, and the
   * card renders them differently because confusing them is how a user comes to
   * believe that opening a task put it in the selection.
   */
  public readonly selected = input(false);
  /** This card is in the MULTI-SELECTION (FR-C4.1). See {@link selected}. */
  public readonly checked = input(false);
  /** A bulk write covering this card is in flight right now (FR-C4.11). */
  public readonly pending = input(false);
  /**
   * How the last bulk run left this task, or `null` if it was not in one (or
   * it succeeded, in which case the card is no longer selected and there is
   * nothing to explain). See {@link TaskBulkOutcome}.
   */
  public readonly bulkOutcome = input<TaskBulkOutcome | null>(null);
  /**
   * Whether this card is the board's ONE roving tab stop (FR-C7.1).
   *
   * Fed board → column → card. `TaskBoardComponent` guarantees exactly one
   * card carries `true` whenever the board holds any task, so a board rendered
   * with a filter that hides the previously-focused card still has a way in
   * from the keyboard.
   *
   * ## What the roving treatment actually covers
   *
   * Every focusable node in this template, not just the root. The card root is
   * a `role="button"` that CONTAINS the status-menu trigger, its menu, the
   * parent crumb, the child rollup, the isolate toggle and Start — six
   * focusable descendants. Roving the root alone would leave all six of them in
   * the tab order on all 181 cards, which is the defect this input exists to
   * close rather than a smaller version of the same problem.
   */
  public readonly focused = input(false);
  /**
   * The derived board graph, for the two facts a card cannot know about itself:
   * whether its declared `parent` claim was honoured, and how many children
   * claim IT.
   *
   * Optional and defaulted to `null` so the card stays usable standalone. With
   * no graph the card renders the declared parent as a non-navigable value with
   * a stated reason and renders no rollup — it never guesses, and it never
   * offers an affordance it cannot honour.
   */
  public readonly graph = input<TaskGraph | null>(null);

  public readonly selectTask = output<string>();
  /**
   * Space was pressed on the card itself — toggle its selection (FR-C7.2).
   *
   * Distinct from {@link selectTask}, which always opens. The host now maps it
   * onto the multi-selection: Space adds or removes this card from the set that
   * a bulk action would write, and opens nothing. FR-C4's model re-pointed the
   * reducer for this event; this component did not change to carry it, which is
   * what the event being "Space happened on this card" rather than "close the
   * panel" bought.
   */
  public readonly toggleTask = output<string>();
  /**
   * A multi-selection gesture: the checkbox, Ctrl-click, or Shift-click
   * (FR-C4.1–4.2).
   *
   * Separate from {@link toggleTask}, which is the keyboard's Space and carries
   * no modifier information, and from {@link selectTask}, which opens the
   * detail panel. Three events because there are three distinct intents.
   */
  public readonly selectionToggle = output<TaskSelectionToggle>();
  public readonly statusChange = output<TaskStatusChange>();
  public readonly startTask = output<TaskStartRequest>();
  /**
   * The child rollup was activated: narrow the board to THIS task's sub-tasks
   * (FR-B3.3). Carries this task's id — the PARENT — because that is what the
   * shared `childrenOf` facet is keyed by.
   */
  public readonly filterChildren = output<string>();

  /** Local UI state: whether the Start action should request isolation. */
  public readonly isolate = signal(false);

  /**
   * `0` on the focused card, `-1` on every other — bound to the root AND to
   * each focusable descendant. See {@link focused}.
   */
  protected readonly rovingTabIndex = computed(() => (this.focused() ? 0 : -1));

  protected readonly statusOptions = computed(() => TASK_STATUSES);
  protected readonly typeBadgeClass = computed(() =>
    taskTypeBadge(this.task().type),
  );

  /**
   * How many label chips a card shows before rolling the rest into `+N`.
   *
   * Three, because the column is a fixed 16rem and a chip caps at 6rem: three
   * chips wrap to at most two lines, which is the most the card can spend on
   * labels without dominating the title. This is a presentation cap only —
   * nothing is hidden from the data, and the overflow chip names every label it
   * stands for.
   */
  private static readonly MAX_VISIBLE_LABELS = 3;

  protected readonly visibleLabels = computed(() =>
    this.task().labels.slice(0, TaskCardComponent.MAX_VISIBLE_LABELS),
  );

  protected readonly hiddenLabels = computed(() =>
    this.task().labels.slice(TaskCardComponent.MAX_VISIBLE_LABELS),
  );

  protected readonly hiddenLabelsTitle = computed(() => {
    const hidden = this.hiddenLabels();
    return hidden.length === 0
      ? ''
      : `${hidden.length} more label(s): ${hidden.join(', ')}`;
  });

  protected readonly estimateBadgeClass = computed(() => {
    const estimate = this.task().estimate;
    return estimate ? taskEstimateBadge(estimate) : '';
  });

  protected readonly estimateTitle = computed(() => {
    const estimate = this.task().estimate;
    return estimate ? `Estimate: ${TASK_ESTIMATE_LABELS[estimate]}` : '';
  });

  /**
   * Child counts for this task, or `null` when it has none.
   *
   * Read out of the graph's rollup, which is itself read out of every CHILD's
   * frontmatter — so a parent card gaining a rollup involves no write to the
   * parent's carrier (FR-B3.2). Only parents that HAVE children appear in the
   * map, so `null` is the exact "render nothing" case (plan §6.7).
   */
  protected readonly childRollup = computed<TaskChildRollup | null>(
    () => this.graph()?.rollup.get(this.task().id) ?? null,
  );

  protected readonly rollupTitle = computed(() => {
    const rollup = this.childRollup();
    if (rollup === null) return '';
    return `Sub-tasks: ${rollup.done} done · ${rollup.open} open · ${rollup.cancelled} cancelled (${rollup.total} total)`;
  });

  /**
   * The rollup's accessible name and tooltip.
   *
   * It states the counts AND what activating it does. A control named only by
   * its value tells a screen-reader user what it says and nothing about what
   * pressing it will do to the board.
   */
  protected readonly rollupActionTitle = computed(() => {
    const rollup = this.childRollup();
    if (rollup === null) return '';
    return `${this.rollupTitle()} — show only these sub-tasks`;
  });

  /**
   * The declared parent, plus whether the graph honoured the claim.
   *
   * `null` when no `parent` key was declared — absent renders nothing, with no
   * "no parent" placeholder (plan §6.7). When the claim was refused the reason
   * comes from the task's OWN parent validation issue, so the card repeats the
   * backend's sentence rather than inventing a second, drift-prone one.
   *
   * `ariaLabel` carries the id AND the reason on the refused branch. A `title`
   * alone does not discharge "disabled with a stated reason": it needs a mouse
   * and a hover, so keyboard and screen-reader users get the bare id with no
   * explanation at all. Naming the wrapper instead of adding `tabindex` keeps
   * the reason reachable without spending a tab stop per card — the board is
   * meant to become ONE tab stop under FR-C7, and 181 new ones would be a
   * regression that batch then has to undo.
   */
  protected readonly parentCrumb = computed<{
    readonly id: string;
    readonly navigable: boolean;
    readonly reason: string;
    readonly ariaLabel: string;
  } | null>(() => {
    const task = this.task();
    const parent = task.parent;
    if (parent === undefined || parent.length === 0) return null;

    const refused = (reason: string) => ({
      id: parent,
      navigable: false,
      reason,
      ariaLabel: `Parent ${parent}, not linked. ${reason}`,
    });

    const graph = this.graph();
    if (graph === null) {
      return refused(
        'The board index is not available here, so the parent cannot be opened from this card.',
      );
    }
    if (graph.effectiveParent.get(task.id) === parent) {
      return { id: parent, navigable: true, reason: '', ariaLabel: '' };
    }
    const issue = task.validationIssues.find(
      (candidate) => candidate.field === 'parent',
    );
    return refused(
      issue?.message ??
        `The parent claim '${parent}' was not honoured, so there is nothing to open.`,
    );
  });

  /** Terminal tasks (done / cancelled) cannot be started. */
  protected readonly isTerminal = computed(() => {
    const status = this.task().status;
    return status === 'done' || status === 'cancelled';
  });
  protected readonly terminalIcon = computed(() =>
    this.task().status === 'done' ? CheckCircle2 : Ban,
  );

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly MoreVerticalIcon = MoreVertical;
  protected readonly UserIcon = User;
  protected readonly GitBranchIcon = GitBranch;
  protected readonly PlayIcon = Play;
  protected readonly CopyIcon = Copy;
  protected readonly CornerLeftUpIcon = CornerLeftUp;
  protected readonly ListTreeIcon = ListTree;
  protected readonly CircleXIcon = CircleX;
  protected readonly CircleDashedIcon = CircleDashed;

  protected statusLabel(status: TaskStatus): string {
    return TASK_STATUS_LABELS[status];
  }

  /** Hashed chip classes for one label — see `labelChipClass`. */
  protected chipClass(label: string): string {
    return labelChipClass(label);
  }

  protected onIsolateToggle(event: Event): void {
    this.isolate.set((event.target as HTMLInputElement).checked);
  }

  /**
   * The checkbox's accessible name — and it names the ACTION, not the state.
   *
   * "Select TASK_2026_181" on a checked box would be wrong, and a bare
   * "Select" would be one of 181 identical controls to anyone navigating by
   * name. The checked state is already announced by the control's role, so the
   * name only has to say which task and which direction.
   */
  /**
   * The outcome badge's full sentence. It states what happened AND what is
   * true now, because the badge text alone ("not attempted") does not say that
   * the task is still selected and still waiting.
   */
  protected readonly outcomeTitle = computed(() => {
    const outcome = this.bulkOutcome();
    if (outcome === null) return '';
    return outcome === 'failed'
      ? `The last bulk change was refused for ${this.task().id}. It is still selected — see the summary above for the reason.`
      : `The last bulk change never reached ${this.task().id} — it was cancelled first, so nothing was written. It is still selected.`;
  });

  protected readonly selectAriaLabel = computed(() =>
    this.checked()
      ? `Deselect task ${this.task().id}`
      : `Select task ${this.task().id}`,
  );

  /**
   * A click on the checkbox is always a selection gesture, never an open.
   *
   * `stopPropagation` keeps it off the card root's handler — without it the
   * detail panel would open every time somebody ticked a box, which is the
   * precise conflation `checked` and `selected` exist to keep apart.
   */
  protected onCheckboxClick(event: MouseEvent): void {
    event.stopPropagation();
    this.selectionToggle.emit({
      taskId: this.task().id,
      range: event.shiftKey,
    });
  }

  /**
   * A click on the card body: open it, unless a modifier says otherwise.
   *
   * Ctrl/Cmd-click toggles the selection and Shift-click extends it — the two
   * gestures every list in every desktop application has used for thirty years.
   * A plain click still opens the detail panel, so nothing a user already knew
   * about this board has changed.
   *
   * The modifier branch does NOT open the panel as well. Doing both would mean
   * a Ctrl-click that adds a card to a twelve-task selection also throws the
   * detail panel open over it, which is neither of the two things the user
   * asked for.
   */
  protected onCardClick(event: MouseEvent): void {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      this.selectionToggle.emit({
        taskId: this.task().id,
        range: event.shiftKey,
      });
      return;
    }
    this.selectTask.emit(this.task().id);
  }

  /**
   * Enter on the CARD opens it (FR-C7.2).
   *
   * ## The guard is the whole point of this method
   *
   * The card root is a `role="button"` wrapping four-to-six real `<button>`
   * descendants. Each of those stops the `click` it produces — but a keyboard
   * activation is a `keydown` that bubbles to this handler FIRST and then, in a
   * real browser, a synthesised `click` that the descendant stops. So before
   * this guard existed, pressing Enter on the child rollup narrowed the board
   * to that parent's sub-tasks (which excludes the parent) AND opened the
   * detail panel for the now-invisible parent, from one keypress.
   *
   * `event.target !== event.currentTarget` is the exact test: `currentTarget`
   * is this root div for the duration of the dispatch, and `target` is whatever
   * the user was actually on. A descendant's activation therefore leaves this
   * handler without doing anything, and the descendant's own handler is left to
   * do its one job.
   *
   * This defect predates the child rollup — Batch 3 established the pattern and
   * every button added since inherited it. The `.click()`-driven assertion that
   * covered the rollup proved only the MOUSE path; the keyboard path is
   * asserted in `task-card.component.spec.ts` alongside this.
   */
  protected onCardEnter(event: Event): void {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this.selectTask.emit(this.task().id);
  }

  /** Space on the CARD toggles its selection (FR-C7.2). Same guard, same why. */
  protected onCardSpace(event: Event): void {
    if (event.target !== event.currentTarget) return;
    // Unconditional: a Space that reaches a card must never also scroll the
    // column, whether or not it ends up toggling anything.
    event.preventDefault();
    this.toggleTask.emit(this.task().id);
  }

  protected onStatusPick(status: TaskStatus): void {
    if (status === this.task().status) return;
    this.statusChange.emit({ taskId: this.task().id, status });
  }

  protected onStart(): void {
    this.startTask.emit({
      taskId: this.task().id,
      isolate: this.isolate(),
    });
  }
}
