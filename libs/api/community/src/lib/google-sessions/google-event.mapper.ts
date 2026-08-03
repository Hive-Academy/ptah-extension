import type {
  AdminSession,
  BuildersSession,
  GoogleCalendarEvent,
  SessionAttendee,
} from './google-sessions.types';

/**
 * Pure mapping helpers between Google Calendar `events` resources and the
 * `BuildersSession` contract shape.
 *
 * Extracted from `SessionsService` for TASK_2026_169: the same mapping is now
 * needed by four call sites — the member read path, the admin read path, and
 * the admin create/patch responses. A single mapper keeps those four from
 * drifting into subtly different versions of "the same" contract.
 *
 * These functions are pure and dependency-free: no ConfigService, no provider,
 * no logger. `SessionsService` and `AdminSessionsService` both delegate here.
 */

/** Promote a Google start/end (dateTime or all-day date) to an ISO string. */
export function resolveTimestamp(
  slot: { dateTime?: string; date?: string } | undefined,
): string | null {
  if (!slot) {
    return null;
  }
  if (slot.dateTime) {
    return new Date(slot.dateTime).toISOString();
  }
  if (slot.date) {
    return new Date(`${slot.date}T00:00:00.000Z`).toISOString();
  }
  return null;
}

/** Resolve a Meet URL from hangoutLink or a video conferenceData entry point. */
export function resolveMeetLink(event: GoogleCalendarEvent): string | null {
  if (event.hangoutLink) {
    return event.hangoutLink;
  }
  const video = event.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === 'video' && entry.uri,
  );
  return video?.uri ?? null;
}

/**
 * Map a raw Google Calendar event to the contract session shape, or null when
 * it lacks the minimum fields (id + resolvable start/end).
 */
export function toBuildersSession(
  event: GoogleCalendarEvent,
): BuildersSession | null {
  const id = event.id;
  const startsAt = resolveTimestamp(event.start);
  const endsAt = resolveTimestamp(event.end);
  if (!id || !startsAt || !endsAt) {
    return null;
  }

  return {
    id,
    title: event.summary ?? '',
    startsAt,
    endsAt,
    meetLink: resolveMeetLink(event),
    recurring: Boolean(event.recurringEventId || event.recurrence),
  };
}

/**
 * Map a raw Google Calendar event to the ADMIN session shape — the member
 * contract plus `description` — or null when it lacks the minimum fields.
 *
 * Built on {@link toBuildersSession} so the shared fields can never drift
 * between the member and admin surfaces.
 */
export function toAdminSession(
  event: GoogleCalendarEvent,
  protectedEventIds: ReadonlySet<string> = new Set(),
): AdminSession | null {
  const base = toBuildersSession(event);
  if (!base) {
    return null;
  }
  // Computed from the SAME set the service's 409 guards consult, so the client
  // is told exactly what the server will accept. Deriving it client-side from
  // `recurring` is what previously disabled Edit and Delete on every event in
  // any series — including admin-created repeats nothing depends on.
  const isProtectedMaster = protectedEventIds.has(event.id ?? '');
  return {
    ...base,
    description: event.description ?? null,
    attendees: toSessionAttendees(event),
    isProtectedMaster,
    inProtectedSeries:
      isProtectedMaster || protectedEventIds.has(event.recurringEventId ?? ''),
  };
}

/**
 * Flatten Google's attendee resources to `{ email, responseStatus }`.
 *
 * Entries without an email are dropped: Google emits them for resources (rooms,
 * equipment) and for guests hidden by the calendar's privacy settings, and
 * neither is something the admin can act on or re-send to. Emails are
 * lowercased to match the provisioning fan-out's own normalisation, so the same
 * person cannot appear twice under different casing.
 */
export function toSessionAttendees(
  event: GoogleCalendarEvent,
): SessionAttendee[] {
  return (event.attendees ?? [])
    .filter((attendee) => Boolean(attendee.email))
    .map((attendee) => ({
      email: (attendee.email as string).toLowerCase(),
      responseStatus: attendee.responseStatus ?? null,
    }));
}

/** Extract the `items` array from a Calendar list response, or `[]`. */
export function extractEventItems(json: unknown): GoogleCalendarEvent[] {
  if (
    typeof json === 'object' &&
    json !== null &&
    Array.isArray((json as { items?: unknown }).items)
  ) {
    return (json as { items: GoogleCalendarEvent[] }).items;
  }
  return [];
}
