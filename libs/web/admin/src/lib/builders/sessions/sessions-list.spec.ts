import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import {
  AdminBuildersApiService,
  AdminSession,
  AdminSessionsResponse,
} from '../../services/admin-builders-api.service';
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
    deleteSession: jest.Mock;
  };

  const createComponent = (): void => {
    fixture = TestBed.createComponent(SessionsList);
    fixture.detectChanges();
  };

  const rows = (): HTMLTableRowElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('tbody tr'));

  const buttonsIn = (el: Element): HTMLButtonElement[] =>
    Array.from(el.querySelectorAll('button')) as HTMLButtonElement[];

  const findButton = (el: Element, text: string): HTMLButtonElement => {
    const found = buttonsIn(el).find((b) => b.textContent?.trim() === text);
    if (!found) {
      throw new Error(`No <button> with text "${text}" found`);
    }
    return found;
  };

  beforeEach(() => {
    api = {
      listSessions: jest.fn().mockReturnValue(of(response())),
      deleteSession: jest.fn().mockReturnValue(of({ deleted: true })),
    };
    TestBed.configureTestingModule({
      imports: [SessionsList],
      providers: [{ provide: AdminBuildersApiService, useValue: api }],
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

      const row = rows()[0];
      const actionCell = row.querySelector('td:last-child');
      expect(actionCell?.querySelector('button')).toBeNull();
      expect(actionCell?.textContent).toContain('read-only');

      expect(fixture.nativeElement.textContent).toContain(
        'Calendar is read-only',
      );
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

      const rowButtons = buttonsIn(rows()[0]);
      expect(rowButtons.some((b) => b.textContent?.trim() === 'Edit')).toBe(
        true,
      );
      expect(rowButtons.some((b) => b.textContent?.trim() === 'Delete')).toBe(
        true,
      );
      expect(fixture.nativeElement.textContent).not.toContain(
        'Calendar is read-only',
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

      const row = rows()[0];
      const editBtn = findButton(row, 'Edit');
      const deleteBtn = findButton(row, 'Delete');

      expect(editBtn.disabled).toBe(true);
      expect(deleteBtn.disabled).toBe(true);
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

      const row = rows()[0];
      const editBtn = findButton(row, 'Edit');
      expect(editBtn.disabled).toBe(false);
    });
  });

  it('refetches with the newly selected lookahead window', () => {
    createComponent();
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

    const row = (): HTMLTableRowElement => rows()[0];
    findButton(row(), 'Delete').click();
    fixture.detectChanges();

    findButton(row(), 'Cancel').click();
    fixture.detectChanges();

    expect(api.deleteSession).not.toHaveBeenCalled();
    expect(row().textContent).not.toContain('Delete this session?');
  });
});
