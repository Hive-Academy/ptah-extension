import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type { AnswerValue, DiscoveryQuestion } from '@ptah-extension/shared';

/**
 * QuestionCardComponent - Presentational component for rendering a single discovery question
 *
 * Purpose:
 * - Render a single question based on its input type (single-select, multi-select, text)
 * - Emit value changes back to the parent component
 * - Provide accessible, DaisyUI-styled form controls
 *
 * Input Types:
 * - single-select: Selectable radio-style cards with highlighted border
 * - multi-select: Toggle-able chip/badge selections
 * - text: Standard text input with placeholder
 *
 * Usage:
 * ```html
 * <ptah-question-card
 *   [question]="question"
 *   [value]="currentAnswer"
 *   (valueChange)="onAnswerChange($event)"
 * />
 * ```
 */
@Component({
  selector: 'ptah-question-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-4">
      <span class="text-sm font-medium mb-2 block">
        {{ question().text }}
        @if (question().required) {
          <span class="text-error">*</span>
        }
      </span>

      @switch (question().inputType) {
        @case ('single-select') {
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            @for (option of question().options ?? []; track option.value) {
              <button
                type="button"
                class="border rounded-lg p-3 text-left transition-all w-full
                       hover:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/50"
                [class.border-primary]="value() === option.value"
                [class.bg-primary/5]="value() === option.value"
                [class.border-base-300]="value() !== option.value"
                [class.bg-base-200/30]="value() !== option.value"
                (click)="onSingleSelect(option.value)"
                [attr.aria-pressed]="value() === option.value"
                [attr.aria-label]="option.label"
                role="radio"
                [attr.aria-checked]="value() === option.value"
              >
                <div class="flex items-center gap-2">
                  <div
                    class="w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center"
                    [class.border-primary]="value() === option.value"
                    [class.border-base-300]="value() !== option.value"
                  >
                    @if (value() === option.value) {
                      <div class="w-2 h-2 rounded-full bg-primary"></div>
                    }
                  </div>
                  <div>
                    <span class="text-xs font-medium">{{ option.label }}</span>
                    @if (option.description) {
                      <p class="text-xs text-base-content/50 mt-0.5">
                        {{ option.description }}
                      </p>
                    }
                  </div>
                </div>
              </button>
            }
          </div>
        }

        @case ('multi-select') {
          <div class="flex flex-wrap gap-2">
            @for (option of question().options ?? []; track option.value) {
              <button
                type="button"
                class="badge gap-1 cursor-pointer transition-all text-xs py-3 px-3
                       hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-primary/50"
                [class.badge-primary]="isMultiSelected(option.value)"
                [class.badge-outline]="!isMultiSelected(option.value)"
                (click)="onMultiToggle(option.value)"
                [attr.aria-pressed]="isMultiSelected(option.value)"
                [attr.aria-label]="option.label"
                role="checkbox"
                [attr.aria-checked]="isMultiSelected(option.value)"
              >
                {{ option.label }}
              </button>
            }
          </div>
          @if (question().minSelections && question().minSelections! > 0) {
            <p class="text-xs text-base-content/40 mt-1">
              Select at least {{ question().minSelections }}
            </p>
          }
        }

        @case ('text') {
          <input
            type="text"
            class="input input-bordered input-sm w-full"
            [placeholder]="question().placeholder ?? ''"
            [value]="textValue()"
            (input)="onTextInput($event)"
            [attr.aria-label]="question().text"
          />
        }
      }
    </div>
  `,
})
export class QuestionCardComponent {
  /**
   * The discovery question to render.
   */
  readonly question = input.required<DiscoveryQuestion>();

  /**
   * Current answer value for this question.
   */
  readonly value = input<AnswerValue | undefined>();

  /**
   * Emits when the answer value changes.
   */
  valueChange = output<AnswerValue>();

  /**
   * Get the current value as a string for text inputs.
   */
  protected textValue(): string {
    const val = this.value();
    if (typeof val === 'string') return val;
    return '';
  }

  /**
   * Check if a value is selected in a multi-select question.
   */
  protected isMultiSelected(optionValue: string): boolean {
    const val = this.value();
    if (Array.isArray(val)) return val.includes(optionValue);
    return false;
  }

  /**
   * Handle single-select option click.
   */
  protected onSingleSelect(optionValue: string): void {
    this.valueChange.emit(optionValue);
  }

  /**
   * Handle multi-select toggle.
   * Adds or removes the value from the current selection array.
   */
  protected onMultiToggle(optionValue: string): void {
    const current = this.value();
    const currentArray = Array.isArray(current) ? [...current] : [];

    const index = currentArray.indexOf(optionValue);
    if (index >= 0) {
      currentArray.splice(index, 1);
    } else {
      const maxSelections = this.question().maxSelections;
      if (maxSelections && currentArray.length >= maxSelections) {
        return;
      }
      currentArray.push(optionValue);
    }

    this.valueChange.emit(currentArray);
  }

  /**
   * Handle text input change.
   */
  protected onTextInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.valueChange.emit(target.value);
  }
}
