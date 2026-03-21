import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import {
  SortField,
  SessionWithCost,
} from '../../services/session-analytics-state.service';
import { formatCost, formatTokenCount } from '../../utils/format.utils';

/**
 * SessionHistoryTableComponent
 *
 * Presentational sortable table displaying session history with cost and token data.
 * Emits sort change and load-more events to the parent container.
 *
 * No service injection -- purely presentational component.
 */
@Component({
  selector: 'ptah-session-history-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div
      class="bg-base-200/50 rounded-lg border border-base-300 overflow-hidden"
    >
      <div class="overflow-x-auto">
        <table
          class="table table-sm w-full"
          role="table"
          aria-label="Session history"
        >
          <thead>
            <tr>
              <th
                class="cursor-pointer select-none text-[10px] uppercase tracking-wider text-base-content/50 font-normal"
                role="columnheader"
                tabindex="0"
                [attr.aria-sort]="getSortAria('name')"
                (click)="sortChanged.emit('name')"
                (keydown.enter)="sortChanged.emit('name')"
                (keydown.space)="onSortKeydown($event, 'name')"
              >
                Name {{ getSortIndicator('name') }}
              </th>
              <th
                class="cursor-pointer select-none text-[10px] uppercase tracking-wider text-base-content/50 font-normal"
                role="columnheader"
                tabindex="0"
                [attr.aria-sort]="getSortAria('lastActivityAt')"
                (click)="sortChanged.emit('lastActivityAt')"
                (keydown.enter)="sortChanged.emit('lastActivityAt')"
                (keydown.space)="onSortKeydown($event, 'lastActivityAt')"
              >
                Date {{ getSortIndicator('lastActivityAt') }}
              </th>
              <th
                class="cursor-pointer select-none text-right text-[10px] uppercase tracking-wider text-base-content/50 font-normal"
                role="columnheader"
                tabindex="0"
                [attr.aria-sort]="getSortAria('inputTokens')"
                (click)="sortChanged.emit('inputTokens')"
                (keydown.enter)="sortChanged.emit('inputTokens')"
                (keydown.space)="onSortKeydown($event, 'inputTokens')"
              >
                In Tokens {{ getSortIndicator('inputTokens') }}
              </th>
              <th
                class="cursor-pointer select-none text-right text-[10px] uppercase tracking-wider text-base-content/50 font-normal"
                role="columnheader"
                tabindex="0"
                [attr.aria-sort]="getSortAria('outputTokens')"
                (click)="sortChanged.emit('outputTokens')"
                (keydown.enter)="sortChanged.emit('outputTokens')"
                (keydown.space)="onSortKeydown($event, 'outputTokens')"
              >
                Out Tokens {{ getSortIndicator('outputTokens') }}
              </th>
              <th
                class="cursor-pointer select-none text-right text-[10px] uppercase tracking-wider text-base-content/50 font-normal"
                role="columnheader"
                tabindex="0"
                [attr.aria-sort]="getSortAria('estimatedCost')"
                (click)="sortChanged.emit('estimatedCost')"
                (keydown.enter)="sortChanged.emit('estimatedCost')"
                (keydown.space)="onSortKeydown($event, 'estimatedCost')"
              >
                Est. Cost {{ getSortIndicator('estimatedCost') }}
              </th>
              <th
                class="cursor-pointer select-none text-right text-[10px] uppercase tracking-wider text-base-content/50 font-normal"
                role="columnheader"
                tabindex="0"
                [attr.aria-sort]="getSortAria('messageCount')"
                (click)="sortChanged.emit('messageCount')"
                (keydown.enter)="sortChanged.emit('messageCount')"
                (keydown.space)="onSortKeydown($event, 'messageCount')"
              >
                Msgs {{ getSortIndicator('messageCount') }}
              </th>
            </tr>
          </thead>
          <tbody>
            @for (session of sessions(); track session.id) {
            <tr>
              <td class="max-w-[200px] truncate" [title]="session.name">
                {{ session.name }}
              </td>
              <td class="text-xs text-base-content/70">
                {{ formatDate(session.lastActivityAt) }}
              </td>
              <td class="font-mono text-xs text-right text-cyan-400">
                {{
                  session.tokenUsage
                    ? formatTokenCount(session.tokenUsage.input)
                    : '--'
                }}
              </td>
              <td class="font-mono text-xs text-right text-purple-400">
                {{
                  session.tokenUsage
                    ? formatTokenCount(session.tokenUsage.output)
                    : '--'
                }}
              </td>
              <td class="font-mono text-xs text-right text-success">
                {{
                  session.estimatedCost !== null
                    ? formatCost(session.estimatedCost)
                    : '--'
                }}
              </td>
              <td class="font-mono text-xs text-right">
                {{ session.messageCount }}
              </td>
            </tr>
            } @empty {
            <tr>
              <td colspan="6" class="text-center text-base-content/50 py-4">
                No sessions to display
              </td>
            </tr>
            }
          </tbody>
        </table>
      </div>
    </div>

    @if (hasMore()) {
    <div class="flex justify-center mt-4">
      <button
        class="btn btn-sm btn-outline"
        [disabled]="isLoadingMore()"
        (click)="loadMore.emit()"
      >
        @if (isLoadingMore()) {
        <span class="loading loading-spinner loading-sm"></span>
        Loading... } @else { Load More }
      </button>
    </div>
    }
  `,
})
export class SessionHistoryTableComponent {
  // Inputs
  readonly sessions = input.required<SessionWithCost[]>();
  readonly sortField = input.required<SortField>();
  readonly sortDirection = input.required<'asc' | 'desc'>();
  readonly hasMore = input.required<boolean>();
  readonly isLoadingMore = input.required<boolean>();

  // Outputs
  readonly sortChanged = output<SortField>();
  readonly loadMore = output<void>();

  readonly formatCost = formatCost;
  readonly formatTokenCount = formatTokenCount;

  /**
   * Handle Space keydown on sortable headers.
   * Prevents default scroll behavior and emits sort change.
   */
  onSortKeydown(event: Event, field: SortField): void {
    event.preventDefault();
    this.sortChanged.emit(field);
  }

  /**
   * Format a timestamp to a short date string (e.g., "Mar 15, 2026").
   */
  formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  /**
   * Get the sort indicator arrow for a given field.
   * Returns an up/down arrow for the active sort field, empty string otherwise.
   */
  getSortIndicator(field: SortField): string {
    if (this.sortField() !== field) return '';
    return this.sortDirection() === 'asc' ? '\u25B2' : '\u25BC';
  }

  /**
   * Get the aria-sort attribute value for a given field.
   * Returns 'ascending', 'descending', or null.
   */
  getSortAria(field: SortField): string | null {
    if (this.sortField() !== field) return null;
    return this.sortDirection() === 'asc' ? 'ascending' : 'descending';
  }
}
