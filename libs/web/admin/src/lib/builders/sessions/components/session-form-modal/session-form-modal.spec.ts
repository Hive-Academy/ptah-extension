import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import {
  AdminBuildersApiService,
  AdminSession,
} from '../../../../services/admin-builders-api.service';
import { SessionFormModal } from './session-form-modal';

function session(overrides: Partial<AdminSession> = {}): AdminSession {
  return {
    id: 'evt-1',
    title: 'Builders Office Hours',
    startsAt: '2026-08-10T17:00:00.000Z',
    endsAt: '2026-08-10T18:00:00.000Z',
    meetLink: null,
    recurring: false,
    description: 'Bring your questions.',
    attendees: [],
    ...overrides,
  };
}

describe('SessionFormModal', () => {
  let fixture: ComponentFixture<SessionFormModal>;
  let api: {
    createSession: jest.Mock;
    updateSession: jest.Mock;
  };

  const q = {
    title: (): HTMLInputElement =>
      fixture.nativeElement.querySelector(
        'input[placeholder="e.g. Builders Office Hours"]',
      ),
    description: (): HTMLTextAreaElement =>
      fixture.nativeElement.querySelector('textarea'),
    startsAt: (): HTMLInputElement =>
      fixture.nativeElement.querySelectorAll('input[type="datetime-local"]')[0],
    endsAt: (): HTMLInputElement =>
      fixture.nativeElement.querySelectorAll('input[type="datetime-local"]')[1],
    submitButton: (): HTMLButtonElement =>
      fixture.nativeElement.querySelector('button[type="submit"]'),
    form: (): HTMLFormElement => fixture.nativeElement.querySelector('form'),
  };

  const typeInto = (
    el: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ): void => {
    el.value = value;
    el.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  const openCreate = (): void => {
    fixture.componentRef.setInput('session', null);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  };

  const openEdit = (target: AdminSession): void => {
    fixture.componentRef.setInput('session', target);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  };

  const closeModal = (): void => {
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
  };

  const submit = (): void => {
    q.form().dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
  };

  beforeEach(() => {
    api = {
      createSession: jest.fn().mockReturnValue(of(session())),
      updateSession: jest.fn().mockReturnValue(of(session())),
    };
    TestBed.configureTestingModule({
      imports: [SessionFormModal],
      providers: [{ provide: AdminBuildersApiService, useValue: api }],
    });
    fixture = TestBed.createComponent(SessionFormModal);
  });

  describe('rangeValid / canSubmit (the branching this review flagged)', () => {
    it('disables submit until both a title and a valid, ordered start/end range are present', () => {
      openCreate();
      expect(q.submitButton().disabled).toBe(true);

      typeInto(q.title(), 'Office Hours');
      expect(q.submitButton().disabled).toBe(true); // no range yet

      typeInto(q.startsAt(), '2026-09-01T10:00');
      typeInto(q.endsAt(), '2026-09-01T09:00'); // end before start
      expect(q.submitButton().disabled).toBe(true);

      typeInto(q.endsAt(), '2026-09-01T11:00'); // end after start
      expect(q.submitButton().disabled).toBe(false);
    });

    it('rejects an end time equal to the start time (strictly-after, not on-or-after)', () => {
      openCreate();
      typeInto(q.title(), 'Office Hours');
      typeInto(q.startsAt(), '2026-09-01T10:00');
      typeInto(q.endsAt(), '2026-09-01T10:00');
      expect(q.submitButton().disabled).toBe(true);
    });

    it('shows the range error only once both fields have been touched, not while the form is still empty', () => {
      openCreate();
      typeInto(q.title(), 'Office Hours');
      expect(fixture.nativeElement.textContent).not.toContain(
        'The end time must be after the start time.',
      );

      typeInto(q.startsAt(), '2026-09-01T10:00');
      typeInto(q.endsAt(), '2026-09-01T09:00');
      expect(fixture.nativeElement.textContent).toContain(
        'The end time must be after the start time.',
      );
    });
  });

  describe('description handling — the unconditional-send decision this review flagged', () => {
    it('prefills the description from the loaded session in edit mode', () => {
      openEdit(session({ description: 'Bring your laptop.' }));
      expect(q.description().value).toBe('Bring your laptop.');
    });

    it('sends description: "" (not omitted) when an admin blanks a prefilled description', () => {
      // Deliberate: with prefill, a blank box unambiguously means "clear it".
      // A conditional send here would silently no-op the clear and leave the
      // stale description on the calendar event.
      openEdit(session({ id: 'evt-42', description: 'Bring your laptop.' }));
      typeInto(q.description(), '');
      submit();

      expect(api.updateSession).toHaveBeenCalledWith(
        'evt-42',
        expect.objectContaining({ description: '' }),
      );
    });

    it('still sends the typed description unconditionally when it is non-empty', () => {
      openEdit(session({ id: 'evt-42', description: 'Old text' }));
      typeInto(q.description(), 'New text');
      submit();

      expect(api.updateSession).toHaveBeenCalledWith(
        'evt-42',
        expect.objectContaining({ description: 'New text' }),
      );
    });
  });

  describe('server reason-code mapping', () => {
    it('maps protected_recurring_event to operator-readable copy instead of a raw body', () => {
      api.updateSession.mockReturnValue(
        throwError(() => ({ error: { reason: 'protected_recurring_event' } })),
      );
      openEdit(session());
      submit();

      expect(fixture.nativeElement.textContent).toContain(
        'recurring Builders series',
      );
    });

    it('maps calendar_write_unavailable to operator-readable copy instead of a raw body', () => {
      api.updateSession.mockReturnValue(
        throwError(() => ({ error: { reason: 'calendar_write_unavailable' } })),
      );
      openEdit(session());
      submit();

      expect(fixture.nativeElement.textContent).toContain(
        'Re-consent is required',
      );
    });

    it('falls back to the server message for an unmapped reason', () => {
      api.updateSession.mockReturnValue(
        throwError(() => ({ error: { message: 'Something else went wrong' } })),
      );
      openEdit(session());
      submit();

      expect(fixture.nativeElement.textContent).toContain(
        'Something else went wrong',
      );
    });
  });

  /**
   * This block used to assert "the Meet toggle is create-only", encoding the
   * old belief that Google could not attach conferencing to an existing event.
   * It can — the provider was simply not sending `conferenceDataVersion=1` on
   * patch. The contract is now about whether a link ALREADY EXISTS, not about
   * create vs edit.
   */
  describe('meet-link control', () => {
    it('offers to create a link in create mode', () => {
      openCreate();
      expect(fixture.nativeElement.textContent).toContain('Create a Meet link');
    });

    it('offers to add a link when editing a session that has none', () => {
      openEdit(session({ meetLink: null }));

      expect(fixture.nativeElement.textContent).toContain('Add a Meet link');
    });

    it('offers no toggle when the session already has a link, and says why', () => {
      openEdit(session({ meetLink: 'https://meet.google.com/abc-defg-hij' }));

      // An on/off control for a link this path cannot turn off would be a lie
      // about what saving does.
      expect(fixture.nativeElement.textContent).not.toContain(
        'Meet link</span>',
      );
      expect(
        fixture.nativeElement.querySelector('input[type="checkbox"]'),
      ).toBeNull();
      expect(fixture.nativeElement.textContent).toContain(
        'already has a Meet link',
      );
    });

    it('sends createMeetLink on an edit of a session with no link', () => {
      openEdit(session({ id: 'evt-2', meetLink: null }));
      submit();

      expect(api.updateSession).toHaveBeenCalledWith(
        'evt-2',
        expect.objectContaining({ createMeetLink: true }),
      );
    });

    it('omits createMeetLink entirely when the session already has a link', () => {
      openEdit(session({ id: 'evt-3', meetLink: 'https://meet.google.com/x' }));
      submit();

      expect(api.updateSession.mock.calls[0][1]).not.toHaveProperty(
        'createMeetLink',
      );
    });
  });

  /**
   * Guests are recorded on the event and NOBODY is emailed here — sending is a
   * separate action on the details dialog. These tests pin that boundary as
   * much as they pin the chip mechanics.
   */
  describe('guest list', () => {
    const guestInput = (): HTMLInputElement =>
      fixture.nativeElement.querySelector('input[type="email"]');

    const addGuest = (email: string): void => {
      typeInto(guestInput(), email);
      guestInput().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      fixture.detectChanges();
    };

    it('prefills the guest list from the loaded session', () => {
      openEdit(
        session({
          attendees: [{ email: 'a@example.com', responseStatus: 'accepted' }],
        }),
      );

      expect(fixture.nativeElement.textContent).toContain('a@example.com');
    });

    it('adds a typed address as a chip and submits it', () => {
      openCreate();
      typeInto(q.title(), 'Office hours');
      typeInto(q.startsAt(), '2026-09-01T17:00');
      typeInto(q.endsAt(), '2026-09-01T18:00');
      addGuest('New@Example.com');

      expect(fixture.nativeElement.textContent).toContain('new@example.com');
      submit();

      expect(api.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ attendees: ['new@example.com'] }),
      );
    });

    it('refuses a malformed address before the round-trip', () => {
      openCreate();
      addGuest('not-an-email');

      expect(fixture.nativeElement.textContent).toContain(
        'is not a valid email address',
      );
    });

    it('refuses a duplicate rather than inviting someone twice', () => {
      openEdit(
        session({
          attendees: [{ email: 'a@example.com', responseStatus: null }],
        }),
      );
      addGuest('A@example.com');

      expect(fixture.nativeElement.textContent).toContain(
        'already on the guest list',
      );
    });

    it('sends the complete list on edit, so removing a chip removes that guest', () => {
      openEdit(
        session({
          id: 'evt-5',
          attendees: [
            { email: 'keep@example.com', responseStatus: null },
            { email: 'drop@example.com', responseStatus: null },
          ],
        }),
      );

      const removeButton = Array.from<HTMLButtonElement>(
        fixture.nativeElement.querySelectorAll('button[aria-label^="Remove"]'),
      ).find((b) => b.getAttribute('aria-label') === 'Remove drop@example.com');
      removeButton?.click();
      fixture.detectChanges();
      submit();

      // The server REPLACES the guest list with what it receives, so a partial
      // list here would silently uninvite people.
      expect(api.updateSession).toHaveBeenCalledWith(
        'evt-5',
        expect.objectContaining({ attendees: ['keep@example.com'] }),
      );
    });

    it('states that saving emails nobody', () => {
      openCreate();

      expect(fixture.nativeElement.textContent).toContain(
        'Nobody is emailed until you choose',
      );
    });

    it('does not carry a guest list across a close and reopen', () => {
      openEdit(
        session({
          attendees: [{ email: 'a@example.com', responseStatus: null }],
        }),
      );
      expect(fixture.nativeElement.textContent).toContain('a@example.com');

      closeModal();
      openCreate();

      // The reset effect reseeds from the new inputs. Leaking the previous
      // session's guests into a blank create form would invite strangers to it.
      expect(fixture.nativeElement.textContent).not.toContain('a@example.com');
    });
  });
});
