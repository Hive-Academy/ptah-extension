import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { Filter, LucideAngularModule, X } from 'lucide-angular';
import {
  EMPTY_TASK_FILTER,
  TASK_ESTIMATES,
  TASK_PARENTAGE_FACETS,
  TASK_RELATION_FACETS,
  TASK_SORT_FIELDS,
  TASK_STATUSES,
  TASK_TYPES,
  isTaskFilterActive,
  labelKey,
  type TaskEstimate,
  type TaskFilterSpec,
  type TaskLabelMatchMode,
  type TaskParentageFacet,
  type TaskRelationFacet,
  type TaskSortField,
  type TaskSortSpec,
} from '@ptah-extension/shared';
import type { TaskEstimateBuckets } from '../../services/tasks-store.service';
import {
  TASK_ESTIMATE_LABELS,
  TASK_STATUS_LABELS,
  labelChipClass,
} from '../../task-presentation';

/**
 * One entry in a facet menu.
 *
 * `next` is the WHOLE spec that results from toggling this entry, computed
 * ahead of the click. The menu therefore needs to know nothing about facets:
 * it renders a list and emits the spec the user asked for. That is what keeps
 * the toggle arithmetic in one place per facet instead of a switch that grows a
 * silently-missing arm every time a facet is added.
 */
export interface TaskFacetOption {
  /** Track key. Index-qualified — see the note on {@link TaskFilterChip.key}. */
  readonly key: string;
  readonly label: string;
  readonly checked: boolean;
  /** How many indexed tasks carry this value; `null` when it is not counted. */
  readonly count: number | null;
  readonly next: TaskFilterSpec;
}

/**
 * One removable chip standing for one active facet value (FR-C1.6).
 *
 * `next` is the spec with this value removed, for the same reason
 * {@link TaskFacetOption} carries one.
 */
export interface TaskFilterChip {
  /**
   * Track key.
   *
   * Qualified by the facet AND the position, never by the value alone. Chips
   * are derived from user-authored text — a label is whatever somebody typed
   * into a carrier — so two chips CAN carry the same rendered string, and a
   * `track` on the value alone throws on the duplicate.
   */
  readonly key: string;
  /** Which facet this value belongs to, rendered as the chip's prefix. */
  readonly facet: string;
  readonly value: string;
  /** Extra classes for the chip; label chips carry their hashed palette slot. */
  readonly classes: string;
  readonly removeLabel: string;
  readonly next: TaskFilterSpec;
  /**
   * Why this value currently selects nothing — `undefined` when it is fine.
   *
   * Set for a label or executor the workspace no longer carries, which is what
   * a saved view looks like after the last task using that label was retired
   * (FR-C2.4). It is an ANNOTATION and never an edit: the facet still applies,
   * still matches nothing, and stays in the spec until the user removes it.
   * Auto-pruning it would silently rewrite a lens somebody saved.
   */
  readonly note?: string;
}

/**
 * A single facet menu: a labelled disclosure holding a checkbox per value.
 *
 * Built on `<details>`/`<summary>` rather than a `tabindex` dropdown so the
 * open/close state and the expanded state exposed to assistive technology are
 * the browser's, not ours. Checking a box does not close the menu, which is
 * what makes a multi-value facet selectable in one visit.
 *
 * **`<details>` has no Escape-to-close behaviour** — that belongs to
 * `<dialog>`, not to this element, and an earlier revision of this comment
 * claimed otherwise. Escape does nothing here; the menu closes by activating
 * the summary again or by clicking away. If Escape-to-close is wanted it has
 * to be written, and it would need a focus-return path with it.
 *
 * ## Colour
 *
 * Every colour in here is either full-opacity `base-content` or a daisyUI
 * `-content` pair. No text carries an opacity modifier — see the audit table
 * on {@link TaskFilterBarComponent}.
 *
 * Presentational and facet-agnostic: it renders {@link TaskFacetOption}s and
 * emits the one that was clicked.
 */
