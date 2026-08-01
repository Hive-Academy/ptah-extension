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

  describe('create-only meet-link control', () => {
    it('offers "Create a Meet link" in create mode but not in edit mode', () => {
      openCreate();
      expect(fixture.nativeElement.textContent).toContain('Create a Meet link');

      closeModal();
      openEdit(session());
      expect(fixture.nativeElement.textContent).not.toContain(
        'Create a Meet link',
      );
    });
  });
});
