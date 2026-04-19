import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import {
  AdminApiService,
  AdminBulkEmailResponse,
} from '../../../../services/admin-api.service';

/**
 * BulkEmailModal — DaisyUI dialog for sending a marketing email to selected
 * users.
 *
 * Opens when the parent sets `[open]="true"`. Shows a subject + HTML body
 * form; on submit calls `AdminApiService.bulkEmail` and then renders a
 * success summary with a Close button (parent decides when to fully dismiss).
 *
 * Angular 21: standalone, OnPush, signal-based inputs/outputs, no
 * FormsModule — a minimal signal-driven form is simpler and avoids pulling
 * in ReactiveFormsModule in a lazy admin bundle.
 */
@Component({
  selector: 'ptah-admin-bulk-email-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './bulk-email-modal.html',
})
export class BulkEmailModal {
  private readonly api = inject(AdminApiService);

  /** Show/hide the modal. Parent owns the signal. */
  public readonly open = input<boolean>(false);

  /** Recipients. Required. */
  public readonly userIds = input.required<readonly string[]>();

  /** Emitted when the user requests the modal to close (backdrop/Close). */
  public readonly closeModal = output<void>();

  /** Emitted after a successful bulk-email call with the server response. */
  public readonly submitted = output<AdminBulkEmailResponse>();

  // --- Form state ----------------------------------------------------------

  protected readonly subject = signal<string>('');
  protected readonly html = signal<string>('');

  protected readonly sending = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly result = signal<AdminBulkEmailResponse | null>(null);

  protected readonly recipientCount = computed<number>(
    () => this.userIds().length,
  );

  protected readonly canSubmit = computed<boolean>(() => {
    if (this.sending()) return false;
    if (this.result()) return false;
    if (this.recipientCount() === 0) return false;
    const subject = this.subject().trim();
    const html = this.html().trim();
    return (
      subject.length > 0 &&
      html.length > 0 &&
      subject.length <= 200 &&
      html.length <= 50000
    );
  });

  public constructor() {
    // Reset form state every time the modal opens so stale data/results from
    // a previous session do not leak in.
    effect(() => {
      if (this.open()) {
        this.subject.set('');
        this.html.set('');
        this.errorMessage.set(null);
        this.result.set(null);
        this.sending.set(false);
      }
    });
  }

  // --- Event handlers ------------------------------------------------------

  protected onSubjectInput(event: Event): void {
    const t = event.target as HTMLInputElement | null;
    this.subject.set(t?.value ?? '');
  }

  protected onHtmlInput(event: Event): void {
    const t = event.target as HTMLTextAreaElement | null;
    this.html.set(t?.value ?? '');
  }

  protected onCloseClick(): void {
    if (this.sending()) return;
    this.closeModal.emit();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) return;

    const payload = {
      userIds: Array.from(this.userIds()),
      subject: this.subject().trim(),
      html: this.html().trim(),
    };

    this.sending.set(true);
    this.errorMessage.set(null);

    this.api.bulkEmail(payload).subscribe({
      next: (res) => {
        this.sending.set(false);
        this.result.set(res);
        this.submitted.emit(res);
      },
      error: (err: unknown) => {
        this.sending.set(false);
        this.errorMessage.set(this.extractErrorMessage(err));
      },
    });
  }

  private extractErrorMessage(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const anyErr = err as { error?: { message?: string }; message?: string };
      return (
        anyErr.error?.message ??
        anyErr.message ??
        'Failed to send bulk email. Please try again.'
      );
    }
    return 'Failed to send bulk email. Please try again.';
  }
}
