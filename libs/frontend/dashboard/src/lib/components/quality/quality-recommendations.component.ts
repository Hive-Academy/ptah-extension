import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import { Recommendation } from '@ptah-extension/shared';

/**
 * QualityRecommendationsComponent
 *
 * Displays a prioritized list of quality recommendations.
 * Each recommendation is shown in a DaisyUI card with priority badge,
 * category label, issue description, solution, and optional example files.
 *
 * Recommendations are displayed in priority order (lowest number = highest priority).
 */
@Component({
  selector: 'ptah-quality-recommendations',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card bg-base-100 shadow-sm">
      <div class="card-body p-4">
        <h3 class="card-title text-sm font-semibold">Recommendations</h3>

        @if (recommendations().length === 0) {
        <div
          class="text-base-content/50 text-sm py-4 text-center"
          role="status"
        >
          No recommendations at this time.
        </div>
        } @else {
        <div
          class="space-y-3 mt-2"
          role="list"
          aria-label="Quality recommendations"
        >
          @for (rec of sortedRecommendations(); track rec.priority + rec.issue;
          let i = $index) {
          <div class="border border-base-300 rounded-lg p-3" role="listitem">
            <div class="flex items-start gap-3">
              <span
                class="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                [class]="getPriorityCircleClass(rec.priority)"
                [attr.aria-label]="'Priority ' + rec.priority"
              >
                {{ i + 1 }}
              </span>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="badge badge-sm badge-outline">
                    {{ rec.category }}
                  </span>
                </div>
                <p class="text-sm font-medium">{{ rec.issue }}</p>
                <p class="text-sm opacity-70 mt-1">{{ rec.solution }}</p>

                @if (rec.exampleFiles && rec.exampleFiles.length > 0) {
                <div class="mt-2">
                  <span class="text-xs opacity-50">Example files:</span>
                  <div class="flex flex-wrap gap-1 mt-1">
                    @for (file of rec.exampleFiles; track file) {
                    <span class="badge badge-sm badge-ghost font-mono text-xs">
                      {{ shortenPath(file) }}
                    </span>
                    }
                  </div>
                </div>
                }
              </div>
            </div>
          </div>
          }
        </div>
        }
      </div>
    </div>
  `,
})
export class QualityRecommendationsComponent {
  readonly recommendations = input.required<Recommendation[]>();

  /**
   * Sort recommendations by priority (ascending: 1, 2, 3...)
   */
  readonly sortedRecommendations = computed(() => {
    return [...this.recommendations()].sort((a, b) => a.priority - b.priority);
  });

  /**
   * Map numeric priority to visual styling.
   * Priority 1-2: error (most critical)
   * Priority 3-4: warning
   * Priority 5+: info
   */
  getPriorityCircleClass(priority: number): string {
    if (priority <= 2) return 'bg-error text-error-content';
    if (priority <= 4) return 'bg-warning text-warning-content';
    return 'bg-info text-info-content';
  }

  /**
   * Shorten file paths for display. Shows the last 2-3 path segments
   * to keep the display compact while maintaining identifiability.
   */
  shortenPath(filePath: string): string {
    const segments = filePath.replace(/\\/g, '/').split('/');
    if (segments.length <= 3) return filePath;
    return '...' + '/' + segments.slice(-3).join('/');
  }
}
