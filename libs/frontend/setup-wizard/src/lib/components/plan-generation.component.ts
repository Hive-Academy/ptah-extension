import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { AlertTriangle, LucideAngularModule, RefreshCw } from 'lucide-angular';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';

/**
 * PlanGenerationComponent - Loading state while master plan is being generated
 *
 * Purpose:
 * - Show spinner and progress messaging while plan generates
 * - Call RPC to submit discovery answers and then fetch the master plan
 * - Navigate to plan-review step on success
 * - Show error state with retry button on failure
 *
 * Usage:
 * ```html
 * <ptah-plan-generation />
 * ```
 */
@Component({
  selector: 'ptah-plan-generation',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }
      .animate-pulse-slow {
        animation: pulse 2s ease-in-out infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .animate-pulse-slow {
          animation: none;
        }
      }
    `,
  ],
  template: `
    <div class="h-full flex flex-col items-center justify-center px-3 py-4">
      <div class="text-center w-full max-w-md">
        @if (!hasError()) {
          <!-- Loading State -->
          <div class="mb-6">
            <span
              class="loading loading-spinner loading-lg text-primary"
            ></span>
          </div>

          <h2 class="text-base font-semibold mb-2">
            Generating Your Project Plan
          </h2>

          <p class="text-xs text-base-content/60 mb-4">
            {{ statusMessage() }}
          </p>

          <div class="space-y-2">
            <div
              class="flex items-center justify-center gap-2 text-xs text-base-content/40"
            >
              <span class="animate-pulse-slow"
                >Analyzing your requirements...</span
              >
            </div>

            <progress
              class="progress progress-primary w-full"
              [value]="progress()"
              max="100"
            ></progress>

            <p class="text-xs text-base-content/40">
              This may take 1-2 minutes
            </p>
          </div>
        } @else {
          <!-- Error State -->
          <div class="mb-4">
            <div class="rounded-full bg-error/20 p-4 inline-flex">
              <lucide-angular
                [img]="AlertTriangleIcon"
                class="w-8 h-8 text-error"
                aria-hidden="true"
              />
            </div>
          </div>

          <h2 class="text-base font-semibold mb-2">Plan Generation Failed</h2>

          <p class="text-xs text-base-content/60 mb-4">
            {{ errorMessage() }}
          </p>

          <div class="flex items-center justify-center gap-3">
            <button
              class="btn btn-primary btn-sm"
              (click)="onRetry()"
              aria-label="Retry plan generation"
            >
              <lucide-angular
                [img]="RefreshCwIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
              Retry
            </button>

            <button
              class="btn btn-ghost btn-sm"
              (click)="onBack()"
              aria-label="Go back to discovery"
            >
              Back to Questions
            </button>
          </div>
        }
      </div>
    </div>
  `,
})
export class PlanGenerationComponent implements OnInit {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly RefreshCwIcon = RefreshCw;

  protected readonly hasError = signal(false);
  protected readonly errorMessage = signal('');
  protected readonly statusMessage = signal('Preparing your project plan...');
  protected readonly progress = signal(10);

  public ngOnInit(): void {
    this.generatePlan();
  }

  /**
   * Execute plan generation workflow:
   * 1. Submit discovery answers via RPC
   * 2. Fetch the generated master plan
   * 3. Set plan in state and navigate to plan-review
   */
  private async generatePlan(): Promise<void> {
    const projectType = this.wizardState.newProjectType();
    if (!projectType) {
      this.hasError.set(true);
      this.errorMessage.set(
        'No project type selected. Please go back and select a type.',
      );
      return;
    }

    const answers = this.wizardState.discoveryAnswers();
    const projectName = (answers['project-name'] as string) || 'my-project';

    this.hasError.set(false);
    this.wizardState.setPlanGenerating(true);

    try {
      // Step 1: Submit answers
      this.statusMessage.set('Submitting your requirements...');
      this.progress.set(20);

      await this.wizardRpc.submitDiscoveryAnswers(
        projectType,
        answers,
        projectName,
      );
      this.progress.set(60);

      // Step 2: Fetch the generated plan
      this.statusMessage.set('Retrieving generated plan...');
      this.progress.set(75);

      const plan = await this.wizardRpc.getMasterPlan();
      this.progress.set(100);

      // Step 3: Set plan in state and navigate
      this.wizardState.setMasterPlan(plan);
      this.wizardState.setPlanGenerating(false);
      this.wizardState.setCurrentStep('plan-review');
    } catch (error) {
      this.hasError.set(true);
      this.errorMessage.set(
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred during plan generation.',
      );
      this.wizardState.setPlanGenerating(false);
    }
  }

  /**
   * Retry plan generation after a failure.
   */
  protected onRetry(): void {
    this.progress.set(10);
    this.statusMessage.set('Preparing your project plan...');
    this.generatePlan();
  }

  /**
   * Navigate back to the discovery step.
   */
  protected onBack(): void {
    this.wizardState.setCurrentStep('discovery');
  }
}
