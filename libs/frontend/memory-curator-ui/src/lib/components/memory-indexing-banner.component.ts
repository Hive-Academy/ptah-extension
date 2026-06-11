import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';

import type { IndexingUiState } from '@ptah-extension/workspace-indexing';

@Component({
  selector: 'ptah-memory-indexing-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    @let banner = state();
    @switch (banner.kind) {
      @case ('never-indexed') {
        <div
          class="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3"
          role="status"
          data-testid="memory-banner-never-indexed"
        >
          <div class="flex flex-1 flex-col gap-0.5">
            <span class="text-sm font-semibold">
              Your workspace isn't indexed yet
            </span>
            <span class="text-xs text-base-content/60">
              Memory search and code navigation need a local index. Files are
              read on your machine; nothing is uploaded.
            </span>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            [disabled]="!hasWorkspace() || busy()"
            (click)="indexNow.emit()"
            aria-label="Index workspace now"
          >
            @if (busy()) {
              <span class="loading loading-spinner loading-xs"></span>
            }
            Index now
          </button>
        </div>
      }
      @case ('code-only-no-memory') {
        <div
          class="flex flex-col gap-0.5 rounded-xl border border-info/40 bg-info/5 px-4 py-3"
          role="status"
          data-testid="memory-banner-code-only"
        >
          <span class="text-sm font-semibold">
            Code index ready — chat to populate memory
          </span>
          <span class="text-xs text-base-content/60">
            Your codebase is indexed for symbol search ({{
              banner.codeSymbolCount
            }}
            symbols). Memory entries will appear here after your next qualifying
            conversation (5+ turns).
          </span>
        </div>
      }
      @case ('indexing') {
        <div
          class="flex flex-wrap items-center gap-3 rounded-xl border border-base-300 bg-base-200/40 px-4 py-3"
          role="status"
          data-testid="memory-banner-indexing"
        >
          <div class="flex flex-1 flex-col gap-1">
            <span class="text-sm font-semibold">
              Indexing workspace… {{ banner.percent }}%
            </span>
            @if (banner.totalKnown) {
              <progress
                class="progress progress-primary h-1.5 w-full"
                [value]="banner.percent"
                max="100"
              ></progress>
            } @else {
              <progress
                class="progress progress-primary h-1.5 w-full"
              ></progress>
            }
          </div>
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            (click)="cancelIndex.emit()"
            aria-label="Cancel indexing"
          >
            Cancel
          </button>
        </div>
      }
      @case ('paused') {
        <div
          class="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3"
          role="status"
          data-testid="memory-banner-paused"
        >
          <span class="flex-1 text-sm">
            Indexing paused at {{ banner.percent }}%.
          </span>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            (click)="resumeIndex.emit()"
          >
            Resume
          </button>
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            (click)="cancelIndex.emit()"
          >
            Cancel
          </button>
        </div>
      }
      @case ('stale') {
        <div
          class="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/5 px-4 py-3"
          role="status"
          data-testid="memory-banner-stale"
        >
          <span class="flex-1 text-sm">
            Workspace changed since last index — re-index to keep memory search
            accurate.
          </span>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            (click)="indexNow.emit()"
          >
            Re-index
          </button>
        </div>
      }
      @case ('error') {
        <div
          class="flex flex-wrap items-center gap-3 rounded-xl border border-error/40 bg-error/5 px-4 py-3"
          role="status"
          data-testid="memory-banner-error"
        >
          <span class="flex-1 text-sm text-error">
            Indexing failed: {{ banner.message }}
          </span>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            (click)="indexNow.emit()"
          >
            Try again
          </button>
        </div>
      }
    }
  `,
})
export class MemoryIndexingBannerComponent {
  public readonly state = input.required<IndexingUiState>();
  public readonly hasWorkspace = input<boolean>(false);
  public readonly busy = input<boolean>(false);

  public readonly indexNow = output<void>();
  public readonly resumeIndex = output<void>();
  public readonly cancelIndex = output<void>();
}
