import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';

import {
  AdminBuildersApiService,
  AdminSession,
  AdminSessionsResponse,
} from '../../services/admin-builders-api.service';
import {
  AdminApiService,
  type MemberGroup,
} from '../../services/admin-api.service';
import { SessionTemplatePalette } from './components/session-template-palette/session-template-palette';
import { SessionCalendar } from '@ptah-web/ui';
import { SessionsList } from './sessions-list';

function cohort(overrides: Partial<MemberGroup> = {}): MemberGroup {
  return {
    id: 'grp-1',
    key: 'founding',
    name: 'Founding',
    description: null,
    discourseGroup: null,
    sessionEventId: 'series-1',
    isDefault: true,
    memberCount: 12,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<AdminSession> = {}): AdminSession {
  return {
    id: 'evt-1',
    title: 'Builders Office Hours',
    startsAt: '2026-08-10T17:00:00.000Z',
    endsAt: '2026-08-10T18:00:00.000Z',
    meetLink: null,
    recurring: false,
    description: null,
    attendees: [],
    isProtectedMaster: false,
    inProtectedSeries: false,
    ...overrides,
  };
}

function response(
  overrides: Partial<AdminSessionsResponse> = {},
): AdminSessionsResponse {
  return {
    sessions: [],
    calendarWritable: true,
    ...overrides,
  };
}

describe('SessionsList', () => {
  let fixture: ComponentFixture<SessionsList>;
  let api: {
    listSessions: jest.Mock;
    updateSession: jest.Mock;
    deleteSession: jest.Mock;
    sendInvitations: jest.Mock;
  };
  let adminApi: { listGroups: jest.Mock };

  const createComponent = (): void => {
    fixture = TestBed.createComponent(SessionsList);
    fixture.detectChanges();
  };

  const buttonsIn = (el: Element): HTMLButtonElement[] =>
    Array.from(el.querySelectorAll('button')) as HTMLButtonElement[];

  const findButton = (el: Element, text: string): HTMLButtonElement => {
    const found = buttonsIn(el).find((b) => b.textContent?.trim() === text);
    if (!found) {
      throw new Error(`No <button> with text "${text}" found`);
    }
    return found;
  };

  /** The table lives behind a tab now; every row assertion goes through here. */
  const showTable = (): void => {
    findButton(fixture.nativeElement, 'Table').click();
    fixture.detectChanges();
  };

  const rows = (): HTMLTableRowElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('tbody tr'));

  const calendar = (): SessionCalendar<AdminSession> =>
    fixture.debugElement.query(By.directive(SessionCalendar)).componentInstance;

  const detailsDialog = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('.modal-open');

  beforeEach(() => {
    api = {
      listSessions: jest.fn().mockReturnValue(of(response())),
      updateSession: jest.fn().mockReturnValue(of(session())),
      deleteSession: jest.fn().mockReturnValue(of({ deleted: true })),
      sendInvitations: jest.fn().mockReturnValue(of(session())),
    };
    adminApi = { listGroups: jest.fn().mockReturnValue(of([cohort()])) };
    TestBed.configureTestingModule({
      imports: [SessionsList],
      providers: [
        { provide: AdminBuildersApiService, useValue: api },
        { provide: AdminApiService, useValue: adminApi },
      ],
    });
  });

  describe('view switching', () => {
    it('opens on the calendar, with no table and no lookahead select', () => {
      api.listSessions.mockReturnValue(of(response({ sessions: [session()] })));
      createComponent();

      expect(
        fixture.debugElement.query(By.directive(SessionCalendar)),
      ).not.toBeNull();
      expect(fixture.nativeElement.querySelector('tbody')).toBeNull();
      expect(
        fixture.nativeElement.querySelector(
          'select[aria-label="Lookahead window in days"]',
        ),
      ).toBeNull();
    });

    it('swaps to the table — and its window select — on demand', () => {
      api.listSessions.mockReturnValue(of(response({ sessions: [session()] })));
      createComponent();
      showTable();

      expect(rows()).toHaveLength(1);
      expect(
        fixture.debugElement.query(By.directive(SessionCalendar)),
      ).toBeNull();
      expect(
        fixture.nativeElement.querySelector(
          'select[aria-label="Lookahead window in days"]',
        ),
      ).not.toBeNull();
    });
  });

  describe('calendarWritable degradation — hidden, not disabled', () => {
    it('hides the "New Session" trigger and every per-row control when the calendar is not writable', () => {
      api.listSessions.mockReturnValue(
        of(response({ calendarWritable: false, sessions: [session()] })),
      );
      createComponent();

      const allButtons = buttonsIn(fixture.nativeElement);
      expect(
        allButtons.some((b) => b.textContent?.includes('New Session')),
      ).toBe(false);
      expect(fixture.nativeElement.textContent).toContain(
        'Calendar is read-only',
      );

      showTable();
      const actionCell = rows()[0].querySelector('td:last-child');
      expect(actionCell?.querySelector('button')).toBeNull();
      expect(actionCell?.textContent).toContain('read-only');
    });

    it('shows the "New Session" trigger and per-row Edit/Delete when the calendar is writable', () => {
      api.listSessions.mockReturnValue(
        of(
          response({
            calendarWritable: true,
            sessions: [session({ recurring: false })],
          }),
        ),
      );
      createComponent();

      const allButtons = buttonsIn(fixture.nativeElement);
      expect(
        allButtons.some((b) => b.textContent?.includes('New Session')),
      ).toBe(true);
      expect(fixture.nativeElement.textContent).not.toContain(
        'Calendar is read-only',
      );

      showTable();
      const rowButtons = buttonsIn(rows()[0]);
      expect(rowButtons.some((b) => b.textContent?.trim() === 'Edit')).toBe(
        true,
      );
      expect(rowButtons.some((b) => b.textContent?.trim() === 'Delete')).toBe(
        true,
      );
    });
  });

  /**
   * ⚠️ BEING IN A SERIES IS NOT A PERMISSION. These previously gated on
   * `recurring`, which disabled Edit and Delete on every event in any series —
   * including ordinary repeats an admin created themselves. The server only
   * ever refused the provisioning-owned one, so the UI was locking an admin out
   * of requests that would have succeeded.
   */
  describe('protected-series gating', () => {
    it('leaves an ordinary recurring row fully actionable', () => {
      api.listSessions.mockReturnValue(
        of(
          response({
            calendarWritable: true,
            // A weekly meeting the admin set up. Recurring, but nothing
            // depends on it, and the server will happily edit or delete it.
            sessions: [
              session({
                recurring: true,
                isProtectedMaster: false,
                inProtectedSeries: false,
              }),
            ],
          }),
        ),
      );
      createComponent();
      showTable();

      const row = rows()[0];
      expect(findButton(row, 'Edit').disabled).toBe(false);
      expect(findButton(row, 'Delete').disabled).toBe(false);
      // Still badged as a series — presentation, not permission.
      expect(row.textContent).toContain('series');
    });

    it('allows editing an INSTANCE of the protected series but not deleting it', () => {
      api.listSessions.mockReturnValue(
        of(
          response({
            calendarWritable: true,
            sessions: [
              session({
                recurring: true,
                isProtectedMaster: false,
                inProtectedSeries: true,
              }),
            ],
          }),
        ),
      );
      createComponent();
      showTable();

      const row = rows()[0];
      // Moving one occurrence is normal and the server accepts it; deleting
      // would reach the series member provisioning depends on.
      expect(findButton(row, 'Edit').disabled).toBe(false);
      expect(findButton(row, 'Delete').disabled).toBe(true);
    });

    it('locks the protected master itself out of both', () => {
      api.listSessions.mockReturnValue(
        of(
          response({
            calendarWritable: true,
            sessions: [
              session({
                recurring: true,
                isProtectedMaster: true,
                inProtectedSeries: true,
              }),
            ],
          }),
        ),
      );
      createComponent();
      showTable();

      const row = rows()[0];
      expect(findButton(row, 'Edit').disabled).toBe(true);
      expect(findButton(row, 'Delete').disabled).toBe(true);
      expect(row.textContent).toContain('provisioning maintains');
    });

    it('leaves a non-recurring row fully actionable', () => {
      api.listSessions.mockReturnValue(
        of(
          response({
            calendarWritable: true,
            sessions: [session({ recurring: false })],
          }),
        ),
      );
      createComponent();
      showTable();

      expect(findButton(rows()[0], 'Edit').disabled).toBe(false);
    });
  });

  it('refetches with the newly selected lookahead window', () => {
    createComponent();
    showTable();
    api.listSessions.mockClear();

    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[aria-label="Lookahead window in days"]',
    );
    select.value = '90';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(api.listSessions).toHaveBeenCalledWith(
      expect.objectContaining({ daysAhead: 90 }),
    );
  });

  describe('calendar-driven window', () => {
    it('refetches when the admin navigates past the loaded window', () => {
      createComponent();
      api.listSessions.mockClear();

      calendar().windowRequested.emit(120);
      fixture.detectChanges();

      expect(api.listSessions).toHaveBeenCalledWith(
        expect.objectContaining({ daysAhead: 120 }),
      );
    });

    it('stays quiet for a range the loaded window already covers', () => {
      createComponent();
      api.listSessions.mockClear();

      calendar().windowRequested.emit(35);
      fixture.detectChanges();

      expect(api.listSessions).not.toHaveBeenCalled();
    });
  });

  describe('reschedule by drag', () => {
    it('PATCHes the new bounds and refreshes', () => {
      createComponent();
      api.listSessions.mockClear();
      const revert = jest.fn();

      calendar().rescheduled.emit({
        session: session({ id: 'evt-4' }),
        startsAt: '2026-08-11T17:00:00.000Z',
        endsAt: '2026-08-11T18:00:00.000Z',
        revert,
      });
      fixture.detectChanges();

      expect(api.updateSession).toHaveBeenCalledWith('evt-4', {
        startsAt: '2026-08-11T17:00:00.000Z',
        endsAt: '2026-08-11T18:00:00.000Z',
      });
      expect(revert).not.toHaveBeenCalled();
      expect(api.listSessions).toHaveBeenCalledTimes(1);
    });

    it('never asks the server to notify — a drag has no moment to ask', () => {
      createComponent();

      calendar().rescheduled.emit({
        session: session({
          id: 'evt-4',
          attendees: [{ email: 'a@example.com', responseStatus: null }],
        }),
        startsAt: '2026-08-11T17:00:00.000Z',
        endsAt: '2026-08-11T18:00:00.000Z',
        revert: jest.fn(),
      });
      fixture.detectChanges();

      expect(api.updateSession.mock.calls[0][1]).not.toHaveProperty(
        'notifyGuests',
      );
    });

    it('says so when guests were left in the dark', () => {
      createComponent();

      calendar().rescheduled.emit({
        session: session({
          attendees: [
            { email: 'a@example.com', responseStatus: null },
            { email: 'b@example.com', responseStatus: null },
          ],
        }),
        startsAt: '2026-08-11T17:00:00.000Z',
        endsAt: '2026-08-11T18:00:00.000Z',
        revert: jest.fn(),
      });
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(
        '2 guests were not notified',
      );
    });

    it('stays quiet about notification when the session has no guests', () => {
      createComponent();

      calendar().rescheduled.emit({
        session: session({ attendees: [] }),
        startsAt: '2026-08-11T17:00:00.000Z',
        endsAt: '2026-08-11T18:00:00.000Z',
        revert: jest.fn(),
      });
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('not notified');
    });

    it('reverts the grid and explains the refusal when the server says no', () => {
      createComponent();
      api.updateSession.mockReturnValue(
        throwError(() => ({
          status: 409,
          error: { reason: 'protected_recurring_event' },
        })),
      );
      const revert = jest.fn();

      calendar().rescheduled.emit({
        session: session({ id: 'evt-5', recurring: true }),
        startsAt: '2026-08-11T17:00:00.000Z',
        endsAt: '2026-08-11T18:00:00.000Z',
        revert,
      });
      fixture.detectChanges();

      expect(revert).toHaveBeenCalledTimes(1);
      expect(fixture.nativeElement.textContent).toContain(
        'recurring Builders series',
      );
    });
  });

  describe('details dialog', () => {
    it('opens on an event click and offers Join / Edit / Delete', () => {
      api.listSessions.mockReturnValue(
        of(response({ calendarWritable: true, sessions: [session()] })),
      );
      createComponent();

      calendar().sessionSelected.emit(
        session({ title: 'Weekly Live', meetLink: 'https://meet.example/x' }),
      );
      fixture.detectChanges();

      const dialog = detailsDialog();
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).toContain('Weekly Live');
      expect(
        dialog?.querySelector('a[href="https://meet.example/x"]'),
      ).not.toBeNull();
      expect(
        buttonsIn(dialog as Element).map((b) => b.textContent?.trim()),
      ).toEqual(expect.arrayContaining(['Edit', 'Delete', 'Close']));
    });

    it('offers no mutation on the protected series and says why', () => {
      api.listSessions.mockReturnValue(
        of(response({ calendarWritable: true, sessions: [session()] })),
      );
      createComponent();

      calendar().sessionSelected.emit(
        session({ recurring: true, inProtectedSeries: true }),
      );
      fixture.detectChanges();

      const dialog = detailsDialog() as Element;
      const labels = buttonsIn(dialog).map((b) => b.textContent?.trim());
      expect(labels).not.toContain('Edit');
      expect(labels).not.toContain('Delete');
      expect(dialog.textContent).toContain('provisioning maintains');
    });

    it('still offers Edit and Delete on an ordinary recurring event', () => {
      api.listSessions.mockReturnValue(
        of(response({ calendarWritable: true, sessions: [session()] })),
      );
      createComponent();

      calendar().sessionSelected.emit(session({ recurring: true }));
      fixture.detectChanges();

      const labels = buttonsIn(detailsDialog() as Element).map((b) =>
        b.textContent?.trim(),
      );
      expect(labels).toEqual(expect.arrayContaining(['Edit', 'Delete']));
    });

    it('deletes from the dialog only after confirmation, then closes', () => {
      api.listSessions.mockReturnValue(
        of(response({ calendarWritable: true, sessions: [session()] })),
      );
      createComponent();

      calendar().sessionSelected.emit(session({ id: 'evt-8' }));
      fixture.detectChanges();

      findButton(detailsDialog() as Element, 'Delete').click();
      fixture.detectChanges();
      expect(api.deleteSession).not.toHaveBeenCalled();

      findButton(detailsDialog() as Element, 'Confirm').click();
      fixture.detectChanges();

      expect(api.deleteSession).toHaveBeenCalledWith('evt-8');
      expect(detailsDialog()).toBeNull();
    });
  });

  describe('session-type palette (cohort-derived)', () => {
    it('renders one draggable chip per cohort', () => {
      adminApi.listGroups.mockReturnValue(
        of([cohort({ key: 'founding', name: 'Founding' })]),
      );
      createComponent();

      const palette = fixture.debugElement.query(
        By.directive(SessionTemplatePalette),
      );
      expect(palette).not.toBeNull();
      expect(palette.nativeElement.textContent).toContain('Founding');
      expect(
        palette.nativeElement.querySelector(
          '[data-session-template="founding"]',
        ),
      ).not.toBeNull();
    });

    it('hides the palette on a read-only grant — nothing there is droppable', () => {
      api.listSessions.mockReturnValue(
        of(response({ calendarWritable: false })),
      );
      createComponent();

      expect(
        fixture.debugElement.query(By.directive(SessionTemplatePalette)),
      ).toBeNull();
    });

    it('degrades to no palette, not an error, when cohorts fail to load', () => {
      adminApi.listGroups.mockReturnValue(
        throwError(() => new Error('groups down')),
      );
      createComponent();

      expect(
        fixture.debugElement.query(By.directive(SessionTemplatePalette)),
      ).toBeNull();
      // The calendar loaded fine; a missing convenience must not look broken.
      expect(
        fixture.debugElement.query(By.directive(SessionCalendar)),
      ).not.toBeNull();
      expect(fixture.nativeElement.querySelector('.alert-error')).toBeNull();
    });

    it('seeds the create form title from a dropped template', () => {
      adminApi.listGroups.mockReturnValue(
        of([cohort({ key: 'founding', name: 'Founding' })]),
      );
      createComponent();

      calendar().rangeSelected.emit({
        startsAt: '2026-09-01T17:00:00.000Z',
        endsAt: '2026-09-01T18:00:00.000Z',
        templateId: 'founding',
      });
      fixture.detectChanges();

      const titleInput: HTMLInputElement = fixture.nativeElement.querySelector(
        'input[placeholder="e.g. Builders Office Hours"]',
      );
      expect(titleInput.value).toBe('Founding — Live Session');
    });

    it('leaves the title blank for a plain drag across empty space', () => {
      createComponent();

      calendar().rangeSelected.emit({
        startsAt: '2026-09-01T17:00:00.000Z',
        endsAt: '2026-09-01T18:00:00.000Z',
      });
      fixture.detectChanges();

      const titleInput: HTMLInputElement = fixture.nativeElement.querySelector(
        'input[placeholder="e.g. Builders Office Hours"]',
      );
      expect(titleInput.value).toBe('');
    });
  });

  /**
   * ⚠️ The blast-radius block on the client side. Sending puts mail in real
   * customers' inboxes, so these pin that it takes two deliberate clicks, that
   * the confirmation states the true recipient count, and that no other action
   * can reach it.
   */
  describe('⚠️ invitations', () => {
    const withGuests = (): AdminSession =>
      session({
        id: 'evt-6',
        attendees: [
          { email: 'a@example.com', responseStatus: 'accepted' },
          { email: 'b@example.com', responseStatus: null },
        ],
      });

    const openDetails = (target: AdminSession): void => {
      api.listSessions.mockReturnValue(
        of(response({ calendarWritable: true, sessions: [target] })),
      );
      createComponent();
      calendar().sessionSelected.emit(target);
      fixture.detectChanges();
    };

    it('does not send on the first click — it asks, naming the recipient count', () => {
      openDetails(withGuests());

      findButton(detailsDialog() as Element, 'Send invitations').click();
      fixture.detectChanges();

      expect(api.sendInvitations).not.toHaveBeenCalled();
      expect(detailsDialog()?.textContent).toContain('Email 2 guests?');
      expect(detailsDialog()?.textContent).toContain('cannot be recalled');
    });

    it('sends on confirmation and reports the outcome', () => {
      openDetails(withGuests());
      api.sendInvitations.mockReturnValue(of(withGuests()));

      findButton(detailsDialog() as Element, 'Send invitations').click();
      fixture.detectChanges();
      findButton(detailsDialog() as Element, 'Send now').click();
      fixture.detectChanges();

      expect(api.sendInvitations).toHaveBeenCalledWith('evt-6');
      expect(fixture.nativeElement.textContent).toContain(
        'Invitations sent to 2 guests.',
      );
    });

    it('backs out without sending', () => {
      openDetails(withGuests());

      findButton(detailsDialog() as Element, 'Send invitations').click();
      fixture.detectChanges();
      findButton(detailsDialog() as Element, 'Cancel').click();
      fixture.detectChanges();

      expect(api.sendInvitations).not.toHaveBeenCalled();
    });

    it('offers nothing to send when the event has no guests', () => {
      openDetails(session({ attendees: [] }));

      const labels = buttonsIn(detailsDialog() as Element).map((b) =>
        b.textContent?.trim(),
      );
      expect(labels).not.toContain('Send invitations');
      expect(detailsDialog()?.textContent).toContain('Nobody is invited yet');
    });

    it('offers nothing to send on the protected series', () => {
      openDetails(
        session({
          recurring: true,
          inProtectedSeries: true,
          attendees: [{ email: 'a@example.com', responseStatus: null }],
        }),
      );

      const labels = buttonsIn(detailsDialog() as Element).map((b) =>
        b.textContent?.trim(),
      );
      expect(labels).not.toContain('Send invitations');
    });

    it('surfaces a refusal without claiming anything was sent', () => {
      openDetails(withGuests());
      api.sendInvitations.mockReturnValue(
        throwError(() => ({
          status: 400,
          error: { reason: 'no_recipients', message: 'No guests to invite.' },
        })),
      );

      findButton(detailsDialog() as Element, 'Send invitations').click();
      fixture.detectChanges();
      findButton(detailsDialog() as Element, 'Send now').click();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain(
        'No guests to invite.',
      );
      expect(fixture.nativeElement.textContent).not.toContain(
        'Invitations sent',
      );
    });

    it('never fires as a side effect of rescheduling', () => {
      createComponent();

      calendar().rescheduled.emit({
        session: session({ id: 'evt-4' }),
        startsAt: '2026-08-11T17:00:00.000Z',
        endsAt: '2026-08-11T18:00:00.000Z',
        revert: jest.fn(),
      });
      fixture.detectChanges();

      expect(api.sendInvitations).not.toHaveBeenCalled();
    });
  });

  it('deletes only after inline confirmation, then refreshes the list', () => {
    api.listSessions.mockReturnValue(
      of(
        response({
          calendarWritable: true,
          sessions: [session({ id: 'evt-7' })],
        }),
      ),
    );
    createComponent();
    showTable();

    const row = (): HTMLTableRowElement => rows()[0];

    findButton(row(), 'Delete').click();
    fixture.detectChanges();

    expect(api.deleteSession).not.toHaveBeenCalled();
    expect(row().textContent).toContain('Delete this session?');

    findButton(row(), 'Confirm').click();
    fixture.detectChanges();

    expect(api.deleteSession).toHaveBeenCalledWith('evt-7');
    // Constructor fetch + the post-delete refetch.
    expect(api.listSessions).toHaveBeenCalledTimes(2);
  });

  it('cancels the inline delete confirmation without calling the API', () => {
    api.listSessions.mockReturnValue(
      of(response({ calendarWritable: true, sessions: [session()] })),
    );
    createComponent();
    showTable();

    const row = (): HTMLTableRowElement => rows()[0];
    findButton(row(), 'Delete').click();
    fixture.detectChanges();

    findButton(row(), 'Cancel').click();
    fixture.detectChanges();

    expect(api.deleteSession).not.toHaveBeenCalled();
    expect(row().textContent).not.toContain('Delete this session?');
  });
});
