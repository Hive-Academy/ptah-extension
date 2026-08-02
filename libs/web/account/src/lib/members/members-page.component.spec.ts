import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';

import { MembersApiService, type BuildersSession } from '@ptah-web/core';
import { SessionCalendar } from '@ptah-web/ui';

import { MembersPageComponent } from './members-page.component';

function session(overrides: Partial<BuildersSession> = {}): BuildersSession {
  return {
    id: 'evt-1',
    title: 'Builders Office Hours',
    startsAt: '2026-08-10T17:00:00.000Z',
    endsAt: '2026-08-10T18:00:00.000Z',
    meetLink: 'https://meet.google.com/abc-defg-hij',
    recurring: false,
    ...overrides,
  };
}

/**
 * ⚠️ THE MEMBER SURFACE RENDERS THE ADMIN'S CALENDAR COMPONENT.
 *
 * `SessionCalendar` is shared: the admin console passes `writable` from the
 * server's scope verdict, and this page passes a hardcoded `false`. That one
 * input is the entire boundary between "a member is looking at the schedule"
 * and "a member can edit the company calendar", so it is asserted here rather
 * than trusted to a template literal nobody reads.
 *
 * The component's own spec proves what `writable=false` removes. This proves
 * this page actually passes it.
 */
describe('MembersPageComponent — shared calendar', () => {
  let fixture: ComponentFixture<MembersPageComponent>;
  let api: { getSessions: jest.Mock; getCommunitySummary?: jest.Mock };

  const showCalendar = (): void => {
    const tab = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Calendar');
    tab?.click();
    fixture.detectChanges();
  };

  const calendar = (): SessionCalendar<BuildersSession> | null => {
    const found = fixture.debugElement.query(By.directive(SessionCalendar));
    return found ? found.componentInstance : null;
  };

  beforeEach(async () => {
    api = {
      getSessions: jest.fn().mockReturnValue(
        of({
          sessions: [session()],
          communityUrl: null,
          memberGroups: [],
        }),
      ),
    };
    await TestBed.configureTestingModule({
      imports: [MembersPageComponent],
      providers: [
        provideRouter([]),
        { provide: MembersApiService, useValue: api },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MembersPageComponent);
    fixture.detectChanges();
  });

  it('opens on the list — the scannable answer to "when is the next one"', () => {
    expect(calendar()).toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'Builders Office Hours',
    );
  });

  it('renders the shared calendar component on demand', () => {
    showCalendar();

    expect(calendar()).not.toBeNull();
  });

  it('⚠️ passes writable=false, so no mutation affordance is rendered', () => {
    showCalendar();

    expect(calendar()?.writable()).toBe(false);
  });

  it('caps navigation at the 60 days this endpoint can serve', () => {
    showCalendar();

    // The member endpoint has a fixed 60-day window, unlike the admin's
    // widenable one. Paging past it would show empty months that read as a
    // quiet calendar rather than an unfetchable one.
    expect(calendar()?.maxDaysAhead()).toBe(60);
  });

  it('shows a session card when an event is picked', () => {
    showCalendar();
    expect(fixture.nativeElement.textContent).toContain('Select a session');

    fixture.componentInstance.onSessionSelected(session({ title: 'Picked' }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Picked');
  });

  it('drops the selection when switching back to the list', () => {
    showCalendar();
    fixture.componentInstance.onSessionSelected(session());
    fixture.detectChanges();

    fixture.componentInstance.setSessionsView('list');
    fixture.detectChanges();

    // Otherwise a duplicate card of one session would sit under the full list.
    expect(fixture.componentInstance.selectedSession()).toBeNull();
  });

  it('offers no view toggle at all when there are no sessions', () => {
    api.getSessions.mockReturnValue(
      of({ sessions: [], communityUrl: null, memberGroups: [] }),
    );
    fixture = TestBed.createComponent(MembersPageComponent);
    fixture.detectChanges();

    const labels = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Calendar');
    expect(fixture.nativeElement.textContent).toContain(
      'No sessions scheduled',
    );
  });
});
