/**
 * Wizard View Component - Main container for setup wizard UI.
 *
 * **Responsibilities**:
 * - Render current wizard step component
 * - Display step progress indicator
 * - Handle step navigation (next/previous)
 * - Coordinate with SetupWizardStateService for state
 *
 * **State Management**:
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
} from '@angular/core';

import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WelcomeComponent } from './welcome.component';
import { WizardLandingComponent } from './wizard-landing.component';
import { ScanProgressComponent } from './scan-progress.component';
import { AnalysisResultsComponent } from './analysis-results.component';
import { AgentSelectionComponent } from './agent-selection.component';
import { GenerationProgressComponent } from './generation-progress.component';
import { CompletionComponent } from './completion.component';
import { PromptEnhancementComponent } from './prompt-enhancement.component';

@Component({
  selector: 'ptah-wizard-view',
  imports: [
    WelcomeComponent,
    WizardLandingComponent,
    ScanProgressComponent,
    AnalysisResultsComponent,
    AgentSelectionComponent,
    PromptEnhancementComponent,
    GenerationProgressComponent,
    CompletionComponent,
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
        <div
          class="animate-fadeIn"
          data-testid="wizard-step"
          [attr.data-step]="currentStep()"
        >
          <!--
            Every step after 'welcome' renders inside @defer (on immediate):
            it loads as soon as the step is current, but its code (and the
            stores only it uses) stays out of the initial bundle budget.
          -->
          @switch (currentStep()) {
            @case ('welcome') {
              <ptah-wizard-landing />
              <details class="mx-auto max-w-[720px] px-4 pb-4">
                <summary class="cursor-pointer text-sm">
                  Analysis and recovery options
                </summary>
                <ptah-welcome />
              </details>
            }
            @case ('scan') {
              @defer (on immediate) {
                <ptah-scan-progress />
              }
            }
            @case ('analysis') {
              @defer (on immediate) {
                <ptah-analysis-results />
              }
            }
            @case ('selection') {
              @defer (on immediate) {
                <ptah-agent-selection />
              }
            }
            @case ('enhance') {
              @defer (on immediate) {
                <ptah-prompt-enhancement />
              }
            }
            @case ('generation') {
              @defer (on immediate) {
                <ptah-generation-progress />
              }
            }
            @case ('completion') {
              @defer (on immediate) {
                <ptah-completion />
              }
            }
          }
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WizardViewComponent {
  private readonly wizardState = inject(SetupWizardStateService);

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
    if (targetIndex <= currentIdx) return true;
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
}
