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
import { LucideAngularModule, HelpCircle } from 'lucide-angular';
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
 * QuestionCardComponent - Display AskUserQuestion prompts with option selection
 *
 * Complexity Level: 2 (Medium - timer, form inputs, computed validation)
 * Pattern: Signal-based state, composition over inheritance
 *
 * Features:
 * - Countdown timer showing time remaining
 * - Single-select (radio buttons) and multi-select (checkboxes) support
 * - Submit button enabled only when all questions answered
 * - Multi-select answers formatted as comma-separated strings
 *
 * SOLID Principles:
 * - Single Responsibility: Display question prompts and collect user answers
 * - Composition: Self-contained, no inheritance
 * - Interface Segregation: Minimal inputs/outputs
 *
 * Similar to PermissionRequestCardComponent but for questions instead of approve/deny
 */
@Component({
  selector: 'ptah-question-card',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card bg-info/10 border border-info/30 p-3">
      <!-- Header with timer -->
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <lucide-angular
            [img]="HelpCircleIcon"
            class="w-4 h-4 text-info"
            aria-hidden="true"
          />
          <span class="text-xs font-medium text-info"
            >Claude needs your input</span
          >
        </div>
        <span [class]="'text-xs ' + timerColorClass()">
          {{ timeRemaining() }}s
        </span>
      </div>

      <!-- Questions -->
      @for (question of request().questions; track question.header) {
      <div class="mb-3 last:mb-0">
        <p class="text-sm font-medium mb-2">{{ question.question }}</p>

        @if (question.multiSelect) {
        <!-- Multi-select: checkboxes -->
        @for (option of question.options; track option.label) {
        <label
          class="flex items-start gap-2 mb-1 cursor-pointer hover:bg-base-200/50 rounded p-1 -ml-1"
        >
          <input
            type="checkbox"
            [value]="option.label"
            [checked]="isOptionSelected(question.question, option.label)"
            (change)="onOptionToggle(question.question, option.label, $event)"
            class="checkbox checkbox-sm checkbox-info mt-0.5"
          />
          <div>
            <span class="text-sm">{{ option.label }}</span>
            <p class="text-xs text-base-content/60">{{ option.description }}</p>
          </div>
        </label>
        } } @else {
        <!-- Single-select: radio buttons -->
        @for (option of question.options; track option.label) {
        <label
          class="flex items-start gap-2 mb-1 cursor-pointer hover:bg-base-200/50 rounded p-1 -ml-1"
        >
          <input
            type="radio"
            [name]="'q-' + question.header"
            [value]="option.label"
            [checked]="selectedAnswers()[question.question] === option.label"
            (change)="onOptionSelect(question.question, option.label)"
            class="radio radio-sm radio-info mt-0.5"
          />
          <div>
            <span class="text-sm">{{ option.label }}</span>
            <p class="text-xs text-base-content/60">{{ option.description }}</p>
          </div>
        </label>
        } }
      </div>
      }

      <!-- Submit button -->
      <button
        (click)="onSubmit()"
        [disabled]="!canSubmit()"
        class="btn btn-info btn-sm w-full mt-2"
        [class.btn-disabled]="!canSubmit()"
      >
        Submit Answers
      </button>
    </div>
  `,
})
export class QuestionCardComponent implements OnInit, OnDestroy {
  /** Lucide icon reference for template binding */
  protected readonly HelpCircleIcon = HelpCircle;

  /** The question request containing questions to display */
  readonly request = input.required<AskUserQuestionRequest>();

  /** Emits when user submits their answers */
  readonly answered = output<AskUserQuestionResponse>();

  /** Tracks selected answers for each question (question text -> selected option(s)) */
  protected readonly selectedAnswers = signal<Record<string, string>>({});

  /** Countdown timer showing seconds remaining until timeout */
  protected readonly timeRemaining = signal(30);

  /** Timer interval reference for cleanup */
  private timerInterval?: ReturnType<typeof setInterval>;

  /**
   * Computed signal - can submit only when all questions have answers
   */
  protected readonly canSubmit = computed(() => {
    const answers = this.selectedAnswers();
    const questions = this.request().questions;
    return questions.every((q) => answers[q.question]?.length > 0);
  });

  /**
   * Computed signal - timer color class based on time remaining
   * Changes from neutral to warning to error as time runs out
   */
  protected readonly timerColorClass = computed(() => {
    const remaining = this.timeRemaining();
    if (remaining <= 5) return 'text-error';
    if (remaining <= 10) return 'text-warning';
    return 'text-base-content/50';
  });

  ngOnInit(): void {
    // Initialize timer based on timeoutAt from request
    this.updateTimeRemaining();

    // Countdown timer - update every second
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

  /**
   * Calculate and update time remaining from request.timeoutAt
   * @returns Current time remaining in seconds
   */
  private updateTimeRemaining(): number {
    const remaining = Math.max(
      0,
      Math.floor((this.request().timeoutAt - Date.now()) / 1000)
    );
    this.timeRemaining.set(remaining);
    return remaining;
  }

  /**
   * Clear the timer interval
   */
  private clearTimer(): void {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = undefined;
    }
  }

  /**
   * Check if an option is currently selected (for multi-select checkboxes)
   */
  protected isOptionSelected(question: string, option: string): boolean {
    const current = this.selectedAnswers()[question] || '';
    const options = current ? current.split(', ') : [];
    return options.includes(option);
  }

  /**
   * Handle single-select option selection (radio button)
   * @param question The question text
   * @param option The selected option label
   */
  protected onOptionSelect(question: string, option: string): void {
    this.selectedAnswers.update((a) => ({ ...a, [question]: option }));
  }

  /**
   * Handle multi-select option toggle (checkbox)
   * Maintains comma-separated string of selected options per SDK docs
   * @param question The question text
   * @param option The toggled option label
   * @param event The checkbox change event
   */
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
        // Add option if not already present
        if (!options.includes(option)) {
          options.push(option);
        }
      } else {
        // Remove option
        const idx = options.indexOf(option);
        if (idx >= 0) {
          options.splice(idx, 1);
        }
      }

      return { ...a, [question]: options.join(', ') };
    });
  }

  /**
   * Submit answers to parent component
   * Emits response with all selected answers
   */
  protected onSubmit(): void {
    if (!this.canSubmit()) return;

    this.answered.emit({
      id: this.request().id,
      answers: this.selectedAnswers(),
    });
  }
}
