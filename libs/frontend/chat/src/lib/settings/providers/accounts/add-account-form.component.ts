import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  isSafeProviderAccountSummary,
  type ProviderAccountSummary,
} from '@ptah-extension/shared';
import { validateAccountName } from './account-presentation';

const FALLBACK_ERROR = 'This action did not complete. Refresh and try again.';
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * Inline "Add another account" form (design §3.5, plan §9). It asks for a name only: no credential, directory or
 * sign-in. Submit emits the trimmed name; the parent writes it and destroys the form on success or Cancel, so each
 * open starts empty. Validation and the host refusal share one `role=alert` slot; a refusal keeps the typed value.
 *
 * Focus: the input on creation. While the Add write is pending the controls are disabled, so focus moves to the
 * polite "Adding…" status first (busy rule §3.7 c); after a refusal it returns to the input only if it is still on
 * that status (B-2).
 */
@Component({
  selector: 'ptah-add-account-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form
      class="mt-2 space-y-2 rounded-lg border border-base-300 bg-base-200 p-3 text-xs text-base-content"
      [attr.aria-busy]="pending() ? 'true' : null"
      (submit)="$event.preventDefault(); submit()"
      (keydown.escape)="escape($event)"
      data-testid="add-account-form"
    >
      <div class="space-y-1">
        <label for="add-account-name" class="block text-sm font-semibold">Name this account</label>
        <p id="add-account-name-hint" class="text-base-content-muted">
          For example: Work, or Team plan. Only you see this name. Each name must be different.
        </p>
        <input
          #name
          id="add-account-name"
          type="text"
          [class]="field"
          [value]="label()"
          (input)="edit($event)"
          [disabled]="pending()"
          autocomplete="off"
          [attr.maxlength]="maxLength"
          [attr.aria-invalid]="alertText() ? 'true' : 'false'"
          aria-describedby="add-account-name-hint add-account-name-error"
          data-testid="add-account-name"
        />
      </div>

      <p
        id="add-account-name-error"
        class="min-h-[1rem] font-semibold"
        role="alert"
        data-testid="add-account-error"
      >{{ alertText() ?? '' }}</p>

      <p
        #status
        class="min-h-[1rem] outline-none"
        role="status"
        aria-live="polite"
        tabindex="-1"
        data-testid="add-account-status"
      >{{ pending() ? 'Adding…' : '' }}</p>

      <div class="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          [class]="'btn btn-outline btn-sm min-h-[30px] ' + focusRing"
          [disabled]="pending()"
          (click)="cancel()"
          data-testid="add-account-cancel"
        >
          Cancel
        </button>
        <button
          type="submit"
          [class]="'btn btn-primary btn-sm min-h-[30px] ' + focusRing"
          [disabled]="!canSubmit()"
          data-testid="add-account-submit"
        >
          {{ pending() ? 'Adding…' : 'Add account' }}
        </button>
      </div>
    </form>
  `,
})
export class AddAccountFormComponent {
  private readonly document = inject(DOCUMENT);

  /** Named accounts of the held host snapshot, for the uniqueness rule. */
  readonly accounts = input.required<readonly ProviderAccountSummary[]>();
  /** The Add write is in flight. */
  readonly pending = input(false);
  /** Safe host sentence of the last refused Add; anything unsafe becomes fixed copy. */
  readonly refusal = input<string | null>(null);

  /** The trimmed, validated name. Never a selection or a sign-in request. */
  readonly submitted = output<string>();
  /** Cancel or Escape. */
  readonly cancelled = output<void>();

  protected readonly maxLength = PROVIDER_ACCOUNT_LABEL_MAX_LENGTH;
  protected readonly focusRing = FOCUS;
  protected readonly field = `input input-bordered input-sm mt-1 w-full text-xs text-base-content aria-[invalid=true]:border-2 aria-[invalid=true]:border-state-err ${FOCUS}`;

  protected readonly label = signal('');
  /** The value was edited after the last submit, so a host refusal no longer describes it. */
  private readonly editedSinceSubmit = signal(true);
  private readonly check = computed(() => validateAccountName(this.label(), this.accounts()));

  protected readonly canSubmit = computed(() => !this.pending() && this.check().ok);
  protected readonly alertText = computed(() => {
    const check = this.check();
    if (!check.ok && check.message !== null) return check.message;
    const refusal = this.refusal();
    if (refusal === null || this.pending() || this.editedSinceSubmit()) return null;
    return isSafeProviderAccountSummary(refusal) ? refusal : FALLBACK_ERROR;
  });

  private readonly nameEl = viewChild.required<ElementRef<HTMLInputElement>>('name');
  private readonly statusEl = viewChild.required<ElementRef<HTMLElement>>('status');
  /** Focus was moved to the status line for the pending Add (B-2 waiting target). */
  private readonly waiting = signal(false);

  constructor() {
    afterNextRender(() => this.nameEl().nativeElement.focus());

    afterRenderEffect(() => {
      const pending = this.pending();
      const waiting = this.waiting();
      if (pending || !waiting) return;
      this.waiting.set(false);
      const status = this.statusEl().nativeElement;
      if (this.document.activeElement === status && status.isConnected) {
        this.nameEl().nativeElement.focus();
      }
    });
  }

  protected edit(event: Event): void {
    this.label.set((event.target as HTMLInputElement).value);
    this.editedSinceSubmit.set(true);
  }

  /** Re-reads the field at submit time (R4), so the emitted name is exactly what is shown. */
  protected submit(): void {
    if (this.pending()) return;
    const value = this.nameEl().nativeElement.value;
    this.label.set(value);
    const check = validateAccountName(value, this.accounts());
    if (!check.ok) return;
    this.editedSinceSubmit.set(false);
    // The parent's write disables the controls; focus leaves them first.
    this.statusEl().nativeElement.focus();
    this.waiting.set(true);
    this.submitted.emit(check.label);
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
