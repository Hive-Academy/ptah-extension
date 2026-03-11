import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
  signal,
} from '@angular/core';
import { QualityGap, QualityGapPriority } from '@ptah-extension/shared';

/**
 * Sort direction type
 */
type SortDirection = 'asc' | 'desc';

/**
 * Priority ordering for sorting (higher number = higher priority)
 */
const PRIORITY_ORDER: Record<QualityGapPriority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * QualityGapsTableComponent
 *
 * Displays quality gaps in a DaisyUI zebra-striped table with
 * priority badges. Supports sorting by clicking the Priority column header.
 *
 * Columns: Area, Priority (badge), Description, Recommendation
 * Priority badges: high = badge-error, medium = badge-warning, low = badge-info
 */
@Component({
  selector: 'ptah-quality-gaps-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4">
        <h3 class="card-title text-sm font-semibold">Quality Gaps</h3>

        @if (gaps().length === 0) {
        <div
          class="text-base-content/50 text-sm py-4 text-center"
          role="status"
        >
          No quality gaps identified. Keep up the good work!
        </div>
        } @else {
        <div class="overflow-x-auto">
          <table class="table table-zebra table-sm" aria-label="Quality gaps">
            <thead>
              <tr>
                <th>Area</th>
                <th>
                  <button
                    class="flex items-center gap-1 hover:text-primary transition-colors"
                    (click)="toggleSort()"
                    aria-label="Sort by priority"
                  >
                    Priority @if (sortDirection() === 'desc') {
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="w-3 h-3"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                        clip-rule="evenodd"
                      />
                    </svg>
                    } @else {
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="w-3 h-3"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z"
                        clip-rule="evenodd"
                      />
                    </svg>
                    }
                  </button>
                </th>
                <th>Description</th>
                <th>Recommendation</th>
              </tr>
            </thead>
            <tbody>
              @for (gap of sortedGaps(); track gap.area + gap.description) {
              <tr>
                <td class="font-medium whitespace-nowrap">{{ gap.area }}</td>
                <td>
                  <span
                    [class]="
                      'badge badge-sm ' + getPriorityBadgeClass(gap.priority)
                    "
                  >
                    {{ gap.priority }}
                  </span>
                </td>
                <td class="text-sm">{{ gap.description }}</td>
                <td class="text-sm opacity-75">{{ gap.recommendation }}</td>
              </tr>
              }
            </tbody>
          </table>
        </div>
        }
      </div>
    </div>
  `,
})
export class QualityGapsTableComponent {
  readonly gaps = input.required<QualityGap[]>();

  readonly sortDirection = signal<SortDirection>('desc');

  /**
   * Gaps sorted by priority. Default sort is descending (high first).
   */
  readonly sortedGaps = computed(() => {
    const items = [...this.gaps()];
    const direction = this.sortDirection();

    return items.sort((a, b) => {
      const aOrder = PRIORITY_ORDER[a.priority] ?? 0;
      const bOrder = PRIORITY_ORDER[b.priority] ?? 0;
      return direction === 'desc' ? bOrder - aOrder : aOrder - bOrder;
    });
  });

  /**
   * Toggle sort direction between ascending and descending
   */
  toggleSort(): void {
    this.sortDirection.set(this.sortDirection() === 'desc' ? 'asc' : 'desc');
  }

  /**
   * Map priority to DaisyUI badge class
   */
  getPriorityBadgeClass(priority: QualityGapPriority): string {
    switch (priority) {
      case 'high':
        return 'badge-error';
      case 'medium':
        return 'badge-warning';
      case 'low':
        return 'badge-info';
    }
  }
}
