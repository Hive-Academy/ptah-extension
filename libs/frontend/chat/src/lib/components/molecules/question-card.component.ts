import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  OnDestroy,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  Send,
  Clock,
  PenLine,
} from 'lucide-angular';
import type {
  AskUserQuestionRequest,
  AskUserQuestionResponse,
} from '@ptah-extension/shared';

/**
 * QuestionCardComponent - Display AskUserQuestion prompts with step-by-step navigation
 *
 * Complexity Level: 2 (Medium - timer, form inputs, computed validation, steps)
 * Pattern: Signal-based state, composition over inheritance
 *
 * Features:
 * - DaisyUI Steps indicator for multiple questions
 * - One question at a time with prev/next navigation
 * - Countdown timer showing time remaining
 * - Single-select (radio buttons) and multi-select (checkboxes) support
 * - Submit button on last step when all questions answered
 * - Proper info theme styling matching design system
 *
 * SOLID Principles:
 * - Single Responsibility: Display question prompts and collect user answers
 * - Composition: Self-contained, no inheritance
 * - Interface Segregation: Minimal inputs/outputs
 */
@Component({
  selector: 'ptah-question-card',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="relative bg-base-300/30 rounded border-l-2 border-info"
      role="alert"
    >
      <!-- Header row - compact with timer -->
      <div
        class="py-1.5 px-2 flex items-center gap-1.5 text-[11px] border-b border-base-300/30"
      >
        <lucide-angular
          [img]="HelpCircleIcon"
          class="w-3 h-3 text-info flex-shrink-0"
          aria-hidden="true"
        />
        <span class="font-semibold text-info">Input needed</span>
        <span
          class="badge badge-xs font-mono px-1.5 gap-0.5 ml-auto flex-shrink-0"
          [class.badge-warning]="timeRemaining() < 0 || timeRemaining() > 10"
          [class.badge-error]="timeRemaining() >= 0 && timeRemaining() <= 10"
        >
          <lucide-angular [img]="ClockIcon" class="w-2.5 h-2.5" />
          {{ timeRemaining() < 0 ? 'No timeout' : timeRemaining() + 's' }}
        </span>
      </div>

      <!-- Steps indicator (only for multiple questions) -->
      @if (hasMultipleQuestions()) {
        <div class="px-2 py-1.5 border-b border-base-300/30">
          <ul class="steps steps-horizontal w-full text-[9px]">
            @for (q of request().questions; track q.header; let i = $index) {
              <li
                class="step"
                [class.step-info]="i <= currentStep()"
                [attr.data-content]="isStepAnswered(i) ? '✓' : i + 1"
              >
                <span class="hidden sm:inline truncate max-w-16">{{
                  q.header
                }}</span>
              </li>
            }
          </ul>
        </div>
      }

      <!-- Current question -->
      <div class="py-2 px-2">
        @if (currentQuestion(); as question) {
          <p class="text-[11px] font-medium text-base-content/90 mb-1.5">
            {{ question.question }}
          </p>

          <!-- Options list - single column for clarity -->
          <div class="space-y-0.5">
            @if (question.multiSelect) {
              <!-- Multi-select: checkboxes -->
              @for (option of question.options; track option.label) {
                <label
                  class="flex items-start gap-2 cursor-pointer hover:bg-info/10 rounded px-1.5 py-1 text-[10px] transition-colors"
                  [class.bg-info]="
                    isOptionSelected(question.question, option.label)
                  "
                  [class.bg-opacity-15]="
                    isOptionSelected(question.question, option.label)
                  "
                >
                  <input
                    type="checkbox"
                    [value]="option.label"
                    [checked]="
                      isOptionSelected(question.question, option.label)
                    "
                    (change)="
                      onOptionToggle(question.question, option.label, $event)
                    "
                    class="checkbox checkbox-xs checkbox-info mt-0.5"
                  />
                  <div class="flex-1 min-w-0">
                    <span class="font-medium">{{ option.label }}</span>
                    @if (option.description) {
                      <p class="text-[9px] text-base-content/50 leading-tight">
                        {{ option.description }}
                      </p>
                    }
                  </div>
                </label>
              }
            } @else {
              <!-- Single-select: radio buttons -->
              @for (option of question.options; track option.label) {
                <label
                  class="flex items-start gap-2 cursor-pointer hover:bg-info/10 rounded px-1.5 py-1 text-[10px] transition-colors"
                  [class.bg-info]="
                    selectedAnswers()[question.question] === option.label
                  "
                  [class.bg-opacity-15]="
                    selectedAnswers()[question.question] === option.label
                  "
                >
                  <input
                    type="radio"
                    [name]="'q-' + currentStep()"
                    [value]="option.label"
                    [checked]="
                      selectedAnswers()[question.question] === option.label
                    "
                    (change)="onOptionSelect(question.question, option.label)"
                    class="radio radio-xs radio-info mt-0.5"
                  />
                  <div class="flex-1 min-w-0">
                    <span class="font-medium">{{ option.label }}</span>
                    @if (option.description) {
                      <p class="text-[9px] text-base-content/50 leading-tight">
                        {{ option.description }}
                      </p>
                    }
                  </div>
                </label>
              }
            }

            <!-- Custom response option -->
            <label
              class="flex items-start gap-2 cursor-pointer hover:bg-info/10 rounded px-1.5 py-1 text-[10px] transition-colors"
              [class.bg-info]="isCustomMode()"
              [class.bg-opacity-15]="isCustomMode()"
            >
              <input
                type="radio"
                [name]="'q-' + currentStep()"
                [value]="'__custom__'"
                [checked]="isCustomMode()"
                (change)="onCustomSelect(question.question)"
                class="radio radio-xs radio-info mt-0.5"
              />
              <div class="flex-1 min-w-0">
                <span class="font-medium flex items-center gap-1">
                  <lucide-angular [img]="PenLineIcon" class="w-2.5 h-2.5" />
                  Other
                </span>
                <p class="text-[9px] text-base-content/50 leading-tight">
                  Type a custom response
                </p>
              </div>
            </label>

            <!-- Custom input field (shown when custom option selected) -->
            @if (isCustomMode()) {
              <div class="flex gap-1 mt-1 px-1.5">
                <input
                  type="text"
                  [value]="customText()"
                  (input)="onCustomTextInput($event)"
                  (keydown.enter)="onCustomTextConfirm(question.question)"
                  placeholder="Type your response..."
                  class="input input-xs input-bordered input-info flex-1 text-[10px] bg-base-100/50"
                />
                <button
                  (click)="onCustomTextConfirm(question.question)"
                  [disabled]="!customText().trim()"
                  class="btn btn-xs btn-info btn-outline px-1.5"
                  type="button"
                  title="Confirm custom response"
                >
                  <lucide-angular [img]="SendIcon" class="w-3 h-3" />
                </button>
              </div>
            }
          </div>
        }
      </div>

      <!-- Navigation buttons -->
      <div
        class="flex items-center gap-1.5 px-2 py-1.5 border-t border-base-300/30 bg-base-100/20"
      >
        <!-- Prev button -->
        @if (hasMultipleQuestions()) {
          <button
            (click)="prevStep()"
            [disabled]="currentStep() === 0"
            class="btn btn-xs btn-ghost gap-0.5 px-1.5"
            type="button"
          >
            <lucide-angular [img]="ChevronLeftIcon" class="w-3 h-3" />
            Prev
          </button>
        }

        <!-- Progress text -->
        <span class="text-[9px] text-base-content/50 flex-1 text-center">
          {{ getAnsweredCount() }}/{{ request().questions.length }} answered
        </span>

        <!-- Next or Submit button -->
        @if (isLastStep()) {
          <button
            (click)="onSubmit()"
            [disabled]="!canSubmit()"
            class="btn btn-xs btn-info gap-0.5 px-2"
            type="button"
          >
            <lucide-angular [img]="SendIcon" class="w-3 h-3" />
            Submit
          </button>
        } @else {
          <button
            (click)="nextStep()"
            [disabled]="!isCurrentStepAnswered()"
            class="btn btn-xs btn-info btn-outline gap-0.5 px-1.5"
            type="button"
          >
            Next
            <lucide-angular [img]="ChevronRightIcon" class="w-3 h-3" />
          </button>
        }
      </div>
    </div>
  `,
})
export class QuestionCardComponent implements OnInit, OnDestroy {
  /** Lucide icon references */
  protected readonly HelpCircleIcon = HelpCircle;
  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly SendIcon = Send;
  protected readonly ClockIcon = Clock;
  protected readonly PenLineIcon = PenLine;

  /** The question request containing questions to display */
  readonly request = input.required<AskUserQuestionRequest>();

  /** Emits when user submits their answers */
  readonly answered = output<AskUserQuestionResponse>();

  /** Tracks selected answers for each question (question text -> selected option(s)) */
  protected readonly selectedAnswers = signal<Record<string, string>>({});

  /** Whether the current question is in custom input mode */
  protected readonly isCustomMode = signal(false);

  /** Text entered in the custom input field */
  protected readonly customText = signal('');

  /** Current step index (0-based) */
  protected readonly currentStep = signal(0);

  /** Countdown timer showing seconds remaining until timeout */
  protected readonly timeRemaining = signal(30);

  /** Timer interval reference for cleanup */
  private timerInterval?: ReturnType<typeof setInterval>;

  /** Whether there are multiple questions */
  protected readonly hasMultipleQuestions = computed(
    () => this.request().questions.length > 1,
  );

  /** Current question being displayed */
  protected readonly currentQuestion = computed(
    () => this.request().questions[this.currentStep()],
  );

  /** Whether we're on the last step */
  protected readonly isLastStep = computed(
    () => this.currentStep() === this.request().questions.length - 1,
  );

  /** Whether all questions have answers */
  protected readonly canSubmit = computed(() => {
    const answers = this.selectedAnswers();
    const questions = this.request().questions;
    return questions.every((q) => answers[q.question]?.length > 0);
  });

  /** Whether current step has an answer */
  protected readonly isCurrentStepAnswered = computed(() => {
    const question = this.currentQuestion();
    if (!question) return false;
    const answer = this.selectedAnswers()[question.question];
    return answer !== undefined && answer.length > 0;
  });

  ngOnInit(): void {
    // TASK_2025_215: timeoutAt === 0 means "no timeout — block indefinitely"
    // Skip timer entirely when no timeout is set
    if (this.request().timeoutAt <= 0) {
      this.timeRemaining.set(-1); // Sentinel: no timeout
      return;
    }

    this.updateTimeRemaining();
    this.timerInterval = setInterval(() => {
      const remaining = this.updateTimeRemaining();
      if (remaining <= 0) {
        this.clearTimer();
      }
    }, 1000);
  }

  ngOnDestroy(): void {
    this.clearTimer();
  }

  /** Get count of answered questions */
  protected getAnsweredCount(): number {
    const answers = this.selectedAnswers();
    const questions = this.request().questions;
    return questions.filter((q) => answers[q.question]?.length > 0).length;
  }

  /** Check if a specific step is answered */
  protected isStepAnswered(stepIndex: number): boolean {
    const question = this.request().questions[stepIndex];
    if (!question) return false;
    const answer = this.selectedAnswers()[question.question];
    return answer !== undefined && answer.length > 0;
  }

  /** Navigate to previous step */
  protected prevStep(): void {
    if (this.currentStep() > 0) {
      this.currentStep.update((s) => s - 1);
      this.resetCustomState();
    }
  }

  /** Navigate to next step */
  protected nextStep(): void {
    if (this.currentStep() < this.request().questions.length - 1) {
      this.currentStep.update((s) => s + 1);
      this.resetCustomState();
    }
  }

  /** Reset custom input state when switching questions */
  private resetCustomState(): void {
    this.isCustomMode.set(false);
    this.customText.set('');
  }

  private updateTimeRemaining(): number {
    const remaining = Math.max(
      0,
      Math.floor((this.request().timeoutAt - Date.now()) / 1000),
    );
    this.timeRemaining.set(remaining);
    return remaining;
  }

  private clearTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
  }

  /** Check if an option is currently selected (for multi-select checkboxes) */
  protected isOptionSelected(question: string, option: string): boolean {
    const current = this.selectedAnswers()[question] || '';
    const options = current ? current.split(', ') : [];
    return options.includes(option);
  }

  /** Handle single-select option selection (radio button) */
  protected onOptionSelect(question: string, option: string): void {
    this.isCustomMode.set(false);
    this.customText.set('');
    this.selectedAnswers.update((a) => ({ ...a, [question]: option }));
  }

  /** Handle multi-select option toggle (checkbox) */
  protected onOptionToggle(
    question: string,
    option: string,
    event: Event,
  ): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectedAnswers.update((a) => {
      const current = a[question] || '';
      const options = current ? current.split(', ') : [];

      if (checked) {
        if (!options.includes(option)) {
          options.push(option);
        }
      } else {
        const idx = options.indexOf(option);
        if (idx >= 0) {
          options.splice(idx, 1);
        }
      }

      return { ...a, [question]: options.join(', ') };
    });
  }

  /** Activate custom input mode for a question */
  protected onCustomSelect(question: string): void {
    this.isCustomMode.set(true);
    // Clear the predefined selection so custom text takes over
    this.selectedAnswers.update((a) => {
      const { [question]: _, ...rest } = a;
      return rest;
    });
  }

  /** Handle typing in the custom input field */
  protected onCustomTextInput(event: Event): void {
    this.customText.set((event.target as HTMLInputElement).value);
  }

  /** Confirm custom text as the answer for a question */
  protected onCustomTextConfirm(question: string): void {
    const text = this.customText().trim();
    if (!text) return;
    this.selectedAnswers.update((a) => ({ ...a, [question]: text }));
  }

  /** Submit answers to parent component */
  protected onSubmit(): void {
    if (!this.canSubmit()) return;

    this.answered.emit({
      id: this.request().id,
      answers: this.selectedAnswers(),
    });
  }
}
