import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { ArchitecturePattern } from '@ptah-extension/shared';

/**
 * ArchitecturePatternsCardComponent - Displays detected architecture patterns with confidence scores
 *
 * Purpose:
 * - Show detected architectural patterns (DDD, Layered, Microservices, etc.)
 * - Display confidence scores with progress bars
 * - Show pattern descriptions and evidence
 *
 * Features:
 * - Confidence badge with color coding (success >= 80, warning >= 60, error < 60)
 * - Progress bar visualization of confidence
 * - Collapsible evidence details
 *
 * Usage:
 * ```html
 * <ptah-architecture-patterns-card [patterns]="analysis.architecturePatterns" />
 * ```
 */
@Component({
  selector: 'ptah-architecture-patterns-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card bg-base-200 shadow-xl mb-6">
      <div class="card-body">
        <h3 class="card-title text-xl mb-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
          Architecture Patterns Detected
        </h3>

        <div class="space-y-4">
          @for (pattern of patterns; track pattern.name) {
          <div class="p-4 bg-base-100 rounded-lg">
            <div class="flex justify-between items-center mb-2">
              <span class="font-semibold">{{ pattern.name }}</span>
              <span
                class="badge"
                [class]="getConfidenceBadgeClass(pattern.confidence)"
              >
                {{ pattern.confidence }}% confidence
              </span>
            </div>
            <progress
              class="progress w-full"
              [class]="getConfidenceProgressClass(pattern.confidence)"
              [value]="pattern.confidence"
              max="100"
              [attr.aria-label]="
                pattern.name + ' confidence: ' + pattern.confidence + ' percent'
              "
            ></progress>
            @if (pattern.description) {
            <p class="text-sm text-base-content/70 mt-2">
              {{ pattern.description }}
            </p>
            } @if (pattern.evidence && pattern.evidence.length > 0) {
            <div class="mt-2">
              <span class="text-xs text-base-content/60">Evidence: </span>
              <span class="text-xs text-base-content/60">{{
                pattern.evidence.slice(0, 3).join(', ')
              }}</span>
              @if (pattern.evidence.length > 3) {
              <span class="text-xs text-base-content/60">
                +{{ pattern.evidence.length - 3 }} more
              </span>
              }
            </div>
            }
          </div>
          }
        </div>
      </div>
    </div>
  `,
})
export class ArchitecturePatternsCardComponent {
  /**
   * Architecture patterns to display.
   */
  @Input({ required: true }) patterns!: ArchitecturePattern[];

  /**
   * Get badge class based on confidence score.
   * High confidence (>= 80): success
   * Medium confidence (>= 60): warning
   * Low confidence (< 60): error
   */
  protected getConfidenceBadgeClass(confidence: number): string {
    if (confidence >= 80) return 'badge-success';
    if (confidence >= 60) return 'badge-warning';
    return 'badge-error';
  }

  /**
   * Get progress bar class based on confidence score.
   */
  protected getConfidenceProgressClass(confidence: number): string {
    if (confidence >= 80) return 'progress-success';
    if (confidence >= 60) return 'progress-warning';
    return 'progress-error';
  }
}
