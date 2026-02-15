import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  CircleCheck,
  LucideAngularModule,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-angular';

/**
 * QualityScoreCardComponent - Displays code quality score from agentic analysis
 *
 * Shows a radial progress indicator with the quality score (0-100),
 * color-coded by severity, plus top strengths and issues as badges.
 *
 * Usage:
 * ```html
 * <ptah-quality-score-card
 *   [qualityScore]="85"
 *   [qualityStrengths]="['Type Safety', 'Architecture']"
 *   [qualityIssues]="[{ area: 'Testing', severity: 'medium', description: 'Low coverage' }]"
 * />
 * ```
 */
@Component({
  selector: 'ptah-quality-score-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card bg-base-200/50 border border-base-300">
      <div class="card-body p-3">
        <!-- Header -->
        <div class="flex items-center gap-2 mb-2">
          <lucide-angular
            [img]="ShieldCheckIcon"
            class="w-4 h-4 text-primary"
            aria-hidden="true"
          />
          <h3 class="text-sm font-semibold">Code Quality</h3>
        </div>

        <div class="flex items-start gap-4">
          <!-- Radial Progress -->
          <div class="flex flex-col items-center gap-1">
            <div
              class="radial-progress text-sm font-bold"
              [class]="scoreColorClass()"
              [style]="
                '--value:' + qualityScore() + '; --size:4rem; --thickness:4px;'
              "
              role="progressbar"
              [attr.aria-valuenow]="qualityScore()"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-label]="
                'Code quality score: ' + qualityScore() + ' out of 100'
              "
            >
              {{ qualityScore() }}
            </div>
            <span class="text-[10px] text-base-content/50">out of 100</span>
          </div>

          <!-- Strengths & Issues -->
          <div class="flex-1 min-w-0 space-y-2">
            @if (topStrengths().length > 0) {
            <div>
              <span
                class="text-[10px] text-base-content/50 uppercase tracking-wide"
                >Strengths</span
              >
              <div class="flex flex-wrap gap-1 mt-0.5">
                @for (strength of topStrengths(); track strength) {
                <span class="badge badge-success badge-sm gap-1">
                  <lucide-angular
                    [img]="CircleCheckIcon"
                    class="w-2.5 h-2.5"
                    aria-hidden="true"
                  />
                  {{ strength }}
                </span>
                }
              </div>
            </div>
            } @if (topIssues().length > 0) {
            <div>
              <span
                class="text-[10px] text-base-content/50 uppercase tracking-wide"
                >Issues</span
              >
              <div class="flex flex-wrap gap-1 mt-0.5">
                @for (issue of topIssues(); track issue.area) {
                <span
                  class="badge badge-sm gap-1"
                  [class.badge-error]="issue.severity === 'high'"
                  [class.badge-warning]="issue.severity !== 'high'"
                >
                  <lucide-angular
                    [img]="TriangleAlertIcon"
                    class="w-2.5 h-2.5"
                    aria-hidden="true"
                  />
                  {{ issue.area }}
                </span>
                }
              </div>
            </div>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class QualityScoreCardComponent {
  /** Quality score 0-100 */
  readonly qualityScore = input.required<number>();

  /** Quality strengths (best practices followed well) */
  readonly qualityStrengths = input<string[]>([]);

  /** Quality issues found during analysis */
  readonly qualityIssues = input<
    Array<{
      area: string;
      severity: 'high' | 'medium' | 'low';
      description: string;
    }>
  >([]);

  protected readonly ShieldCheckIcon = ShieldCheck;
  protected readonly CircleCheckIcon = CircleCheck;
  protected readonly TriangleAlertIcon = TriangleAlert;

  /** Color class based on score: success (70+), warning (40-70), error (0-40) */
  protected readonly scoreColorClass = computed(() => {
    const score = this.qualityScore();
    if (score >= 70) return 'text-success';
    if (score >= 40) return 'text-warning';
    return 'text-error';
  });

  /** Top 3 strengths for display */
  protected readonly topStrengths = computed(() =>
    this.qualityStrengths().slice(0, 3)
  );

  /** Top 3 issues for display */
  protected readonly topIssues = computed(() =>
    this.qualityIssues().slice(0, 3)
  );
}
