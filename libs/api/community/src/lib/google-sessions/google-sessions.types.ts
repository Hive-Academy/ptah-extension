/**
 * Google Calendar / Meet "Builders sessions" integration types.
 *
 * The founder's Google account hosts a recurring "Builders session" (a live
 * office-hours call). Paid Builders members can see the upcoming sessions and
 * are added as attendees on the recurring event. Everything is BEST-EFFORT:
 * providers NEVER surface raw upstream bodies, and the provisioning path NEVER
 * rethrows into the Paddle webhook.
 *
 * Feature-off mode: when the GOOGLE_OAUTH_* env vars are unset the integration
 * reports `isEnabled() === false` and no-ops (logged once). The public members
 * endpoint still responds `{ sessions: [], memberGroups }` so the frontend has
 * a stable contract.
 */

/**
 * A single upcoming Builders session, shaped exactly for the
 * `GET /api/v1/members/sessions` contract.
 *
 * - `id`        — Google Calendar event id (instance id for recurring events).
 * - `title`     — event summary (empty string when Google omits it).
 * - `startsAt`  — ISO-8601 start (dateTime, or all-day date promoted to ISO).
 * - `endsAt`    — ISO-8601 end.
 * - `meetLink`  — Google Meet URL from `hangoutLink`/`conferenceData`, else null.
 * - `recurring` — true when the event is an instance of (or defines) a recurrence.
 */
export interface BuildersSession {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  meetLink: string | null;
  recurring: boolean;
}

/**
 * The outcome of a member-facing upcoming-sessions read.
 *
 * ⚠️ THIS TYPE EXISTS TO SEPARATE "NOTHING SCHEDULED" FROM "WE COULD NOT LOOK".
 * `listUpcomingSessions` answers `BuildersSession[]`, which has exactly one way
 * to say "no sessions" — `[]` — and therefore cannot distinguish an empty
 * calendar from a Google outage. A caller that renders that `[]` tells a paying
 * member "you have no upcoming sessions" during an incident, which is a FALSE
 * STATEMENT rather than a degraded one.
 *
 * `reason` is deliberately a closed vocabulary and NOT an error message:
 *   - `'disabled'`     — `GOOGLE_OAUTH_*` unset. Nothing was attempted.
 *   - `'fetch_failed'` — configured, attempted, and the Calendar call failed.
 *
 * Both are non-answers, and both map to the hub's `'unavailable'`. They stay
 * distinct because only one of them is an incident worth paging about. Upstream
 * status codes and bodies are logged, never carried here — NFR-S7 keeps raw
 * upstream detail off anything a member-facing composer can reach.
 */
export type UpcomingSessionsResult =
  | { ok: true; sessions: BuildersSession[] }
  | { ok: false; reason: 'disabled' | 'fetch_failed' };

/**
 * A Calendar event as the PHASE-4 LIVE FEED needs it — {@link BuildersSession}
 * plus the one field AD-3's de-duplication cannot work without.
 *
 * 🔴 WHY THIS TYPE EXISTS AT ALL (TASK_2026_177, RISK-V). `listEvents` requests
 * `singleEvents=true`, so Google EXPANDS recurrences and members see INSTANCES
 * whose ids are NOT the master series id. `LiveSession.calendarEventId` (AD-3)
 * normally holds the MASTER id — that is what an admin copies out of Google
 * Calendar. So a merge that compares only `event.id` de-duplicates ZERO
 * instances of a claimed series, and every occurrence appears twice in the feed:
 * once as the claiming `LiveSession` and once as an unclaimed calendar event.
 * `scopeToCohort` already documents exactly this trap for cohort scoping, and
 * matches both fields for exactly this reason.
 *
 * ⚠️ IT IS A SEPARATE TYPE RATHER THAN A FIELD ON `BuildersSession`, and the
 * reason is the same one `AdminSession`'s docblock gives. `BuildersSession` is
 * the MEMBER contract for `GET /api/v1/members/sessions`; widening it would put
 * an internal Google series id on a shipped member-facing response as a side
 * effect of an internal merge. {@link SessionsService.readUpcomingSessions}
 * keeps returning `BuildersSession` and is byte-identical to before.
 *
 * ⚠️ AND IT NEVER REACHES THE WIRE EITHER. `LiveFeedService` folds these into
 * `LiveFeedItem`, which has no `recurringEventId`. The field exists to be
 * COMPARED, not to be served.
 */
export interface CalendarFeedEvent extends BuildersSession {
  /**
   * The MASTER series id when this event is an expanded instance; `null` for a
   * one-off event, and `null` when the event IS the master.
   */
  recurringEventId: string | null;
}

/**
 * {@link UpcomingSessionsResult}, carrying {@link CalendarFeedEvent}s.
 *
 * Same two non-answers, for the same reason: `'disabled'` and `'fetch_failed'`
 * are both "we could not look", and the Live feed maps both to
 * `calendarAvailable: false` (R3.6) while still rendering its Ptah-sourced half.
 */
