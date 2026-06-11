import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import type { MemoryWire } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-memory-entry-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <section class="flex-1 overflow-auto" aria-label="Memory entries">
      @if (loading() && entries().length === 0) {
        <div class="flex items-center justify-center py-8">
          <span class="loading loading-spinner loading-md"></span>
        </div>
      } @else if (entries().length === 0) {
        <div
          class="rounded-lg border border-dashed border-base-300 p-6 text-center text-sm text-base-content/60"
        >
          No memory entries match the current filter.
        </div>
      } @else {
        <ul class="flex flex-col gap-2">
          @for (entry of entries(); track entry.id) {
            <li
              data-testid="memory-entry-row"
              class="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-100 p-3 md:flex-row md:items-start"
            >
              <div class="flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    class="badge badge-sm"
                    [class]="tierBadgeClass(entry.tier)"
                  >
                    {{ entry.tier }}
                  </span>
                  <span class="badge badge-sm badge-ghost">
                    {{ entry.kind }}
                  </span>
                  @if (entry.pinned) {
                    <span class="badge badge-sm badge-warning">pinned</span>
                  }
                  <span class="text-xs text-base-content/60">
                    score {{ entry.salience.toFixed(2) }}
                  </span>
                </div>
                @if (entry.subject) {
                  <div class="mt-1 text-sm font-medium text-base-content">
                    {{ entry.subject }}
                  </div>
                }
                <div class="mt-1 line-clamp-3 text-sm text-base-content/80">
                  {{ entry.content }}
                </div>
              </div>
              <div class="flex shrink-0 gap-1">
                @if (entry.pinned) {
                  <button
                    type="button"
                    data-testid="memory-entry-unpin"
                    class="btn btn-xs btn-ghost"
                    (click)="unpin.emit(entry.id)"
                    [attr.aria-label]="'Unpin entry ' + entry.id"
                  >
                    Unpin
                  </button>
                } @else {
                  <button
                    type="button"
                    data-testid="memory-entry-pin"
                    class="btn btn-xs btn-ghost"
                    (click)="pin.emit(entry.id)"
                    [attr.aria-label]="'Pin entry ' + entry.id"
                  >
                    Pin
                  </button>
                }
                <button
                  type="button"
                  data-testid="memory-entry-forget"
                  class="btn btn-xs btn-ghost text-error"
                  (click)="forget.emit(entry.id)"
                  [attr.aria-label]="'Forget entry ' + entry.id"
                >
                  Forget
                </button>
              </div>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class MemoryEntryListComponent {
  public readonly entries = input.required<readonly MemoryWire[]>();
  public readonly loading = input<boolean>(false);

  public readonly pin = output<string>();
  public readonly unpin = output<string>();
  public readonly forget = output<string>();

  protected tierBadgeClass(tier: MemoryWire['tier']): string {
    switch (tier) {
      case 'core':
        return 'badge-primary';
      case 'recall':
        return 'badge-info';
      case 'archival':
        return 'badge-neutral';
    }
  }
}
