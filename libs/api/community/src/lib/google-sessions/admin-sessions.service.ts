import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from '@ptah-api/audit';
import type { AdminAuditAction } from '@ptah-api/audit';
import { MemberGroupsService } from '../member-groups/member-groups.service';
import { GoogleCalendarProvider } from './google-calendar.provider';
import {
  extractEventItems,
  toAdminSession,
  toSessionAttendees,
} from './google-event.mapper';
import type {
  AdminSession,
  CalendarEventInput,
  GoogleApiResult,
  GoogleCalendarEvent,
} from './google-sessions.types';

/** Audit actor context threaded from the controller. */
export interface SessionActor {
  email: string | null;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * AdminSessionsService — the ADMIN WRITE PATH for Builders session events
 * (TASK_2026_169).
 *
 * Separated from `SessionsService` deliberately: that service owns the member
 * read path plus the Paddle-driven attendee fan-out, both of which are
 * best-effort and must never throw. This one is request-scoped admin work, so
 * it does the opposite — it maps every upstream failure to a typed HTTP
 * exception with a fixed `reason` code.
 *
 * ⚠️ THIS IS NOT THE MEMBER ENDPOINT. `GET /api/v1/members/sessions` lives in
 * the sibling `members.controller.ts`, is gated on an active Builders
 * membership, and is NOT modified by this feature. Admin access is a separate
 * authorized path (`JwtAuthGuard` + `AdminGuard`), never a loosening of that
 * gate — an admin without a Builders membership reads sessions here and is
 * still refused there.
 *
 * Upstream error contract — a raw Google body is NEVER forwarded:
 *   401 / 403  → 503 `calendar_write_unavailable` (scope or ACL insufficient;
 *                see the re-consent runbook in the implementation plan §4.3)
 *   skipped    → 503 `calendar_unconfigured` (GOOGLE_OAUTH_* unset)
 *   404 / 410  → 404, or `{ deleted: false }` on the idempotent delete path
 *   anything   → 502 `calendar_upstream_error`
 */
@Injectable()
export class AdminSessionsService {
  private readonly logger = new Logger(AdminSessionsService.name);

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(GoogleCalendarProvider)
    private readonly calendar: GoogleCalendarProvider,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    // Optional: cohort → session-event lookup, so the footgun guard below
    // protects EVERY cohort's series, not just the env-var one.
    @Optional()
    @Inject(MemberGroupsService)
    private readonly memberGroups?: MemberGroupsService,
  ) {}

