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
import type { SessionRangeSelection } from '@ptah-web/ui';

/**
 * SessionFormModal — daisyUI dialog for scheduling or rescheduling a Builders
 * session on the Google Calendar.
 *
 * Dual mode driven by the `session` input: `null` → create (POST
 * /api/v1/admin/sessions), non-null → edit (PATCH .../sessions/:eventId).
 *
 * `createMeetLink` is offered on create, and on edit only when the session has
 * no conference yet. Google DOES attach one to an existing event (the provider
 * sends `conferenceDataVersion=1` on patch too), but there is no removal
 * through this path — an on/off control for a link that only goes one way
 * would misdescribe what saving does.
 *
 * ⚠️ ONE FIELD HERE CAN SEND EMAIL. `notifyGuests` patches with
 * `sendUpdates=all`, so Google tells the guest list about the change. It
 * defaults off on every open and is only offered when editing a session that
 * already has guests. Everything else on this form — including a rescheduling
 * drag, which never opens this modal at all — is silent by construction.
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

  /**
   * Create-mode start/end seed from a calendar grid selection. Ignored in edit
   * mode, where `session` is the authoritative source for the times.
   */
  public readonly initialRange = input<SessionRangeSelection | null>(null);

  /**
   * Create-mode title seed from a session-type template. Ignored in edit mode,
   * where `session.title` wins.
   */
  public readonly initialTitle = input<string | null>(null);

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

  /** Guest list as it will be sent. Recorded on the event; emails nobody. */
  protected readonly attendees = signal<string[]>([]);

  /**
   * ⚠️ Opt-in guest notification for this save. Defaults OFF every time the
   * modal opens — a notification is a decision about someone else's inbox, and
   * a remembered `true` would silently ride along on the next unrelated edit.
   */
  protected readonly notifyGuests = signal<boolean>(false);
  protected readonly attendeeDraft = signal<string>('');
  protected readonly attendeeError = signal<string | null>(null);

  protected readonly saving = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly isEdit = computed<boolean>(() => this.session() !== null);

  /**
   * Offer the Meet toggle on create, and on edit only when the session has no
   * link yet. Google can attach a conference to an existing event, but it has
   * no "remove" through this path — showing an on/off control for a link that
   * cannot be turned off would be a lie about what saving does.
   */
  protected readonly showMeetToggle = computed<boolean>(() => {
    const existing = this.session();
    return existing === null || existing.meetLink === null;
  });

  /**
   * Offer guest notification only when editing a session that HAS guests.
   *
   * Not on create: a brand-new event has no one to notify about a change, and
   * its guests are invited deliberately through "Send invitations" instead.
   */
  protected readonly showNotifyToggle = computed<boolean>(() => {
    const existing = this.session();
    return existing !== null && existing.attendees.length > 0;
  });

  /** Live guest count, for the notification control's copy. */
  protected readonly guestCount = computed<number>(
    () => this.attendees().length,
  );

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
      // Edit mode reads the session; create mode reads the grid selection when
      // the modal was opened by dragging the calendar, and is blank otherwise.
      const seed = s ?? this.initialRange();
      this.title.set(s?.title ?? this.initialTitle() ?? '');
      this.description.set(s?.description ?? '');
      this.startsAt.set(seed ? toLocalInputValue(seed.startsAt) : '');
      this.endsAt.set(seed ? toLocalInputValue(seed.endsAt) : '');
      this.attendees.set(s ? s.attendees.map((a) => a.email) : []);
      this.attendeeDraft.set('');
      this.attendeeError.set(null);
      this.notifyGuests.set(false);
      // Defaults on for create. On edit it means "add one", and the toggle is
      // only rendered when the session has none, so `true` never claims to
      // re-mint a link that already exists.
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

  protected onNotifyGuestsChange(event: Event): void {
    this.notifyGuests.set(
      (event.target as HTMLInputElement | null)?.checked ?? false,
    );
  }

  protected onAttendeeDraftInput(event: Event): void {
    this.attendeeDraft.set(
      (event.target as HTMLInputElement | null)?.value ?? '',
    );
    this.attendeeError.set(null);
  }

  /**
   * Commit the draft address as a chip.
   *
   * Validated and de-duplicated here rather than on submit: the server rejects
   * the whole request on one malformed address, and finding out after filling
   * in the rest of the form is a worse trade than being told immediately.
   */
  protected onAttendeeCommit(event: Event): void {
    event.preventDefault();
    const email = this.attendeeDraft().trim().toLowerCase();
    if (email.length === 0) return;

    if (!EMAIL_PATTERN.test(email)) {
      this.attendeeError.set(`"${email}" is not a valid email address.`);
      return;
    }
    if (this.attendees().includes(email)) {
      this.attendeeError.set(`${email} is already on the guest list.`);
      return;
    }

    this.attendees.update((list) => [...list, email]);
    this.attendeeDraft.set('');
    this.attendeeError.set(null);
  }

  protected removeAttendee(email: string): void {
    this.attendees.update((list) => list.filter((item) => item !== email));
    this.attendeeError.set(null);
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
          // The server REPLACES the guest list with what it receives, and this
          // signal was seeded from the loaded session, so it is always the
          // complete list — removing a chip really removes that guest.
          attendees: this.attendees(),
          // ⚠️ The only field on this request that can send email. Sent as a
          // literal so an unticked box is an explicit `false`, not an absence
          // the server has to interpret.
          notifyGuests: this.notifyGuests(),
          // Only sent when the session has no conference yet (`showMeetToggle`).
          // Sending `false` on an event that has one is harmless but would be a
          // field with no meaning; sending nothing keeps the patch honest.
          ...(this.showMeetToggle()
            ? { createMeetLink: this.createMeetLink() }
            : {}),
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
          attendees: this.attendees(),
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
 * Guest-address shape. Deliberately permissive — a UX guard that catches the
 * obvious typo before the round-trip, not an authority. `class-validator`'s
 * `@IsEmail` on the server is the real boundary, and a stricter pattern here
 * would only reject addresses the server would have accepted.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
