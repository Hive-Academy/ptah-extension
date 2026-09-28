import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  viewChildren,
} from '@angular/core';
import { LucideAngularModule, Search, X } from 'lucide-angular';
import type { McpServerOrigin } from '@ptah-extension/shared';

import type {
  ProviderFilter,
  ProviderFilterOptions,
} from '../data/provider-filtering';
import {
  ProviderFilterSelectComponent,
  type FilterSelectOption,
} from './provider-filter-select.component';
import { statusPresentation } from './status-pill.component';

/** One origin radio. `value: null` is "All". */
interface OriginChoice {
  readonly value: McpServerOrigin | null;
  readonly label: string;
  readonly count: number;
}

/**
 * The filter bar above a server list (plan C8 `ProviderFilters`): a search
 * field, an origin segmented control and target / status dropdowns.
 *
 * Filters are not navigation: every control is a button or an input, none is
 * a link, and nothing here touches the router. The page holds the
 * `ProviderFilter` in a signal and passes it back in; each change emits the
 * whole next filter.
 *
 * - Search is an `input[type="search"]`, which the shell's `/` shortcut finds
 *   (Batch 12 contract).
 * - Origin is a `role="radiogroup"` with roving focus: arrow keys move and
 *   choose, only the checked radio is in the tab order.
 * - Status words come from `statusPresentation()` — the pill's words, never
 *   a second mapping.
 *
 * @example
 * ```html
 * <ptah-provider-filters
 *   [filter]="filter()"
 *   [options]="filterOptions()"
 *   (filterChange)="filter.set($event)"
 * />
 * ```
 */