  /**
   * Every master session event that member provisioning depends on: the
   * server-wide `BUILDERS_SESSION_EVENT_ID` plus each cohort's own
   * `MemberGroup.sessionEventId`.
   *
   * The env var is read through ConfigService on every call (never
   * `process.env`) so a deployment can change it without a rebuild.
   *
   * DEGRADATION IS DELIBERATELY TOWARDS THE OLD BEHAVIOUR, NOT TOWARDS OPEN.
   * If the cohort lookup fails, the returned set still contains the env-var id,
   * so the guard keeps exactly the protection it had before cohorts existed —
   * it does not 500 an admin delete over a groups-table hiccup, and it does not
   * silently drop to no protection at all. A cohort series could be deletable
   * during such an outage; that is an accepted, logged trade, and it is not a
   * realistic window since the same database backs the admin's own auth.
   */
  private async protectedEventIds(): Promise<Set<string>> {
    const ids = new Set<string>();

    const envId = this.configService
      .get<string>('BUILDERS_SESSION_EVENT_ID')
      ?.trim();
    if (envId) {
      ids.add(envId);
    }

    if (this.memberGroups) {
      try {
        for (const cohortId of await this.memberGroups.listSessionEventIds()) {
          ids.add(cohortId);
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Failed to list cohort session events (${message}) — the protected-series guard covers only BUILDERS_SESSION_EVENT_ID for this request`,
        );
      }
    }

    return ids;
  }

  /**
   * List upcoming sessions for the admin surface, plus whether the granted
   * OAuth scope permits writes.
   *
   * This deliberately does NOT delegate to `SessionsService.listUpcomingSessions()`:
   * that method is the MEMBER read path, fixed at a 60-day window and returning
   * the member contract shape. The admin surface needs a caller-chosen window
   * and the extra `description` field, and widening the member method to serve
   * both would change a member-facing response as a side effect of an admin
   * feature. The shared Google→contract mapping still lives in one place
   * (`google-event.mapper`), so the two paths cannot drift.
   *
   * `calendarWritable` is a UI hint, not an authorization decision: `undefined`
   * (no successful token refresh yet) collapses to `false` so the admin UI
   * degrades to read-only rather than rendering buttons that would 503. Google
   * remains the authority — a write can still be refused with the scope granted.
   *
   * Degradation mirrors the member path: feature-off or an upstream failure
   * yields `[]` and a 200, never a 500.
   */
  async listSessions(
    daysAhead: number,
  ): Promise<{ sessions: AdminSession[]; calendarWritable: boolean }> {
    if (!this.calendar.isEnabled()) {
      return { sessions: [], calendarWritable: false };
    }

    const now = new Date();
    const timeMax = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const result = await this.calendar.listEvents(now, timeMax);
    if (!result.ok) {
      this.logger.warn(
        `Admin session list failed upstream (status=${result.status ?? 'n/a'}) — degrading to []`,
      );
      return {
        sessions: [],
        calendarWritable: this.calendar.isWritable() === true,
      };
    }

    // Resolved once per request and handed to the mapper so every row carries
    // the SAME verdict the 409 guards below will apply. Without it the client
    // has to guess from `recurring`, which over-blocks every ordinary repeat.
    const protectedIds = await this.protectedEventIds();
    const sessions = extractEventItems(result.json)
      .filter((event) => event.status !== 'cancelled')
      .map((event) => toAdminSession(event, protectedIds))
      .filter((session): session is AdminSession => session !== null);

    // Re-read the verdict: the listEvents call above may have been the first
    // successful token refresh since boot, which is when scopes become known.
    return { sessions, calendarWritable: this.calendar.isWritable() === true };
  }

  /**
   * Create a calendar event. Audited as `sessions.event.create`.
   *
   * Any `attendees` are recorded on the event but NOT emailed — the create call
   * goes out with `sendUpdates=none`. Notifying is {@link sendInvitations},
   * a separate deliberate action.
   */
  async createSession(
    input: CalendarEventInput,
    actor: SessionActor,
  ): Promise<AdminSession> {
    this.assertRangeAdvances(input.startsAt, input.endsAt);

    const result = await this.calendar.createEvent({
      ...input,
      attendees: normalizeEmails(input.attendees),
    });
    const session = this.unwrapEvent(
      result,
      'create',
      await this.protectedEventIds(),
    );

    this.logger.log(
      `Admin created session: actor=${actor.email ?? 'unknown'} eventId=${session.id}`,
    );
    await this.safeAudit('sessions.event.create', session.id, actor, {
      title: session.title,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      meetLink: session.meetLink,
      attendeeCount: session.attendees.length,
    });
    return session;
  }

  /**
   * Patch a calendar event. Refuses the protected recurring MASTER with 409 —
   * patching the master rewrites every occurrence, including the standing
   * invite that member provisioning depends on.
   */
  async updateSession(
    eventId: string,
    input: Partial<CalendarEventInput>,
    actor: SessionActor,
    notifyGuests = false,
  ): Promise<AdminSession> {
    if (input.startsAt && input.endsAt) {
      this.assertRangeAdvances(input.startsAt, input.endsAt);
    }
    await this.assertNotProtectedSeries(eventId, undefined);

    // ⚠️ The one place a patch is allowed to send mail, and only when the caller
    // asked. Defaults to 'none', so a rescheduling drag — which never sets this
    // — stays silent exactly as before.
    const result = await this.calendar.patchEvent(
      eventId,
      { ...input, attendees: normalizeEmails(input.attendees) },
      notifyGuests ? 'all' : 'none',
    );
    const session = this.unwrapEvent(
      result,
      'update',
      await this.protectedEventIds(),
    );

    this.logger.log(
      `Admin updated session: actor=${actor.email ?? 'unknown'} eventId=${eventId} notifyGuests=${notifyGuests}`,
    );
    await this.safeAudit('sessions.event.update', eventId, actor, {
      fields: Object.keys(input).filter(
        (key) => (input as Record<string, unknown>)[key] !== undefined,
      ),
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      // Recorded so "was the guest list told about this change" is answerable
      // from the audit log rather than inferred from timing.
      notifiedGuests: notifyGuests,
      recipientCount: notifyGuests ? session.attendees.length : 0,
    });
    return session;
  }

  /**
   * Add guests to a session and EMAIL THEM.
   *
   * ⚠️ THE ONLY PATH IN THIS SERVICE THAT SENDS MAIL. Every other write —
   * create, patch, a rescheduling drag — goes out with `sendUpdates=none`, so
   * routine editing never reaches a customer's inbox. This method exists to
   * make notifying a separate decision the admin takes on purpose, and it is
   * why `sendUpdates` is a parameter on the provider rather than a constant.
   *
   * Attendees are MERGED into the existing list, not replaced: the caller is
   * saying "invite these people", and a partial list must never silently
   * uninvite the guests it omits. Google re-mails everyone on the resulting
   * list, including guests already invited — that is Google's behaviour for
   * `sendUpdates=all`, not something this method can narrow, and the admin UI
   * states the recipient count before calling.
   *
   * The protected recurring series is refused for the same reason patching it
   * is: member provisioning owns that event's attendee list, and an admin
   * invite merged into it would fight the fan-out.
   */
  async sendInvitations(
    eventId: string,
    attendees: string[] | undefined,
    actor: SessionActor,
  ): Promise<AdminSession> {
    const resolved = await this.resolveEvent(eventId);
    await this.assertNotProtectedSeries(eventId, resolved?.recurringEventId);

    const existing = resolved ? toSessionAttendees(resolved) : [];
    const merged = mergeEmails(
      existing.map((attendee) => attendee.email),
      normalizeEmails(attendees),
    );

    if (merged.length === 0) {
      throw new BadRequestException({
        reason: 'no_recipients',
        message:
          'This session has no guests, and no addresses were supplied to invite.',
      });
    }

    const result = await this.calendar.patchEvent(
      eventId,
      { attendees: merged },
      'all',
    );
    const session = this.unwrapEvent(
      result,
      'update',
      await this.protectedEventIds(),
    );

    this.logger.log(
      `Admin sent session invitations: actor=${actor.email ?? 'unknown'} eventId=${eventId} recipients=${merged.length}`,
    );
    await this.safeAudit('sessions.event.invite', eventId, actor, {
      // Counts, not addresses: an audit row is not the place to accumulate a
      // second copy of the customer email list.
      recipientCount: merged.length,
      addedCount: merged.length - existing.length,
      title: session.title,
      startsAt: session.startsAt,
    });
    return session;
  }

  /**
   * Delete a calendar event.
   *
   * ⚠️ FOOTGUN GUARD (implementation plan §4.4). `BUILDERS_SESSION_EVENT_ID`
   * — and now, additionally, every cohort's `MemberGroup.sessionEventId` — names
   * a master recurring event whose attendee list the Paddle provisioning fan-out
   * maintains. Deleting one would silently destroy every provisioned member's
   * standing invite for that cohort and break `addMemberToSessions` for all
   * future signups into it. Cohort awareness MULTIPLIED the number of events
   * carrying this hazard, so the guard covers all of them rather than only the
   * env-var one it was originally written for.
   *
   * The guard checks BOTH ids, and that second check is the load-bearing one:
   * `listUpcomingSessions` expands recurrences (`singleEvents=true`), so the
   * admin UI lists INSTANCES whose ids differ from the master's. Comparing only
   * `eventId` would let an admin delete the series through any one of its
   * expanded rows. Each instance carries `recurringEventId` pointing back at
   * the master, so resolving the event first and checking that field closes the
   * hole. The protected series is managed in Google Calendar directly.
   */
  async deleteSession(
    eventId: string,
    actor: SessionActor,
  ): Promise<{ deleted: boolean }> {
    const resolved = await this.resolveEvent(eventId);
    await this.assertNotProtectedSeries(eventId, resolved?.recurringEventId);

    const result = await this.calendar.deleteEvent(eventId);

    // Idempotent: Google answers 410 Gone for an already-deleted event and 404
    // for one that never existed. Neither is a server fault.
    if (!result.ok && (result.status === 404 || result.status === 410)) {
      this.logger.log(
        `Admin delete session was a no-op (already gone): eventId=${eventId}`,
      );
      return { deleted: false };
    }
    if (!result.ok) {
      throw this.mapUpstreamFailure(result, 'delete');
    }

    this.logger.log(
      `Admin deleted session: actor=${actor.email ?? 'unknown'} eventId=${eventId}`,
    );
    await this.safeAudit('sessions.event.delete', eventId, actor, {
      title: resolved?.summary ?? null,
      recurringEventId: resolved?.recurringEventId ?? null,
    });
    return { deleted: true };
  }

  /**
   * Best-effort read of an event before a destructive action, used only to
   * resolve `recurringEventId` and a title for the audit row. A failure here
   * returns `undefined`; the protected-series guard then falls back to the
   * direct `eventId` comparison, and the delete itself still validates upstream.
   */
  private async resolveEvent(
    eventId: string,
  ): Promise<GoogleCalendarEvent | undefined> {
    const result = await this.calendar.getEvent(eventId);
    if (!result.ok || typeof result.json !== 'object' || result.json === null) {
      return undefined;
    }
    return result.json as GoogleCalendarEvent;
  }

  /**
   * Throw 409 when the target is A protected recurring series — either a master
   * itself or one of its expanded instances.
   *
   * Now plural: with cohort-aware sessions there is one protected master PER
   * COHORT plus the env-var one, and deleting any of them destroys that
   * cohort's standing invites. The two comparisons and the 409 contract are
   * otherwise unchanged — set membership simply replaced equality against a
   * single id.
   */
  private async assertNotProtectedSeries(
    eventId: string,
    recurringEventId: string | undefined,
  ): Promise<void> {
    const protectedIds = await this.protectedEventIds();
    if (protectedIds.size === 0) {
      return;
    }
    if (
      protectedIds.has(eventId) ||
      (recurringEventId !== undefined && protectedIds.has(recurringEventId))
    ) {
      throw new ConflictException({
        reason: 'protected_recurring_event',
        message:
          'This is a recurring Builders session series that member provisioning depends on. Manage it in Google Calendar directly.',
      });
    }
  }

  /** Reject a time range that does not strictly advance. */
  private assertRangeAdvances(startsAt: string, endsAt: string): void {
    const start = new Date(startsAt).getTime();
    const end = new Date(endsAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new BadRequestException({
        reason: 'invalid_time_range',
        message: 'endsAt must be after startsAt',
      });
    }
  }

  /**
   * Unwrap a successful create/patch response into the contract shape, or throw
   * the mapped upstream failure.
   */
  private unwrapEvent(
    result: GoogleApiResult,
    op: 'create' | 'update',
    protectedIds: ReadonlySet<string> = new Set(),
  ): AdminSession {
    if (!result.ok) {
      throw this.mapUpstreamFailure(result, op);
    }
    const session = toAdminSession(
      (result.json ?? {}) as GoogleCalendarEvent,
      protectedIds,
    );
    if (!session) {
      throw new BadGatewayException({
        reason: 'calendar_upstream_error',
        message: `Google Calendar returned an unusable event on ${op}`,
      });
    }
    return session;
  }

  /**
   * Map a non-ok provider result to a typed Nest exception.
   *
   * The provider has already sanitized the upstream body (it only ever carries
   * `Google Calendar API returned status N`), and even so nothing from
   * `result.error` is forwarded to the client — every branch below returns a
   * fixed `reason` code and a message written here.
   */
  private mapUpstreamFailure(result: GoogleApiResult, op: string): Error {
    this.logger.warn(
      `Admin session ${op} failed upstream (status=${result.status ?? 'n/a'}, skipped=${Boolean(
        result.skipped,
      )})`,
    );

    if (result.skipped) {
      return new ServiceUnavailableException({
        reason: 'calendar_unconfigured',
        message: 'Google Calendar is not configured on this server.',
      });
    }
    if (result.status === 401 || result.status === 403) {
      return new ServiceUnavailableException({
        reason: 'calendar_write_unavailable',
        message:
          'The Google Calendar grant does not permit event writes. Re-consent with the calendar scope and restart the server.',
      });
    }
    if (result.status === 404 || result.status === 410) {
      return new NotFoundException({
        reason: 'calendar_event_not_found',
        message: 'That calendar event no longer exists.',
      });
    }
    return new BadGatewayException({
      reason: 'calendar_upstream_error',
      message: 'Google Calendar could not complete the request.',
    });
  }

  /**
   * Best-effort audit write. Unlike the packs registry — where the mutation and
   * its audit row are both DB writes and share a transaction — the mutation
   * here already committed at Google. Failing the response after that would
   * report a false negative for work that actually happened, so an audit
   * failure is logged and swallowed.
   */
  private async safeAudit(
    action: Extract<AdminAuditAction, `sessions.event.${string}`>,
    eventId: string,
    actor: SessionActor,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.write({
        actorEmail: actor.email,
        action,
        targetType: 'CalendarEvent',
        targetId: eventId,
        metadata,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to write ${action} audit log for event ${eventId}: ${message}`,
      );
    }
  }
}

/**
 * Lowercase, trim, and de-duplicate a guest list, preserving first-seen order.
 *
 * Returns `undefined` for an absent list so the spread into a patch body leaves
 * `attendees` unset — sending `attendees: undefined` through would be harmless,
 * but sending `attendees: []` would wipe the event's guest list, and the two
 * are one typo apart.
 *
 * Normalisation matches `SessionsService.mutateAttendee`, which lowercases
 * before comparing. Without it the same person could occupy two slots on one
 * event under different casing, and the provisioning fan-out would then fail to
 * find the one it wrote.
 */
function normalizeEmails(emails: string[] | undefined): string[] | undefined {
  if (emails === undefined) {
    return undefined;
  }
  return mergeEmails([], emails);
}

/** Concatenate two guest lists, normalised, de-duplicated, order-preserving. */
function mergeEmails(
  existing: string[],
  incoming: string[] | undefined,
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const raw of [...existing, ...(incoming ?? [])]) {
    const email = raw.trim().toLowerCase();
    if (email.length === 0 || seen.has(email)) {
      continue;
    }
    seen.add(email);
    merged.push(email);
  }
  return merged;
}
