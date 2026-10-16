/**
 * PreviousSessionsToolbarComponent — the query controls in the header of the
 * previous-sessions modal (TASK_2026_679, plan component 8a, design 3.4).
 *
 * Presentational: every value comes in as an input and every change goes out
 * as an output; the modal binds both to `SessionListViewStore`. It holds no
 * state of its own, so the query survives the modal closing and reopening.
 *
 * - Organization hosts (Electron, CLI): `ptah-session-filter-bar` (search,
 *   Filters, Sort, Group; the server answers the query).
 * - Plain hosts (VS Code): a local name search with a clear X.
 * - Both: the Date range toggle and its two-column From / To panel, and
 *   `Clear` while any filter is active.
 *
 * Markup moved from the old sidebar (`app-shell.component.html`, search,
 * date toggle, Clear and date inputs).
 */
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import {
  CalendarDays,
  ChevronDown,
  LucideAngularModule,
  Search,
  X,
} from 'lucide-angular';
import type { SessionListQuery } from '../../../services/chat-store/session-loader.service';
import { SessionFilterBarComponent } from '../session-filter-bar/session-filter-bar.component';

/**
 * The app's keyboard focus ring (`styles.css` `:focus-visible`). daisyUI's
 * `.input` focus outline is a 20% tint and wins over the global rule, so these
 * controls restate it as utilities (as `SessionFilterBarComponent` does).
 */
const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--s))]';
/** The same ring on a label that wraps its input (search box). */
const FOCUS_RING_WITHIN =
  'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[oklch(var(--s))]';

let nextId = 0;

