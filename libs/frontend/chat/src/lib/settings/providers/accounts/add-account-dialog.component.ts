import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  isSafeProviderAccountLabel,
  isSafeProviderAccountSummary,
  type ProviderAccountActionResult,
} from '@ptah-extension/shared';
import { NativeModalComponent } from '@ptah-extension/ui';

const PENDING = 'Adding profile…';
const FALLBACK_ERROR = 'This action did not complete. Refresh and try again.';
const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content';

/**
 * Label-only Add Claude account dialog (design §3.1/§3.6, plan :250-252), on the shared `NativeModalComponent`.
 * It asks for a bounded local label and nothing else: no credential, directory, sign-in or process. Add emits the
 * trimmed label; the parent writes it through the account state owner and closes the dialog on the committed result.
 * Adding never selects the new profile. Labels need not be unique; the host's secret-free refusal (for example the
 * duplicate-directory sentence) arrives through `error` and is shown in an alert inside the dialog, because
 * `showModal()` makes the page's own live regions inert. The opener gets focus back on cancel and on success.
 */
@Component({
  selector: 'ptah-add-account-dialog',
  standalone: true,
  imports: [NativeModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-native-modal
      data-glass-surface="overlay"
      [isOpen]="open()"
      ariaLabelledby="add-account-title"
      size="sm"
      (closed)="closed.emit()"
    >
      <div
        modal-header
        class="surface-3 -mx-6 -mt-6 mb-4 space-y-1 border-b px-5 py-3"
        data-testid="add-account-dialog"
      >
        <h2 id="add-account-title" class="text-sm font-bold text-base-content">
          Add a named Claude account
        </h2>
        <p class="text-xs text-base-content-muted">
          Enter a local label only.
        </p>
      </div>

      <form
        class="space-y-3 text-xs"
        (submit)="$event.preventDefault(); submit()"
        data-testid="add-account-form"
      >
        <div class="space-y-1">
          <label
            for="add-account-label"
            class="block font-semibold text-base-content"
            >Local label</label
          >
          <input
            id="add-account-label"
            type="text"
            [class]="field"
            [value]="label()"
            (input)="label.set(value($event))"
            autocomplete="off"
            [attr.maxlength]="maxLength"
            [attr.aria-invalid]="errorText() ? 'true' : null"
            [attr.aria-describedby]="errorText() ? 'add-account-error' : null"
            data-testid="add-account-label"
          />
        </div>

        <p
          class="text-base-content"
          aria-live="polite"
          role="status"
          data-testid="add-account-status"
        >
          {{ pending() ? pendingText : '' }}
        </p>
        @if (errorText(); as message) {
          <p
            id="add-account-error"
            role="alert"
            class="text-base-content"
            data-testid="add-account-error"
          >
            {{ message }}
          </p>
        }

        <div class="modal-action">
          <button
            type="button"
            [class]="'btn btn-outline btn-sm ' + focusRing"
            (click)="closed.emit()"
            data-testid="add-account-cancel"
          >
            Cancel
          </button>
          <button
            type="submit"
            [class]="'btn btn-primary btn-sm ' + focusRing"
            [disabled]="!canSubmit()"
            data-testid="add-account-submit"
          >
            Add profile
          </button>
        </div>
      </form>
    </ptah-native-modal>
  `,
})
export class AddAccountDialogComponent {
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Parent-owned visibility. */
  readonly open = input.required<boolean>();
  /** The Add write is in flight. */
  readonly pending = input(false);
  /** Refusal of the last Add; its safe sentence is shown, anything else becomes fixed copy. */
  readonly error = input<ProviderAccountActionResult | null>(null);

  /** The trimmed, bounded label to add. No selection intent is ever emitted. */
  readonly add = output<string>();
  /** Cancel, Escape or backdrop. */
  readonly closed = output<void>();

  protected readonly label = signal('');
  protected readonly maxLength = PROVIDER_ACCOUNT_LABEL_MAX_LENGTH;
  protected readonly pendingText = PENDING;
  protected readonly focusRing = FOCUS;
  protected readonly field = `input input-bordered input-sm w-full text-xs text-base-content ${FOCUS}`;

  private readonly trimmed = computed(() => this.label().trim());
  protected readonly canSubmit = computed(
    () => !this.pending() && isSafeProviderAccountLabel(this.trimmed()),
  );
  protected readonly errorText = computed(() => {
    const error = this.error();
    if (error === null || this.pending()) return null;
    return isSafeProviderAccountSummary(error.summary)
      ? error.summary
      : FALLBACK_ERROR;
  });

  private opener: HTMLElement | null = null;
  private wasOpen = false;

  constructor() {
    // Each open starts empty; the opener is captured on open and refocused when the parent closes the dialog.
    effect(() => {
      const open = this.open();
      untracked(() => {
        if (open && !this.wasOpen) {
          this.label.set('');
          this.opener = this.focusedOutside();
        }
        if (!open && this.wasOpen) {
          const opener = this.opener;
          this.opener = null;
          if (opener?.isConnected) opener.focus();
        }
        this.wasOpen = open;
      });
    });
  }

  protected submit(): void {
    if (!this.canSubmit()) return;
    this.add.emit(this.trimmed());
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  private focusedOutside(): HTMLElement | null {
    const active = this.document.activeElement;
    if (!(active instanceof HTMLElement) || active === this.document.body)
      return null;
    return this.host.nativeElement.contains(active) ? null : active;
  }
}
