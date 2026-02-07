import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import { QualityGap } from '@ptah-extension/shared';

/**
 * QualityScoreCardComponent
 *
 * Displays the overall quality score as a large number with color coding
 * based on score thresholds, along with a summary of quality gaps by severity.
 *
 * Uses DaisyUI stat classes for card layout.
 *
 * Color thresholds:
 * - Score >= 80: green (text-success) -- Good quality
 * - Score >= 60: yellow (text-warning) -- Needs improvement
 * - Score < 60: red (text-error) -- Poor quality
 */
@Component({
  selector: 'ptah-quality-score-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stat bg-base-100 shadow rounded-box">
      <div class="stat-figure" [class]="scoreColorClass()">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-8 h-8"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
          />
        </svg>
      </div>
      <div class="stat-title">Quality Score</div>
      <div class="stat-value" [class]="scoreColorClass()">
        {{ score() }}
        <span class="text-base font-normal opacity-60">/100</span>
      </div>
      <div class="stat-desc">
        @if (gaps().length === 0) { No quality gaps detected } @else {
        {{ gaps().length }} gap{{ gaps().length === 1 ? '' : 's' }}: @if
        (highCount() > 0) {
        <span class="text-error font-semibold">{{ highCount() }} high</span>
        } @if (highCount() > 0 && (mediumCount() > 0 || lowCount() > 0)) {
        <span>, </span>
        } @if (mediumCount() > 0) {
        <span class="text-warning font-semibold">{{ mediumCount() }} med</span>
        } @if (mediumCount() > 0 && lowCount() > 0) {
        <span>, </span>
        } @if (lowCount() > 0) {
        <span class="text-info font-semibold">{{ lowCount() }} low</span>
        } }
      </div>
    </div>
  `,
})
export class QualityScoreCardComponent {
  readonly score = input.required<number>();
  readonly gaps = input.required<QualityGap[]>();

  readonly scoreColorClass = computed(() => {
    const s = this.score();
    if (s >= 80) return 'text-success';
    if (s >= 60) return 'text-warning';
    return 'text-error';
  });

  readonly highCount = computed(
    () => this.gaps().filter((g) => g.priority === 'high').length
  );

  readonly mediumCount = computed(
    () => this.gaps().filter((g) => g.priority === 'medium').length
  );

  readonly lowCount = computed(
    () => this.gaps().filter((g) => g.priority === 'low').length
  );
}
