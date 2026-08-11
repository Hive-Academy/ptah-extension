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
  ADMIN_APPROVE_WAITLIST_MAX_IDS,
  AdminApiService,
  AdminApproveWaitlistResponse,
} from '../../services/admin-api.service';

/** One line of the post-approval summary, in the order an admin reads it. */
interface OutcomeLine {
  key: 'approved' | 'already_approved' | 'already_paid' | 'not_found' | 'failed';
  label: string;
  count: number;
  /** Explains why the outcome happened — the skips are the load-bearing ones. */
  hint: string;
  /** DaisyUI text colour for the count. */
  tone: string;
}

/**
 * ApproveWaitlistModal — the single confirmation path for approving waitlist
 * rows into the founding cohort (`POST /api/v1/admin/waitlist/approve`).
 *
 * This modal REPLACES the deleted invite modal, which sold a paid founding
 * discount. There is no batch/"oldest N" mode any more: approval is
 * always an explicit list of ids, because it grants real licences and mails
 * real people. A per-row Approve click opens this with a single id; the bulk
 * action opens it with the current selection.
 *
 * Two states:
 * - Confirm — states the count, the free 1-year grant, the `Founding Members`
 *   cohort, and that one email goes out per person (R9.2).
 * - Result — the full per-outcome tally, INCLUDING the skips. A summary that
 *   showed only successes would hide `already_paid`, the one outcome an admin
 *   most needs to see (R9.3).
 *
 * On failure the modal surfaces the server's sanitized message and leaves the
 * request un-submitted; the parent keeps its selection so the admin can retry
 * without re-picking rows (R9.6).
 */
@Component({
  selector: 'ptah-admin-approve-waitlist-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './approve-waitlist-modal.html',
})
export class ApproveWaitlistModal {
  private readonly api = inject(AdminApiService);

  /** Show/hide the modal. Parent owns the signal. */
  public readonly open = input<boolean>(false);

  /** Waitlist row ids to approve — one for a per-row click, N for bulk. */
  public readonly ids = input<readonly string[]>([]);

  /** Emitted when the user requests the modal to close. */
  public readonly closeModal = output<void>();

  /** Emitted after a successful call, carrying the whole per-row response. */
  public readonly submitted = output<AdminApproveWaitlistResponse>();

  /** Mirrors the server DTO's `@ArrayMaxSize(50)`. */
  protected readonly maxIds = ADMIN_APPROVE_WAITLIST_MAX_IDS;

  protected readonly submitting = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly result = signal<AdminApproveWaitlistResponse | null>(null);

  protected readonly count = computed<number>(() => this.ids().length);

  /** Over the server cap — blocked here so the admin sees why, not a raw 400. */
  protected readonly overLimit = computed<boolean>(
    () => this.count() > this.maxIds,
  );

  protected readonly canSubmit = computed<boolean>(
    () =>
      !this.submitting() &&
      this.result() === null &&
      this.count() > 0 &&
      !this.overLimit(),
  );

  /**
   * The result summary, always all five outcomes so a zero is visibly zero
   * rather than absent.
   */
  protected readonly outcomeLines = computed<readonly OutcomeLine[]>(() => {
    const tally = this.result()?.tally;
    if (!tally) return [];
    return [
      {
        key: 'approved' as const,
        label: 'Approved',
        count: tally.approved,
        hint: 'Free 1-year Builders access granted, cohort assigned, welcome email sent.',
        tone: 'text-success',
      },
      {
        key: 'already_approved' as const,
        label: 'Already approved',
        count: tally.already_approved,
        hint: 'Approved earlier — nothing was granted again and no email was re-sent.',
        tone: 'text-info',
      },
      {
        key: 'already_paid' as const,
        label: 'Already paid',
        count: tally.already_paid,
        hint: 'These people already bought a membership, so they were skipped.',
        tone: 'text-warning',
      },
      {
        key: 'not_found' as const,
        label: 'Not found',
        count: tally.not_found,
        hint: 'No waitlist row matched the id — it may have been deleted since the list loaded.',
        tone: 'text-base-content/70',
      },
      {
        key: 'failed' as const,
        label: 'Failed',
        count: tally.failed,
        hint: 'Rolled back — no licence, no cohort placement, no email. Safe to retry.',
        tone: 'text-error',
      },
    ];
  });

  /** Rows whose grant committed but whose welcome email did not go out. */
  protected readonly emailWarningCount = computed<number>(
    () =>
      this.result()?.results.filter((r) => r.warning !== undefined).length ?? 0,
  );

  public constructor() {
    effect(() => {
      // Reset every time the modal is opened so a previous run's tally or
      // error never bleeds into the next confirmation.
      if (this.open()) {
        this.submitting.set(false);
        this.errorMessage.set(null);
        this.result.set(null);
      }
    });
  }

  protected onCloseClick(): void {
    if (this.submitting()) return;
    this.closeModal.emit();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) return;

    this.submitting.set(true);
    this.errorMessage.set(null);

    this.api.approveWaitlist({ ids: Array.from(this.ids()) }).subscribe({
      next: (res) => {
        this.submitting.set(false);
        this.result.set(res);
        this.submitted.emit(res);
      },
      error: (err: unknown) => {
        // Deliberately does NOT emit `submitted` and does NOT close: the parent
        // keeps its selection so the admin can retry the same rows (R9.6).
        this.submitting.set(false);
        this.errorMessage.set(this.extractErrorMessage(err));
      },
    });
  }

  /** Surfaces the server's sanitized message, never a raw transport string. */
  private extractErrorMessage(err: unknown): string {
    const fallback = 'Failed to approve these rows. Please try again.';
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const shaped = err as { error?: { message?: string }; message?: string };
      return shaped.error?.message ?? shaped.message ?? fallback;
    }
    return fallback;
  }
}
