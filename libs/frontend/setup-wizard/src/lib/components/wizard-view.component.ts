/**
 * Wizard View Component - Main container for setup wizard UI.
 *
 * **Responsibilities**:
 * - Verify premium license before showing wizard
 * - Render current wizard step component
 * - Display step progress indicator
 * - Handle step navigation (next/previous)
 * - Coordinate with SetupWizardStateService for state
 *
 * **State Management**:
 * - License state: `licenseState()` signal - 'checking' | 'valid' | 'invalid'
 * - Current step: `wizardState.currentStep()` signal
 * - Step index: `wizardState.stepIndex()` signal (for progress indicator)
 *
 * **Wizard Steps**:
 * 1. Welcome - Introduction screen
 * 2. Scan - Codebase scanning progress
 * 3. Analysis - Project analysis results
 * 4. Selection - Agent selection
 * 5. Generation - Rule generation progress
 * 6. Enhance - Enhanced prompts generation
 * 7. Completion - Success confirmation
 *
 * **Premium Gating**:
 * - Shows loading state while checking license
 * - Shows PremiumUpsellComponent if license is invalid
 * - Shows wizard content if license is valid
 *
 * **Usage**:
 * ```html
 * <ptah-wizard-view />
 * ```
 *
 * @see SetupWizardStateService
 */

import {
  Component,
  computed,
  inject,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';

import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WelcomeComponent } from './welcome.component';
import { ScanProgressComponent } from './scan-progress.component';
import { AnalysisResultsComponent } from './analysis-results.component';
import { AgentSelectionComponent } from './agent-selection.component';
import { GenerationProgressComponent } from './generation-progress.component';
import { CompletionComponent } from './completion.component';
import { PremiumUpsellComponent } from './premium-upsell.component';
import { PromptEnhancementComponent } from './prompt-enhancement.component';
import { ProjectTypeSelectionComponent } from './project-type-selection.component';
import { DiscoveryStepperComponent } from './discovery-stepper.component';
import { PlanGenerationComponent } from './plan-generation.component';
import { PlanReviewComponent } from './plan-review.component';

/**
 * License verification state
 */
type LicenseState = 'checking' | 'valid' | 'invalid';

