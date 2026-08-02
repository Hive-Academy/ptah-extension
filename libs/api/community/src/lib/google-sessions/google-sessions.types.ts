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
 * endpoint still responds `{ sessions: [], communityUrl }` so the frontend has
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
