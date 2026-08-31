import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  viewChild,
} from '@angular/core';
import type { AnalysisPhase } from '@ptah-extension/shared';
import {
  Bot,
  Building2,
  CheckCircle,
  CircleDot,
  Info,
  Lightbulb,
  LucideAngularModule,
  LucideIconData,
  Search,
  ShieldCheck,
  XCircle,
  Zap,
} from 'lucide-angular';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardAnalysisRunner } from '../services/wizard-analysis-runner.service';
import { AnalysisActivityIndicatorComponent } from './analysis-activity-indicator.component';
import { AnalysisStatsDashboardComponent } from './analysis-stats-dashboard.component';
import { AnalysisTranscriptComponent } from './analysis-transcript.component';
import { ConfirmationModalComponent } from './confirmation-modal.component';

/**
 * Phase step definition for the stepper UI
 */
interface PhaseStep {
  id: AnalysisPhase;
  label: string;
  icon: LucideIconData;
}

/**
 * ScanProgressComponent - Real-time workspace scan progress display
 *
 * Purpose:
 * - Show live file scanning progress (X of Y files)
 * - Display real-time detection updates (tech stack, frameworks, etc.)
 * - Show phase stepper for agentic analysis progress
 * - Display agent reasoning in collapsible section
 * - Provide cancel option with confirmation
 *
 * Features:
 * - Reactive progress bar based on files scanned / total files
 * - Phase stepper UI for agentic analysis phases
 * - Collapsible agent reasoning section
 * - Live detection list with alert cards
 * - Percentage calculation computed signal
 * - Cancel button with confirmation prompt
 *
 * Usage:
 * ```html
 * <ptah-scan-progress />
 * ```
 */
