/**
 * SessionFilterBarComponent — the sidebar's organization query controls
 * (TASK_2026_580, plan component 11).
 *
 * Search text, a Filters popover (status and priority multi-select, task id,
 * pinned and has-PR toggles) and the sort and group menus. It owns the draft
 * and emits one normalized `SessionFilterQuery`; the parent sends it on
 * `session:list`.
 *
 * Emission (L17): typed fields (search text, task id) wait 250 ms; every other
 * change emits at once and takes any pending typed change with it. There is
 * only ever one pending timer, it is released on destroy, and a query equal to
 * the last one sent is not sent again.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { ListFilter, LucideAngularModule, Search, X } from 'lucide-angular';
import { NativePopoverComponent } from '@ptah-extension/ui';
import {
  SESSION_PRIORITIES,
  SESSION_WORKFLOW_STATUSES,
  type SessionListGroup,
  type SessionListParams,
  type SessionListSort,
  type SessionPriority,
  type SessionWorkflowStatus,
} from '@ptah-extension/shared';
import {
  SESSION_PRIORITY_LABELS,
  SESSION_STATUS_LABELS,
} from '../../atoms/session-organization-chips/session-organization-labels';

/** The organization part of a `session:list` request. */
export type SessionFilterQuery = Pick<
  SessionListParams,
  | 'status'
  | 'priority'
  | 'taskId'
  | 'pinned'
  | 'hasPr'
  | 'text'
  | 'sort'
  | 'groupBy'
>;

/** Delay for typed fields (L17). */
export const SESSION_FILTER_TEXT_DEBOUNCE_MS = 250;

const SORT_OPTIONS: readonly { value: SessionListSort; label: string }[] = [
  { value: 'lastActive', label: 'Last active' },
  { value: 'priority', label: 'Priority' },
  { value: 'created', label: 'Created' },
  { value: 'name', label: 'Name' },
];

const GROUP_OPTIONS: readonly { value: SessionListGroup; label: string }[] = [
  { value: 'none', label: 'No grouping' },
  { value: 'status', label: 'By status' },
  { value: 'task', label: 'By task' },
  { value: 'parent', label: 'By parent' },
];

/**
 * The app's keyboard focus ring (`styles.css` `:focus-visible`, the one the
 * buttons show). daisyUI's `.input`/`.select` focus outline is a 20% tint and
 * wins over the global rule, so these controls restate it as utilities.
 */
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]';
/** The same ring on a label that wraps its input (search box). */
const FOCUS_RING_WITHIN =
  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[oklch(var(--s))]';

let nextId = 0;

/**
 * The bar sends trimmed text, and the parent passes it back as the new query.
 * Keep the typed draft while it trims to that value, so a space the user just
 * typed is not removed from the input.
 */
function keepDraftUntilTrimmedChange(
  seed: string,
  previous: { source: string; value: string } | undefined,
): string {
  return previous !== undefined && previous.value.trim() === seed
    ? previous.value
    : seed;
}

