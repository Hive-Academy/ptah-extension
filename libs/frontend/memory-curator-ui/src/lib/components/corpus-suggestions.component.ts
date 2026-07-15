import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { CorpusSuggestion } from '@ptah-extension/shared';

/**
 * CorpusSuggestionsComponent
 *
 * Presentational "Suggested boards" strip for the Memory tab's corpus panel.
 * Renders deterministic corpus proposals (from `corpus:suggest`) as one-click
 * cards. Purely dumb: inputs in, `create` / `dismiss` events out. The smart
 * host ({@link CorpusListComponent}) feeds each suggestion's `filter` straight
 * into `corpus:build` on create.
 *
 * Renders NOTHING when there are no suggestions and we are not loading — the
 * strip must never leave an empty shell behind the corpus header.
 *
 * No `[innerHTML]`: all suggestion fields (names, concepts, rationale) are
 * AI-adjacent and rendered via plain interpolation only.
 */
@Component({
  selector: 'ptah-corpus-suggestions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    @if (loading()) {
      <section
        class="flex flex-col gap-2"
        aria-label="Loading suggested boards"
      >
        <span class="text-sm font-semibold">Suggested boards</span>
        <div class="flex flex-wrap gap-2">
          @for (n of skeletonCards; track n) {
            <div
              class="flex w-64 flex-col gap-2 rounded-xl border border-base-300 bg-base-200/40 px-4 py-3"
            >
              <div class="skeleton h-3 w-32"></div>
              <div class="skeleton h-2 w-20"></div>
              <div class="skeleton h-6 w-full"></div>
            </div>
          }
        </div>
      </section>
    } @else if (suggestions().length > 0) {
      <section class="flex flex-col gap-2" aria-label="Suggested boards">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-semibold">Suggested boards</span>
          <span class="text-xs text-base-content/60">
            One-click boards clustered from your memories.
          </span>
        </div>
        <div class="flex flex-wrap gap-2">
          @for (suggestion of suggestions(); track suggestion.suggestedName) {
            <article
              class="group flex w-64 flex-col gap-2 rounded-xl border border-base-300 bg-base-200/40 px-4 py-3 transition-colors duration-150 hover:bg-base-300/30"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">
                    {{ suggestion.suggestedName }}
                  </p>
                  <p class="text-xs text-base-content/60">
                    {{ suggestion.memberCount }}
                    {{ suggestion.memberCount === 1 ? 'memory' : 'memories' }}
                  </p>
                </div>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-circle"
                  (click)="dismiss.emit(suggestion)"
                  [attr.aria-label]="
                    'Dismiss suggestion ' + suggestion.suggestedName
                  "
                >
                  ×
                </button>
              </div>

              @if (suggestion.topConcepts.length > 0) {
                <div class="flex flex-wrap gap-1">
                  @for (concept of suggestion.topConcepts; track concept) {
                    <span class="badge badge-ghost badge-sm">{{
                      concept
                    }}</span>
                  }
                </div>
              }

              <p class="text-xs text-base-content/70">
                {{ suggestion.rationale }}
              </p>

              <button
                type="button"
                class="btn btn-primary btn-sm mt-1"
                [disabled]="busyName() === suggestion.suggestedName"
                (click)="create.emit(suggestion)"
                [attr.aria-label]="'Create board ' + suggestion.suggestedName"
              >
                @if (busyName() === suggestion.suggestedName) {
                  <span class="loading loading-spinner loading-xs"></span>
                }
                Create
              </button>
            </article>
          }
        </div>
      </section>
    }
  `,
})
export class CorpusSuggestionsComponent {
  public readonly suggestions = input<readonly CorpusSuggestion[]>([]);
  public readonly loading = input<boolean>(false);
  public readonly busyName = input<string | null>(null);

  public readonly create = output<CorpusSuggestion>();
  public readonly dismiss = output<CorpusSuggestion>();

  protected readonly skeletonCards = [0, 1, 2] as const;
}