@Component({
  selector: 'ptah-scan-progress',
  standalone: true,
  imports: [
    LucideAngularModule,
    AnalysisActivityIndicatorComponent,
    AnalysisTranscriptComponent,
    ConfirmationModalComponent,
    AnalysisStatsDashboardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="h-full flex flex-col">
      <!-- Header -->
      <div class="shrink-0 px-3 py-3">
        <h2 class="text-lg font-semibold">Analyzing Workspace</h2>
      </div>

      @if (fallbackWarning(); as warning) {
        <div class="shrink-0 px-3">
          <div class="alert alert-warning mb-3 py-2 px-3 text-xs" role="status">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="stroke-current shrink-0 h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span>{{ warning }}</span>
          </div>
        </div>
      }
      @if (errorMessage(); as error) {
        <div class="shrink-0 px-3">
          <div class="alert alert-error mb-3 py-2 px-3 text-xs" role="alert">
            <lucide-angular
              [img]="XCircleIcon"
              class="h-4 w-4 shrink-0 stroke-current"
              aria-hidden="true"
            />
            <span>{{ error }}</span>
          </div>
        </div>
      }

      <!-- Main Content Area -->
      <div class="flex-1 min-h-0 px-3 pb-3">
        @if (resumableAnalysis()) {
          <!-- Resume hold: the prior run is kept until the user decides -->
          <div class="h-full flex flex-col items-center justify-center gap-4">
            <div
              class="card bg-base-200/60 border border-base-300 max-w-md"
              data-testid="resume-analysis-card"
            >
              <div class="card-body items-center text-center gap-3">
                <h3 class="text-sm font-semibold">Unfinished analysis found</h3>
                <p class="text-xs text-base-content-muted">
                  A previous workspace analysis did not finish. Resume it, or
                  start a fresh analysis. The saved progress is kept until you
                  decide.
                </p>
                <div class="flex gap-2">
                  <button
                    class="btn btn-primary btn-sm"
                    aria-label="Resume analysis"
                    (click)="onResumeAnalysis()"
                  >
                    Resume Analysis
                  </button>
                  <button
                    class="btn btn-ghost btn-sm"
                    aria-label="Start a fresh analysis"
                    (click)="onStartFresh()"
                  >
                    Start Fresh
                  </button>
                </div>
              </div>
            </div>
          </div>
        } @else if (progress(); as progressData) {
          <!-- Phase Cards (agentic analysis) -->
          @if (progressData.currentPhase) {
            <div class="shrink-0 grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              @for (phase of phases; track phase.id) {
                <div
                  class="card transition-all duration-500"
                  [class]="getPhaseCardClasses(phase.id)"
                  [attr.aria-label]="
                    phase.label +
                    (isPhaseComplete(phase.id)
                      ? ' - complete'
                      : isCurrentPhase(phase.id)
                        ? ' - in progress'
                        : ' - pending')
                  "
                >
                  <div class="card-body p-2 items-center text-center gap-0.5">
                    @if (isPhaseComplete(phase.id)) {
                      <lucide-angular
                        [img]="CheckCircleIcon"
                        class="w-4 h-4 text-success"
                        aria-hidden="true"
                      />
                    } @else if (isCurrentPhase(phase.id)) {
                      <lucide-angular
                        [img]="phase.icon"
                        class="w-4 h-4 text-primary animate-pulse"
                        aria-hidden="true"
                      />
                    } @else {
                      <lucide-angular
                        [img]="phase.icon"
                        class="w-4 h-4 text-base-content-muted"
                        aria-hidden="true"
                      />
                    }
                    <span
                      class="text-xs font-medium"
                      [class]="
                        isPhaseCompleteOrCurrent(phase.id)
                          ? ''
                          : 'text-base-content-muted'
                      "
                    >
                      {{ phase.label }}
                    </span>
                    @if (isPhaseComplete(phase.id)) {
                      <span class="badge badge-xs badge-success">done</span>
                    } @else if (isCurrentPhase(phase.id)) {
                      <span class="badge badge-xs badge-info animate-pulse"
                        >active</span
                      >
                    }
                  </div>
                </div>
              }
            </div>

            <!-- Current Phase Label -->
            @if (progressData.phaseLabel) {
              <div
                class="shrink-0 flex items-center justify-center gap-1.5 mb-3"
              >
                <lucide-angular
                  [img]="BotIcon"
                  class="w-4 h-4 text-primary animate-pulse"
                  aria-hidden="true"
                />
                <span class="text-xs font-medium text-primary">
                  {{ progressData.phaseLabel }}
                </span>
              </div>
            }

            <!-- Stats Dashboard -->
            @if (hasStreamMessages()) {
              <div class="shrink-0 mb-3">
                <ptah-analysis-stats-dashboard />
              </div>
            }
          } @else if (progressData.totalFiles > 0) {
            <!-- Progress Bar -->
            <div class="shrink-0 mb-3">
              <div class="flex justify-between mb-1.5">
                <span class="text-sm font-medium text-base-content-muted">
                  Analyzing {{ progressData.filesScanned || 0 }} of
                  {{ progressData.totalFiles || 0 }} files...
                </span>
                <span class="text-sm font-semibold text-base-content">
                  {{ progressPercentage() }}%
                </span>
              </div>
              <progress
                class="progress progress-primary w-full h-2"
                [value]="progressPercentage()"
                max="100"
                role="progressbar"
                [attr.aria-valuenow]="progressPercentage()"
                [attr.aria-valuemin]="0"
                [attr.aria-valuemax]="100"
                [attr.aria-label]="
                  'Workspace scan progress: ' +
                  progressPercentage() +
                  ' percent complete'
                "
              ></progress>
            </div>
          } @else {
            <!-- Initializing state -->
            <div
              class="shrink-0 flex items-center justify-center gap-2 mb-3 py-2"
            >
              <span
                class="loading loading-spinner loading-sm text-primary"
              ></span>
              <span class="text-sm text-base-content-muted"
                >Initializing analysis...</span
              >
            </div>
          }

          <!-- Two Column Layout: Transcript (left) + Detections (right) -->
          <div class="flex gap-4 min-h-[400px] max-h-[70vh]">
            <!-- Left Column: Agent Transcript -->
            <div class="flex-1 min-w-0">
              @if (hasStreamMessages()) {
                <div class="h-full">
                  <ptah-analysis-transcript />
                </div>
              } @else if (progressData.agentReasoning) {
                <div class="alert alert-info h-full flex items-center">
                  <lucide-angular
                    [img]="InfoIcon"
                    class="stroke-current shrink-0 w-5 h-5"
                    aria-hidden="true"
                  />
                  <p class="text-sm">{{ progressData.agentReasoning }}</p>
                </div>
              } @else {
                <div
                  class="h-full flex flex-col items-center justify-center gap-4"
                >
                  <span
                    class="loading loading-spinner loading-lg text-primary"
                  ></span>
                  <ptah-analysis-activity-indicator />
                </div>
              }
            </div>

            <!-- Right Column: Detections -->
            @if (
              progressData.detections && progressData.detections.length > 0
            ) {
              <div class="w-64 shrink-0 flex flex-col">
                <div
                  class="flex items-center gap-2 mb-3 sticky top-0 bg-base-100 py-2 z-10"
                >
                  <lucide-angular
                    [img]="ZapIcon"
                    class="w-4 h-4 text-accent"
                    aria-hidden="true"
                  />
                  <h3 class="text-sm font-bold text-base-content">
                    Detected Stack
                  </h3>
                  <span class="badge badge-sm badge-ghost">
                    {{ progressData.detections.length }}
                  </span>
                </div>
                <div class="flex-1 overflow-y-auto pr-1">
                  <div class="flex flex-wrap gap-2">
                    @for (
                      detection of progressData.detections;
                      track detection;
                      let i = $index
                    ) {
                      <div
                        class="group flex items-center gap-2 px-3 py-2 rounded-lg
                         bg-base-200/80 border border-base-300/60
                         hover:border-primary/40 hover:bg-primary/5
                         transition-all duration-200 cursor-default"
                      >
                        <lucide-angular
                          [img]="CircleDotIcon"
                          class="w-3 h-3 shrink-0 text-primary group-hover:text-primary"
                          aria-hidden="true"
                        />
                        <span
                          class="text-sm font-medium text-base-content-muted whitespace-nowrap"
                        >
                          {{ detection }}
                        </span>
                      </div>
                    } @empty {
                      <p class="text-base-content-muted text-xs italic">
                        Scanning for project characteristics...
                      </p>
                    }
                  </div>
                </div>
              </div>
            }
          </div>
        } @else {
          <!-- Fallback: No progress data yet -->
          <div class="h-full flex flex-col items-center justify-center gap-4">
            <span
              class="loading loading-spinner loading-lg text-primary"
            ></span>
            <ptah-analysis-activity-indicator />
          </div>
        }
      </div>

      <!-- Action Buttons -->
      <div
        class="shrink-0 flex justify-center gap-3 py-4 border-t border-base-300"
      >
        @if (errorMessage()) {
          <button
            class="btn btn-ghost"
            aria-label="Go back to welcome"
            (click)="onGoBack()"
          >
            Back
          </button>
          <button
            class="btn btn-primary"
            [disabled]="isAnalyzing()"
            aria-label="Retry analysis"
            (click)="onRetry()"
          >
            @if (isAnalyzing()) {
              <span class="loading loading-spinner loading-sm"></span>
            }
            Retry
          </button>
        } @else {
          <button
            class="btn btn-ghost"
            [disabled]="!isAnalyzing()"
            aria-label="Cancel scan"
            (click)="onCancel()"
          >
            Cancel Scan
          </button>
        }
      </div>
    </div>

    <!-- Confirmation Modal -->
    <ptah-confirmation-modal
      #confirmModal
      [title]="'Cancel Scan?'"
      [message]="'Are you sure you want to cancel the scan? Progress will be lost.'"
      [confirmText]="'Yes, Cancel Scan'"
      [cancelText]="'No, Continue'"
      [confirmClass]="'btn-error'"
      (confirmed)="onConfirmCancellation()"
      (cancelled)="onDeclineCancellation()"
    />
  `,
})
export class ScanProgressComponent implements OnInit {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly runner = inject(WizardAnalysisRunner);

  protected readonly XCircleIcon = XCircle;
  protected readonly InfoIcon = Info;
  protected readonly BotIcon = Bot;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly ZapIcon = Zap;
  protected readonly CircleDotIcon = CircleDot;

  /** Phase steps for the stepper UI (v2 multi-phase pipeline) */
  protected readonly phases: PhaseStep[] = [
    { id: 'project-profile', label: 'Profile', icon: Search },
    { id: 'architecture-assessment', label: 'Architecture', icon: Building2 },
    { id: 'quality-audit', label: 'Quality', icon: ShieldCheck },
    { id: 'elevation-plan', label: 'Elevation', icon: Lightbulb },
  ];

  public readonly confirmModal =
    viewChild.required<ConfirmationModalComponent>('confirmModal');

  /**
   * Reactive progress data from state service.
   * Uses scanProgress signal which includes agentic analysis fields
   * (currentPhase, phaseLabel, agentReasoning, completedPhases).
   */
  protected readonly progress = this.wizardState.scanProgress;

  /**
   * Fallback warning from state service.
   * Displayed as a non-blocking amber alert when agentic analysis
   * falls back to quick analysis mode.
   */
  protected readonly fallbackWarning = this.wizardState.fallbackWarning;

  /**
   * Calculated progress percentage (0-100)
   * Handles division by zero and null cases
   */
  protected readonly progressPercentage = computed(() => {
    const progressData = this.progress();
    if (!progressData?.totalFiles || progressData.totalFiles === 0) {
      return 0;
    }
    const scanned = progressData.filesScanned || 0;
    return Math.round((scanned / progressData.totalFiles) * 100);
  });

  /**
   * Whether any stream messages have been received.
   * Used to conditionally show the full transcript vs simple reasoning text.
   */
  protected readonly hasStreamMessages = computed(() => {
    return this.wizardState.analysisStream().length > 0;
  });
  /**
   * Run state read straight off {@link WizardAnalysisRunner}. It is root-scoped,
   * so these survive this component being destroyed by a view switch.
   */
  protected readonly isCanceling = this.runner.isCanceling;
  protected readonly errorMessage = this.runner.errorMessage;
  protected readonly statusText = this.runner.statusText;
  protected readonly isAnalyzing = this.runner.isRunning;
  protected readonly resumableAnalysis = this.runner.resumableAnalysis;

  /**
   * Check if a phase is completed or is the current active phase.
   * Used by the phase stepper to highlight completed/active steps.
   */
  protected isPhaseCompleteOrCurrent(phaseId: AnalysisPhase): boolean {
    const progressData = this.progress();
    if (!progressData) return false;

    const completedPhases = progressData.completedPhases || [];
    return (
      completedPhases.includes(phaseId) || progressData.currentPhase === phaseId
    );
  }

  /**
   * Check if a specific phase is completed (in completedPhases array).
   * Used by the phase stepper to show green checkmark for completed phases.
   */
  protected isPhaseComplete(phaseId: AnalysisPhase): boolean {
    const progressData = this.progress();
    if (!progressData) return false;
    return (progressData.completedPhases || []).includes(phaseId);
  }

  /**
   * Check if a specific phase is the currently active phase.
   * Used by the phase stepper to show pulsing animation on the active phase.
   */
  protected isCurrentPhase(phaseId: AnalysisPhase): boolean {
    const progressData = this.progress();
    if (!progressData) return false;
    return progressData.currentPhase === phaseId;
  }

  /**
   * Get DaisyUI/Tailwind classes for a phase card based on its state.
   * Returns gradient-styled classes for complete, active, and pending phases.
   */
  protected getPhaseCardClasses(phaseId: AnalysisPhase): string {
    if (this.isPhaseComplete(phaseId)) {
      return 'bg-success/10 border border-success/30 shadow-sm';
    }
    if (this.isCurrentPhase(phaseId)) {
      return 'bg-primary/10 border border-primary/30 shadow-md';
    }
    return 'bg-base-200 border border-base-300/50 opacity-60';
  }

  /**
   * Join the analysis run rather than owning it.
   *
   * Remounting after a view switch re-attaches to the run still in flight (or
   * to its stored result); it never starts a second analysis.
   */
  public ngOnInit(): void {
    void this.runner.ensureStarted();
  }

  /**
   * Handle "Retry" button — re-run the analysis flow.
   */
  protected onRetry(): void {
    void this.runner.retry();
  }

  /** Handle "Resume Analysis" — continue the persisted unfinished run. */
  protected onResumeAnalysis(): void {
    void this.runner.resumeAnalysis();
  }

  /** Handle "Start Fresh" — discard the resume offer and analyze anew. */
  protected onStartFresh(): void {
    void this.runner.startFreshAnalysis();
  }

  /**
   * Handle "Back" button — go back to welcome step (client-side only).
   */
  protected onGoBack(): void {
    this.runner.reset();
    this.wizardState.reset();
  }

  /**
   * Handle "Cancel Scan" button — show confirmation modal.
   */
  protected onCancel(): void {
    if (this.isAnalyzing()) {
      this.confirmModal().show();
    }
  }

  /**
   * Handle modal confirmation (user confirmed cancellation).
   * Cancels the backend analysis first, then resets wizard state.
   *
   * The cancel RPC aborts the active AbortController in
   * AgenticAnalysisService, preventing the SDK query from running for up
   * to 90 seconds after the user has already cancelled in the UI.
   */
  protected onConfirmCancellation(): void {
    void this.runner.cancel();
  }

  /**
   * Handle modal cancellation (user declined cancellation)
   */
  protected onDeclineCancellation(): void {
    console.log('ScanProgressComponent.onDeclineCancellation called');
  }
}
