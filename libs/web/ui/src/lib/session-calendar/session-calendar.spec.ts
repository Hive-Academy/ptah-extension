import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  CalendarApi,
  CalendarOptions,
  DateSelectInfo,
  DatesSetInfo,
  EventClickInfo,
  EventDropInfo,
  FullCalendarComponent,
} from '@fullcalendar/angular';

import {
  CalendarSession,
  SessionRangeSelection,
  SessionRescheduleRequest,
  SessionCalendar,
} from './session-calendar';

function session(overrides: Partial<CalendarSession> = {}): CalendarSession {
  return {
    id: 'evt-1',
    title: 'Builders Office Hours',
    startsAt: '2026-08-10T17:00:00.000Z',
    endsAt: '2026-08-10T18:00:00.000Z',
    meetLink: null,
    recurring: false,
    ...overrides,
  };
}

describe('SessionCalendar', () => {
  let fixture: ComponentFixture<SessionCalendar>;

  const create = (
    sessions: CalendarSession[],
    writable: boolean,
  ): ComponentFixture<SessionCalendar> => {
    fixture = TestBed.createComponent(SessionCalendar);
    fixture.componentRef.setInput('sessions', sessions);
    fixture.componentRef.setInput('writable', writable);
    fixture.detectChanges();
    return fixture;
  };

  const api = (): CalendarApi =>
    fixture.debugElement
      .query(By.directive(FullCalendarComponent))
      .componentInstance.getApi();

  /**
   * Reads a handler straight off the live calendar and invokes it. Simulating a
   * real pointer drag in jsdom would test jsdom, not this component's mapping
   * from FullCalendar's callback shapes onto our outputs.
   */
  const option = <K extends keyof CalendarOptions>(
    name: K,
  ): NonNullable<CalendarOptions[K]> => {
    const handler = api().getOption(name);
    if (!handler) throw new Error(`Calendar option "${String(name)}" is unset`);
    return handler as NonNullable<CalendarOptions[K]>;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SessionCalendar] });
  });

  it('renders one calendar event per session, carrying the session itself', () => {
    create([session({ id: 'evt-7', title: 'Weekly Live' })], true);

    const events = api().getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('evt-7');
    expect(events[0].title).toBe('Weekly Live');
    expect(events[0].extendedProps['session']).toEqual(
      expect.objectContaining({ id: 'evt-7' }),
    );
  });

  describe('drag gating', () => {
    it('leaves a non-recurring event draggable when the calendar is writable', () => {
      create([session({ recurring: false })], true);

      const event = api().getEvents()[0];
      expect(event.startEditable).toBe(true);
      expect(event.durationEditable).toBe(true);
    });

    it('pins the recurring master in place — the server refuses to move it', () => {
      create([session({ recurring: true })], true);

      const event = api().getEvents()[0];
      expect(event.startEditable).toBe(false);
      expect(event.durationEditable).toBe(false);
    });

    it('makes nothing draggable or selectable on a read-only grant', () => {
      create([session({ recurring: false })], false);

      expect(api().getOption('editable')).toBe(false);
      expect(api().getOption('selectable')).toBe(false);
      expect(api().getEvents()[0].startEditable).toBe(false);
    });
  });

  it('emits the clicked session', () => {
    create([session({ id: 'evt-3' })], true);
    const emitted: CalendarSession[] = [];
    fixture.componentInstance.sessionSelected.subscribe((s) => emitted.push(s));

    option('eventClick')({
      event: api().getEvents()[0],
    } as unknown as EventClickInfo);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].id).toBe('evt-3');
  });

  describe('range selection', () => {
    it('passes a timed selection through unchanged', () => {
      create([], true);
      const emitted: SessionRangeSelection[] = [];
      fixture.componentInstance.rangeSelected.subscribe((r) => emitted.push(r));

      option('select')({
        start: new Date('2026-09-01T17:00:00.000Z'),
        end: new Date('2026-09-01T18:30:00.000Z'),
        allDay: false,
      } as unknown as DateSelectInfo);

      expect(emitted).toEqual([
        {
          startsAt: '2026-09-01T17:00:00.000Z',
          endsAt: '2026-09-01T18:30:00.000Z',
        },
      ]);
    });

    it('collapses an all-day month cell to a one-hour slot on that day', () => {
      create([], true);
      const emitted: SessionRangeSelection[] = [];
      fixture.componentInstance.rangeSelected.subscribe((r) => emitted.push(r));

      const day = new Date(2026, 8, 1);
      option('select')({
        start: day,
        end: new Date(2026, 8, 2),
        allDay: true,
      } as unknown as DateSelectInfo);

      expect(emitted).toHaveLength(1);
      const start = new Date(emitted[0].startsAt);
      const end = new Date(emitted[0].endsAt);
      expect(start.getFullYear()).toBe(2026);
      expect(start.getMonth()).toBe(8);
      expect(start.getDate()).toBe(1);
      expect(start.getHours()).toBe(9);
      expect(end.getTime() - start.getTime()).toBe(60 * 60 * 1000);
    });

    it('stays silent on a read-only grant', () => {
      create([], false);
      const emitted: SessionRangeSelection[] = [];
      fixture.componentInstance.rangeSelected.subscribe((r) => emitted.push(r));

      option('select')({
        start: new Date('2026-09-01T17:00:00.000Z'),
        end: new Date('2026-09-01T18:00:00.000Z'),
        allDay: false,
      } as unknown as DateSelectInfo);

      expect(emitted).toHaveLength(0);
    });
  });

  describe('reschedule', () => {
    it('emits the dragged event with its new bounds and FullCalendar’s revert', () => {
      create([session({ id: 'evt-9' })], true);
      const emitted: SessionRescheduleRequest<CalendarSession>[] = [];
      fixture.componentInstance.rescheduled.subscribe((r) => emitted.push(r));
      const revert = jest.fn();

      option('eventDrop')({
        event: {
          start: new Date('2026-08-11T17:00:00.000Z'),
          end: new Date('2026-08-11T18:00:00.000Z'),
          extendedProps: { session: session({ id: 'evt-9' }) },
        },
        revert,
      } as unknown as EventDropInfo);

      expect(emitted).toHaveLength(1);
      expect(emitted[0].session.id).toBe('evt-9');
      expect(emitted[0].startsAt).toBe('2026-08-11T17:00:00.000Z');
      expect(emitted[0].endsAt).toBe('2026-08-11T18:00:00.000Z');
      expect(revert).not.toHaveBeenCalled();
    });

    it('reverts instead of emitting a half-specified range', () => {
      create([session()], true);
      const emitted: SessionRescheduleRequest<CalendarSession>[] = [];
      fixture.componentInstance.rescheduled.subscribe((r) => emitted.push(r));
      const revert = jest.fn();

      option('eventDrop')({
        event: {
          start: new Date('2026-08-11T17:00:00.000Z'),
          end: null,
          extendedProps: { session: session() },
        },
        revert,
      } as unknown as EventDropInfo);

      expect(emitted).toHaveLength(0);
      expect(revert).toHaveBeenCalledTimes(1);
    });
  });

  describe('window requests', () => {
    it('reports days from now to the end of the visible range', () => {
      create([], true);
      const emitted: number[] = [];
      fixture.componentInstance.windowRequested.subscribe((d) =>
        emitted.push(d),
      );

      option('datesSet')({
        end: new Date(Date.now() + 45 * 86_400_000),
      } as unknown as DatesSetInfo);

      expect(emitted.at(-1)).toBe(45);
    });

    it('clamps to the 365-day ceiling the server enforces', () => {
      create([], true);
      const emitted: number[] = [];
      fixture.componentInstance.windowRequested.subscribe((d) =>
        emitted.push(d),
      );

      option('datesSet')({
        end: new Date(Date.now() + 900 * 86_400_000),
      } as unknown as DatesSetInfo);

      expect(emitted.at(-1)).toBe(365);
    });
  });

  it('pins navigation to the window the API can actually serve', () => {
    create([], true);

    const range = api().getOption('validRange') as { start: Date; end: Date };
    const spanDays = Math.round(
      (range.end.getTime() - range.start.getTime()) / 86_400_000,
    );
    expect(spanDays).toBe(365);
    expect(range.start.getTime()).toBeLessThanOrEqual(Date.now());
  });

  /**
   * ⚠️ The member surface renders this same component with `writable=false`.
   * These pin that the read-only mode removes every mutation affordance
   * outright rather than relying on a handler to decline — a member cannot
   * reach what is not rendered.
   */
  describe('read-only mode (the members’ area)', () => {
    const readOnly = (): void => {
      fixture = TestBed.createComponent(SessionCalendar);
      fixture.componentRef.setInput('sessions', [session()]);
      fixture.componentRef.setInput('writable', false);
      fixture.componentRef.setInput('maxDaysAhead', 60);
      fixture.detectChanges();
    };

    it('is not a drop target, so an external palette cannot reach it', () => {
      readOnly();

      expect(api().getOption('droppable')).toBe(false);
    });

    it('offers no selection and no dragging at all', () => {
      readOnly();

      expect(api().getOption('selectable')).toBe(false);
      expect(api().getOption('editable')).toBe(false);
      expect(api().getEvents()[0].startEditable).toBe(false);
      expect(api().getEvents()[0].durationEditable).toBe(false);
    });

    it('still lets a member click through to a session', () => {
      readOnly();
      const emitted: CalendarSession[] = [];
      fixture.componentInstance.sessionSelected.subscribe((s) =>
        emitted.push(s),
      );

      option('eventClick')({
        event: api().getEvents()[0],
      } as unknown as EventClickInfo);

      // Reading is the whole point of the member calendar; only mutation is gated.
      expect(emitted).toHaveLength(1);
    });

    it('honours a tighter navigation ceiling than the admin’s', () => {
      readOnly();

      // The member endpoint is fixed at 60 days. Letting a member page past it
      // would show empty months that read as a quiet calendar rather than an
      // unfetchable one.
      const range = api().getOption('validRange') as { start: Date; end: Date };
      const spanDays = Math.round(
        (range.end.getTime() - range.start.getTime()) / 86_400_000,
      );
      expect(spanDays).toBe(60);
    });

    it('clamps window requests to that same ceiling', () => {
      readOnly();
      const emitted: number[] = [];
      fixture.componentInstance.windowRequested.subscribe((d) =>
        emitted.push(d),
      );

      option('datesSet')({
        end: new Date(Date.now() + 900 * 86_400_000),
      } as unknown as DatesSetInfo);

      expect(emitted.at(-1)).toBe(60);
    });
  });
});