export type UpcomingCalendarFeedResult =
  | { ok: true; events: CalendarFeedEvent[] }
  | { ok: false; reason: 'disabled' | 'fetch_failed' };

/**
 * A session as returned by the ADMIN surface (`/api/v1/admin/sessions`).
 *
 * Identical to {@link BuildersSession} plus `description`, which the admin edit
 * form needs in order to prefill — without it a blind edit would either wipe
 * the calendar event's description or have to leave the field permanently blank.
 *
 * ⚠️ WHY THIS IS A SEPARATE TYPE RATHER THAN A FIELD ON `BuildersSession`.
 * `BuildersSession` is the MEMBER contract (`GET /api/v1/members/sessions`).
 * Widening it would change a member-facing response shape as a side effect of
 * an admin feature — and this task deliberately changes nothing on the member
 * path. Keeping the admin shape distinct means the member response stays
 * byte-identical while the admin surface gets the field it needs.
 */
export interface AdminSession extends BuildersSession {
  description: string | null;
  /**
   * The event's guest list. Admin-only for the same reason `description` is:
   * widening `BuildersSession` would leak every other member's email address
   * onto the member-facing response.
   */
  attendees: SessionAttendee[];

  /**
   * This event IS a provisioning-owned master series (its own id is in the
   * protected set). PATCH is refused with 409 — rewriting the master rewrites
   * every occurrence, including the standing invite the fan-out maintains.
   *
   * ⚠️ NOT THE SAME AS `recurring`, and the difference is the whole point of
   * these two fields. `recurring` is true for EVERY instance of EVERY series,
   * including one-off admin-created repeats the server is perfectly happy to
   * edit. Gating the UI on `recurring` locked those out of their own controls.
   */
  isProtectedMaster: boolean;

  /**
   * This event is, or belongs to, a provisioning-owned series. DELETE and the
   * invitations route are refused with 409, because member provisioning
   * maintains that series' attendee list.
   *
   * Implied by {@link isProtectedMaster}; also true for an expanded INSTANCE of
   * a protected master, whose own id differs from the master's.
   */
  inProtectedSeries: boolean;
}

/**
 * One guest on a session event, flattened from Google's attendee resource.
 *
 * `responseStatus` is Google's own vocabulary (`needsAction` | `declined` |
 * `tentative` | `accepted`) and is passed through rather than remapped, so the
 * admin UI shows exactly what Google shows. `null` when Google omits it.
 */
export interface SessionAttendee {
  email: string;
  responseStatus: string | null;
}

/**
 * Whether a write should email the guest list.
 *
 * Mirrors Google's `sendUpdates` query parameter. Every routine write defaults
 * to `'none'` — creating, editing, or dragging a session must never email
 * customers as a side effect. `'all'` is reached only through the explicit
 * invitations endpoint, which exists precisely so sending is a decision the
 * admin makes on purpose rather than a consequence of another action.
 */
export type SendUpdates = 'none' | 'all' | 'externalOnly';

/**
 * Internal input for creating/patching a Builders session event (TASK_2026_169).
 * Mapped to Google's `events` resource shape by
 * `GoogleCalendarProvider.toGoogleEventBody`.
 *
 * - `startsAt` / `endsAt` — ISO-8601 timestamps.
 * - `createMeetLink`      — mint a Google Meet link via `conferenceData.createRequest`.
 *                           Honoured on BOTH create and patch: Google will attach
 *                           conferencing to an existing event as long as the
 *                           request carries `conferenceDataVersion=1`.
 * - `attendees`           — the full guest list, lowercased emails. This REPLACES
 *                           the event's attendees rather than merging, so a caller
 *                           holding a partial list would silently uninvite everyone
 *                           missing from it. `AdminSessionsService` is the only
 *                           caller and always sends the complete list.
 */
export interface CalendarEventInput {
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  createMeetLink?: boolean;
  attendees?: string[];
}

/**
 * Result of an OAuth2 access-token acquisition.
 * `ok:false` carries a short sanitized reason — never the raw upstream body.
 */
export interface GoogleTokenResult {
  ok: boolean;
  skipped?: boolean;
  accessToken?: string;
  error?: string;
}

/**
 * Bounded, non-throwing result of a single Google Calendar REST call.
 * `etag` is surfaced for optimistic-concurrency (If-Match) on read-modify-write.
 */
export interface GoogleApiResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  json?: unknown;
  etag?: string;
  error?: string;
}

/**
 * Result of adding/removing a member as an attendee on the Builders session
 * event. Mirrors the Circle result-object convention.
 */
export interface SessionAttendeeResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
}

/**
 * Minimal shape of a Google Calendar `events` resource we read. Only the
 * fields the mapping needs are typed; everything else is ignored.
 */
export interface GoogleCalendarEvent {
  id?: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  hangoutLink?: string;
  recurringEventId?: string;
  recurrence?: string[];
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{
    email?: string;
    responseStatus?: string;
    organizer?: boolean;
    self?: boolean;
  }>;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
}
