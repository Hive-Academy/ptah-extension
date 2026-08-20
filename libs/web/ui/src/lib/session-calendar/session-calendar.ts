import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
  output,
} from '@angular/core';
import {
  CalendarOptions,
  DateSelectInfo,
  DatesSetInfo,
  EventClickInfo,
  EventDropInfo,
  EventInput,
  EventReceiveInfo,
  EventResizeDoneInfo,
  FullCalendarModule,
} from '@fullcalendar/angular';
// Plugins come from `fullcalendar/*` rather than the `@fullcalendar/angular/*`
// aliases, which are one-line `export { default } from 'fullcalendar/…'` shims.
// Both resolve to the same module instance under the bundler, but the shim's
// re-exported default double-wraps under Jest's CJS interop and the plugin
// arrives as `{ default: plugin }` — FullCalendar then throws "Plugin must
// specify a name". Importing the real module sidesteps the shim entirely.
import dayGridPlugin from 'fullcalendar/daygrid';
import interactionPlugin from 'fullcalendar/interaction';
import timeGridPlugin from 'fullcalendar/timegrid';
import breezyTheme from 'fullcalendar/themes/breezy';

/** Local wall-clock hour a month-view click prefills as the session start. */
const DEFAULT_START_HOUR = 9;

/** Duration a prefilled session spans, in milliseconds. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/**
 * The minimum a session must be for this calendar to render it.
 *
 * Declared structurally rather than imported so the component belongs to
 * neither the admin nor the member side. Both surfaces' own session types
 * satisfy it without conversion: the admin's carries `description` and
 * `attendees` on top, the member's is exactly this. Those extras survive the
 * round-trip through `extendedProps`, which is what lets the generic parameter
 * hand the caller back its OWN type in every output.
 */
export interface CalendarSession {
  id: string;
  title: string;
  /** ISO 8601 */
  startsAt: string;
  /** ISO 8601 */
  endsAt: string;
  meetLink: string | null;
  recurring: boolean;
  /**
   * Whether THIS event may be dragged on a writable grid. Omitted means yes.
   *
   * Deliberately supplied by the host rather than inferred from `recurring`
   * here: "part of a series" and "the server will refuse to move it" are
   * different facts, and only the host knows which of its events are the
   * provisioning-owned ones. Inferring it locked ordinary admin-created
   * repeats in place for no reason.
   */
  editable?: boolean;
}

/** A time range picked on the grid, ready for a create form. */
export interface SessionRangeSelection {
  /** ISO 8601 */
  startsAt: string;
  /** ISO 8601 */
  endsAt: string;
  /**
   * Identifier of the template chip that was dropped, when the range came from
   * one. Absent for a plain drag across empty space.
   */
  templateId?: string;
}

/**
 * A drag/resize performed on an existing event. `revert()` is FullCalendar's
 * own undo — the host calls it when the save fails so the grid never shows a
 * time the server refused.
 */
export interface SessionRescheduleRequest<T extends CalendarSession> {
  session: T;
  /** ISO 8601 */
  startsAt: string;
  /** ISO 8601 */
  endsAt: string;
  revert: () => void;
}

/**
 * SessionCalendar — the Builders session grid, shared by the admin console and
 * the members' area (FullCalendar v7).
 *
 * Presentational and stateless: it owns no HTTP and no session state. Every
 * interaction is emitted upward, so the host stays the single place that talks
 * to an API and the single place that knows what its server will refuse.
 *
 * ⚠️ ONE COMPONENT, TWO AUDIENCES, ONE GATE. `writable` is the whole of the
 * difference between the two surfaces. The members' area passes `false`, which
 * removes selection, dragging and external drops outright — a member cannot
 * reach a mutation affordance because none is rendered, not because a handler
 * declines. The admin passes `calendarWritable` from the server's own scope
 * verdict.
 *
 * ⚠️ IT RENDERS WHAT IT IS GIVEN. This component never fetches, so it can never
 * widen what a member is allowed to see. The member endpoint returns
 * `BuildersSession`, which carries no guest list and no description by
 * construction; sharing this component does not change that, and the guards in
 * `google-event.mapper.spec` / `sessions.service.spec` still hold the line.
 *
 * Two constraints from the API shape the options below:
 *
 * 1. **The window is anchored to now.** Both session endpoints take a
 *    days-ahead lookahead with no arbitrary start, so events before today are
 *    unfetchable. `validRange` pins navigation to today…today+`maxDaysAhead`
 *    rather than letting a reader page into empty months and read that
 *    emptiness as "no sessions".
 * 2. **Recurring masters are immovable.** The server answers 409
 *    `protected_recurring_event` because member provisioning maintains that
 *    event's attendee list, so those events are never draggable — refused by
 *    the grid, not by a round-trip.
 */
