import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import type { AnalysisPhase } from '@ptah-extension/shared';
import {
  Bot,
  Building2,
  HeartPulse,
  Info,
  LucideAngularModule,
  LucideIconData,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-angular';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
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
  imports: [LucideAngularModule, ConfirmationModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container mx-auto px-6 py-12 max-w-3xl">
      <h2 class="text-4xl font-bold text-center mb-8">Analyzing Workspace</h2>

      @if (errorMessage(); as error) {
      <div class="alert alert-error mb-4" role="alert">
        <lucide-angular
          [img]="XCircleIcon"
          class="h-6 w-6 shrink-0 stroke-current"
          aria-hidden="true"
        />
        <span>{{ error }}</span>
      </div>
      } @if (progress(); as progressData) {

      <!-- Phase Stepper (agentic analysis) -->
      @if (progressData.currentPhase) {
      <div class="mb-8">
        <ul class="steps steps-horizontal w-full">
          @for (phase of phases; track phase.id) {
          <li
            class="step"
            [class.step-primary]="isPhaseCompleteOrCurrent(phase.id)"
            [attr.aria-label]="phase.label"
          >
            <span class="flex items-center gap-1.5 text-xs">
              <lucide-angular
                [img]="phase.icon"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
              {{ phase.label }}
            </span>
          </li>
          }
        </ul>
      </div>

      <!-- Current Phase Label -->
      @if (progressData.phaseLabel) {
      <div class="flex items-center justify-center gap-2 mb-4">
        <lucide-angular
          [img]="BotIcon"
          class="w-5 h-5 text-primary animate-pulse"
          aria-hidden="true"
        />
        <span class="text-sm font-medium text-primary">
          {{ progressData.phaseLabel }}
        </span>
      </div>
      } } @else {
      <!-- Progress Bar (hardcoded fallback analysis) -->
      <div class="mb-6">
        <div class="flex justify-between mb-2">
          <span class="text-sm font-medium text-base-content/80">
            Analyzing {{ progressData.filesScanned || 0 }} of
            {{ progressData.totalFiles || 0 }} files...
          </span>
          <span class="text-sm font-semibold text-base-content">
            {{ progressPercentage() }}%
          </span>
        </div>
        <progress
          class="progress progress-primary w-full h-3"
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
      }

      <!-- Agent Reasoning (collapsible) -->
      @if (progressData.agentReasoning) {
      <div class="collapse collapse-arrow bg-base-200 mb-6">
        <input type="checkbox" checked />
        <div class="collapse-title text-sm font-medium text-base-content/70">
          Agent Activity
        </div>
        <div class="collapse-content">
          <p class="text-sm text-base-content/60">
            {{ progressData.agentReasoning }}
          </p>
        </div>
      </div>
      }

      <!-- Detections List -->
      @if (progressData.detections && progressData.detections.length > 0) {
      <div class="space-y-3 mb-8">
        <h3 class="text-lg font-semibold text-base-content/80">Detections:</h3>
        @for (detection of progressData.detections; track detection) {
        <div class="alert alert-info shadow-md">
          <lucide-angular
            [img]="InfoIcon"
            class="stroke-current shrink-0 w-6 h-6"
            aria-hidden="true"
          />
          <span>{{ detection }}</span>
        </div>
        } @empty {
        <p class="text-base-content/60">
          Scanning for project characteristics...
        </p>
        }
      </div>
      } } @else {
      <!-- Fallback: No progress data yet -->
      <div class="flex flex-col items-center gap-4 py-12">
        <span class="loading loading-spinner loading-lg text-primary"></span>
        <p class="text-base-content/60">{{ statusText() }}</p>
      </div>
      }

      <!-- Action Buttons -->
      <div class="flex justify-center gap-3 mt-8">
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
          } Retry
        </button>
        } @else {
        <button
          class="btn btn-ghost"
          [disabled]="isAnalyzing()"
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
      [message]="
        'Are you sure you want to cancel the scan? Progress will be lost.'
      "
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
  private readonly wizardRpc = inject(WizardRpcService);
  private readonly destroyRef = inject(DestroyRef);

  /** Set to true when the component is destroyed, to prevent stale state mutations. */
  private isDestroyed = false;

  protected readonly XCircleIcon = XCircle;
  protected readonly InfoIcon = Info;
  protected readonly BotIcon = Bot;

  /** Phase steps for the stepper UI */
  protected readonly phases: PhaseStep[] = [
    { id: 'discovery', label: 'Discovery', icon: Search },
    { id: 'architecture', label: 'Architecture', icon: Building2 },
    { id: 'health', label: 'Health', icon: HeartPulse },
    { id: 'quality', label: 'Quality', icon: ShieldCheck },
  ];

  readonly confirmModal =
    viewChild.required<ConfirmationModalComponent>('confirmModal');

  /**
   * Reactive progress data from state service.
   * Uses scanProgress signal which includes agentic analysis fields
   * (currentPhase, phaseLabel, agentReasoning, completedPhases).
   */
  protected readonly progress = this.wizardState.scanProgress;

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

  // Component-local state
  protected readonly isCanceling = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly statusText = signal('Initializing workspace scan...');
  protected readonly isAnalyzing = signal(false);

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

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.isDestroyed = true;
    });
  }

  ngOnInit(): void {
    this.startAnalysis();
  }

  /**
   * Trigger deep analysis and agent recommendations.
   * Skips deep analysis if results are already cached (smart retry for partial failures).
   * Guarded against re-entry and stale component mutations.
   */
  private async startAnalysis(): Promise<void> {
    if (this.isAnalyzing()) {
      return; // Prevent concurrent calls
    }

    this.isAnalyzing.set(true);
    this.errorMessage.set(null);

    try {
      // Smart retry: skip deep analysis if already cached in state
      let analysis = this.wizardState.deepAnalysis();

      if (!analysis) {
        this.statusText.set('Analyzing project structure...');
        analysis = await this.wizardRpc.deepAnalyze();
        if (this.isDestroyed) return; // Component was destroyed during async call
        this.wizardState.setDeepAnalysis(analysis);
      }

      this.statusText.set('Calculating agent recommendations...');
      const recommendations = await this.wizardRpc.recommendAgents(analysis);
      if (this.isDestroyed) return; // Component was destroyed during async call

      this.wizardState.setRecommendations(recommendations);
      this.wizardState.setCurrentStep('analysis');
    } catch (error) {
      if (this.isDestroyed) return;
      const message =
        error instanceof Error
          ? error.message
          : 'Analysis failed. Please try again.';
      this.errorMessage.set(message);
      this.statusText.set('Analysis failed');
      console.error('[ScanProgressComponent] Analysis failed:', error);
    } finally {
      if (!this.isDestroyed) {
        this.isAnalyzing.set(false);
      }
    }
  }

  /**
   * Handle "Retry" button — re-run the analysis flow.
   */
  protected onRetry(): void {
    this.startAnalysis();
  }

  /**
   * Handle "Back" button — go back to welcome step (client-side only).
   */
  protected onGoBack(): void {
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
   * TASK_2025_145 SERIOUS-6: The cancel RPC aborts the active AbortController
   * in AgenticAnalysisService, preventing the SDK query from running for up
   * to 90 seconds after the user has already cancelled in the UI.
   */
  protected onConfirmCancellation(): void {
    // Fire-and-forget: cancel the backend analysis (best-effort, non-blocking).
    // Intentionally not awaited — the user should not wait for the backend
    // cancellation RPC to complete before the wizard resets. The `void` operator
    // makes the fire-and-forget intent explicit and suppresses floating-promise lints.
    void this.wizardRpc.cancelAnalysis();
    this.wizardState.reset();
  }

  /**
   * Handle modal cancellation (user declined cancellation)
   */
  protected onDeclineCancellation(): void {
    // Modal auto-closes, no action needed
  }
}
