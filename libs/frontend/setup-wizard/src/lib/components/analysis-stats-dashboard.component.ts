import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  Activity,
  AlertTriangle,
  Brain,
  Clock,
  LucideAngularModule,
  MessageSquare,
  Terminal,
} from 'lucide-angular';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';

/**
 * AnalysisStatsDashboardComponent - Real-time analysis metrics display
 *
 * Purpose:
 * - Show live message count, tool call count, elapsed time, current phase
 * - Display message type breakdown with colored badges
 * - All data derived from existing SetupWizardStateService signals
 * - No new services or state mutations required
 *
 * Timer Cleanup:
 * - Uses DestroyRef.onDestroy() to clear the setInterval timer
 * - Prevents memory leaks when the component is destroyed during navigation
 *
 * Usage:
 * ```html
 * <ptah-analysis-stats-dashboard />
 * ```
 */
@Component({
  selector: 'ptah-analysis-stats-dashboard',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (messageCount() > 0) {
    <!-- Stats Grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      <!-- Messages Processed -->
      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="stat-figure text-primary">
          <lucide-angular
            [img]="MessageSquareIcon"
            class="w-5 h-5"
            aria-hidden="true"
          />
        </div>
        <div class="stat-title text-xs">Messages</div>
        <div class="stat-value text-lg">{{ messageCount() }}</div>
      </div>

      <!-- Tool Calls -->
      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="stat-figure text-info">
          <lucide-angular
            [img]="TerminalIcon"
            class="w-5 h-5"
            aria-hidden="true"
          />
        </div>
        <div class="stat-title text-xs">Tool Calls</div>
        <div class="stat-value text-lg">{{ toolCallCount() }}</div>
      </div>

      <!-- Current Phase -->
      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="stat-figure text-secondary">
          <lucide-angular
            [img]="ActivityIcon"
            class="w-5 h-5"
            aria-hidden="true"
          />
        </div>
        <div class="stat-title text-xs">Phase</div>
        <div class="stat-value text-sm truncate">{{ currentPhaseName() }}</div>
        <div class="stat-desc text-[10px]">{{ phaseProgress() }}</div>
      </div>

      <!-- Elapsed Time -->
      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="stat-figure text-accent">
          <lucide-angular
            [img]="ClockIcon"
            class="w-5 h-5"
            aria-hidden="true"
          />
        </div>
        <div class="stat-title text-xs">Elapsed</div>
        <div class="stat-value text-lg">{{ elapsedTime() }}</div>
      </div>
    </div>

    <!-- Message Type Breakdown -->
    <div class="flex flex-wrap gap-2 mb-2">
      @if (textCount() > 0) {
      <span class="badge badge-sm badge-info gap-1">
        <lucide-angular
          [img]="MessageSquareIcon"
          class="w-3 h-3"
          aria-hidden="true"
        />
        {{ textCount() }} text
      </span>
      } @if (toolCallCount() > 0) {
      <span class="badge badge-sm badge-primary gap-1">
        <lucide-angular
          [img]="TerminalIcon"
          class="w-3 h-3"
          aria-hidden="true"
        />
        {{ toolCallCount() }} tools
      </span>
      } @if (thinkingCount() > 0) {
      <span class="badge badge-sm badge-secondary gap-1">
        <lucide-angular [img]="BrainIcon" class="w-3 h-3" aria-hidden="true" />
        {{ thinkingCount() }} thinking
      </span>
      } @if (errorCount() > 0) {
      <span class="badge badge-sm badge-error gap-1">
        <lucide-angular
          [img]="AlertTriangleIcon"
          class="w-3 h-3"
          aria-hidden="true"
        />
        {{ errorCount() }} errors
      </span>
      }
    </div>
    } @else {
    <!-- Skeleton Stats -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      @for (_ of skeletonItems; track $index) {
      <div class="stat bg-base-200 rounded-lg p-3">
        <div class="skeleton h-4 w-16 mb-2"></div>
        <div class="skeleton h-6 w-12"></div>
      </div>
      }
    </div>
    }
  `,
})
export class AnalysisStatsDashboardComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly destroyRef = inject(DestroyRef);

  /** Array used for skeleton card iteration in the template */
  protected readonly skeletonItems = [1, 2, 3, 4];

  // Icons
  protected readonly MessageSquareIcon = MessageSquare;
  protected readonly TerminalIcon = Terminal;
  protected readonly ActivityIcon = Activity;
  protected readonly ClockIcon = Clock;
  protected readonly BrainIcon = Brain;
  protected readonly AlertTriangleIcon = AlertTriangle;

  /** Analysis start timestamp (set once when first message arrives) */
  private readonly analysisStartTime = signal<number | null>(null);

  /** Current elapsed time string, updated every second */
  private readonly elapsedTimeValue = signal('0:00');

  /** Timer interval ID for cleanup */
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Track analysis start time from first message
    effect(() => {
      const stream = this.wizardState.analysisStream();
      if (stream.length > 0 && this.analysisStartTime() === null) {
        this.analysisStartTime.set(stream[0].timestamp);
        this.startTimer();
      }
    });

    // CRITICAL: Clean up timer on component destroy to prevent memory leaks.
    // The plan's code omitted this -- this is the mitigation for the MEDIUM risk
    // identified in the Plan Validation Summary.
    this.destroyRef.onDestroy(() => {
      this.stopTimer();
    });
  }

  // === Computed Signals for Metrics ===

  protected readonly messageCount = computed(
    () => this.wizardState.analysisStream().length
  );

  protected readonly toolCallCount = computed(
    () =>
      this.wizardState.analysisStream().filter((m) => m.kind === 'tool_start')
        .length
  );

  protected readonly textCount = computed(
    () =>
      this.wizardState.analysisStream().filter((m) => m.kind === 'text').length
  );

  protected readonly thinkingCount = computed(
    () =>
      this.wizardState.analysisStream().filter((m) => m.kind === 'thinking')
        .length
  );

  protected readonly errorCount = computed(
    () =>
      this.wizardState.analysisStream().filter((m) => m.kind === 'error').length
  );

  protected readonly currentPhaseName = computed(() => {
    const progress = this.wizardState.scanProgress();
    if (!progress?.phaseLabel) return 'Starting...';
    return progress.phaseLabel;
  });

  protected readonly phaseProgress = computed(() => {
    const progress = this.wizardState.scanProgress();
    if (!progress) return '';
    const completed = progress.completedPhases?.length || 0;
    return `${completed}/4 complete`;
  });

  protected readonly elapsedTime = this.elapsedTimeValue.asReadonly();

  // === Timer Logic ===

  private startTimer(): void {
    if (this.timerInterval) return;
    this.timerInterval = setInterval(() => {
      const start = this.analysisStartTime();
      if (start) {
        const elapsed = Math.floor((Date.now() - start) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        this.elapsedTimeValue.set(
          `${minutes}:${seconds.toString().padStart(2, '0')}`
        );
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
}
