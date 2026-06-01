import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { MemoryIndexRow } from '@ptah-extension/shared';

import { TimelineStateService } from '../services/timeline-state.service';

import { TimelineFiltersComponent } from './timeline-filters.component';

/**
 * TimelineViewComponent
 *
 * Smart container for the Memory tab's Timeline view. Renders the filter
 * strip + a scrollable list of {@link MemoryIndexRow} compact rows fetched
 * via {@link TimelineStateService}. Drilling on a row replaces the list
 * with the `mem:timeline` neighbour window.
 *
 * Layer-1 / Layer-2 path of the progressive-disclosure design (the full
 * memory content lives behind `mem:getObservations`, surfaced by the parent
 * tab's detail pane — out of scope here).
 */
@Component({
  selector: 'ptah-timeline-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, TimelineFiltersComponent],
  template: `
    <div class="flex h-full w-full flex-col gap-3">
      <ptah-timeline-filters />

      @if (state.error()) {
        <div role="alert" class="alert alert-error">
          <span class="text-sm">{{ state.error() }}</span>
        </div>
      }

      @if (state.anchorId() !== null) {
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="text-base-content/70">
            Anchored on
            <span class="font-mono">{{ state.anchorId() }}</span>
          </span>
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            (click)="onClearAnchor()"
            aria-label="Clear timeline anchor"
          >
            Clear anchor
          </button>
        </div>
      }

      <section class="flex-1 overflow-auto" aria-label="Memory timeline rows">
        @if (state.loading() && state.rows().length === 0) {
          <div class="flex items-center justify-center py-8">
            <span class="loading loading-spinner loading-md"></span>
          </div>
        } @else if (state.rows().length === 0) {
          <div
            class="rounded-lg border border-dashed border-base-300 p-6 text-center text-sm text-base-content/60"
          >
            No memories match the current filters. Try widening the date range
            or removing concept/file filters.
          </div>
        } @else {
          <ul class="flex flex-col gap-2">
            @for (row of state.rows(); track row.id) {
              <li
                class="flex flex-col gap-1 rounded-lg border border-base-300 bg-base-100 p-3"
                [class.bg-base-200]="row.id === state.anchorId()"
              >
                <div class="flex flex-wrap items-center gap-2 text-xs">
                  <span class="badge badge-sm badge-info">{{ row.type }}</span>
                  <span class="text-base-content/60">
                    {{ formatCapturedAt(row.capturedAt) }}
                  </span>
                  <span class="text-base-content/60">
                    score {{ row.score.toFixed(2) }}
                  </span>
                  <div class="ml-auto flex gap-1">
                    <button
                      type="button"
                      class="btn btn-xs btn-ghost"
                      (click)="onDrill(row.id)"
                      [attr.aria-label]="'Drill into timeline for ' + row.id"
                    >
                      Timeline
                    </button>
                  </div>
                </div>
                @if (row.subject !== null) {
                  <div class="text-sm font-medium text-base-content">
                    {{ row.subject }}
                  </div>
                }
                @if (row.concepts.length > 0) {
                  <div class="flex flex-wrap gap-1">
                    @for (concept of row.concepts; track concept) {
                      <span class="badge badge-xs badge-ghost">
                        {{ concept }}
                      </span>
                    }
                  </div>
                }
                @if (row.files.length > 0) {
                  <div
                    class="line-clamp-1 font-mono text-xs text-base-content/70"
                  >
                    {{ row.files.join(', ') }}
                  </div>
                }
              </li>
            }
          </ul>
        }
      </section>

      @if (state.rows().length > 0 && !state.exhausted()) {
        <div class="flex justify-center pb-2">
          <button
            type="button"
            class="btn btn-sm btn-outline"
            [disabled]="state.loading()"
            (click)="onLoadMore()"
            aria-label="Load more timeline rows"
          >
            @if (state.loading()) {
              <span class="loading loading-spinner loading-xs"></span>
            }
            Load more
          </button>
        </div>
      }
    </div>
  `,
})
export class TimelineViewComponent implements OnInit {
  protected readonly state = inject(TimelineStateService);

  public ngOnInit(): void {
    if (this.state.rows().length === 0) {
      void this.state.search();
    }
  }

  protected onDrill(id: string): void {
    void this.state.drillToTimeline(id);
  }

  protected onLoadMore(): void {
    void this.state.loadMore();
  }

  protected onClearAnchor(): void {
    this.state.setAnchorId(null);
    void this.state.search();
  }

  protected formatCapturedAt(ms: number): string {
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return String(ms);
    }
  }

  protected trackRow(_index: number, row: MemoryIndexRow): string {
    return row.id;
  }
}
