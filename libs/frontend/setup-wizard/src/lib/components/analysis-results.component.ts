import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  AlertTriangle,
  CheckCircle,
  LucideAngularModule,
  TriangleAlert,
  XCircle,
} from 'lucide-angular';
import { MarkdownModule } from 'ngx-markdown';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { ConfirmationModalComponent } from './confirmation-modal.component';

/**
 * AnalysisResultsComponent - Display detected project characteristics with deep analysis
 *
 * Purpose:
 * - Show detected project type, tech stack, architecture patterns
 * - Display key file locations grouped by type (collapsible)
 * - Show language distribution statistics
 * - Display existing issues count (errors, warnings)
 * - Show test coverage estimate
 * - Get user confirmation before proceeding
 *
 * Features:
 * - Composed of sub-components for maintainability
 * - Architecture patterns with confidence score progress bars
 * - Collapsible sections for key file locations
 * - Language distribution list with percentages
 * - Diagnostics summary (errors, warnings)
 * - Test coverage indicator
 * - Monorepo information (if detected)
 *
 * Usage:
 * ```html
 * <ptah-analysis-results />
 * ```
 */
@Component({
  selector: 'ptah-analysis-results',
  standalone: true,
  imports: [LucideAngularModule, MarkdownModule, ConfirmationModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-3 py-4">
      <h2 class="text-xl font-semibold mb-4">Analysis Complete</h2>

      <!-- Multi-Phase Analysis Results (primary path) -->
      @if (multiPhaseResult(); as mp) {
      <div class="space-y-3 mb-4">
        <!-- Summary bar -->
        <div class="flex items-center gap-2 text-xs text-base-content/60 mb-2">
          <span
            >Model:
            <span class="font-semibold text-base-content">{{
              mp.manifest.model
            }}</span></span
          >
          <span class="text-base-content/30">|</span>
          <span
            >Duration:
            <span class="font-semibold text-base-content">{{
              formatDuration(mp.manifest.totalDurationMs)
            }}</span></span
          >
          <span class="text-base-content/30">|</span>
          <span
            >Phases:
            <span class="font-semibold text-base-content">{{
              phaseEntries().length
            }}</span></span
          >
        </div>

        <!-- Phase cards -->
        @for (phase of phaseEntries(); track phase.id) {
        <div
          class="collapse collapse-arrow border border-base-300 bg-base-200/50"
        >
          <input
            type="checkbox"
            [checked]="isPhaseExpanded(phase.id)"
            (change)="togglePhase(phase.id)"
          />
          <div class="collapse-title flex items-center gap-2 min-h-0 py-2 px-3">
            <!-- Status icon -->
            @if (phase.status === 'completed') {
            <lucide-angular
              [img]="CheckCircleIcon"
              class="h-4 w-4 text-success shrink-0"
            />
            } @else if (phase.status === 'failed') {
            <lucide-angular
              [img]="XCircleIcon"
              class="h-4 w-4 text-error shrink-0"
            />
            } @else {
            <lucide-angular
              [img]="AlertTriangleIcon"
              class="h-4 w-4 text-warning shrink-0"
            />
            }
            <span class="text-sm font-semibold">{{
              getPhaseLabel(phase.id)
            }}</span>
            @if (phase.durationMs > 0) {
            <span class="text-xs text-base-content/50 ml-auto mr-6">
              {{ formatDuration(phase.durationMs) }}
            </span>
            }
          </div>
          <div class="collapse-content px-3 pb-3">
            @if (phase.content) {
            <div class="prose prose-sm max-w-none text-xs">
              <markdown [data]="phase.content" />
            </div>
            } @else if (phase.error) {
            <div class="alert alert-error text-xs py-2">
              <lucide-angular
                [img]="XCircleIcon"
                class="h-3.5 w-3.5 shrink-0"
              />
              <span>{{ phase.error }}</span>
            </div>
            } @else {
            <p class="text-xs text-base-content/50 italic">
              No content available for this phase.
            </p>
            }
          </div>
        </div>
        }
      </div>

      <!-- Confirmation Warning -->
      <div class="alert alert-warning text-xs mb-4">
        <lucide-angular
          [img]="TriangleAlertIcon"
          class="stroke-current shrink-0 h-4 w-4"
          aria-hidden="true"
        />
        <div>
          <div class="font-semibold">Does this look correct?</div>
          <div class="text-xs opacity-80">
            The agents we generate will be tailored to these characteristics.
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex gap-2 justify-center">
        <button class="btn btn-ghost btn-sm" (click)="onManualAdjust()">
          No, Let Me Adjust
        </button>
        <button class="btn btn-primary btn-sm" (click)="onContinue()">
          Yes, Continue
        </button>
      </div>

      } @else {
      <!-- Skeleton loading state (no analysis available) -->
      <div class="space-y-4">
        <div class="border border-base-300 rounded-md bg-base-200/50">
          <div class="p-4">
            <div class="skeleton h-4 w-48 mb-2"></div>
            <div class="flex flex-wrap gap-2 mb-2">
              <div class="skeleton h-4 w-20 rounded-full"></div>
              <div class="skeleton h-4 w-24 rounded-full"></div>
              <div class="skeleton h-4 w-16 rounded-full"></div>
            </div>
            <div class="skeleton h-3 w-full mb-1"></div>
            <div class="skeleton h-3 w-3/4"></div>
          </div>
        </div>
        <div class="flex gap-2 justify-center">
          <div class="skeleton h-8 w-28 rounded-lg"></div>
          <div class="skeleton h-8 w-28 rounded-lg"></div>
        </div>
      </div>
      }
    </div>

    <!-- Alert Modal for Future Enhancement -->
    <ptah-confirmation-modal
      #alertModal
      title="Manual Adjustment Coming Soon"
      [message]="confirmationMessage"
      [mode]="'alert'"
      [confirmText]="'OK'"
      (confirmed)="onAlertOk()"
    />
  `,
})
export class AnalysisResultsComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  // Lucide icon references
  protected readonly TriangleAlertIcon = TriangleAlert;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly XCircleIcon = XCircle;
  protected readonly AlertTriangleIcon = AlertTriangle;

  public readonly alertModal =
    viewChild.required<ConfirmationModalComponent>('alertModal');

  public readonly confirmationMessage = `Manual adjustment is coming soon!
For now, you can:
1. Continue with detected settings
2. Cancel and manually configure your .claude folder
3. Contact support for custom configuration help`;

  /** Track which phase cards are expanded */
  private readonly expandedPhases = signal<Set<string>>(
    new Set(['project-profile'])
  );

  /**
   * Multi-phase analysis result (primary path for premium users).
   */
  protected readonly multiPhaseResult = computed(() => {
    return this.wizardState.multiPhaseResult();
  });

  /**
   * Phase entries from the multi-phase manifest, enriched with content.
   */
  protected readonly phaseEntries = computed(() => {
    const mp = this.multiPhaseResult();
    if (!mp) return [];

    // Display order for phases (exclude synthesis/agent-context from display)
    const displayOrder = [
      'project-profile',
      'architecture-assessment',
      'quality-audit',
      'elevation-plan',
    ];

    return displayOrder
      .filter((id) => mp.manifest.phases[id])
      .map((id) => ({
        id,
        status: mp.manifest.phases[id].status,
        durationMs: mp.manifest.phases[id].durationMs,
        error: mp.manifest.phases[id].error,
        content: mp.phaseContents[id] ?? null,
      }));
  });

  /** Phase display labels */
  protected getPhaseLabel(phaseId: string): string {
    const labels: Record<string, string> = {
      'project-profile': 'Project Profile',
      'architecture-assessment': 'Architecture Assessment',
      'quality-audit': 'Quality Audit',
      'elevation-plan': 'Elevation Plan',
    };
    return labels[phaseId] ?? phaseId;
  }

  /** Check if a phase card is expanded */
  protected isPhaseExpanded(phaseId: string): boolean {
    return this.expandedPhases().has(phaseId);
  }

  /** Toggle a phase card's expanded state */
  protected togglePhase(phaseId: string): void {
    this.expandedPhases.update((set) => {
      const next = new Set(set);
      if (next.has(phaseId)) {
        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }
      return next;
    });
  }

  /** Format milliseconds to a readable duration string */
  protected formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  /**
   * Handle "Yes, Continue" button click
   * - User confirmed analysis results
   * - Transition to agent selection step
   */
  protected onContinue(): void {
    this.wizardState.setCurrentStep('selection');
  }

  /**
   * Handle "No, Let Me Adjust" button click
   * - Show DaisyUI modal for future enhancement notice
   */
  protected onManualAdjust(): void {
    this.alertModal().show();
  }

  /**
   * Handle alert modal OK button
   * - Modal auto-closes
   */
  protected onAlertOk(): void {
    // Modal auto-closes, no action needed
  }
}