@Component({
  selector: 'ptah-task-facet-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="dropdown" [attr.data-testid]="'facet-menu-' + testId()">
      <!-- summary is not in the app's global focus-visible rule (which lists
           button/input/select/textarea/a), so the ring is declared here rather
           than left to the browser's own — otherwise tabbing along this bar
           flips between two different focus styles. Same colour source as the
           global rule: the theme's secondary. -->
      <summary
        class="btn btn-ghost btn-xs gap-1 text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]"
        [class.btn-active]="selectedCount() > 0"
        [class.font-normal]="selectedCount() === 0"
        [class.font-semibold]="selectedCount() > 0"
        [attr.aria-label]="summaryAriaLabel()"
      >
        {{ label() }}
        @if (selectedCount() > 0) {
          <!-- The count is TEXT in the inherited colour, not a filled badge.
               A badge-primary here painted primary-content on primary, which
               is 4.14:1 on anubis — the app's own default theme. -->
          <span class="tabular-nums" data-testid="facet-selected-count">
            {{ selectedCount() }}
          </span>
        }
      </summary>
      <!-- Width is clamped to the viewport, not fixed: the bar wraps, so which
           row a trigger lands on (and therefore how much room is to its right)
           is not knowable here. dropdown-end would be a fixed guess that is
           wrong roughly half the time; a clamp is right at every width. -->
      <ul
        class="dropdown-content menu menu-xs z-30 mt-1 w-[min(14rem,calc(100vw-1rem))] flex-nowrap overflow-y-auto max-h-72 rounded-box border border-base-300 bg-base-200 p-1 text-base-content shadow"
      >
        @for (option of options(); track option.key) {
          <li>
            <label class="flex cursor-pointer items-center gap-2 py-1">
              <input
                type="checkbox"
                class="checkbox checkbox-xs"
                [checked]="option.checked"
                (change)="picked.emit(option)"
              />
              <span class="truncate">{{ option.label }}</span>
              @if (option.count !== null) {
                <span
                  class="ml-auto shrink-0 font-mono text-[11px] tabular-nums"
                >
                  {{ option.count }}
                </span>
              }
            </label>
          </li>
        } @empty {
          <li class="px-2 py-1.5 text-[11px]">
            {{ emptyText() }}
          </li>
        }
      </ul>
    </details>
  `,
})
export class TaskFacetMenuComponent {
  public readonly label = input.required<string>();
  public readonly testId = input.required<string>();
  public readonly options = input.required<readonly TaskFacetOption[]>();
  public readonly selectedCount = input(0);
  /**
   * What the menu says when it has no values to offer. Always a sentence about
   * the workspace, never an empty popover: a menu that opens onto nothing is
   * indistinguishable from one that failed to load.
   */
  public readonly emptyText = input('Nothing on the board carries one yet.');

  public readonly picked = output<TaskFacetOption>();

  protected readonly summaryAriaLabel = computed(() => {
    const selected = this.selectedCount();
    return selected === 0
      ? `Filter by ${this.label().toLowerCase()}`
      : `Filter by ${this.label().toLowerCase()}, ${selected} selected`;
  });
}

/**
 * TaskFilterBarComponent
 *
 * The multi-axis filter surface (FR-C1): a free-text box, one menu per facet,
 * the ANY/ALL label mode, removable chips for everything active, the
 * `23 of 181` counter, clear-all, and the sort control (FR-C3).
 *
 * ## It filters nothing
 *
 * This component never inspects a task. It edits a {@link TaskFilterSpec} and
 * emits it; the shared `filterTasks` — the one predicate the `tasks:list`
 * handler and the CLI also run — decides what matches. There is no `.filter()`
 * over tasks anywhere in this file, and adding one would be the second
 * implementation FR-C1.5 exists to prevent.
 *
 * ## Untrusted text (BR-10, NFR-4/NFR-13)
 *
 * Label and executor values are authored by hand in carriers on disk. Every one
 * of them renders as `{{ interpolation }}` and nothing else: no `[innerHTML]`,
 * no markdown, and nothing here compiles the free-text needle into a `RegExp` —
 * the shared predicate matches it with a case-insensitive `String.includes`.
 *
 * ## Colour: no opacity modifier on any text (NFR-12, R15)
 *
 * An earlier revision de-emphasised meta text with `text-base-content/40`,
 * `/50` and `/60`. That is the same trap `LABEL_CHIP_CLASSES` was moved off:
 * the ratio depends on whatever the theme's base happens to be, so one audit
 * cannot cover 30-plus themes. Recomputed over the four mandated bases
 * (`base-content` over `base-100`), NO partial opacity is safe:
 *
 * | opacity | anubis | anubis-light | daisyUI dark | daisyUI light |
 * |---|---|---|---|---|
 * | `/30` | 2.39 | 1.92 | 1.84 | 1.85 |
 * | `/40` | 3.31 | 2.48 | 2.28 | 2.35 |
 * | `/50` | 4.48 | 3.28 | 2.82 | 3.05 |
 * | `/60` | 5.94 | 4.45 | 3.45 | 4.06 |
 * | `/70` | 7.69 | 6.18 | **4.18** | 5.53 |
 *
 * Even `/70` misses on daisyUI `dark`. So every text colour here is FULL
 * `base-content`, which daisyUI guarantees against its own base by
 * construction — 14.86 / 15.91 / 7.03 / 14.68 over `base-100`, and
 * 13.89 / 14.21 / 7.44 / 13.11 over `base-200`. Hierarchy comes from size and
 * weight, which are theme-invariant by definition. The only surviving opacity
 * is on `aria-hidden` glyphs, which carry no information.
 */
@Component({
  selector: 'ptah-task-filter-bar',
  standalone: true,
  imports: [LucideAngularModule, TaskFacetMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      class="flex flex-col gap-1 border-b border-base-300 px-3 py-1.5 text-base-content"
      role="search"
      aria-label="Filter and sort tasks"
    >
      <!-- Controls -->
      <div class="flex flex-wrap items-center gap-1">
        <!-- Decorative only, and aria-hidden — the one place an opacity
             modifier is still allowed, because it carries no information. -->
        <lucide-angular
          [img]="FilterIcon"
          class="h-3.5 w-3.5 shrink-0 opacity-60"
          aria-hidden="true"
        />

        <input
          type="search"
          class="input input-xs input-bordered w-44"
          placeholder="Find by id, title, text"
          aria-label="Filter tasks by text"
          data-testid="task-filter-text"
          [value]="filter().text"
          (input)="onText($event)"
        />

        <ptah-task-facet-menu
          label="Status"
          testId="status"
          [options]="statusOptions()"
          [selectedCount]="filter().statuses.length"
          (picked)="filterChange.emit($event.next)"
        />
        <ptah-task-facet-menu
          label="Type"
          testId="type"
          [options]="typeOptions()"
          [selectedCount]="filter().types.length"
          (picked)="filterChange.emit($event.next)"
        />
        <ptah-task-facet-menu
          label="Estimate"
          testId="estimate"
          [options]="estimateOptions()"
          [selectedCount]="estimateSelectedCount()"
          (picked)="filterChange.emit($event.next)"
        />
        <ptah-task-facet-menu
          label="Label"
          testId="label"
          [options]="labelOptions()"
          [selectedCount]="filter().labels.length"
          emptyText="No task on the board carries a label yet."
          (picked)="filterChange.emit($event.next)"
        />
        <ptah-task-facet-menu
          label="Executor"
          testId="executor"
          [options]="executorOptions()"
          [selectedCount]="filter().executors.length"
          emptyText="No task on the board names an executor yet."
          (picked)="filterChange.emit($event.next)"
        />
        <ptah-task-facet-menu
          label="Structure"
          testId="parentage"
          [options]="parentageOptions()"
          [selectedCount]="filter().parentage.length"
          (picked)="filterChange.emit($event.next)"
        />
        <ptah-task-facet-menu
          label="Relations"
          testId="relations"
          [options]="relationOptions()"
          [selectedCount]="relationSelectedCount()"
          (picked)="filterChange.emit($event.next)"
        />

        <!-- ANY/ALL. Only rendered once a second label is selected: with one
             label the two modes are identical, and a control whose two states
             do the same thing teaches the user the wrong thing about it. -->
        @if (filter().labels.length > 1) {
          <div
            class="join"
            role="group"
            aria-label="How multiple labels are combined"
            data-testid="task-filter-labels-mode"
          >
            @for (mode of labelModes; track mode.value) {
              <button
                type="button"
                class="btn join-item btn-xs font-normal"
                [class.btn-active]="filter().labelsMode === mode.value"
                [attr.aria-pressed]="filter().labelsMode === mode.value"
                [title]="mode.title"
                (click)="onLabelsMode(mode.value)"
              >
                {{ mode.label }}
              </button>
            }
          </div>
        }

        <div class="flex-1"></div>

        <label class="flex cursor-pointer items-center gap-1">
          <input
            type="checkbox"
            class="checkbox checkbox-xs"
            data-testid="task-filter-issues"
            [checked]="filter().hasValidationIssues"
            (change)="onIssuesToggle($event)"
          />
          <span class="text-xs">Warnings only</span>
        </label>

        <label class="flex items-center gap-1">
          <span class="text-xs">Sort</span>
          <select
            class="select select-xs select-bordered"
            aria-label="Sort tasks by"
            data-testid="task-sort-field"
            [value]="sort().field"
            (change)="onSortField($event)"
          >
            @for (field of sortFields; track field.value) {
              <option
                [value]="field.value"
                [selected]="field.value === sort().field"
              >
                {{ field.label }}
              </option>
            }
          </select>
        </label>
        <button
          type="button"
          class="btn btn-ghost btn-xs font-mono"
          data-testid="task-sort-direction"
          [attr.aria-label]="sortDirectionLabel()"
          [title]="sortDirectionLabel()"
          (click)="onSortDirection()"
        >
          {{ sort().direction === 'asc' ? '↑' : '↓' }}
        </button>

        <!-- The second number appears only while a filter is hiding something,
             the same rule the column counter states and follows one row below.
             At rest "181 of 181" is noise; the board size is the useful fact. -->
        <span
          class="text-xs tabular-nums"
          data-testid="task-filter-count"
          [title]="countTitle()"
        >
          @if (active()) {
            {{ matchedCount() }} of {{ totalIndexed() }}
          } @else {
            {{ totalIndexed() }}
          }
        </span>

        <button
          type="button"
          class="btn btn-ghost btn-xs"
          data-testid="task-filter-clear"
          [disabled]="!active()"
          [title]="
            active()
              ? 'Remove every filter'
              : 'No filter is active, so there is nothing to clear'
          "
          (click)="filterChange.emit(EMPTY_FILTER)"
        >
          Clear
        </button>
      </div>

      <!-- Active facet values, each removable on its own (FR-C1.6) -->
      @if (chips().length > 0) {
        <ul
          class="flex flex-wrap items-center gap-1"
          data-testid="task-filter-chips"
        >
          <!-- Hand-rolled rather than badge badge-xs, for one reason: the
               remove control. badge-xs is 12px tall, so its button was a
               12px target — under WCAG 2.2 SC 2.5.8's 24px floor. The pill is
               24px and the button is a 24x24 square inside it. -->
          @for (chip of chips(); track chip.key) {
            <li>
              <!-- max-w-full is what keeps a chip inside the bar. The board
                   column is 256px and the bar is the same width; without it a
                   chip is as wide as its content and pushes the whole bar into
                   a horizontal scroll. -->
              <span
                class="inline-flex h-6 max-w-full items-center gap-1 rounded-full border pl-2 text-xs"
                [class]="chip.classes"
              >
                <span class="shrink-0 font-normal">{{ chip.facet }}</span>
                <!-- shrink-0, not min-w-0: the value and the note are both in
                     this flex row, and if both can shrink then a short stale
                     value competes with a long annotation for the same space.
                     Losing that race leaves the note about the fact more
                     legible than the fact. The value is capped at 10rem and
                     truncates within that; the note absorbs the pressure. -->
                <span class="max-w-[10rem] shrink-0 truncate font-medium">
                  {{ chip.value }}
                </span>
                @if (chip.note) {
                  <!-- Said in words, not by colour or a tooltip alone: a chip
                       that quietly matches nothing is indistinguishable from a
                       board that lost its tasks.

                       Bounded exactly like the value beside it, and for the
                       same reason. Truncation hides the overflow visually while
                       leaving the whole sentence in the text node, so assistive
                       technology still reads it in full and the title gives a
                       pointer user the same. Unbounded nowrap here overflowed
                       the bar every time it rendered — which is the only time
                       it renders at all. -->
                  <span
                    class="min-w-0 truncate font-normal"
                    [title]="chip.note"
                    data-testid="task-filter-chip-note"
                  >
                    — {{ chip.note }}
                  </span>
                }
                <button
                  type="button"
                  class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[oklch(var(--s))]"
                  [attr.aria-label]="chip.removeLabel"
                  [title]="chip.removeLabel"
                  (click)="filterChange.emit(chip.next)"
                >
                  <lucide-angular [img]="XIcon" class="h-3 w-3" />
                </button>
              </span>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class TaskFilterBarComponent {
  public readonly filter = input.required<TaskFilterSpec>();
  public readonly sort = input.required<TaskSortSpec>();
  /** Canonical display texts, first-seen order — the graph's label union. */
  public readonly knownLabels = input<readonly string[]>([]);
  public readonly knownExecutors = input<readonly string[]>([]);
  public readonly estimateBuckets = input<TaskEstimateBuckets>({
    sized: { XS: 0, S: 0, M: 0, L: 0, XL: 0 },
    unestimated: 0,
  });
  public readonly matchedCount = input(0);
  public readonly totalIndexed = input(0);

  public readonly filterChange = output<TaskFilterSpec>();
  public readonly sortChange = output<TaskSortSpec>();

  protected readonly EMPTY_FILTER = EMPTY_TASK_FILTER;
  protected readonly FilterIcon = Filter;
  protected readonly XIcon = X;

  protected readonly labelModes: ReadonlyArray<{
    readonly value: TaskLabelMatchMode;
    readonly label: string;
    readonly title: string;
  }> = [
    {
      value: 'any',
      label: 'Any',
      title: 'Show tasks carrying at least one of the selected labels',
    },
    {
      value: 'all',
      label: 'All',
      title: 'Show only tasks carrying every selected label',
    },
  ];

  protected readonly sortFields: ReadonlyArray<{
    readonly value: TaskSortField;
    readonly label: string;
  }> = TASK_SORT_FIELDS.map((field) => ({
    value: field,
    label: TaskFilterBarComponent.SORT_FIELD_LABELS[field],
  }));

  protected readonly active = computed(() => isTaskFilterActive(this.filter()));

  protected readonly countTitle = computed(() =>
    this.active()
      ? `${this.matchedCount()} of ${this.totalIndexed()} indexed tasks match the active filter`
      : `${this.totalIndexed()} indexed tasks, no filter active`,
  );

  protected readonly sortDirectionLabel = computed(() =>
    this.sort().direction === 'asc'
      ? 'Sorted ascending — switch to descending'
      : 'Sorted descending — switch to ascending',
  );

  protected readonly statusOptions = computed<readonly TaskFacetOption[]>(
    () => {
      const filter = this.filter();
      return TASK_STATUSES.map((status, index) => ({
        key: `status#${index}#${status}`,
        label: TASK_STATUS_LABELS[status],
        checked: filter.statuses.includes(status),
        count: null,
        next: {
          ...filter,
          statuses: toggle(filter.statuses, status),
        },
      }));
    },
  );

  protected readonly typeOptions = computed<readonly TaskFacetOption[]>(() => {
    const filter = this.filter();
    return TASK_TYPES.map((type, index) => ({
      key: `type#${index}#${type}`,
      label: type,
      checked: filter.types.includes(type),
      count: null,
      next: { ...filter, types: toggle(filter.types, type) },
    }));
  });

  /**
   * The five sizes plus "No estimate".
   *
   * They share one facet — `estimates` and `unestimated` are OR-ed inside the
   * predicate — so they belong in one menu. Splitting them would present an
   * AND-shaped choice for something that is not one.
   */
  protected readonly estimateOptions = computed<readonly TaskFacetOption[]>(
    () => {
      const filter = this.filter();
      const buckets = this.estimateBuckets();
      const sized: TaskFacetOption[] = TASK_ESTIMATES.map(
        (estimate: TaskEstimate, index) => ({
          key: `estimate#${index}#${estimate}`,
          label: `${estimate} — ${TASK_ESTIMATE_LABELS[estimate]}`,
          checked: filter.estimates.includes(estimate),
          count: buckets.sized[estimate],
          next: { ...filter, estimates: toggle(filter.estimates, estimate) },
        }),
      );
      return [
        ...sized,
        {
          key: `estimate#${TASK_ESTIMATES.length}#unestimated`,
          label: 'No estimate',
          checked: filter.unestimated,
          count: buckets.unestimated,
          next: { ...filter, unestimated: !filter.unestimated },
        },
      ];
    },
  );

  /**
   * One entry per distinct label on the board.
   *
   * ## Matched on the SHARED `labelKey`, not on raw equality
   *
   * `Licensing`, `licensing` and `licensing ` are one label (R9), and the
   * function that decides that is imported from the same module the predicate
   * calls — a second fold written here is exactly how a chip stops agreeing
   * with the tasks it selected. Toggling therefore drops every entry with the
   * same key rather than the one that happens to match character for
   * character, so the spec can never carry two spellings of one label.
   */
  protected readonly labelOptions = computed<readonly TaskFacetOption[]>(() => {
    const filter = this.filter();
    return this.knownLabels().map((label, index) => {
      const key = labelKey(label);
      const checked = filter.labels.some(
        (selected) => labelKey(selected) === key,
      );
      return {
        key: `label#${index}#${label}`,
        label,
        checked,
        count: null,
        next: {
          ...filter,
          labels: checked
            ? filter.labels.filter((selected) => labelKey(selected) !== key)
            : [...filter.labels, label],
        },
      };
    });
  });

  /** Executors are matched on the trimmed value, case-SENSITIVELY (FR-C1.1). */
  protected readonly executorOptions = computed<readonly TaskFacetOption[]>(
    () => {
      const filter = this.filter();
      return this.knownExecutors().map((executor, index) => ({
        key: `executor#${index}#${executor}`,
        label: executor,
        checked: filter.executors.includes(executor),
        count: null,
        next: { ...filter, executors: toggle(filter.executors, executor) },
      }));
    },
  );

  protected readonly parentageOptions = computed<readonly TaskFacetOption[]>(
    () => {
      const filter = this.filter();
      return TASK_PARENTAGE_FACETS.map((facet: TaskParentageFacet, index) => ({
        key: `parentage#${index}#${facet}`,
        label: TaskFilterBarComponent.PARENTAGE_LABELS[facet],
        checked: filter.parentage.includes(facet),
        count: null,
        next: { ...filter, parentage: toggle(filter.parentage, facet) },
      }));
    },
  );

  protected readonly relationOptions = computed<readonly TaskFacetOption[]>(
    () => {
      const filter = this.filter();
      return TASK_RELATION_FACETS.map((facet: TaskRelationFacet, index) => ({
        key: `relations#${index}#${facet}`,
        label: TaskFilterBarComponent.RELATION_LABELS[facet],
        checked: filter.relations.includes(facet),
        count: null,
        next: { ...filter, relations: toggle(filter.relations, facet) },
      }));
    },
  );

  /** `unestimated` shares the estimate facet, so it shares its badge count. */
  protected readonly estimateSelectedCount = computed(() => {
    const filter = this.filter();
    return filter.estimates.length + (filter.unestimated ? 1 : 0);
  });

  protected readonly relationSelectedCount = computed(
    () => this.filter().relations.length,
  );

  /**
   * Every active facet value as its own removable chip.
   *
   * One chip per VALUE rather than one per facet: "remove `licensing`" is the
   * edit a user wants to make, and a chip that drops a whole facet makes them
   * rebuild the rest of it by hand.
   */
  protected readonly chips = computed<readonly TaskFilterChip[]>(() => {
    const filter = this.filter();
    // Folded exactly as the predicate folds them, because a chip that decided
    // "vanished" on a different comparison than the one that decides "matches"
    // annotates the wrong chips:
    //
    //  - labels through the shared `labelKey` (trim + case-fold), and
    //  - executors TRIMMED but case-SENSITIVE (FR-C1.1).
    //
    // The trim is not cosmetic. `matchesExecutors` (`task-filter.ts`) trims
    // BOTH sides, and `buildTaskGraph` stores `knownExecutors` already trimmed
    // — so a spec carrying `' gemini '` matches a task whose executor is
    // `gemini`. Comparing the raw value here labelled that chip "no longer
    // present in this workspace" while it was busy matching tasks, which is the
    // precise contradiction this annotation exists to avoid.
    const knownLabelKeys = new Set(this.knownLabels().map(labelKey));
    const knownExecutors = new Set(
      this.knownExecutors().map((executor) => executor.trim()),
    );
    const chips: TaskFilterChip[] = [];
    const add = (
      facetKey: string,
      facet: string,
      value: string,
      next: TaskFilterSpec,
      classes = TaskFilterBarComponent.NEUTRAL_CHIP_CLASSES,
      note?: string,
    ): void => {
      chips.push({
        key: `${facetKey}#${chips.length}#${value}`,
        facet,
        value,
        classes,
        removeLabel: `Remove the ${facet.toLowerCase()} filter ${value}`,
        next,
        ...(note === undefined ? {} : { note }),
      });
    };

    const text = filter.text.trim();
    if (text.length > 0) {
      add('text', 'Text', text, { ...filter, text: '' });
    }
    for (const status of filter.statuses) {
      add('status', 'Status', TASK_STATUS_LABELS[status], {
        ...filter,
        statuses: toggle(filter.statuses, status),
      });
    }
    for (const type of filter.types) {
      add('type', 'Type', type, {
        ...filter,
        types: toggle(filter.types, type),
      });
    }
    for (const label of filter.labels) {
      add(
        'label',
        'Label',
        label,
        { ...filter, labels: toggle(filter.labels, label) },
        labelChipClass(label),
        knownLabelKeys.has(labelKey(label))
          ? undefined
          : TaskFilterBarComponent.STALE_FACET_NOTE,
      );
    }
    for (const estimate of filter.estimates) {
      add('estimate', 'Estimate', estimate, {
        ...filter,
        estimates: toggle(filter.estimates, estimate),
      });
    }
    if (filter.unestimated) {
      add('estimate', 'Estimate', 'No estimate', {
        ...filter,
        unestimated: false,
      });
    }
    for (const executor of filter.executors) {
      add(
        'executor',
        'Executor',
        executor,
        { ...filter, executors: toggle(filter.executors, executor) },
        TaskFilterBarComponent.NEUTRAL_CHIP_CLASSES,
        knownExecutors.has(executor.trim())
          ? undefined
          : TaskFilterBarComponent.STALE_FACET_NOTE,
      );
    }
    for (const facet of filter.parentage) {
      add(
        'parentage',
        'Structure',
        TaskFilterBarComponent.PARENTAGE_LABELS[facet],
        {
          ...filter,
          parentage: toggle(filter.parentage, facet),
        },
      );
    }
    for (const parent of filter.childrenOf) {
      add('childrenOf', 'Sub-tasks of', parent, {
        ...filter,
        childrenOf: toggle(filter.childrenOf, parent),
      });
    }
    for (const facet of filter.relations) {
      add(
        'relations',
        'Relation',
        TaskFilterBarComponent.RELATION_LABELS[facet],
        {
          ...filter,
          relations: toggle(filter.relations, facet),
        },
      );
    }
    if (filter.hasValidationIssues) {
      add('issues', 'Only', 'with warnings', {
        ...filter,
        hasValidationIssues: false,
      });
    }
    return chips;
  });

  /**
   * The chip surface for every facet except labels.
   *
   * `base-200` fill with inherited `base-content` text — a daisyUI base pair,
   * so it is audited by construction on every theme (7.44:1 at worst, on
   * daisyUI `dark`). Label chips override it with `labelChipClass`, whose
   * absolute-hex palette carries its own audit table from Batch 3.
   */
  private static readonly NEUTRAL_CHIP_CLASSES = 'bg-base-200 border-base-300';

  /**
   * What a chip says when the workspace no longer carries the value it selects.
   *
   * A saved view outlives the tasks it was written against (FR-C2.4). When the
   * last task carrying `licensing` is retired, a view filtering on `licensing`
   * still APPLIES, still matches nothing on that facet, and is left exactly as
   * the user saved it. This sentence is the whole of the response: the chip is
   * not removed, the spec is not rewritten, and nothing is written to disk.
   * Silently editing somebody's saved lens for them is the same class of act as
   * backfilling a carrier.
   */
  private static readonly STALE_FACET_NOTE =
    'no longer present in this workspace';

  private static readonly PARENTAGE_LABELS: Record<TaskParentageFacet, string> =
    {
      parent: 'Has sub-tasks',
      child: 'Is a sub-task',
      standalone: 'Standalone',
    };

  private static readonly RELATION_LABELS: Record<TaskRelationFacet, string> = {
    unmet_dependencies: 'Blocked by unfinished work',
    duplicate: 'Marked as a duplicate',
  };

  private static readonly SORT_FIELD_LABELS: Record<TaskSortField, string> = {
    updated: 'Updated',
    created: 'Created',
    title: 'Title',
    status: 'Status',
    type: 'Type',
    estimate: 'Estimate',
    id: 'Id',
  };

  protected onText(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.filterChange.emit({ ...this.filter(), text: value });
  }

  protected onIssuesToggle(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.filterChange.emit({
      ...this.filter(),
      hasValidationIssues: checked,
    });
  }

  protected onLabelsMode(mode: TaskLabelMatchMode): void {
    if (this.filter().labelsMode === mode) return;
    this.filterChange.emit({ ...this.filter(), labelsMode: mode });
  }

  protected onSortField(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const field = TASK_SORT_FIELDS.find((candidate) => candidate === value);
    // A `<select>` can only offer what was rendered, so this is unreachable
    // from the UI — it exists so an unknown value is IGNORED rather than
    // written into the sort spec as a field nothing knows how to compare.
    if (field === undefined) return;
    this.sortChange.emit({ ...this.sort(), field });
  }

  protected onSortDirection(): void {
    const sort = this.sort();
    this.sortChange.emit({
      ...sort,
      direction: sort.direction === 'asc' ? 'desc' : 'asc',
    });
  }
}

/**
 * Add a value to a facet selection, or remove it if it is already there.
 *
 * Facet arithmetic — set membership over the SPEC, never a comparison against a
 * task. Which tasks that spec then matches is `filterTasks`' decision and no
 * part of it is duplicated here.
 */
function toggle<T>(current: readonly T[], value: T): readonly T[] {
  return current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];
}
