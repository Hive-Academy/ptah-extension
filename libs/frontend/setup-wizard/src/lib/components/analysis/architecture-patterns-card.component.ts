import { NgClass } from '@angular/common';
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { ArchitecturePattern } from '@ptah-extension/shared';
import { LucideAngularModule, Building } from 'lucide-angular';

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
  imports: [NgClass, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card bg-base-200 shadow-xl mb-6">
      <div class="card-body">
        <h3 class="card-title text-xl mb-4">
          <lucide-angular [img]="BuildingIcon" class="h-6 w-6" />
          Architecture Patterns Detected
        </h3>

        <div class="space-y-4">
          @for (pattern of patterns(); track pattern.name) {
          <div class="p-4 bg-base-100 rounded-lg">
            <div class="flex justify-between items-center mb-2">
              <span class="font-semibold">{{ pattern.name }}</span>
              <span
                [ngClass]="[
                  'badge',
                  getConfidenceBadgeClass(pattern.confidence)
                ]"
              >
                {{ pattern.confidence }}% confidence
              </span>
            </div>
            <progress
              [ngClass]="[
                'progress',
                'w-full',
                getConfidenceProgressClass(pattern.confidence)
              ]"
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
  // Lucide icon reference
  protected readonly BuildingIcon = Building;

  /**
   * Architecture patterns to display.
   */
  readonly patterns = input.required<ArchitecturePattern[]>();

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