@Component({
  selector: 'ptah-wizard-view',
  imports: [
    WelcomeComponent,
    ScanProgressComponent,
    AnalysisResultsComponent,
    AgentSelectionComponent,
    PromptEnhancementComponent,
    GenerationProgressComponent,
    CompletionComponent,
    PremiumUpsellComponent,
    ProjectTypeSelectionComponent,
    DiscoveryStepperComponent,
    PlanGenerationComponent,
    PlanReviewComponent,
  ],
  styles: [
    `
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .animate-fadeIn {
        animation: fadeIn 0.3s ease-out;
      }
      @media (prefers-reduced-motion: reduce) {
        .animate-fadeIn {
          animation: none;
        }
        .animate-pulse {
          animation: none;
        }
      }
    `,
  ],
  template: `
    <!-- License checking state -->
    @if (licenseState() === 'checking') {
      <div class="h-full flex items-center justify-center">
        <div class="text-center">
          <span class="loading loading-spinner loading-sm text-primary"></span>
          <p class="mt-2 text-xs text-base-content/60">Verifying license...</p>
        </div>
      </div>
    }

    <!-- Invalid license - show upsell -->
    @else if (licenseState() === 'invalid') {
      <ptah-premium-upsell
        [features]="premiumFeatures"
        [errorMessage]="licenseError()"
        (retry)="checkLicense()"
      />
    }

    <!-- Valid license - show wizard -->
    @else {
      <div class="wizard-container h-full flex flex-col bg-base-100">
        <!-- Progress indicator -->
        <div class="wizard-progress p-3 border-b border-base-300">
          <ul class="steps steps-horizontal w-full text-xs">
            @for (label of stepLabels(); track label; let i = $index) {
              <li
                class="step cursor-pointer hover:opacity-80 transition-opacity"
                [class.step-primary]="stepIndex() >= i"
                [class.pointer-events-none]="!canNavigateToStep(i)"
                [class.opacity-50]="i > 0 && !canNavigateToStep(i)"
                (click)="navigateToStep(i)"
                (keyup.enter)="navigateToStep(i)"
                tabindex="0"
                [title]="'Go to ' + label"
              >
                {{ label }}
              </li>
            }
          </ul>
        </div>

        <!-- Step content -->
        <div class="wizard-content flex-1 overflow-y-auto p-3">
          <div class="animate-fadeIn">
            @switch (currentStep()) {
              @case ('welcome') {
                <ptah-welcome />
              }
              @case ('scan') {
                <ptah-scan-progress />
              }
              @case ('analysis') {
                <ptah-analysis-results />
              }
              @case ('selection') {
                <ptah-agent-selection />
              }
              @case ('enhance') {
                <ptah-prompt-enhancement />
              }
              @case ('generation') {
                <ptah-generation-progress />
              }
              @case ('completion') {
                <ptah-completion />
              }
              @case ('project-type') {
                <ptah-project-type-selection />
              }
              @case ('discovery') {
                <ptah-discovery-stepper />
              }
              @case ('plan-generation') {
                <ptah-plan-generation />
              }
              @case ('plan-review') {
                <ptah-plan-review />
              }
            }
          </div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WizardViewComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly rpcService = inject(ClaudeRpcService);

  public readonly currentStep = this.wizardState.currentStep;
  public readonly stepIndex = this.wizardState.stepIndex;

  /**
   * Dynamic step labels based on the active wizard path (existing vs new project).
   */
  public readonly stepLabels = computed(
    () => this.wizardState.activeStepConfig().labels,
  );

  /**
   * Dynamic step order based on the active wizard path.
   */
  private readonly stepOrder = computed(
    () => this.wizardState.activeStepConfig().steps,
  );

  /**
   * Check if user can navigate to a specific step.
   * Allows backward navigation to any completed step,
   * and forward-jumps when prerequisites are met (e.g., after loading a saved analysis).
   */
  protected canNavigateToStep(targetIndex: number): boolean {
    const currentIdx = this.stepIndex();
    // Can always go back
    if (targetIndex <= currentIdx) return true;
    // Can jump forward if prerequisites are met
    const steps = this.stepOrder();
    const targetStep = steps[targetIndex];
    if (targetStep) {
      return this.wizardState.canJumpToStep(targetStep);
    }
    return false;
  }

  /**
   * Navigate to a specific step by index
   */
  protected navigateToStep(targetIndex: number): void {
    if (!this.canNavigateToStep(targetIndex)) {
      return;
    }

    const steps = this.stepOrder();
    const targetStep = steps[targetIndex];
    if (targetStep) {
      this.wizardState.setCurrentStep(targetStep);
    }
  }

  /**
   * License verification state
   * - 'checking': Initial state, verifying license
   * - 'valid': Premium license valid, show wizard
   * - 'invalid': No premium license, show upsell
   */
  protected readonly licenseState = signal<LicenseState>('checking');

  /**
   * Error message when license check fails due to network error
   */
  protected readonly licenseError = signal<string | null>(null);

  /**
   * Premium features to display in upsell component
   */
  protected readonly premiumFeatures = [
    'Deep project analysis via MCP',
    'Intelligent agent recommendations',
    '13 customized agent templates',
    'Orchestration skill generation',
    'Project-specific rule customization',
  ];

  public constructor() {
    // Check license on component initialization
    this.checkLicense();
  }

  /**
   * Verify premium license status via RPC
   * Uses existing license:getStatus RPC method and checks isPremium flag
   */
  protected async checkLicense(): Promise<void> {
    this.licenseState.set('checking');
    this.licenseError.set(null);

    try {
      const result = await this.rpcService.call('license:getStatus', {});

      if (result.success && result.data) {
        // Check if user has premium license
        if (result.data.isPremium) {
          this.licenseState.set('valid');
        } else {
          this.licenseState.set('invalid');
        }
      } else {
        // RPC call failed - show error with retry option
        this.licenseError.set(
          result.error || 'Failed to verify license. Please try again.',
        );
        this.licenseState.set('invalid');
      }
    } catch (error) {
      // Network or unexpected error - show error with retry option
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to verify license. Please check your connection and try again.';
      this.licenseError.set(message);
      this.licenseState.set('invalid');
    }
  }
}
