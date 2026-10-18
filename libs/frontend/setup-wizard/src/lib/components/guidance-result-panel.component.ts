import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { GuidanceCommittedResult } from '../services/guidance-generation.store';

@Component({
  selector: 'ptah-guidance-result-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-lg border border-base-300 bg-base-200 p-4"
      aria-labelledby="guidance-result-title"
    >
      <h2 id="guidance-result-title" class="font-semibold">Saved guidance</h2>
      @if (result(); as saved) {
        <p class="text-sm">
          Last saved: {{ saved.generatedAt || 'Date unavailable' }}
        </p>
        <p class="text-sm text-base-content-muted">
          {{ saved.cacheValid ? 'Cache is current' : 'Cache needs refreshing' }}
        </p>
        <label class="label cursor-pointer justify-start gap-2">
          <input
            #enabledToggle
            type="checkbox"
            class="toggle toggle-primary"
            [checked]="saved.enabled"
            (change)="enabledChanged.emit(enabledToggle.checked)"
            aria-label="Enable project guidance"
          />
          <span>Use project guidance</span>
        </label>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="btn btn-outline btn-sm"
            (click)="cacheRequested.emit()"
          >
            Refresh cache status
          </button>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            (click)="contentRequested.emit()"
          >
            View content
          </button>
          <button
            type="button"
            class="btn btn-outline btn-sm"
            (click)="downloadRequested.emit()"
          >
            Download
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            (click)="regenerateRequested.emit()"
          >
            Regenerate guidance
          </button>
        </div>
      } @else {
        <p class="text-sm text-base-content-muted">
          No saved guidance is available yet.
        </p>
      }
      @if (showSkip()) {
        <button
          type="button"
          class="btn btn-ghost btn-sm mt-2"
          (click)="skipRequested.emit()"
        >
          Skip guidance
        </button>
      }
    </section>
  `,
})
export class GuidanceResultPanelComponent {
  readonly showSkip = input(false);
  readonly result = input<GuidanceCommittedResult | null>(null);
  readonly enabledChanged = output<boolean>();
  readonly cacheRequested = output<void>();
  readonly contentRequested = output<void>();
  readonly downloadRequested = output<void>();
  readonly regenerateRequested = output<void>();
  readonly skipRequested = output<void>();
}
