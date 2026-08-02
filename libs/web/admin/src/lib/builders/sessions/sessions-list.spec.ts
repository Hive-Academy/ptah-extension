import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';

import {
  AdminBuildersApiService,
  AdminSession,
  AdminSessionsResponse,
} from '../../services/admin-builders-api.service';
import { SessionsCalendar } from './components/sessions-calendar/sessions-calendar';
import { SessionsList } from './sessions-list';

function session(overrides: Partial<AdminSession> = {}): AdminSession {
  return {
    id: 'evt-1',
    title: 'Builders Office Hours',
    startsAt: '2026-08-10T17:00:00.000Z',
    endsAt: '2026-08-10T18:00:00.000Z',
    meetLink: null,
    recurring: false,
    description: null,
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
  };

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

  const calendar = (): SessionsCalendar =>
    fixture.debugElement.query(By.directive(SessionsCalendar)).componentInstance;

  const detailsDialog = (): HTMLElement | null =>
    fixture.nativeElement.querySelector('.modal-open');

  beforeEach(() => {
    api = {
      listSessions: jest.fn().mockReturnValue(of(response())),
      updateSession: jest.fn().mockReturnValue(of(session())),
      deleteSession: jest.fn().mockReturnValue(of({ deleted: true })),
    };
    TestBed.configureTestingModule({
      imports: [SessionsList],
      providers: [{ provide: AdminBuildersApiService, useValue: api }],
    });
  });

  describe('view switching', () => {
    it('opens on the calendar, with no table and no lookahead select', () => {
      api.listSessions.mockReturnValue(of(response({ sessions: [session()] })));
      createComponent();

      expect(
        fixture.debugElement.query(By.directive(SessionsCalendar)),
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
        fixture.debugElement.query(By.directive(SessionsCalendar)),
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

  describe('recurring-row disabling', () => {
    it('disables Edit and Delete on a recurring row even when the calendar is writable', () => {
      api.listSessions.mockReturnValue(
        of(
          response({
            calendarWritable: true,
            sessions: [session({ recurring: true })],
          }),
        ),
      );
      createComponent();
      showTable();

      const row = rows()[0];
      expect(findButton(row, 'Edit').disabled).toBe(true);
      expect(findButton(row, 'Delete').disabled).toBe(true);
      expect(row.textContent).toContain('series');
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
      expect(dialog?.querySelector('a[href="https://meet.example/x"]')).not.toBeNull();
      expect(buttonsIn(dialog as Element).map((b) => b.textContent?.trim())).toEqual(
        expect.arrayContaining(['Edit', 'Delete', 'Close']),
      );
    });

    it('offers no mutation on the recurring series and says why', () => {
      api.listSessions.mockReturnValue(
        of(response({ calendarWritable: true, sessions: [session()] })),
      );
      createComponent();

      calendar().sessionSelected.emit(session({ recurring: true }));
      fixture.detectChanges();

      const dialog = detailsDialog() as Element;
      const labels = buttonsIn(dialog).map((b) => b.textContent?.trim());
      expect(labels).not.toContain('Edit');
      expect(labels).not.toContain('Delete');
      expect(dialog.textContent).toContain('Recurring series');
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
