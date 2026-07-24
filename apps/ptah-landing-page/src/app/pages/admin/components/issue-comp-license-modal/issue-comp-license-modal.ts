import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  of,
  switchMap,
} from 'rxjs';
import {
  AdminApiService,
  IssueComplimentaryLicenseRequest,
  IssueComplimentaryLicenseResponse,
} from '../../../../services/admin-api.service';

/** A user match surfaced by the search-mode recipient combobox. */
export interface LicenseRecipientOption {
  id: string;
  email: string;
  name: string;
}

@Component({
  selector: 'app-issue-comp-license-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './issue-comp-license-modal.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IssueCompLicenseModalComponent {
  /**
   * Target user id — the user-detail path. Optional so the modal can also be
   * opened from a waitlist row (which has no user id) via {@link email}.
   */
  public readonly userId = input<string>('');
  /** Display email for the user-detail path. */
  public readonly userEmail = input<string>('');
  /**
   * Target email — the Early Adopter approval path (opened from a waitlist
   * row). When set, the request is sent as `{ email }` and defaults are
   * pre-filled (1-year duration, "Early adopter approval" reason).
   */
  public readonly email = input<string>('');
  /**
   * Entry-point contract (design spec §6.3):
   *   - `'bound'`  (default): the recipient is fixed via `userId`/`email` —
   *     the original Users-detail and Waitlist-approve behavior, UNCHANGED.
   *   - `'search'`: no recipient is bound; the modal renders a type-ahead
   *     combobox so an admin can pick any user (Licenses-list issuance).
   */
  public readonly mode = input<'bound' | 'search'>('bound');
  public issued = output<IssueComplimentaryLicenseResponse>();

  private adminApi = inject(AdminApiService);

  /** True when opened from a waitlist row (email-targeted). */
  public readonly isWaitlistMode = computed(
    () => this.email().trim().length > 0,
  );

  /**
   * True when the modal must resolve its own recipient. Only when `mode` is
   * `'search'` AND no recipient is bound — a bound `userId`/`email` always wins
   * so existing call sites are never forced into the combobox.
   */
  public readonly isSearchMode = computed(
    () =>
      this.mode() === 'search' && !this.userId().trim() && !this.email().trim(),
  );

  // --- Search-mode recipient combobox ---

  /** Raw text in the recipient search box. */
  public readonly recipientQuery = signal('');
  /** The chosen recipient — issuance targets this user's id. */
  public readonly selectedRecipient = signal<LicenseRecipientOption | null>(
    null,
  );

  /** Debounced type-ahead against `list('users', { search, pageSize: 5 })`. */
  private readonly recipientResults$ = toObservable(this.recipientQuery).pipe(
    debounceTime(250),
    distinctUntilChanged(),
    switchMap((raw) => {
      const term = raw.trim();
      // Don't query on an empty box or once a recipient is locked in.
      if (term.length < 2 || this.selectedRecipient()) {
        return of<LicenseRecipientOption[]>([]);
      }
      return this.adminApi.list('users', { search: term, pageSize: 5 }).pipe(
        switchMap((res) => of(res.data.map(toRecipientOption))),
        catchError(() => of<LicenseRecipientOption[]>([])),
      );
    }),
  );

  public readonly recipientResults = toSignal(this.recipientResults$, {
    initialValue: [] as LicenseRecipientOption[],
  });

  /** Email shown in the header/success copy, whichever path opened the modal. */
  public readonly displayEmail = computed(
    () =>
      this.email().trim() ||
      this.userEmail() ||
      this.selectedRecipient()?.email ||
      '',
  );

  public readonly isOpen = signal(false);
  public readonly isLoading = signal(false);
  public readonly error = signal<string | null>(null);
  public readonly result = signal<IssueComplimentaryLicenseResponse | null>(
    null,
  );

  public readonly durationPreset = signal<
    '30d' | '1y' | '5y' | 'custom' | 'never'
  >('30d');
  public readonly customExpiresAt = signal('');
  public readonly reason = signal('');
  public readonly sendEmail = signal(true);
  public readonly stackOnTopOfPaid = signal(false);

  public readonly canSubmit = computed(
    () =>
      this.reason().length >= 1 &&
      this.reason().length <= 500 &&
      (this.durationPreset() !== 'custom' || !!this.customExpiresAt()) &&
      // Search mode additionally requires a chosen recipient.
      (!this.isSearchMode() || this.selectedRecipient() !== null) &&
      !this.isLoading(),
  );

  public readonly emailSent = computed(
    () => this.result() !== null && !this.result()?.warning && this.sendEmail(),
  );
  public readonly emailError = computed(
    () => this.result()?.warning?.error ?? null,
  );

  public open() {
    this.isOpen.set(true);
    this.error.set(null);
    this.result.set(null);
    // Early Adopter approvals default to a 1-year grant with a stock reason;
    // the user-detail path keeps the original 30-day / blank-reason defaults.
    const waitlist = this.isWaitlistMode();
    this.durationPreset.set(waitlist ? '1y' : '30d');
    this.customExpiresAt.set('');
    this.reason.set(waitlist ? 'Early adopter approval' : '');
    this.sendEmail.set(true);
    this.stackOnTopOfPaid.set(false);
    this.isLoading.set(false);
    // Reset the search-mode combobox so a reopened modal never keeps a stale
    // recipient (bound-mode call sites never touch these).
    this.recipientQuery.set('');
    this.selectedRecipient.set(null);
  }

  public close() {
    this.isOpen.set(false);
  }

  /** Lock in a recipient from the combobox and collapse the results list. */
  public selectRecipient(option: LicenseRecipientOption) {
    this.selectedRecipient.set(option);
    this.recipientQuery.set(option.email);
  }

  /** Clear the chosen recipient to re-open the type-ahead. */
  public clearRecipient() {
    this.selectedRecipient.set(null);
    this.recipientQuery.set('');
  }

  protected onRecipientInput(value: string) {
    // Editing the box after a pick invalidates the previous selection.
    if (this.selectedRecipient()) this.selectedRecipient.set(null);
    this.recipientQuery.set(value);
  }

  public confirm() {
    if (!this.canSubmit()) return;
    this.isLoading.set(true);
    this.error.set(null);

    const emailTarget = this.email().trim();
    const searchRecipient = this.isSearchMode()
      ? this.selectedRecipient()
      : null;
    // Target precedence: search-mode picked user → bound email → bound userId.
    const target: Pick<IssueComplimentaryLicenseRequest, 'userId' | 'email'> =
      searchRecipient
        ? { userId: searchRecipient.id }
        : emailTarget
          ? { email: emailTarget }
          : { userId: this.userId() };

    const body: IssueComplimentaryLicenseRequest = {
      ...target,
      durationPreset: this.durationPreset(),
      customExpiresAt:
        this.durationPreset() === 'custom'
          ? this.toApiValue(this.customExpiresAt())
          : undefined,
      plan: 'builders' as const,
      reason: this.reason(),
      sendEmail: this.sendEmail(),
      stackOnTopOfPaid: this.stackOnTopOfPaid(),
    };

    this.adminApi.issueComplimentaryLicense(body).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        this.result.set(res);
      },
      error: (err: unknown) => {
        this.isLoading.set(false);
        const errorBody = (err as any)?.error;
        const code = errorBody?.code;
        const existing = errorBody?.existingLicense;

        if (code === 'EXISTING_ACTIVE_LICENSE' && existing) {
          this.error.set(
            `User already has an active ${existing.plan} license (${
              existing.source
            }) expiring ${
              existing.expiresAt || 'never'
            }. Tick "Stack on top of paid" to proceed.`,
          );
        } else if (code === 'INVALID_CUSTOM_DATE') {
          this.error.set('The custom expiration date must be in the future.');
        } else if (code === 'REASON_REQUIRED') {
          this.error.set('A reason is required.');
        } else {
          this.error.set(
            errorBody?.message || 'Failed to issue license. Please try again.',
          );
        }
      },
    });
  }

  public done() {
    const res = this.result();
    if (res) {
      this.issued.emit(res);
    }
    this.close();
  }

  public copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  private toApiValue(value: string): string {
    if (!value.trim()) return '';
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d.toISOString();
  }
}

/** Map a raw admin `users` list row to a combobox option (defensive reads). */
function toRecipientOption(
  row: Record<string, unknown>,
): LicenseRecipientOption {
  const id =
    typeof row['id'] === 'string' ? row['id'] : String(row['id'] ?? '');
  const email = typeof row['email'] === 'string' ? row['email'] : '';
  const first = typeof row['firstName'] === 'string' ? row['firstName'] : '';
  const last = typeof row['lastName'] === 'string' ? row['lastName'] : '';
  const name = `${first} ${last}`.trim();
  return { id, email, name };
}