@Component({
  selector: 'ptah-session-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FullCalendarModule],
  templateUrl: './session-calendar.html',
  styleUrl: './session-calendar.css',
  // FullCalendar's grid is built imperatively and never carries the emulated
  // `_ngcontent-*` attribute, so encapsulated rules would not reach it. See the
  // header comment in `session-calendar.css`.
  encapsulation: ViewEncapsulation.None,
})
export class SessionCalendar<T extends CalendarSession = CalendarSession> {
  /** Sessions currently loaded for the window the host fetched. */
  public readonly sessions = input.required<T[]>();

  /**
   * Master switch for every mutation affordance. `false` renders a read-only
   * grid: nothing selectable, nothing draggable, no external drop target.
   */
  public readonly writable = input<boolean>(false);

  /** Dims the grid while a fetch is in flight without unmounting it. */
  public readonly loading = input<boolean>(false);

  /**
   * How far ahead navigation may reach, in days — the host's own API ceiling.
   * The admin endpoint accepts up to 365; the member endpoint is fixed at 60,
   * and letting a member page past it would show empty months that look like a
   * quiet calendar rather than an unfetchable one.
   */
  public readonly maxDaysAhead = input<number>(365);

  /** An event was clicked. */
  public readonly sessionSelected = output<T>();

  /** An empty range was selected, or a template chip dropped on one. */
  public readonly rangeSelected = output<SessionRangeSelection>();

  /** An event was dragged or resized — the host saves, or reverts. */
  public readonly rescheduled = output<SessionRescheduleRequest<T>>();

  /**
   * The visible range moved. Carries days-from-now to the end of that range so
   * a host with a widenable window can decide whether its loaded set covers the
   * view. Hosts with a fixed window ignore it.
   */
  public readonly windowRequested = output<number>();

  /**
   * Navigation bounds. Depends only on `maxDaysAhead`, so it is recomputed when
   * that changes and NOT on every change-detection pass — handing FullCalendar
   * a fresh object each cycle would re-render the view for no reason.
   */
  private readonly validRange = computed(() =>
    buildValidRange(new Date(), this.maxDaysAhead()),
  );

  protected readonly calendarOptions = computed<CalendarOptions>(() => {
    const writable = this.writable();
    return {
      plugins: [breezyTheme, dayGridPlugin, timeGridPlugin, interactionPlugin],
      initialView: 'dayGridMonth',
      headerToolbar: {
        start: 'prev,next today',
        center: 'title',
        end: 'dayGridMonth,timeGridWeek,timeGridDay',
      },
      height: '72vh',
      validRange: this.validRange(),
      nowIndicator: true,
      // A month is 4-6 real weeks. Padding every month to a fixed 6 rows left a
      // wholly empty leading row on the grid and squeezed the rows that had
      // events into less height than they needed.
      fixedWeekCount: false,
      showNonCurrentDates: false,
      dayMaxEvents: true,
      moreLinkClick: 'popover',
      dayHeaderFormat: { weekday: 'short' },
      eventTimeFormat: {
        hour: 'numeric',
        minute: '2-digit',
        meridiem: 'short',
      },
      // Sessions run in the evening; a 00:00–24:00 axis would push every one of
      // them below the fold in the week view.
      slotMinTime: '07:00:00',
      slotMaxTime: '23:00:00',
      slotDuration: '00:30:00',
      scrollTime: '16:00:00',
      expandRows: true,
      selectable: writable,
      selectMirror: writable,
      // Per-event `editable` still decides individual events (recurring masters
      // opt out); this is the global gate.
      editable: writable,
      // Accepts chips dragged from an external palette. FullCalendar pairs an
      // external `Draggable` with any droppable calendar through a global
      // registry, so the palette needs no reference to this component.
      droppable: writable,
      eventClick: (info: EventClickInfo) => this.onEventClick(info),
      select: (info: DateSelectInfo) => this.onSelect(info),
      eventDrop: (info: EventDropInfo) => this.onEventChange(info),
      eventResize: (info: EventResizeDoneInfo) => this.onEventChange(info),
      eventReceive: (info: EventReceiveInfo) => this.onEventReceive(info),
      datesSet: (info: DatesSetInfo) => this.onDatesSet(info),
    };
  });

