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
  AdminInviteWaitlistResponse,
} from '../../../../services/admin-api.service';

/**
 * WaitlistInviteModal — DaisyUI dialog for sending founding-invite emails to
 * waitlist rows.
 *
 * Two mutually exclusive modes, mirroring `POST /api/v1/admin/waitlist/invite`
 * semantics (`ids` wins over `batchSize` server-side):
 * - `selected`: invite the ids the parent's table selection passed in.
 * - `oldest`: invite the N oldest un-notified rows via `batchSize`.
 */
@Component({
  selector: 'ptah-admin-waitlist-invite-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './waitlist-invite-modal.html',
})
export class WaitlistInviteModal {
  private readonly api = inject(AdminApiService);

  /** Show/hide the modal. Parent owns the signal. */
  public readonly open = input<boolean>(false);

  /** Explicit recipients from the table selection (may be empty). */
  public readonly selectedIds = input<readonly string[]>([]);

  /** Emitted when the user requests the modal to close. */
  public readonly closeModal = output<void>();

  /** Emitted after a successful invite call with the server response. */
  public readonly submitted = output<AdminInviteWaitlistResponse>();

  protected readonly mode = signal<'selected' | 'oldest'>('selected');
  protected readonly batchSize = signal<number>(25);

  protected readonly sending = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly result = signal<AdminInviteWaitlistResponse | null>(null);

  protected readonly canSubmit = computed<boolean>(() => {
    if (this.sending() || this.result() !== null) return false;
    if (this.mode() === 'selected') return this.selectedIds().length > 0;
    return Number.isInteger(this.batchSize()) && this.batchSize() > 0;
  });

  public constructor() {
    effect(() => {
      if (this.open()) {
        this.mode.set(this.selectedIds().length > 0 ? 'selected' : 'oldest');
        this.batchSize.set(25);
        this.sending.set(false);
        this.errorMessage.set(null);
        this.result.set(null);
      }
    });
  }

  protected onBatchSizeInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const value = Number(target?.value ?? 0);
    this.batchSize.set(Number.isFinite(value) ? Math.trunc(value) : 0);
  }

  protected onCloseClick(): void {
    if (this.sending()) return;
    this.closeModal.emit();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) return;

    this.sending.set(true);
    this.errorMessage.set(null);

    const body =
      this.mode() === 'selected'
        ? { ids: Array.from(this.selectedIds()) }
        : { batchSize: this.batchSize() };

    this.api.inviteWaitlist(body).subscribe({
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
        'Failed to send founding invites. Please try again.'
      );
    }
    return 'Failed to send founding invites. Please try again.';
  }
}