@Component({
  selector: 'ptah-provider-filters',
  standalone: true,
  imports: [LucideAngularModule, ProviderFilterSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div
      class="flex flex-wrap items-center gap-2"
      data-testid="provider-filters"
    >
      <label
        class="input input-sm input-bordered flex min-w-48 flex-1 items-center gap-2"
      >
        <lucide-angular
          [img]="SearchIcon"
          class="h-3.5 w-3.5 text-base-content-muted"
          aria-hidden="true"
        />
        <input
          #searchBox
          type="search"
          class="grow bg-transparent"
          [attr.aria-label]="searchLabel()"
          [placeholder]="searchPlaceholder()"
          [value]="filter().search ?? ''"
          data-testid="provider-filter-search"
          (input)="update({ search: searchBox.value })"
        />
      </label>

      @if (showOrigin()) {
        <div
          role="radiogroup"
          aria-label="Filter by origin"
          class="join"
          data-testid="provider-filter-origin"
        >
          @for (choice of originChoices(); track choice.value; let i = $index) {
            <button
              #originRadio
              type="button"
              role="radio"
              class="btn join-item btn-sm gap-1 font-normal"
              [class.btn-active]="choice.value === currentOrigin()"
              [attr.aria-checked]="choice.value === currentOrigin()"
              [attr.tabindex]="choice.value === currentOrigin() ? 0 : -1"
              [attr.data-origin]="choice.value ?? 'all'"
              (click)="chooseOrigin(choice.value)"
              (keydown)="onOriginKeydown($event, i)"
            >
              {{ choice.label }}
              <span class="text-[10px] tabular-nums opacity-70">{{
                choice.count
              }}</span>
            </button>
          }
        </div>
      }

      <ptah-provider-filter-select
        label="Target"
        testId="provider-filter-target"
        [options]="targetChoices()"
        [value]="filter().target ?? null"
        (valueChange)="setTarget($event)"
      />
      <ptah-provider-filter-select
        label="Status"
        testId="provider-filter-status"
        [options]="statusChoices()"
        [value]="filter().status ?? null"
        (valueChange)="setStatus($event)"
      />

      @if (active()) {
        <button
          type="button"
          class="btn btn-ghost btn-sm gap-1"
          data-testid="provider-filter-clear"
          (click)="clear()"
        >
          <lucide-angular
            [img]="ClearIcon"
            class="h-3.5 w-3.5"
            aria-hidden="true"
          />
          Clear filters
        </button>
      }
    </div>
  `,
})
export class ProviderFiltersComponent {
  /** The filter in force. */
  public readonly filter = input.required<ProviderFilter>();

  /** What each control can offer (`providerFilterOptions(rows)`). */
  public readonly options = input.required<ProviderFilterOptions>();

  /** Accessible name of the search field. @default 'Search servers' */
  public readonly searchLabel = input<string>('Search servers');

  /** Placeholder of the search field. */
  public readonly searchPlaceholder = input<string>('Search servers…');

  /**
   * Show the origin control. A page that already scopes by origin hides it.
   * @default true
   */
  public readonly showOrigin = input<boolean>(true);

  /** The next filter after any change. */
  public readonly filterChange = output<ProviderFilter>();

  protected readonly SearchIcon = Search;
  protected readonly ClearIcon = X;

  private readonly originRadios =
    viewChildren<ElementRef<HTMLButtonElement>>('originRadio');

  protected readonly currentOrigin = computed(
    () => this.filter().origin ?? null,
  );

  /**
   * "All" plus each origin present. An origin the filter holds but no row
   * carries any more stays listed (count 0), so the checked radio never
   * vanishes while it filters everything out.
   */
  protected readonly originChoices = computed((): OriginChoice[] => {
    const origins = this.options().origins;
    const total = origins.reduce((sum, origin) => sum + origin.count, 0);
    const choices: OriginChoice[] = [
      { value: null, label: 'All', count: total },
      ...origins,
    ];
    const current = this.currentOrigin();
    if (current !== null && !origins.some((o) => o.value === current)) {
      choices.push({ value: current, label: current, count: 0 });
    }
    return choices;
  });

  protected readonly targetChoices = computed((): FilterSelectOption[] =>
    withHeldValue(
      [
        { value: null, label: 'Any target', count: null, icon: null },
        ...this.options().targets.map((target) => ({
          value: target.value,
          label: target.label,
          count: target.count,
          icon: null,
        })),
      ],
      this.filter().target ?? null,
    ),
  );

  protected readonly statusChoices = computed((): FilterSelectOption[] => {
    const held = this.filter().status ?? null;
    return withHeldValue(
      [
        { value: null, label: 'Any status', count: null, icon: null },
        ...this.options().statuses.map((status) => {
          const presentation = statusPresentation(status.value);
          return {
            value: status.value,
            label: presentation.label,
            count: status.count,
            icon: presentation.icon,
          };
        }),
      ],
      held,
      held === null ? '' : statusPresentation(held).label,
    );
  });

  /** Any filter or search term in force. */
  protected readonly active = computed(() => {
    const filter = this.filter();
    return (
      (filter.search ?? '').trim() !== '' ||
      !!filter.origin ||
      !!filter.target ||
      !!filter.status
    );
  });

  protected update(change: Partial<ProviderFilter>): void {
    this.filterChange.emit({ ...this.filter(), ...change });
  }

  protected chooseOrigin(origin: McpServerOrigin | null): void {
    if (origin !== this.currentOrigin()) this.update({ origin });
  }

  protected setTarget(value: string | null): void {
    const target = this.options().targets.find((t) => t.value === value);
    this.update({ target: target?.value ?? null });
  }

  protected setStatus(value: string | null): void {
    const status = this.options().statuses.find((s) => s.value === value);
    this.update({ status: status?.value ?? null });
  }

  protected clear(): void {
    this.filterChange.emit({
      search: '',
      origin: null,
      target: null,
      status: null,
    });
  }

  /** Radio-group keys: arrows move and choose (wrapping), Home/End jump. */
  protected onOriginKeydown(event: KeyboardEvent, index: number): void {
    const choices = this.originChoices();
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % choices.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index - 1 + choices.length) % choices.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = choices.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.originRadios()[next]?.nativeElement.focus();
    this.chooseOrigin(choices[next].value);
  }
}

/**
 * `options` plus the held value when no option carries it (its rows are
 * gone), so the trigger never shows "any" while a filter is in force.
 * Labelled `heldLabel`, else by its raw id.
 */
function withHeldValue(
  options: FilterSelectOption[],
  held: string | null,
  heldLabel = '',
): FilterSelectOption[] {
  if (held === null || options.some((option) => option.value === held)) {
    return options;
  }
  return [
    ...options,
    { value: held, label: heldLabel || held, count: 0, icon: null },
  ];
}
