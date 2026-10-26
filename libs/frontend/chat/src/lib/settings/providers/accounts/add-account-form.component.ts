import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY,
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  type ProviderAccountSummary,
} from '@ptah-extension/shared';
import { SettingsBusyDisabledDirective } from '../../feedback/busy-disabled.directive';
import { SettingsSaveFeedbackService } from '../../feedback/settings-save-feedback.service';
import { ACCOUNT_COPY, validateAccountName } from './account-presentation';

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * Inline Add form of the Accounts tab (design-spec-p6 "Add (A6)", plan P6 component 8). It asks for a name only: no
 * credential, directory or sign-in, and no helper copy. Submit emits the trimmed name; the parent writes it,
 * announces the outcome and destroys the form on success or Cancel, so each open starts empty.
 *
 * An invalid or duplicate name on submit is announced as an alert toast (P6-A9: the form's own synchronous result)
 * and focus stays in the input. While the Add write is pending the controls are `ptahBusyDisabled`, so focus never
 * drops to the body and nothing is moved programmatically (B-2).
 */
@Component({
  selector: 'ptah-add-account-form',
  standalone: true,
  imports: [SettingsBusyDisabledDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form
      class="space-y-3 rounded-box border border-base-content/15 bg-base-100 px-4 py-3 text-sm text-base-content"
      [attr.aria-busy]="pending() ? 'true' : null"
      (submit)="$event.preventDefault(); submit()"
      (keydown.escape)="escape($event)"
      data-testid="add-account-form"
    >
      <div class="space-y-1">
        <label for="add-account-name" class="block font-semibold">Account name</label>
        <input
          #name
          id="add-account-name"
          type="text"
          [class]="field"
          [value]="label()"
          (input)="edit($event)"
          [ptahBusyDisabled]="pending()"
          autocomplete="off"
          [attr.maxlength]="maxLength"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          data-testid="add-account-name"
        />
      </div>
      <div class="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          [class]="'btn btn-outline btn-sm min-h-8 ' + focusRing"
          [ptahBusyDisabled]="pending()"
          (click)="cancel()"
          data-testid="add-account-cancel"
        >
          Cancel
        </button>
        <button
          type="submit"
          [class]="'btn btn-primary btn-sm min-h-8 ' + focusRing"
          [ptahBusyDisabled]="pending() || empty()"
          data-testid="add-account-submit"
        >
          {{ pending() ? 'Adding…' : 'Add' }}
        </button>
      </div>
    </form>
  `,
})
export class AddAccountFormComponent {
  private readonly feedback = inject(SettingsSaveFeedbackService);

  /** Named accounts of the held host snapshot, for the uniqueness rule. */
  readonly accounts = input.required<readonly ProviderAccountSummary[]>();
  /** The Add write is in flight. */
  readonly pending = input(false);

  /** The trimmed, validated name. Never a selection or a sign-in request. */
  readonly submitted = output<string>();
  /** Cancel or Escape. */
  readonly cancelled = output<void>();

  protected readonly maxLength = PROVIDER_ACCOUNT_LABEL_MAX_LENGTH;
  protected readonly focusRing = FOCUS;
  protected readonly field = `input input-bordered input-sm w-full text-sm text-base-content aria-[invalid=true]:border-2 aria-[invalid=true]:border-state-err ${FOCUS}`;

  protected readonly label = signal('');
  protected readonly empty = computed(() => this.label().trim().length === 0);
  /** The last submit was refused by validation and the value was not edited since. */
  protected readonly invalid = signal(false);

  private readonly nameEl = viewChild.required<ElementRef<HTMLInputElement>>('name');

  constructor() {
    afterNextRender(() => this.nameEl().nativeElement.focus());
  }

  protected edit(event: Event): void {
    this.label.set((event.target as HTMLInputElement).value);
    this.invalid.set(false);
  }

  /** Re-reads the field at submit time (R4), so the emitted name is exactly what is shown. */
  protected submit(): void {
    if (this.pending()) return;
    const input = this.nameEl().nativeElement;
    const value = input.value;
    this.label.set(value);
    const check = validateAccountName(value, this.accounts());
    if (check.ok) {
      this.invalid.set(false);
      this.submitted.emit(check.label);
      return;
    }
    // Empty: Add reads as disabled; nothing to announce.
    if (check.message === null) return;
    this.invalid.set(true);
    const message =
      check.message === PROVIDER_ACCOUNT_DUPLICATE_LABEL_SUMMARY ? ACCOUNT_COPY.nameTaken : check.message;
    this.feedback.announce(message, 'alert');
    input.focus();
  }

  protected cancel(): void {
    if (!this.pending()) this.cancelled.emit();
  }

  /** Escape closes only this form, never the drawer around it. */
  protected escape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.cancel();
  }
}
