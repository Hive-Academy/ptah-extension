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
  AdminBuildersApiService,
  AdminSession,
} from '../../../../services/admin-builders-api.service';

/**
 * SessionFormModal — daisyUI dialog for scheduling or rescheduling a Builders
 * session on the Google Calendar.
 *
 * Dual mode driven by the `session` input: `null` → create (POST
 * /api/v1/admin/sessions), non-null → edit (PATCH .../sessions/:eventId).
 *
 * `createMeetLink` is create-only: Google mints the conference on insert (with
 * `conferenceDataVersion=1`), and the patch path does not add one to an event
 * that shipped without it — offering the checkbox on edit would be a control
 * that silently does nothing.
 *
 * The parent hides this modal's trigger entirely when `calendarWritable` is
 * false, and refuses to open it for the recurring master series (which the
 * server rejects with 409 `protected_recurring_event`).
 */
@Component({
  selector: 'ptah-admin-session-form-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './session-form-modal.html',
})
export class SessionFormModal {
  private readonly api = inject(AdminBuildersApiService);

  /** Show/hide the modal. Parent owns the signal. */
  public readonly open = input<boolean>(false);

  /** `null` = create mode. Non-null = edit mode, pre-fills the form. */
  public readonly session = input<AdminSession | null>(null);

  /** Emitted when the user requests the modal to close without saving. */
  public readonly closeModal = output<void>();

  /** Emitted after a successful create/update. */
  public readonly saved = output<AdminSession>();

  protected readonly title = signal<string>('');
  protected readonly description = signal<string>('');
  /** `datetime-local` value (local wall time, `YYYY-MM-DDTHH:mm`). */
  protected readonly startsAt = signal<string>('');
  protected readonly endsAt = signal<string>('');
  protected readonly createMeetLink = signal<boolean>(true);

  protected readonly saving = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly isEdit = computed<boolean>(() => this.session() !== null);

  /** True when both instants parse and the end is strictly after the start. */
  protected readonly rangeValid = computed<boolean>(() => {
    const start = Date.parse(this.startsAt());
    const end = Date.parse(this.endsAt());
    if (Number.isNaN(start) || Number.isNaN(end)) return false;
    return end > start;
  });

  /** Distinguishes "not filled in yet" from "filled in wrong" for the hint. */
  protected readonly rangeTouched = computed<boolean>(
    () => this.startsAt().length > 0 && this.endsAt().length > 0,
  );

  protected readonly canSubmit = computed<boolean>(() => {
    if (this.saving()) return false;
    if (this.title().trim().length === 0) return false;
    return this.rangeValid();
  });

  public constructor() {
    effect(() => {
      if (!this.open()) return;
      const s = this.session();
      this.title.set(s?.title ?? '');
      this.description.set(s?.description ?? '');
      this.startsAt.set(s ? toLocalInputValue(s.startsAt) : '');
      this.endsAt.set(s ? toLocalInputValue(s.endsAt) : '');
      this.createMeetLink.set(true);
      this.saving.set(false);
      this.errorMessage.set(null);
    });
  }

  protected onTitleInput(event: Event): void {
    this.title.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  protected onDescriptionInput(event: Event): void {
    this.description.set(
      (event.target as HTMLTextAreaElement | null)?.value ?? '',
    );
  }

  protected onStartsAtInput(event: Event): void {
    this.startsAt.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  protected onEndsAtInput(event: Event): void {
    this.endsAt.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  protected onCreateMeetLinkChange(event: Event): void {
    this.createMeetLink.set(
      (event.target as HTMLInputElement | null)?.checked ?? false,
    );
  }

  protected onCloseClick(): void {
    if (this.saving()) return;
    this.closeModal.emit();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) return;

    this.saving.set(true);
    this.errorMessage.set(null);

    const description = this.description().trim();
    const startsAt = new Date(this.startsAt()).toISOString();
    const endsAt = new Date(this.endsAt()).toISOString();
    const existing = this.session();

    const request$ = existing
      ? this.api.updateSession(existing.id, {
          title: this.title().trim(),
          // Sent unconditionally, including when empty. The field now prefills
          // from the loaded session, so a blank box means the admin cleared it
          // — and the server maps `''` through to Google, which clears the
          // event description. Omitting it on empty (the old behaviour, from
          // when edit mode could not prefill) would make clearing impossible.
          description,
          startsAt,
          endsAt,
        })
      : this.api.createSession({
          title: this.title().trim(),
          description: description.length > 0 ? description : undefined,
          startsAt,
          endsAt,
          createMeetLink: this.createMeetLink(),
        });

    request$.subscribe({
      next: (result) => {
        this.saving.set(false);
        this.saved.emit(result);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.errorMessage.set(this.extractErrorMessage(err));
      },
    });
  }

  private extractErrorMessage(err: unknown): string {
    if (err && typeof err === 'object') {
      const anyErr = err as {
        status?: number;
        error?: { message?: string | string[]; reason?: string };
        message?: string;
      };
      // Typed server reasons get operator-readable copy instead of the raw body.
      if (anyErr.error?.reason === 'protected_recurring_event') {
        return 'This is the recurring Builders series that member provisioning depends on. Manage it in Google Calendar directly.';
      }
      if (anyErr.error?.reason === 'calendar_write_unavailable') {
        return 'The server cannot write to Google Calendar right now. Re-consent is required before sessions can be scheduled.';
      }
      const msg = anyErr.error?.message ?? anyErr.message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string') return msg;
    }
    if (typeof err === 'string') return err;
    return 'Failed to save the session. Please try again.';
  }
}

/**
 * ISO 8601 → the `YYYY-MM-DDTHH:mm` local wall time an `<input
 * type="datetime-local">` expects. Built from the local getters rather than
 * slicing `toISOString()`, which would silently shift the value by the
 * viewer's UTC offset.
 */
function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
