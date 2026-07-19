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
  AssignGroupMembersResponse,
  MemberGroup,
} from '../../../../../services/admin-api.service';

/**
 * AssignMembersModal — DaisyUI dialog for bulk-assigning users to a member
 * cohort via `POST /api/v1/admin/groups/:id/assign`.
 *
 * Accepts pasted emails (one per line) and/or pasted user UUIDs (one per
 * line) — either or both may be supplied. The server resolves + dedupes and
 * skips anything already assigned or unresolved; it does not return
 * per-item reasons, so the result only shows the `{ assigned, skipped }`
 * tallies.
 */
@Component({
  selector: 'ptah-admin-assign-members-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './assign-members-modal.html',
})
export class AssignMembersModal {
  private readonly api = inject(AdminApiService);

  /** Show/hide the modal. Parent owns the signal. */
  public readonly open = input<boolean>(false);

  /** The cohort members are being assigned to. */
  public readonly group = input<MemberGroup | null>(null);

  /** Emitted when the user requests the modal to close. */
  public readonly closeModal = output<void>();

  /** Emitted after a successful assign call with the server response. */
  public readonly submitted = output<AssignGroupMembersResponse>();

  protected readonly emailsRaw = signal<string>('');
  protected readonly userIdsRaw = signal<string>('');

  protected readonly sending = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly result = signal<AssignGroupMembersResponse | null>(null);

  protected readonly parsedEmails = computed<string[]>(() =>
    this.emailsRaw()
      .split(/[\n,]+/)
      .map((e) => e.trim())
      .filter((e) => e.length > 0),
  );

  protected readonly parsedUserIds = computed<string[]>(() =>
    this.userIdsRaw()
      .split(/[\n,]+/)
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );

  protected readonly canSubmit = computed<boolean>(() => {
    if (this.sending() || this.result() !== null) return false;
    return this.parsedEmails().length > 0 || this.parsedUserIds().length > 0;
  });

  public constructor() {
    effect(() => {
      if (this.open()) {
        this.emailsRaw.set('');
        this.userIdsRaw.set('');
        this.sending.set(false);
        this.errorMessage.set(null);
        this.result.set(null);
      }
    });
  }

  protected onEmailsInput(event: Event): void {
    this.emailsRaw.set(
      (event.target as HTMLTextAreaElement | null)?.value ?? '',
    );
  }

  protected onUserIdsInput(event: Event): void {
    this.userIdsRaw.set(
      (event.target as HTMLTextAreaElement | null)?.value ?? '',
    );
  }

  protected onCloseClick(): void {
    if (this.sending()) return;
    this.closeModal.emit();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    const group = this.group();
    if (!group || !this.canSubmit()) return;

    this.sending.set(true);
    this.errorMessage.set(null);

    const emails = this.parsedEmails();
    const userIds = this.parsedUserIds();

    this.api
      .assignGroupMembers(group.id, {
        emails: emails.length > 0 ? emails : undefined,
        userIds: userIds.length > 0 ? userIds : undefined,
      })
      .subscribe({
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
      const msg = anyErr.error?.message ?? anyErr.message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string') return msg;
    }
    return 'Failed to assign members. Please try again.';
  }
}