@Component({
  selector: 'ptah-previous-sessions-toolbar',
  standalone: true,
  imports: [LucideAngularModule, SessionFilterBarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The organization filter bar is its own role="search" landmark, so
         this container takes the role only on plain hosts: one landmark per
         variant, never two nested with the same name. -->
    <div
      class="flex flex-col gap-2"
      [attr.role]="organizationAvailable() ? null : 'search'"
      [attr.aria-label]="organizationAvailable() ? null : 'Filter sessions'"
      data-testid="previous-sessions-toolbar"
    >
      @if (organizationAvailable()) {
        <ptah-session-filter-bar
          [query]="listQuery()"
          (queryChange)="queryChange.emit($event)"
        />
      } @else {
        <label
          class="input input-sm rounded-lg h-8 min-h-8 w-full flex items-center gap-1.5 bg-surface-0 border-surface-border ${FOCUS_RING_WITHIN}"
        >
          <lucide-angular
            [img]="SearchIcon"
            class="w-3 h-3 text-base-content-muted flex-shrink-0"
            aria-hidden="true"
          />
          <input
            type="text"
            class="grow text-xs min-w-0 placeholder:text-base-content-muted"
            placeholder="Search sessions..."
            aria-label="Search sessions by name"
            [value]="searchQuery()"
            (input)="onSearchInput($event)"
            data-testid="session-search-local"
          />
          @if (searchQuery()) {
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-circle w-6 h-6 min-h-6 p-0"
              aria-label="Clear search"
              (click)="searchChange.emit('')"
              data-testid="session-search-local-clear"
            >
              <lucide-angular [img]="XIcon" class="w-3 h-3" aria-hidden="true" />
            </button>
          }
        </label>
      }

      <div class="flex items-center gap-1">
        <button
          type="button"
          class="btn btn-ghost btn-sm h-8 min-h-8 gap-1 px-1 justify-start text-base-content-muted hover:text-base-content"
          aria-label="Toggle date filter"
          [attr.aria-expanded]="dateFilterOpen()"
          [attr.aria-controls]="dateFilterOpen() ? datePanelId : null"
          (click)="dateFilterToggled.emit()"
          data-testid="session-date-toggle"
        >
          <lucide-angular
            [img]="CalendarDaysIcon"
            class="w-3 h-3"
            aria-hidden="true"
          />
          <span class="text-xs font-normal">Date range</span>
          <lucide-angular
            [img]="ChevronDownIcon"
            class="w-3 h-3 transition-transform duration-200"
            [class.rotate-180]="dateFilterOpen()"
            aria-hidden="true"
          />
        </button>
        @if (hasActiveFilters()) {
          <button
            type="button"
            class="btn btn-ghost btn-xs ml-auto px-1 text-xs text-base-content-muted hover:text-base-content"
            aria-label="Clear all filters"
            (click)="cleared.emit()"
            data-testid="session-clear-all"
          >
            Clear
          </button>
        }
      </div>

      @if (dateFilterOpen()) {
        <div
          [id]="datePanelId"
          class="grid grid-cols-2 gap-2 px-0.5 pb-0.5"
          data-testid="session-date-panel"
        >
          <div class="flex min-w-0 flex-col gap-1">
            <label
              [attr.for]="dateFromId"
              class="text-xs text-base-content-muted"
              >From</label
            >
            <input
              [id]="dateFromId"
              type="date"
              class="input input-sm rounded-lg h-8 min-h-8 w-full min-w-0 bg-surface-0 border-surface-border text-xs ${FOCUS_RING}"
              [value]="dateFrom()"
              (input)="onDateFromInput($event)"
              data-testid="session-date-from"
            />
          </div>
          <div class="flex min-w-0 flex-col gap-1">
            <label
              [attr.for]="dateToId"
              class="text-xs text-base-content-muted"
              >To</label
            >
            <input
              [id]="dateToId"
              type="date"
              class="input input-sm rounded-lg h-8 min-h-8 w-full min-w-0 bg-surface-0 border-surface-border text-xs ${FOCUS_RING}"
              [value]="dateTo()"
              (input)="onDateToInput($event)"
              data-testid="session-date-to"
            />
          </div>
        </div>
      }
    </div>
  `,
})
export class PreviousSessionsToolbarComponent {
  /** Organization host: filter bar instead of the local search. */
  readonly organizationAvailable = input(false);
  /** The server query; the filter bar's seed. */
  readonly listQuery = input<SessionListQuery>({});
  /** Local search text (plain hosts). */
  readonly searchQuery = input('');
  /** Inclusive start day, `YYYY-MM-DD`, or empty. */
  readonly dateFrom = input('');
  /** Inclusive end day, `YYYY-MM-DD`, or empty. */
  readonly dateTo = input('');
  readonly dateFilterOpen = input(false);
  /** Any search, filter or date is active: shows `Clear`. */
  readonly hasActiveFilters = input(false);

  /** The filter bar's settled query (organization hosts). */
  readonly queryChange = output<SessionListQuery>();
  /** Local search text as typed (plain hosts); `''` from the clear X. */
  readonly searchChange = output<string>();
  readonly dateFromChange = output<string>();
  readonly dateToChange = output<string>();
  /** The Date range toggle was pressed. */
  readonly dateFilterToggled = output<void>();
  /** `Clear` was pressed: clear search, filters and dates. */
  readonly cleared = output<void>();

  protected readonly SearchIcon = Search;
  protected readonly XIcon = X;
  protected readonly CalendarDaysIcon = CalendarDays;
  protected readonly ChevronDownIcon = ChevronDown;

  private readonly idSuffix = nextId++;
  protected readonly datePanelId = `session-date-panel-${this.idSuffix}`;
  protected readonly dateFromId = `session-date-from-${this.idSuffix}`;
  protected readonly dateToId = `session-date-to-${this.idSuffix}`;

  protected onSearchInput(event: Event): void {
    this.searchChange.emit((event.target as HTMLInputElement).value);
  }

  protected onDateFromInput(event: Event): void {
    this.dateFromChange.emit((event.target as HTMLInputElement).value);
  }

  protected onDateToInput(event: Event): void {
    this.dateToChange.emit((event.target as HTMLInputElement).value);
  }
}
