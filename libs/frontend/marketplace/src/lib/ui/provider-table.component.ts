import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  CircleAlert,
  Inbox,
  LucideAngularModule,
  RefreshCw,
  Trash2,
  Unplug,
  type LucideIconData,
} from 'lucide-angular';
import { BrandMarkComponent } from '@ptah-extension/ui';

import { PTAH_SESSIONS_LABEL } from '../data/coverage';
import type { ProviderSort, ProviderSortKey } from '../data/provider-filtering';
import type { ProviderRow, ProviderRowKind } from '../data/provider-row';
import { RemovalLockBadgeComponent } from './removal-lock-badge.component';
import { StatusPillComponent } from './status-pill.component';
import { TargetMarksComponent } from './target-marks.component';

// ── Row helpers shared with the compact card list ─────────────────────────────

/** The removal button of a row that has one. */
export interface ProviderRemovalAction {
  /** Visible word. */
  readonly label: string;
  /** Accessible name, naming the server. */
  readonly ariaLabel: string;
  readonly icon: LucideIconData;
}

/**
 * Whether a row can join a bulk removal. Blocked rows and claude.ai account
 * connectors (`manage-link`) have no removal Ptah can run.
 */
export function isProviderRowSelectable(row: ProviderRow): boolean {
  return row.removal.kind !== 'blocked' && row.removal.kind !== 'manage-link';
}

/**
 * The row checkbox's accessible name: "Select <name>", or, when the row
 * cannot be selected, why not.
 */
export function providerRowCheckboxLabel(row: ProviderRow): string {
  switch (row.removal.kind) {
    case 'blocked':
      return `${row.title} can't be selected: Ptah can't remove it`;
    case 'manage-link':
      return `${row.title} can't be selected: it is managed in your claude.ai account`;
    default:
      return `Select ${row.title}`;
  }
}

/**
 * The removal button of a row, or `null` for a row whose action column shows
 * the lock badge instead (`blocked`, `manage-link`).
 */
export function providerRemovalAction(
  row: ProviderRow,
): ProviderRemovalAction | null {
  switch (row.removal.kind) {
    case 'uninstall':
      return {
        label: 'Remove',
        ariaLabel: `Remove ${row.title}`,
        icon: Trash2,
      };
    case 'confirm-direct':
      return {
        label: 'Remove…',
        ariaLabel: `Remove ${row.title} (asks for confirmation)`,
        icon: Trash2,
      };
    case 'disconnect':
      return {
        label: 'Disconnect',
        ariaLabel: `Disconnect ${row.title}`,
        icon: Unplug,
      };
    case 'blocked':
    case 'manage-link':
      return null;
  }
}

/** The fix command of a blocked row, else `null`. */
export function providerRowFixCommand(row: ProviderRow): string | null {
  return row.removal.kind === 'blocked'
    ? (row.removal.fixCommand ?? null)
    : null;
}

/** The lock reason of a blocked or `manage-link` row, else `null`. */
export function providerRowLockReason(row: ProviderRow): string | null {
  return row.removal.kind === 'blocked' || row.removal.kind === 'manage-link'
    ? row.removal.reason
    : null;
}

const KIND_LABELS: Readonly<Record<ProviderRowKind, string>> = {
  config: 'MCP server',
  connection: 'Hosted connection',
  'account-connector': 'claude.ai connector',
};

/** The small line under a row's name. */
export function providerRowKindLabel(row: ProviderRow): string {
  return KIND_LABELS[row.kind];
}

/**
 * `selected` with `ref` added or removed. Returns a new set; the input is
 * never mutated, so a page holding it in a signal sees a new value.
 */
export function withRefSelected(
  selected: ReadonlySet<string>,
  ref: string,
  checked: boolean,
): ReadonlySet<string> {
  const next = new Set(selected);
  if (checked) next.add(ref);
  else next.delete(ref);
  return next;
}

// ── Table ─────────────────────────────────────────────────────────────────────

/** A sortable column: its key and its header word. */
interface SortColumn {
  readonly key: ProviderSortKey;
  readonly label: string;
}

const SORT_COLUMNS: Readonly<Record<ProviderSortKey, SortColumn>> = {
  name: { key: 'name', label: 'Server' },
  origin: { key: 'origin', label: 'Origin' },
  status: { key: 'status', label: 'Status' },
};

const SKELETON_ROWS = [0, 1, 2, 3] as const;

/** The sort after a header click: the same key flips, a new key starts ascending. */
export function nextProviderSort(
  current: ProviderSort,
  key: ProviderSortKey,
): ProviderSort {
  return current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: 'asc' };
}

