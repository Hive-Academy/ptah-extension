import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  OnInit,
} from '@angular/core';
import { QualityDashboardStateService } from '../../services/quality-dashboard-state.service';
import { QualityScoreCardComponent } from './quality-score-card.component';
import { QualityTrendChartComponent } from './quality-trend-chart.component';
import { AntiPatternDistributionComponent } from './anti-pattern-distribution.component';
import { QualityGapsTableComponent } from './quality-gaps-table.component';
import { QualityRecommendationsComponent } from './quality-recommendations.component';
import { QualityExportButtonComponent } from './quality-export-button.component';

/**
 * QualityDashboardViewComponent
 *
 * Main layout component for the quality dashboard. Composes all child
 * components into a responsive grid layout with loading, error, and
 * data states managed via @if control flow.
 *
 * Responsibilities:
 * - Initialize data loading on mount (assessment + history)
 * - Provide refresh capability
 * - Derive child component inputs from state service signals
 * - Handle responsive layout with DaisyUI/Tailwind grid classes
 *
 * Component Hierarchy:
 *   QualityDashboardViewComponent
 *   +-- QualityScoreCardComponent (score display)
 *   +-- QualityTrendChartComponent (history line chart)
 *   +-- AntiPatternDistributionComponent (category progress bars)
 *   +-- QualityGapsTableComponent (gaps table)
 *   +-- QualityRecommendationsComponent (prioritized list)
 *   +-- QualityExportButtonComponent (export dropdown)
 */
@Component({
  selector: 'ptah-quality-dashboard',
  standalone: true,
  imports: [
    QualityScoreCardComponent,
    QualityTrendChartComponent,
    AntiPatternDistributionComponent,
    QualityGapsTableComponent,
    QualityRecommendationsComponent,
    QualityExportButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="quality-dashboard p-4 space-y-6">
      <!-- Header -->
      <div class="flex justify-between items-center">
        <h2 class="text-xl font-bold">Code Quality Dashboard</h2>
        <div class="flex gap-2">
          <button
            class="btn btn-sm btn-outline"
            (click)="refreshAssessment()"
            [disabled]="loading()"
            aria-label="Refresh quality assessment"
          >
            @if (loading()) {
            <span class="loading loading-spinner loading-xs"></span>
            } Refresh
          </button>
          <ptah-quality-export-button [intelligence]="intelligence()" />
        </div>
      </div>

      @if (loading()) {
      <div
        class="flex justify-center items-center p-12"
        role="status"
        aria-label="Loading quality data"
      >
        <span class="loading loading-spinner loading-lg"></span>
      </div>
      } @else if (error()) {
      <div class="alert alert-error" role="alert">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="stroke-current shrink-0 h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div>
          <h3 class="font-bold">Failed to load quality data</h3>
          <div class="text-sm">{{ error() }}</div>
        </div>
        <button class="btn btn-sm btn-ghost" (click)="refreshAssessment()">
          Retry
        </button>
      </div>
      } @else if (intelligence()) {
      <!-- Score + Trend Row -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ptah-quality-score-card [score]="score()" [gaps]="gaps()" />
        <div class="lg:col-span-2">
          <ptah-quality-trend-chart [history]="history()" />
        </div>
      </div>

      <!-- Pattern Distribution -->
      <ptah-anti-pattern-distribution [antiPatterns]="antiPatterns()" />

      <!-- Gaps & Recommendations -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ptah-quality-gaps-table [gaps]="gaps()" />
        <ptah-quality-recommendations [recommendations]="recommendations()" />
      </div>
      } @else {
      <!-- Initial state before first load -->
      <div
        class="flex flex-col items-center justify-center p-12 text-base-content/50"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          class="w-12 h-12 mb-4"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M10.5 6a7.5 7.5 0 1 0 7.5 7.5h-7.5V6Z"
          />
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M13.5 10.5H21A7.5 7.5 0 0 0 13.5 3v7.5Z"
          />
        </svg>
        <p class="text-sm">
          Click Refresh to run your first quality assessment.
        </p>
      </div>
      }
    </div>
  `,
})
export class QualityDashboardViewComponent implements OnInit {
  private readonly qualityState = inject(QualityDashboardStateService);

  // Delegate state signals
  readonly loading = this.qualityState.loading;
  readonly error = this.qualityState.error;
  readonly intelligence = this.qualityState.intelligence;
  readonly history = this.qualityState.history;

  // Derived signals from intelligence data
  readonly score = computed(
    () => this.intelligence()?.qualityAssessment.score ?? 0
  );

  readonly antiPatterns = computed(
    () => this.intelligence()?.qualityAssessment.antiPatterns ?? []
  );

  readonly gaps = computed(
    () => this.intelligence()?.qualityAssessment.gaps ?? []
  );

  readonly recommendations = computed(
    () => this.intelligence()?.prescriptiveGuidance.recommendations ?? []
  );

  /**
   * Load assessment and history data on component initialization.
   */
  ngOnInit(): void {
    this.qualityState.loadAssessment();
    this.qualityState.loadHistory();
  }

  /**
   * Force a fresh assessment from the backend (bypasses cache).
   * Also reloads history to include the new assessment entry.
   */
  refreshAssessment(): void {
    this.qualityState.loadAssessment(true);
    this.qualityState.loadHistory();
  }
}
