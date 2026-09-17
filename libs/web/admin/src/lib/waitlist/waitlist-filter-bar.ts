import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, RotateCcw, Search } from 'lucide-angular';

import {
  SortOrder,
  WAITLIST_PAGE_SIZES,
  WAITLIST_SORT_FIELDS,
  WAITLIST_SOURCES,
  WaitlistPageSize,
  WaitlistSortField,
  WaitlistSource,
} from './waitlist-query-state';

@Component({
  selector: 'ptah-admin-waitlist-filter-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  templateUrl: './waitlist-filter-bar.html',
})
export class WaitlistFilterBar {
  public readonly search = input<string>('');
  public readonly source = input<WaitlistSource | undefined>(undefined);
  public readonly createdFrom = input<string | undefined>(undefined);
  public readonly createdTo = input<string | undefined>(undefined);
  public readonly sortBy = input<WaitlistSortField>('createdAt');
  public readonly sortOrder = input<SortOrder>('desc');
  public readonly pageSize = input<WaitlistPageSize>(25);
  public readonly invalidDateError = input<string | null>(null);

  public readonly searchChange = output<string>();
  public readonly sourceChange = output<WaitlistSource | undefined>();
  public readonly createdFromChange = output<string | undefined>();
  public readonly createdToChange = output<string | undefined>();
  public readonly sortByChange = output<WaitlistSortField>();
  public readonly sortOrderChange = output<SortOrder>();
  public readonly pageSizeChange = output<WaitlistPageSize>();
  public readonly cleared = output<void>();

  protected readonly SearchIcon = Search;
  protected readonly RotateCcwIcon = RotateCcw;

  protected readonly availableSources = WAITLIST_SOURCES;
  protected readonly availableSortFields = WAITLIST_SORT_FIELDS;
  protected readonly availablePageSizes = WAITLIST_PAGE_SIZES;

  protected readonly fromDateValue = computed<string>(() => {
    const raw = this.createdFrom();
    return raw ? raw.slice(0, 10) : '';
  });

  protected readonly toDateValue = computed<string>(() => {
    const raw = this.createdTo();
    return raw ? raw.slice(0, 10) : '';
  });

  protected readonly localDateError = computed<string | null>(() => {
    const from = this.createdFrom();
    const to = this.createdTo();
    if (from && to && from > to) {
      return 'createdFrom must be before or equal to createdTo';
    }
    return this.invalidDateError();
  });

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchChange.emit(value);
  }

  protected onSourceSelect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const source = (this.availableSources as readonly string[]).includes(value)
      ? (value as WaitlistSource)
      : undefined;
    this.sourceChange.emit(source);
  }

  protected onFromDateChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.createdFromChange.emit(val ? `${val}T00:00:00.000Z` : undefined);
  }

  protected onToDateChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.createdToChange.emit(val ? `${val}T23:59:59.999Z` : undefined);
  }

  protected onSortBySelect(event: Event): void {
    const val = (event.target as HTMLSelectElement).value as WaitlistSortField;
    if ((this.availableSortFields as readonly string[]).includes(val)) {
      this.sortByChange.emit(val);
    }
  }

  protected onSortOrderSelect(event: Event): void {
    const val = (event.target as HTMLSelectElement).value as SortOrder;
    if (val === 'asc' || val === 'desc') {
      this.sortOrderChange.emit(val);
    }
  }

  protected onPageSizeSelect(event: Event): void {
    const parsed = parseInt((event.target as HTMLSelectElement).value, 10);
    if ((this.availablePageSizes as readonly number[]).includes(parsed)) {
      this.pageSizeChange.emit(parsed as WaitlistPageSize);
    }
  }

  protected onClear(): void {
    this.cleared.emit();
  }
}