@Component({
  selector: 'ptah-session-filter-bar',
  standalone: true,
  imports: [LucideAngularModule, NativePopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-col gap-1"
      role="search"
      aria-label="Filter sessions"
      data-testid="session-filter-bar"
    >
      <label
        class="input input-xs w-full flex items-center gap-1.5 bg-base-100 border-base-content/10 ${FOCUS_RING_WITHIN}"
      >
        <lucide-angular
          [img]="SearchIcon"
          class="w-3 h-3 text-base-content-muted flex-shrink-0"
          aria-hidden="true"
        />
        <input
          type="text"
          class="grow text-xs min-w-0"
          placeholder="Search sessions..."
          aria-label="Search sessions by name"
          [value]="text()"
          (input)="onText($event)"
          data-testid="session-filter-text"
        />
        @if (text()) {
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-circle w-6 h-6 min-h-6 p-0"
            aria-label="Clear search"
            (click)="clearText()"
          >
            <lucide-angular [img]="XIcon" class="w-3 h-3" aria-hidden="true" />
          </button>
        }
      </label>

      <div class="flex items-center gap-1">
        <ptah-native-popover
          [isOpen]="filtersOpen()"
          [placement]="'bottom-start'"
          [hasBackdrop]="true"
          [backdropClass]="'transparent'"
          (closed)="filtersOpen.set(false)"
        >
          <button
            trigger
            type="button"
            class="btn btn-ghost btn-xs h-6 min-h-6 gap-1 px-1.5 text-base-content"
            aria-haspopup="dialog"
            [attr.aria-expanded]="filtersOpen()"
            [attr.aria-label]="filtersButtonLabel()"
            (click)="filtersOpen.set(!filtersOpen())"
            data-testid="session-filter-toggle"
          >
            <lucide-angular
              [img]="FilterIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
            <span class="text-[11px]">Filters</span>
            @if (activeFilterCount() > 0) {
              <span
                class="badge badge-xs badge-neutral tabular-nums"
                aria-hidden="true"
                >{{ activeFilterCount() }}</span
              >
            }
          </button>

          <div
            content
            role="dialog"
            aria-label="Session filters"
            class="w-60 max-w-[90vw] p-3 text-xs flex flex-col gap-3 text-base-content"
            data-testid="session-filter-panel"
          >
            <fieldset class="flex flex-col">
              <legend class="mb-1 font-semibold">Status</legend>
              @for (option of statusOptions; track option.value) {
                <label
                  class="flex items-center gap-2 min-h-6 cursor-pointer rounded px-1 hover:bg-base-content/5"
                >
                  <input
                    type="checkbox"
                    class="checkbox checkbox-xs"
                    [checked]="statuses().includes(option.value)"
                    (change)="toggleStatus(option.value)"
                    [attr.data-testid]="'session-filter-status-' + option.value"
                  />
                  <span>{{ option.label }}</span>
                </label>
              }
            </fieldset>

            <fieldset class="flex flex-col">
              <legend class="mb-1 font-semibold">Priority</legend>
              @for (option of priorityOptions; track option.value) {
                <label
                  class="flex items-center gap-2 min-h-6 cursor-pointer rounded px-1 hover:bg-base-content/5"
                >
                  <input
                    type="checkbox"
                    class="checkbox checkbox-xs"
                    [checked]="priorities().includes(option.value)"
                    (change)="togglePriority(option.value)"
                    [attr.data-testid]="
                      'session-filter-priority-' + option.value
                    "
                  />
                  <span>{{ option.label }}</span>
                </label>
              }
            </fieldset>

            <div class="flex flex-col gap-1">
              <label class="font-semibold" [attr.for]="taskInputId"
                >Task id</label
              >
              <input
                [id]="taskInputId"
                type="text"
                class="input input-xs w-full bg-base-100 border-base-content/10 ${FOCUS_RING}"
                placeholder="TASK_2026_..."
                [value]="taskId()"
                (input)="onTaskId($event)"
                data-testid="session-filter-task"
              />
            </div>

            <div class="flex flex-col">
              <label
                class="flex items-center gap-2 min-h-6 cursor-pointer rounded px-1 hover:bg-base-content/5"
              >
                <input
                  type="checkbox"
                  class="toggle toggle-xs"
                  [checked]="pinnedOnly()"
                  (change)="setPinnedOnly($event)"
                  data-testid="session-filter-pinned"
                />
                <span>Pinned only</span>
              </label>
              <label
                class="flex items-center gap-2 min-h-6 cursor-pointer rounded px-1 hover:bg-base-content/5"
              >
                <input
                  type="checkbox"
                  class="toggle toggle-xs"
                  [checked]="hasPrOnly()"
                  (change)="setHasPrOnly($event)"
                  data-testid="session-filter-has-pr"
                />
                <span>Has pull request</span>
              </label>
            </div>

            @if (activeFilterCount() > 0) {
              <button
                type="button"
                class="btn btn-ghost btn-xs h-6 min-h-6 self-start"
                (click)="clearFilters()"
                data-testid="session-filter-clear"
              >
                Clear filters
              </button>
            }
          </div>
        </ptah-native-popover>
      </div>

      <!-- Own row: at the 224px sidebar, sharing a row with "Filters" left
           each select 72px and clipped its value ("Last a"). -->
      <div class="flex items-center gap-1">
        <label class="sr-only" [attr.for]="sortSelectId">Sort sessions</label>
        <select
          [id]="sortSelectId"
          class="select select-xs h-6 min-h-6 min-w-0 flex-1 pl-2 pr-6 bg-base-100 border-base-content/10 text-[11px] ${FOCUS_RING}"
          (change)="onSort($event)"
          data-testid="session-filter-sort"
        >
          @for (option of sortOptions; track option.value) {
            <option [value]="option.value" [selected]="option.value === sort()">
              {{ option.label }}
            </option>
          }
        </select>

        <label class="sr-only" [attr.for]="groupSelectId">Group sessions</label>
        <select
          [id]="groupSelectId"
          class="select select-xs h-6 min-h-6 min-w-0 flex-1 pl-2 pr-6 bg-base-100 border-base-content/10 text-[11px] ${FOCUS_RING}"
          (change)="onGroup($event)"
          data-testid="session-filter-group"
        >
          @for (option of groupOptions; track option.value) {
            <option
              [value]="option.value"
              [selected]="option.value === groupBy()"
            >
              {{ option.label }}
            </option>
          }
        </select>
      </div>
    </div>
  `,
})
export class SessionFilterBarComponent {
  /** Seed for the draft. A new value replaces the draft. */
  readonly query = input<SessionFilterQuery>({});

  /** The normalized query, at most once per settled change. */
  readonly queryChange = output<SessionFilterQuery>();

  protected readonly SearchIcon = Search;
  protected readonly FilterIcon = ListFilter;
  protected readonly XIcon = X;

  protected readonly statusOptions = SESSION_WORKFLOW_STATUSES.map((value) => ({
    value,
    label: SESSION_STATUS_LABELS[value],
  }));
  protected readonly priorityOptions = SESSION_PRIORITIES.map((value) => ({
    value,
    label: SESSION_PRIORITY_LABELS[value],
  }));
  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly groupOptions = GROUP_OPTIONS;

  private readonly idSuffix = nextId++;
  protected readonly taskInputId = `session-filter-task-${this.idSuffix}`;
  protected readonly sortSelectId = `session-filter-sort-${this.idSuffix}`;
  protected readonly groupSelectId = `session-filter-group-${this.idSuffix}`;

  protected readonly filtersOpen = signal(false);

  protected readonly text = linkedSignal<string, string>({
    source: () => this.query().text ?? '',
    computation: keepDraftUntilTrimmedChange,
  });
  protected readonly statuses = linkedSignal<readonly SessionWorkflowStatus[]>(
    () => this.query().status ?? [],
  );
  protected readonly priorities = linkedSignal<readonly SessionPriority[]>(
    () => this.query().priority ?? [],
  );
  protected readonly taskId = linkedSignal<string, string>({
    source: () => this.query().taskId ?? '',
    computation: keepDraftUntilTrimmedChange,
  });
  protected readonly pinnedOnly = linkedSignal(
    () => this.query().pinned === true,
  );
  protected readonly hasPrOnly = linkedSignal(
    () => this.query().hasPr === true,
  );
  protected readonly sort = linkedSignal<SessionListSort>(
    () => this.query().sort ?? 'lastActive',
  );
  protected readonly groupBy = linkedSignal<SessionListGroup>(
    () => this.query().groupBy ?? 'none',
  );

  /** The draft as a request fragment: empty fields omitted, sort always set. */
  readonly draft = computed<SessionFilterQuery>(() =>
    normalizeQuery({
      status: this.statuses(),
      priority: this.priorities(),
      taskId: this.taskId(),
      pinned: this.pinnedOnly(),
      hasPr: this.hasPrOnly(),
      text: this.text(),
      sort: this.sort(),
      groupBy: this.groupBy(),
    }),
  );

  protected readonly activeFilterCount = computed(
    () =>
      this.statuses().length +
      this.priorities().length +
      (this.taskId().trim() ? 1 : 0) +
      (this.pinnedOnly() ? 1 : 0) +
      (this.hasPrOnly() ? 1 : 0),
  );

  protected readonly filtersButtonLabel = computed(() => {
    const count = this.activeFilterCount();
    return count > 0 ? `Filters (${count} active)` : 'Filters';
  });

  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last query sent, and the seed it was sent against. */
  private lastSent: { seed: string; key: string } | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelPending());
  }

  protected onText(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
    this.schedule(true);
  }

  protected clearText(): void {
    this.text.set('');
    this.schedule(false);
  }

  protected onTaskId(event: Event): void {
    this.taskId.set((event.target as HTMLInputElement).value);
    this.schedule(true);
  }

  protected toggleStatus(status: SessionWorkflowStatus): void {
    this.statuses.update((current) =>
      current.includes(status)
        ? current.filter((s) => s !== status)
        : [...current, status],
    );
    this.schedule(false);
  }

  protected togglePriority(priority: SessionPriority): void {
    this.priorities.update((current) =>
      current.includes(priority)
        ? current.filter((p) => p !== priority)
        : [...current, priority],
    );
    this.schedule(false);
  }

  protected setPinnedOnly(event: Event): void {
    this.pinnedOnly.set((event.target as HTMLInputElement).checked);
    this.schedule(false);
  }

  protected setHasPrOnly(event: Event): void {
    this.hasPrOnly.set((event.target as HTMLInputElement).checked);
    this.schedule(false);
  }

  protected onSort(event: Event): void {
    this.sort.set((event.target as HTMLSelectElement).value as SessionListSort);
    this.schedule(false);
  }

  protected onGroup(event: Event): void {
    this.groupBy.set(
      (event.target as HTMLSelectElement).value as SessionListGroup,
    );
    this.schedule(false);
  }

  protected clearFilters(): void {
    this.statuses.set([]);
    this.priorities.set([]);
    this.taskId.set('');
    this.pinnedOnly.set(false);
    this.hasPrOnly.set(false);
    this.schedule(false);
  }

  /** One pending change: a new change replaces the pending one. */
  private schedule(debounced: boolean): void {
    this.cancelPending();
    if (!debounced) {
      this.flush();
      return;
    }
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      this.flush();
    }, SESSION_FILTER_TEXT_DEBOUNCE_MS);
  }

  private cancelPending(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private flush(): void {
    const seed = JSON.stringify(this.query());
    const next = this.draft();
    const key = JSON.stringify(next);
    // Against a new seed, the baseline is the seed itself (normalized).
    const baseline =
      this.lastSent?.seed === seed
        ? this.lastSent.key
        : JSON.stringify(normalizeQuery(this.query()));
    if (key === baseline) return;
    this.lastSent = { seed, key };
    this.queryChange.emit(next);
  }
}

/** Draft fields before normalization. */
interface DraftFields {
  status?: readonly SessionWorkflowStatus[];
  priority?: readonly SessionPriority[];
  taskId?: string;
  pinned?: boolean;
  hasPr?: boolean;
  text?: string;
  sort?: SessionListSort;
  groupBy?: SessionListGroup;
}

/**
 * The one request shape: defaults filled for `sort` and `groupBy`, empty
 * fields dropped, toggles sent only when on, list order fixed by the
 * vocabulary tuples so equal selections compare equal.
 */
function normalizeQuery(fields: DraftFields): SessionFilterQuery {
  const result: SessionFilterQuery = {
    sort: fields.sort ?? 'lastActive',
    groupBy: fields.groupBy ?? 'none',
  };
  const statuses = fields.status ?? [];
  if (statuses.length > 0) {
    result.status = SESSION_WORKFLOW_STATUSES.filter((s) =>
      statuses.includes(s),
    );
  }
  const priorities = fields.priority ?? [];
  if (priorities.length > 0) {
    result.priority = SESSION_PRIORITIES.filter((p) => priorities.includes(p));
  }
  const taskId = fields.taskId?.trim();
  if (taskId) result.taskId = taskId;
  if (fields.pinned === true) result.pinned = true;
  if (fields.hasPr === true) result.hasPr = true;
  const text = fields.text?.trim();
  if (text) result.text = text;
  return result;
}
