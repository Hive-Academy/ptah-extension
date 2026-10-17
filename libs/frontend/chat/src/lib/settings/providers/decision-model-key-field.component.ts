import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';

/** Field classes shared by the decision-model row and its key field, so both controls read the same in both themes. */
export const DECISION_FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';
export const DECISION_ACTION = `btn btn-ghost btn-xs h-6 min-h-6 px-1.5 text-[11px] font-medium text-base-content underline underline-offset-2 ${DECISION_FOCUS}`;
/**
 * The anubis-light `.input` / `.select` rule in styles.css sets the border to base-300 (1.21:1) and the placeholder to
 * 50% base-content (3.28:1) at (0,2,0), which beats a plain utility; so both are forced, as the Advanced settings
 * error border is. `base-content-muted` is >= 5.01:1 on base-100/200/300 in both eager themes (base-content-muted.spec.ts).
 */
const CONTROL_INK = '!border-base-content-muted';
export const DECISION_SELECT = `select select-bordered select-sm min-h-8 w-full ${CONTROL_INK} bg-base-100 text-xs text-base-content ${DECISION_FOCUS}`;
const INPUT_BASE = `input input-bordered input-sm min-h-8 w-full min-w-0 bg-base-100 font-mono text-xs text-base-content placeholder:!text-base-content-muted ${DECISION_FOCUS}`;
export const DECISION_INPUT = `${INPUT_BASE} ${CONTROL_INK}`;
/** An invalid field: the measured `--ptah-error-ink` border instead of the muted one, as Advanced settings does. */
export const DECISION_INPUT_INVALID = `${INPUT_BASE} input-error !border-[color:var(--ptah-error-ink,oklch(var(--er)))]`;
export const DECISION_LABEL =
  'block text-xs font-semibold text-base-content-muted';

/** The decision-model kinds whose API key is entered in the row (Jev, custom endpoint). */
export type DecisionKeyedKind = 'jev' | 'custom';

/** The key field's label and the fixed sentences of its removal, per kind. */
export const DECISION_KEY_TEXT: Readonly<
  Record<
    DecisionKeyedKind,
    { label: string; removal: string; removeFailed: string }
  >
> = {
  jev: {
    label: 'TypeSafe Jev API key',
    removal: 'removal of the TypeSafe Jev API key',
    removeFailed: 'Could not remove the TypeSafe Jev API key.',
  },
  custom: {
    label: 'Endpoint API key (optional)',
    removal: 'removal of the custom endpoint API key',
    removeFailed: 'Could not remove the custom endpoint API key.',
  },
};

/**
 * The decision-model API key field (TASK_2026_684 C13), used for TypeSafe Jev and the custom endpoint. A password
 * input that is never prefilled from the host: `value` is only what the user typed in this editor, so the row can
 * clear it after a save. A stored key is never shown. "Remove stored key" is its own button (`remove`), so an empty
 * field never deletes a key. One key field shows at a time, so its element ids are fixed.
 */
@Component({
  selector: 'ptah-decision-model-key-field',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block space-y-2' },
  template: `
    <label for="decision-model-api-key" [class]="labelClass">{{
      label()
    }}</label>
    <input
      #field
      id="decision-model-api-key"
      type="password"
      [class]="inputClass"
      autocomplete="new-password"
      spellcheck="false"
      aria-describedby="decision-model-api-key-help"
      placeholder="Enter a new key to store it"
      [value]="value()"
      [disabled]="disabled()"
      (input)="onInput($event)"
      data-testid="decision-api-key"
    />
    <p id="decision-model-api-key-help" class="text-xs text-base-content-muted">
      Stored in this machine's secret storage. A stored key is never shown here.
    </p>
    @if (showRemove()) {
      <button
        type="button"
        [class]="actionClass"
        [disabled]="disabled()"
        (click)="remove.emit()"
        data-testid="decision-api-key-remove"
      >
        Remove stored key
      </button>
    }
  `,
})
export class DecisionModelKeyFieldComponent {
  protected readonly labelClass = DECISION_LABEL;
  protected readonly inputClass = DECISION_INPUT;
  protected readonly actionClass = DECISION_ACTION;

  readonly label = input.required<string>();
  /** The key typed in this editor; never a stored key. */
  readonly value = input<string>('');
  readonly disabled = input<boolean>(false);
  readonly showRemove = input<boolean>(false);
  readonly valueChange = output<string>();
  readonly remove = output<void>();

  private readonly field =
    viewChild.required<ElementRef<HTMLInputElement>>('field');

  /** Moves focus to the input, e.g. after "Remove stored key" removed the button that had it. */
  focus(): void {
    this.field().nativeElement.focus();
  }

  protected onInput(event: Event): void {
    if (event.target instanceof HTMLInputElement)
      this.valueChange.emit(event.target.value);
  }
}
