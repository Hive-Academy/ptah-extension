import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  Brain,
  LucideAngularModule,
  Pin,
  PinOff,
  Trash2,
} from 'lucide-angular';

import type { MemoryWire } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-memory-entry-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, LucideAngularModule],
  template: `
    <section aria-label="Memory entries">
      @if (loading() && entries().length === 0) {
        <div
          class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
        >
          <div class="divide-y divide-base-300/70">
            @for (n of skeletonRows; track n) {
              <div class="flex items-start gap-3 px-4 py-3">
                <div class="skeleton mt-1.5 size-1.5 rounded-full"></div>
                <div class="flex flex-1 flex-col gap-2">
                  <div class="skeleton h-3 w-40"></div>
                  <div class="skeleton h-3 w-full"></div>
                </div>
              </div>
            }
          </div>
        </div>
      } @else if (entries().length === 0) {
        <div class="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <lucide-angular
            [img]="BrainIcon"
            class="size-8 text-base-content/30"
            aria-hidden="true"
          />
          <p class="text-sm font-medium">No memories yet</p>
          <p class="text-xs text-base-content/60">
            Thoth captures facts and decisions as you chat. Keep working and
            they'll appear here.
          </p>
        </div>
      } @else {
        <ul
          class="divide-y divide-base-300/70 overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
        >
          @for (entry of entries(); track entry.id) {
            <li
              data-testid="memory-entry-row"
              class="group flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-base-300/30"
            >
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span
                    class="inline-block size-1.5 rounded-full"
                    [class.bg-primary]="entry.tier === 'core'"
                    [class.bg-info]="entry.tier === 'recall'"
                    [class.bg-base-content/30]="entry.tier === 'archival'"
                    aria-hidden="true"
                  ></span>
                  <span class="text-xs text-base-content/60">
                    {{ entry.tier }} · {{ entry.kind }} ·
                    {{ entry.salience.toFixed(2) }}
                  </span>
                  @if (entry.pinned) {
                    <span class="inline-flex items-center gap-1 text-warning">
                      <lucide-angular
                        [img]="PinIcon"
                        class="size-3"
                        aria-hidden="true"
                      />
                      <span class="text-xs">pinned</span>
                    </span>
                  }
                </div>
                @if (entry.subject) {
                  <div class="mt-1 text-sm font-medium text-base-content">
                    {{ entry.subject }}
                  </div>
                }
                <div class="mt-0.5 line-clamp-2 text-sm text-base-content/70">
                  {{ entry.content }}
                </div>
              </div>
              <div
                class="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
              >
                @if (entry.pinned) {
                  <button
                    type="button"
                    data-testid="memory-entry-unpin"
                    class="btn btn-ghost btn-xs btn-square text-base-content/50"
                    (click)="unpin.emit(entry.id)"
                    [attr.aria-label]="'Unpin entry ' + entry.id"
                  >
                    <lucide-angular
                      [img]="PinOffIcon"
                      class="size-3.5"
                      aria-hidden="true"
                    />
                  </button>
                } @else {
                  <button
                    type="button"
                    data-testid="memory-entry-pin"
                    class="btn btn-ghost btn-xs btn-square text-base-content/50"
                    (click)="pin.emit(entry.id)"
                    [attr.aria-label]="'Pin entry ' + entry.id"
                  >
                    <lucide-angular
                      [img]="PinIcon"
                      class="size-3.5"
                      aria-hidden="true"
                    />
                  </button>
                }
                <button
                  type="button"
                  data-testid="memory-entry-forget"
                  class="btn btn-ghost btn-xs btn-square text-base-content/50 hover:text-error"
                  (click)="forget.emit(entry.id)"
                  [attr.aria-label]="'Forget entry ' + entry.id"
                >
                  <lucide-angular
                    [img]="Trash2Icon"
                    class="size-3.5"
                    aria-hidden="true"
                  />
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

  protected readonly BrainIcon = Brain;
  protected readonly PinIcon = Pin;
  protected readonly PinOffIcon = PinOff;
  protected readonly Trash2Icon = Trash2;
  protected readonly skeletonRows = [0, 1, 2, 3] as const;
}
