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
