import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import {
  DECISION_INPUT,
  DECISION_INPUT_INVALID,
  DECISION_LABEL,
} from './decision-model-key-field.component';

/**
 * The custom endpoint's Base URL field of the decision-model editor (TASK_2026_684 C13). Presentational: the row owns
 * the draft and the validation; `error` is the inline hint to show, or `null`. One base URL field shows at a time, so
 * its element ids are fixed.
 */
@Component({
  selector: 'ptah-decision-model-base-url-field',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block space-y-2' },
  template: `
    <label for="decision-model-base-url" [class]="labelClass">Base URL</label>
    <input
      id="decision-model-base-url"
      type="text"
      inputmode="url"
      [class]="error() ? invalidInputClass : inputClass"
      autocomplete="off"
      spellcheck="false"
      placeholder="https://decide.example.com"
      [attr.aria-invalid]="error() ? 'true' : null"
      [attr.aria-describedby]="describedBy()"
      [value]="value()"
      [disabled]="disabled()"
      (input)="onInput($event)"
      (keydown.enter)="submitted.emit()"
      data-testid="decision-base-url"
    />
    <p
      id="decision-model-base-url-help"
      class="text-xs text-base-content-muted"
      data-testid="decision-base-url-help"
    >
      Requests go to this URL plus /v1/systemone. With an API key it must use
      https, unless the endpoint is on this machine (localhost, [::1] or
      127.x.x.x).
    </p>
    <!-- Two text-xs lines are reserved, so a hint never resizes the editor or moves this field (P4 re-review 7). -->
    <div class="min-h-8" data-testid="decision-base-url-error-slot">
      @if (error(); as message) {
        <p
          id="decision-model-base-url-error"
          role="alert"
          class="text-xs text-error"
          data-testid="decision-base-url-error"
        >
          {{ message }}
        </p>
      }
    </div>
  `,
})
export class DecisionModelBaseUrlFieldComponent {
  protected readonly labelClass = DECISION_LABEL;
  protected readonly inputClass = DECISION_INPUT;
  protected readonly invalidInputClass = DECISION_INPUT_INVALID;

  /** The base URL as typed. */
  readonly value = input<string>('');
  /** The inline hint for the typed value, or `null`. */
  readonly error = input<string | null>(null);
  readonly disabled = input<boolean>(false);
  readonly valueChange = output<string>();
  /** Enter in the field: the row saves when it can. */
  readonly submitted = output<void>();

  protected readonly describedBy = computed(() =>
    this.error()
      ? 'decision-model-base-url-help decision-model-base-url-error'
      : 'decision-model-base-url-help',
  );

  protected onInput(event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.valueChange.emit(event.target.value);
  }
}