  protected readonly calendarEvents = computed<EventInput[]>(() =>
    this.sessions().map((session) => ({
      id: session.id,
      title: session.title,
      start: session.startsAt,
      end: session.endsAt,
      editable: this.writable() && (session.editable ?? true),
      className: session.recurring
        ? 'ptah-fc-event ptah-fc-event--series'
        : 'ptah-fc-event',
      // Series events read as `info` for the same reason their admin table row
      // wears an info badge — one colour, one meaning, everywhere. This tracks
      // `recurring`, which is presentation; `editable` above is permission, and
      // the two are deliberately not the same signal.
      ...(session.recurring
        ? {
            color: 'var(--ptah-fc-series)',
            contrastColor: 'var(--ptah-fc-series-contrast)',
          }
        : {}),
      extendedProps: { session },
    })),
  );

  private onEventClick(info: EventClickInfo): void {
    const session = this.readSession(info.event.extendedProps);
    if (session) this.sessionSelected.emit(session);
  }

  private onSelect(info: DateSelectInfo): void {
    if (!this.writable()) return;
    this.rangeSelected.emit(
      info.allDay
        ? defaultRangeOn(info.start)
        : {
            startsAt: info.start.toISOString(),
            endsAt: info.end.toISOString(),
          },
    );
  }

  /**
   * A template chip was dropped on the grid.
   *
   * The dropped event is reverted immediately and a range is emitted instead.
   * FullCalendar adds the event optimistically, but nothing exists server-side
   * yet — leaving it on the grid would show a session that the next refetch
   * silently deletes, and a failed create would leave a phantom behind. The
   * host opens a prefilled create form; the grid regains the event when the
   * server confirms it.
   */
  private onEventReceive(info: EventReceiveInfo): void {
    const { start, end } = info.event;
    const templateId = info.event.extendedProps['templateId'];
    info.revert();

    if (!start) return;
    // A month-cell drop lands all-day; a time-grid drop carries a real end.
    const range =
      info.event.allDay || !end
        ? defaultRangeOn(start)
        : { startsAt: start.toISOString(), endsAt: end.toISOString() };

    this.rangeSelected.emit({
      ...range,
      templateId: typeof templateId === 'string' ? templateId : undefined,
    });
  }

  private onEventChange(info: EventDropInfo | EventResizeDoneInfo): void {
    const session = this.readSession(info.event.extendedProps);
    const { start, end } = info.event;
    // A timed event always carries both bounds. If either is missing the
    // mutation is not representable as a patch body, so undo it rather than
    // send the server a half-specified range.
    if (!session || !start || !end) {
      info.revert();
      return;
    }
    this.rescheduled.emit({
      session,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      revert: info.revert,
    });
  }

  private onDatesSet(info: DatesSetInfo): void {
    this.windowRequested.emit(daysFromNow(info.end, this.maxDaysAhead()));
  }

  /**
   * Narrow FullCalendar's untyped `extendedProps` bag back to the caller's own
   * session type. Sound because the object came from `sessions()` unchanged —
   * `calendarEvents` stores the whole `T` and never reconstructs it.
   */
  private readSession(props: Record<string, unknown>): T | null {
    const candidate = props['session'];
    return candidate && typeof candidate === 'object' ? (candidate as T) : null;
  }
}

/**
 * Days from now until `end`, clamped to the host's ceiling. Rounded up so a
 * range ending part-way through a day still fetches that whole day.
 */
function daysFromNow(end: Date, maxDaysAhead: number): number {
  const days = Math.ceil((end.getTime() - Date.now()) / 86_400_000);
  return Math.min(maxDaysAhead, Math.max(1, days));
}

/**
 * A month-view cell is an all-day span, which is not a shape a Builders session
 * takes. Collapse it to a one-hour slot on the clicked day — a starting point
 * to adjust in the form, not a guess submitted on the admin's behalf.
 */
function defaultRangeOn(day: Date): SessionRangeSelection {
  const start = new Date(day);
  start.setHours(DEFAULT_START_HOUR, 0, 0, 0);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + DEFAULT_DURATION_MS).toISOString(),
  };
}

/** Today 00:00 → today + `maxDaysAhead`, the exact span the API can reach. */
function buildValidRange(
  now: Date,
  maxDaysAhead: number,
): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + maxDaysAhead);
  return { start, end };
}
