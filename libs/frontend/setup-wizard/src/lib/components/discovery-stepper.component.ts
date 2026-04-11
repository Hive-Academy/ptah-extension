import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  ArrowLeft,
  ArrowRight,
  LucideAngularModule,
  Sparkles,
} from 'lucide-angular';
import type { AnswerValue } from '@ptah-extension/shared';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { QuestionCardComponent } from './question-card.component';

/**
 * DiscoveryStepperComponent - Multi-step question group stepper
 *
 * Purpose:
 * - Render one question group at a time from the state service
 * - Show mini progress indicator and group stepper
 * - Provide Back/Next navigation between groups
 * - On last group, show "Generate Plan" button that triggers RPC
 * - Navigate to plan-generation step when submission starts
 *
 * Usage:
 * ```html
 * <ptah-discovery-stepper />
 * ```
 */
@Component({
  selector: 'ptah-discovery-stepper',
  standalone: true,
  imports: [LucideAngularModule, QuestionCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .animate-fadeIn {
        animation: fadeIn 0.4s ease-out;
      }
      @media (prefers-reduced-motion: reduce) {
        .animate-fadeIn {
          animation: none;
        }
      }
    `,
  ],
  template: `
    <div class="h-full flex flex-col px-3 py-4">
      <div class="w-full max-w-2xl mx-auto flex flex-col flex-1">
        <!-- Mini Progress Header -->
        <div class="text-center mb-4">
          <p class="text-xs text-base-content/50 mb-2">
            Step {{ currentIndex() + 1 }} of {{ totalGroups() }}
            @if (currentGroup()) {
              <span class="mx-1">&mdash;</span>
              <span class="font-medium text-base-content/70">
                {{ currentGroup()!.title }}
              </span>
            }
          </p>

          <!-- DaisyUI Steps Indicator -->
          <ul class="steps steps-horizontal text-xs">
            @for (group of groups(); track group.id; let i = $index) {
              <li
                class="step"
                [class.step-primary]="i <= currentIndex()"
                [attr.aria-label]="group.title"
              >
                {{ group.title }}
              </li>
            }
          </ul>
        </div>

        <!-- Group Description -->
        @if (currentGroup()) {
          <p class="text-xs text-base-content/60 mb-4 text-center">
            {{ currentGroup()!.description }}
          </p>
        }

        <!-- Questions -->
        <div class="flex-1 overflow-y-auto animate-fadeIn">
          @if (currentGroup()) {
            @for (question of currentGroup()!.questions; track question.id) {
              <ptah-question-card
                [question]="question"
                [value]="getAnswer(question.id)"
                (valueChange)="onAnswerChange(question.id, $event)"
              />
            }
          }
        </div>

        <!-- Error state -->
        @if (errorMessage()) {
          <div class="alert alert-error text-xs my-3">
            <span>{{ errorMessage() }}</span>
          </div>
        }

        <!-- Navigation Buttons -->
        <div
          class="flex justify-between items-center pt-4 border-t border-base-300 mt-4"
        >
          <button
            class="btn btn-ghost btn-sm"
            (click)="onBack()"
            [disabled]="isSubmitting()"
            aria-label="Go back"
          >
            <lucide-angular
              [img]="ArrowLeftIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Back
          </button>

          @if (isLastGroup()) {
            <button
              class="btn btn-primary btn-sm"
              [disabled]="!canProceed() || isSubmitting()"
              (click)="onGeneratePlan()"
              aria-label="Generate project plan"
            >
              @if (isSubmitting()) {
                <span class="loading loading-spinner loading-xs"></span>
                Generating...
              } @else {
                <lucide-angular
                  [img]="SparklesIcon"
                  class="w-4 h-4"
                  aria-hidden="true"
                />
                Generate Plan
              }
            </button>
          } @else {
            <button
              class="btn btn-primary btn-sm"
              [disabled]="!canProceed()"
              (click)="onNext()"
              aria-label="Next question group"
            >
              Next
              <lucide-angular
                [img]="ArrowRightIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
            </button>
          }
        </div>
      </div>
    </div>
  `,
})
export class DiscoveryStepperComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  protected readonly ArrowLeftIcon = ArrowLeft;
  protected readonly ArrowRightIcon = ArrowRight;
  protected readonly SparklesIcon = Sparkles;

  protected readonly isSubmitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly groups = this.wizardState.questionGroups;
  protected readonly currentIndex = this.wizardState.currentGroupIndex;
  protected readonly currentGroup = this.wizardState.currentQuestionGroup;
  protected readonly isLastGroup = this.wizardState.isLastGroup;
  protected readonly canProceed = this.wizardState.currentGroupComplete;

  protected readonly totalGroups = computed(() => this.groups().length);

  /**
   * Get the current answer for a question by ID.
   */
  protected getAnswer(questionId: string): AnswerValue | undefined {
    return this.wizardState.discoveryAnswers()[questionId];
  }

  /**
   * Handle answer change from a question card.
   */
  protected onAnswerChange(questionId: string, value: AnswerValue): void {
    this.wizardState.setDiscoveryAnswer(questionId, value);
  }

  /**
   * Navigate to the next question group.
   */
  protected onNext(): void {
    this.wizardState.nextQuestionGroup();
  }

  /**
   * Navigate backward.
   * If on the first group, go back to project type selection.
   * Otherwise, go to the previous group.
   */
  protected onBack(): void {
    if (this.currentIndex() === 0) {
      this.wizardState.setCurrentStep('project-type');
    } else {
      this.wizardState.previousQuestionGroup();
    }
  }

  /**
   * Navigate to plan generation step.
   * The actual plan generation RPC is triggered by PlanGenerationComponent.ngOnInit,
   * not here. This method only handles the step transition.
   */
  protected onGeneratePlan(): void {
    this.wizardState.setCurrentStep('plan-generation');
  }
}
