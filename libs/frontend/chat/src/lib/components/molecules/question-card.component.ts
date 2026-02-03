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
} from 'lucide-angular';
import type { QuestionItem } from '@ptah-extension/shared';

/**
 * Request type matching backend AskUserQuestionRequest
 * Sent from backend to frontend when SDK's AskUserQuestion tool is invoked
 */
export interface AskUserQuestionRequest {
  /** Unique identifier for this question request */
  id: string;
  /** Tool name - always 'AskUserQuestion' */
  toolName: 'AskUserQuestion';
  /** Array of questions to present to the user */
  questions: QuestionItem[];
  /** Tool use ID for correlation with execution tree */
  toolUseId?: string;
  /** Backend timestamp when request was emitted */
  timestamp: number;
  /** Timestamp when this request will timeout (30s from emission) */
  timeoutAt: number;
}

/**
 * Response type matching backend AskUserQuestionResponse
 * Sent from frontend to backend with user's selected answers
 */
export interface AskUserQuestionResponse {
  /** Request ID this response corresponds to */
  id: string;
  /** Map of question text to selected answer(s) - multi-select uses comma-separated strings */
  answers: Record<string, string>;
}

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
          [class.badge-warning]="timeRemaining() > 10"
          [class.badge-error]="timeRemaining() <= 10"
        >
          <lucide-angular [img]="ClockIcon" class="w-2.5 h-2.5" />
          {{ timeRemaining() }}s
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
            [class.bg-info]="isOptionSelected(question.question, option.label)"
            [class.bg-opacity-15]="
              isOptionSelected(question.question, option.label)
            "
          >
            <input
              type="checkbox"
              [value]="option.label"
              [checked]="isOptionSelected(question.question, option.label)"
              (change)="onOptionToggle(question.question, option.label, $event)"
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
          } } @else {
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
              [checked]="selectedAnswers()[question.question] === option.label"
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
          } }
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

  /** The question request containing questions to display */
  readonly request = input.required<AskUserQuestionRequest>();

  /** Emits when user submits their answers */
  readonly answered = output<AskUserQuestionResponse>();

  /** Tracks selected answers for each question (question text -> selected option(s)) */
  protected readonly selectedAnswers = signal<Record<string, string>>({});

  /** Current step index (0-based) */
  protected readonly currentStep = signal(0);

  /** Countdown timer showing seconds remaining until timeout */
  protected readonly timeRemaining = signal(30);

  /** Timer interval reference for cleanup */
  private timerInterval?: ReturnType<typeof setInterval>;

  /** Whether there are multiple questions */
  protected readonly hasMultipleQuestions = computed(
    () => this.request().questions.length > 1
  );

  /** Current question being displayed */
  protected readonly currentQuestion = computed(
    () => this.request().questions[this.currentStep()]
  );

  /** Whether we're on the last step */
  protected readonly isLastStep = computed(
    () => this.currentStep() === this.request().questions.length - 1
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
    }
  }

  /** Navigate to next step */
  protected nextStep(): void {
    if (this.currentStep() < this.request().questions.length - 1) {
      this.currentStep.update((s) => s + 1);
    }
  }

  private updateTimeRemaining(): number {
    const remaining = Math.max(
      0,
      Math.floor((this.request().timeoutAt - Date.now()) / 1000)
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
    this.selectedAnswers.update((a) => ({ ...a, [question]: option }));
  }

  /** Handle multi-select option toggle (checkbox) */
  protected onOptionToggle(
    question: string,
    option: string,
    event: Event
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

  /** Submit answers to parent component */
  protected onSubmit(): void {
    if (!this.canSubmit()) return;

    this.answered.emit({
      id: this.request().id,
      answers: this.selectedAnswers(),
    });
  }
}
