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

import { AdminSession } from '../../../../services/admin-builders-api.service';

/** Longest window `GET /api/v1/admin/sessions` accepts (`@Max(365)` on the DTO). */
const MAX_DAYS_AHEAD = 365;

/** Local wall-clock hour a month-view click prefills as the session start. */
const DEFAULT_START_HOUR = 9;

/** Duration a prefilled session spans, in milliseconds. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/** A time range the admin picked on the grid, ready for the create modal. */
export interface SessionRangeSelection {
  /** ISO 8601 */
  startsAt: string;
  /** ISO 8601 */
  endsAt: string;
}

/**
 * A drag/resize the admin performed on an existing event. `revert()` is
 * FullCalendar's own undo — the container calls it when the PATCH fails so the
 * grid never shows a time the server refused.
 */
export interface SessionRescheduleRequest {
  session: AdminSession;
  /** ISO 8601 */
  startsAt: string;
  /** ISO 8601 */
  endsAt: string;
  revert: () => void;
}

/**
 * SessionsCalendar — the Builders session calendar rendered as an actual
 * calendar (FullCalendar v7, `@fullcalendar/angular`), not a table of rows.
 *
 * Presentational: it owns no HTTP and no session state. Every mutation is
 * emitted upward to `SessionsList`, which is the single place that talks to
 * `AdminBuildersApiService` and therefore the single place that knows how the
 * server's two refusals (read-only grant, protected recurring series) surface.
 *
 * Three constraints from the surrounding system shape the options below:
 *
 * 1. **The API window is anchored to now.** `GET /admin/sessions` takes only
 *    `daysAhead` — there is no arbitrary start date — so events before today
 *    are unfetchable. `validRange` therefore pins navigation to
 *    today…today+365d rather than letting the admin page into empty months and
 *    read that emptiness as "no sessions".
 * 2. **Recurring masters are immovable.** The server answers 409
 *    `protected_recurring_event` because member provisioning maintains that
 *    event's attendee list, so those events get `editable: false` and a
 *    distinct class — drag is refused by the grid, not by a round-trip.
 * 3. **`calendarWritable: false` removes affordances, it doesn't grey them.**
 *    When the grant carries no write scope the grid is not selectable and no
 *    event is draggable, matching how the table hides its buttons outright.
 */
@Component({
  selector: 'ptah-admin-sessions-calendar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FullCalendarModule],
  templateUrl: './sessions-calendar.html',
  styleUrl: './sessions-calendar.css',
  // FullCalendar's grid is built imperatively and never carries the emulated
  // `_ngcontent-*` attribute, so encapsulated rules would not reach it. See the
  // header comment in `sessions-calendar.css`.
  encapsulation: ViewEncapsulation.None,
})
export class SessionsCalendar {
  /** Sessions currently loaded for the window the container fetched. */
  public readonly sessions = input.required<AdminSession[]>();

  /** Mirrors `calendarWritable` — gates selection and dragging wholesale. */
  public readonly writable = input<boolean>(false);

  /** Dims the grid while a fetch is in flight without unmounting it. */
  public readonly loading = input<boolean>(false);

  /** An event was clicked — the container opens its details panel. */
  public readonly sessionSelected = output<AdminSession>();

  /** An empty range was selected/clicked — the container opens create mode. */
  public readonly rangeSelected = output<SessionRangeSelection>();

  /** An event was dragged or resized — the container PATCHes, or reverts. */
  public readonly rescheduled = output<SessionRescheduleRequest>();

  /**
   * The visible range moved. Carries days-from-now to the end of that range so
   * the container can decide whether its loaded window still covers the view.
   */
  public readonly windowRequested = output<number>();

  /**
   * Navigation bounds, resolved once at construction. Recomputing this per
   * change detection would hand FullCalendar a new object on every cycle and
   * make it re-render the view for no reason.
   */
  private readonly validRange = buildValidRange(new Date());

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
      height: '70vh',
      validRange: this.validRange,
      nowIndicator: true,
      dayMaxEvents: 3,
      // Sessions run in the evening; a 00:00–24:00 axis would push every one of
      // them below the fold in the week view.
      slotMinTime: '07:00:00',
      slotMaxTime: '23:00:00',
      expandRows: true,
      selectable: writable,
      selectMirror: writable,
      // Per-event `editable` still decides individual events (recurring masters
      // opt out); this is the global gate for the read-only grant.
      editable: writable,
      eventClick: (info: EventClickInfo) => this.onEventClick(info),
      select: (info: DateSelectInfo) => this.onSelect(info),
      eventDrop: (info: EventDropInfo) => this.onEventChange(info),
      eventResize: (info: EventResizeDoneInfo) => this.onEventChange(info),
      datesSet: (info: DatesSetInfo) => this.onDatesSet(info),
    };
  });

  protected readonly calendarEvents = computed<EventInput[]>(() =>
    this.sessions().map((session) => ({
      id: session.id,
      title: session.title,
      start: session.startsAt,
      end: session.endsAt,
      editable: this.writable() && !session.recurring,
      className: session.recurring
        ? 'ptah-fc-event ptah-fc-event--series'
        : 'ptah-fc-event',
      // The immovable series reads as `info` here for the same reason its table
      // row wears an info badge — one colour, one meaning, across both views.
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
    const session = readSession(info.event.extendedProps);
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

  private onEventChange(info: EventDropInfo | EventResizeDoneInfo): void {
    const session = readSession(info.event.extendedProps);
    const { start, end } = info.event;
    // A timed event always carries both bounds. If either is missing the
    // mutation is not representable as a PATCH body, so undo it rather than
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
    this.windowRequested.emit(daysFromNow(info.end));
  }
}

/** Narrows FullCalendar's untyped `extendedProps` bag back to our session. */
function readSession(props: Record<string, unknown>): AdminSession | null {
  const candidate = props['session'];
  return candidate && typeof candidate === 'object'
    ? (candidate as AdminSession)
    : null;
}

/**
 * Days from now until `end`, clamped to the window the server accepts. Rounded
 * up so a range ending part-way through a day still fetches that whole day.
 */
function daysFromNow(end: Date): number {
  const days = Math.ceil((end.getTime() - Date.now()) / 86_400_000);
  return Math.min(MAX_DAYS_AHEAD, Math.max(1, days));
}

/**
 * A month-view cell is an all-day span, which is not a shape a Builders session
 * takes. Collapse it to a one-hour slot on the clicked day — a starting point
 * the admin adjusts in the form, not a guess we submit on their behalf.
 */
function defaultRangeOn(day: Date): SessionRangeSelection {
  const start = new Date(day);
  start.setHours(DEFAULT_START_HOUR, 0, 0, 0);
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + DEFAULT_DURATION_MS).toISOString(),
  };
}

/** Today 00:00 → today+365d, the exact span `daysAhead` can reach. */
function buildValidRange(now: Date): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + MAX_DAYS_AHEAD);
  return { start, end };
}