/**
 * Installed servers as a table (plan C8 `ProviderTable`, regular tier and up).
 *
 * Presentational: the page filters and sorts the rows (`applyProviderView`),
 * owns the selection, the active row and the sort, and reacts to the outputs.
 *
 * - Sortable headers are `<th scope="col">` with `aria-sort` and a button.
 * - Each row has a checkbox named "Select <name>". Blocked and `manage-link`
 *   rows cannot join a bulk removal: their checkbox is disabled and its name
 *   says why.
 * - The server name is the row's open control; its hit area covers the row,
 *   under the checkbox and the action column.
 * - The action column is a removal button, or the lock badge for a row Ptah
 *   cannot remove — never a paragraph.
 * - `activeRef` marks the keyboard-active row (`aria-current`, `data-active`).
 *
 * @example
 * ```html
 * <ptah-provider-table
 *   [rows]="visibleRows()"
 *   [sort]="sort()"
 *   [selected]="selection()"
 *   [activeRef]="activeRef()"
 *   (sortChange)="sort.set($event)"
 *   (selectionChange)="selection.set($event)"
 *   (openRequested)="openDetail($event.ref)"
 *   (removeRequested)="remove($event)"
 * />
 * ```
 */
@Component({
  selector: 'ptah-provider-table',
  standalone: true,
  imports: [
    LucideAngularModule,
    BrandMarkComponent,
    RemovalLockBadgeComponent,
    StatusPillComponent,
    TargetMarksComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @switch (state()) {
      @case ('loading') {
        <div
          role="status"
          aria-busy="true"
          class="space-y-2 p-3"
          data-testid="provider-table-loading"
        >
          <span class="sr-only">Loading {{ caption() }}…</span>
          @for (line of skeletonRows; track line) {
            <div class="flex items-center gap-3" aria-hidden="true">
              <div class="skeleton h-4 w-4 rounded"></div>
              <div class="skeleton h-6 w-6 rounded-md"></div>
              <div class="skeleton h-4 w-1/3 rounded"></div>
              <div class="skeleton ml-auto h-4 w-20 rounded-full"></div>
            </div>
          }
        </div>
      }
      @case ('error') {
        <div
          role="alert"
          class="flex flex-col items-center gap-2 px-4 py-8 text-center"
          data-testid="provider-table-error"
        >
          <lucide-angular
            [img]="ErrorIcon"
            class="h-6 w-6 text-error"
            aria-hidden="true"
          />
          <p class="text-sm font-medium text-base-content">
            Could not load {{ caption() }}
          </p>
          @if (errorMessage()) {
            <p class="text-xs text-base-content-muted">{{ errorMessage() }}</p>
          }
          <button
            type="button"
            class="btn btn-outline btn-sm gap-1"
            data-testid="provider-table-retry"
            (click)="retryRequested.emit()"
          >
            <lucide-angular
              [img]="RetryIcon"
              class="h-3.5 w-3.5"
              aria-hidden="true"
            />
            Retry
          </button>
        </div>
      }
      @default {
        @if (rows().length === 0) {
          <div
            class="flex flex-col items-center gap-2 px-4 py-8 text-center"
            data-testid="provider-table-empty"
          >
            <lucide-angular
              [img]="EmptyIcon"
              class="h-6 w-6 text-base-content-muted"
              aria-hidden="true"
            />
            <p class="text-sm font-medium text-base-content">
              {{ emptyTitle() }}
            </p>
            @if (emptyDetail()) {
              <p class="text-xs text-base-content-muted">{{ emptyDetail() }}</p>
            }
            @if (emptyActionLabel(); as actionLabel) {
              <button
                type="button"
                class="btn btn-primary btn-sm"
                data-testid="provider-table-empty-action"
                (click)="emptyActionRequested.emit()"
              >
                {{ actionLabel }}
              </button>
            }
          </div>
        } @else {
          <div class="overflow-x-auto">
            <table class="table table-sm w-full" data-testid="provider-table">
              <caption class="sr-only">
                {{
                  caption()
                }}
              </caption>
              <thead>
                <tr
                  class="border-base-300 text-[11px] uppercase tracking-wide text-base-content-muted"
                >
                  <th scope="col" class="w-8">
                    <input
                      #selectAll
                      type="checkbox"
                      class="checkbox checkbox-xs"
                      aria-label="Select all selectable servers"
                      data-testid="provider-select-all"
                      [checked]="allSelected()"
                      [indeterminate]="someSelected()"
                      [disabled]="selectableRefs().length === 0"
                      (change)="toggleAll(selectAll.checked)"
                    />
                  </th>
                  <th
                    scope="col"
                    [attr.aria-sort]="ariaSort('name')"
                    data-testid="provider-sort-name"
                  >
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded uppercase hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      (click)="sortBy('name')"
                    >
                      {{ columns.name.label }}
                      <lucide-angular
                        [img]="sortIcon('name')"
                        class="h-3 w-3"
                        aria-hidden="true"
                      />
                    </button>
                  </th>
                  <th
                    scope="col"
                    [attr.aria-sort]="ariaSort('origin')"
                    data-testid="provider-sort-origin"
                  >
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded uppercase hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      (click)="sortBy('origin')"
                    >
                      {{ columns.origin.label }}
                      <lucide-angular
                        [img]="sortIcon('origin')"
                        class="h-3 w-3"
                        aria-hidden="true"
                      />
                    </button>
                  </th>
                  <th scope="col">Targets</th>
                  <th
                    scope="col"
                    [attr.aria-sort]="ariaSort('status')"
                    data-testid="provider-sort-status"
                  >
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded uppercase hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      (click)="sortBy('status')"
                    >
                      {{ columns.status.label }}
                      <lucide-angular
                        [img]="sortIcon('status')"
                        class="h-3 w-3"
                        aria-hidden="true"
                      />
                    </button>
                  </th>
                  <th scope="col" class="text-right">
                    <span class="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track row.ref) {
                  <tr
                    class="relative border-base-300 transition-colors hover:bg-base-200"
                    [class]="rowClass(row.ref)"
                    [attr.aria-current]="
                      row.ref === activeRef() ? 'true' : null
                    "
                    [attr.data-active]="row.ref === activeRef()"
                    [attr.data-ref]="row.ref"
                    data-testid="provider-row"
                  >
                    <td class="relative z-10 w-8">
                      <input
                        #rowBox
                        type="checkbox"
                        class="checkbox checkbox-xs"
                        data-testid="provider-row-checkbox"
                        [attr.aria-label]="checkboxLabel(row)"
                        [attr.title]="
                          isSelectable(row) ? null : checkboxLabel(row)
                        "
                        [checked]="isSelectable(row) && selected().has(row.ref)"
                        [disabled]="!isSelectable(row)"
                        (change)="toggleRow(row, rowBox.checked)"
                      />
                    </td>
                    <td class="min-w-0">
                      <div class="flex min-w-0 items-center gap-2">
                        <ptah-brand-mark
                          [brandSlug]="row.brand"
                          [label]="row.title"
                          size="sm"
                        />
                        <div class="min-w-0">
                          <button
                            type="button"
                            class="block max-w-full truncate text-left text-sm font-medium text-base-content after:absolute after:inset-0 after:content-[''] hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                            [attr.title]="row.title"
                            data-testid="provider-row-open"
                            (click)="openRequested.emit(row)"
                          >
                            {{ row.title }}
                          </button>
                          <p
                            class="truncate text-[11px] text-base-content-muted"
                          >
                            {{ kindLabel(row) }}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        class="badge badge-ghost badge-sm whitespace-nowrap"
                        data-testid="provider-row-origin"
                        >{{ row.originLabel }}</span
                      >
                    </td>
                    <td>
                      @if (row.kind === 'config') {
                        <ptah-target-marks [targets]="row.targets" />
                      } @else {
                        <span
                          class="text-xs text-base-content-muted"
                          data-testid="provider-row-session-targets"
                          >{{ sessionTargetsLabel }}</span
                        >
                      }
                    </td>
                    <td>
                      <ptah-status-pill
                        [status]="row.status"
                        [statusText]="row.statusText"
                      />
                    </td>
                    <td class="relative z-10 text-right">
                      @if (removalAction(row); as action) {
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs gap-1"
                          data-testid="provider-row-remove"
                          [attr.aria-label]="action.ariaLabel"
                          [disabled]="busyRefs().has(row.ref)"
                          [attr.aria-busy]="busyRefs().has(row.ref)"
                          (click)="removeRequested.emit(row)"
                        >
                          @if (busyRefs().has(row.ref)) {
                            <span
                              class="loading loading-spinner loading-xs"
                              aria-hidden="true"
                            ></span>
                          } @else {
                            <lucide-angular
                              [img]="action.icon"
                              class="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          }
                          {{ action.label }}
                        </button>
                      } @else {
                        <ptah-removal-lock-badge
                          [serverName]="row.title"
                          [reason]="lockReason(row) ?? ''"
                          [fixCommand]="fixCommand(row)"
                        />
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    }
  `,
})
export class ProviderTableComponent {
  /** The rows to show, already filtered and sorted by the page. */
  public readonly rows = input.required<readonly ProviderRow[]>();

  /** The current sort; drives `aria-sort` and the header icons. */
  public readonly sort = input<ProviderSort>({ key: 'name', direction: 'asc' });

  /** Refs of the selected rows. */
  public readonly selected = input<ReadonlySet<string>>(new Set());

  /** Ref of the keyboard-active row, or `null`. */
  public readonly activeRef = input<string | null>(null);

  /** Refs whose removal is running: their button is disabled. */
  public readonly busyRefs = input<ReadonlySet<string>>(new Set());

  /** Load state of the slice the rows come from. @default 'ready' */
  public readonly state = input<'loading' | 'ready' | 'error'>('ready');

  /** Shown under the error title. */
  public readonly errorMessage = input<string | null>(null);

  /** The table's caption (visually hidden) and the loading/error noun. */
  public readonly caption = input<string>('installed servers');

  /** Empty-state title. @default 'No servers to show' */
  public readonly emptyTitle = input<string>('No servers to show');

  /** Empty-state detail line. */
  public readonly emptyDetail = input<string | null>(null);

  /** Empty-state button label; no button when `null`. */
  public readonly emptyActionLabel = input<string | null>(null);

  /** The new selection after a checkbox change. */
  public readonly selectionChange = output<ReadonlySet<string>>();

  /** The new sort after a header click. */
  public readonly sortChange = output<ProviderSort>();

  /** The user asked to open a row's detail. */
  public readonly openRequested = output<ProviderRow>();

  /** The user asked to remove (or disconnect) a row. */
  public readonly removeRequested = output<ProviderRow>();

  /** The user asked to retry the failed load. */
  public readonly retryRequested = output<void>();

  /** The user pressed the empty-state button. */
  public readonly emptyActionRequested = output<void>();

  protected readonly columns = SORT_COLUMNS;
  protected readonly skeletonRows = SKELETON_ROWS;
  /** Connections and account connectors reach Ptah sessions only (A5). */
  protected readonly sessionTargetsLabel = PTAH_SESSIONS_LABEL;
  protected readonly ErrorIcon = CircleAlert;
  protected readonly RetryIcon = RefreshCw;
  protected readonly EmptyIcon = Inbox;

  protected readonly isSelectable = isProviderRowSelectable;
  protected readonly checkboxLabel = providerRowCheckboxLabel;
  protected readonly removalAction = providerRemovalAction;
  protected readonly fixCommand = providerRowFixCommand;
  protected readonly lockReason = providerRowLockReason;
  protected readonly kindLabel = providerRowKindLabel;

  /** Refs of the visible rows that can be selected. */
  protected readonly selectableRefs = computed(() =>
    this.rows()
      .filter(isProviderRowSelectable)
      .map((row) => row.ref),
  );

  private readonly selectedVisibleCount = computed(() => {
    const selected = this.selected();
    return this.selectableRefs().filter((ref) => selected.has(ref)).length;
  });

  protected readonly allSelected = computed(
    () =>
      this.selectableRefs().length > 0 &&
      this.selectedVisibleCount() === this.selectableRefs().length,
  );

  protected readonly someSelected = computed(
    () => this.selectedVisibleCount() > 0 && !this.allSelected(),
  );

  protected ariaSort(
    key: ProviderSortKey,
  ): 'ascending' | 'descending' | 'none' {
    const sort = this.sort();
    if (sort.key !== key) return 'none';
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  protected sortIcon(key: ProviderSortKey): LucideIconData {
    const sort = this.sort();
    if (sort.key !== key) return ChevronsUpDown;
    return sort.direction === 'asc' ? ArrowUp : ArrowDown;
  }

  protected sortBy(key: ProviderSortKey): void {
    this.sortChange.emit(nextProviderSort(this.sort(), key));
  }

  protected rowClass(ref: string): string {
    return ref === this.activeRef()
      ? 'bg-primary/10 outline outline-1 -outline-offset-1 outline-primary/40'
      : '';
  }

  protected toggleRow(row: ProviderRow, checked: boolean): void {
    if (!isProviderRowSelectable(row)) return;
    this.selectionChange.emit(
      withRefSelected(this.selected(), row.ref, checked),
    );
  }

  /** Select or clear every visible selectable row; other refs are kept. */
  protected toggleAll(checked: boolean): void {
    const next = new Set(this.selected());
    for (const ref of this.selectableRefs()) {
      if (checked) next.add(ref);
      else next.delete(ref);
    }
    this.selectionChange.emit(next);
  }
}
