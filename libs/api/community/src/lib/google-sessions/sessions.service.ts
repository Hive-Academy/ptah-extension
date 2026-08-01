import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from '@ptah-api/audit';
import { MemberGroupsService } from '../member-groups/member-groups.service';
import { GoogleCalendarProvider } from './google-calendar.provider';
import { extractEventItems, toBuildersSession } from './google-event.mapper';
import type {
  BuildersSession,
  GoogleCalendarEvent,
  SessionAttendeeResult,
} from './google-sessions.types';

/** Window of upcoming sessions surfaced to members. */
const LOOKAHEAD_DAYS = 60;

/**
 * SessionsService — maps the founder's Google Calendar into the Builders
 * sessions contract and manages member attendance on the live session.
 *
 * Read path (`listUpcomingSessions`): lists the next 60 days of events with
 * recurrences expanded, mapping each to the `{ id, title, startsAt, endsAt,
 * meetLink, recurring }` contract shape. Feature-off (Google unconfigured)
 * returns `[]` and logs once.
 *
 * Write path (`add/removeMemberFromSessions`): best-effort attendee add/remove
 * on the member's session event, driven by the Paddle provisioning fan-out.
 * NEVER rethrows — it must never fail the webhook — and is audited.
 *
 * ── COHORT AWARENESS ───────────────────────────────────────────────────────
 * The session event is resolved PER USER, not globally: a cohort
 * (`MemberGroup.sessionEventId`) may name its own Google Meet event so that,
 * say, an English and an Arabic cohort can run concurrently. Resolution order
 * on every path below is:
 *
 *     the user's cohort event  →  BUILDERS_SESSION_EVENT_ID  →  skip
 *
 * The env var is therefore still the whole story for a deployment that
 * configures no cohort events, and its behaviour there is unchanged: the same
 * single event, the same unfiltered listing, the same no-op when unset. The
 * cohort column only ever ADDS a more specific answer ahead of it.
 *
 * The cohort lookup is BEST-EFFORT like everything else here — an unbound or
 * failing `MemberGroupsService` degrades to the env var and logs; it never
 * throws into the members endpoint or the Paddle webhook.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private loggedDisabled = false;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(GoogleCalendarProvider)
    private readonly calendar: GoogleCalendarProvider,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    // Optional: cohort → session-event lookup. Bound by the @Global()
    // MemberGroupsModule; @Optional keeps every path here working (on the env
    // var alone) if that module is ever unregistered — mirrors MembersController.
    @Optional()
    @Inject(MemberGroupsService)
    private readonly memberGroups?: MemberGroupsService,
  ) {}

  /** True when the Google integration is configured. */
  isEnabled(): boolean {
    return this.calendar.isEnabled();
  }

  /**
   * The server-wide fallback session event id, or undefined (skip). Used for
   * every user whose cohorts configure no event of their own — which is every
   * user in a single-cohort deployment.
   */
  private get fallbackEventId(): string | undefined {
    return (
      this.configService.get<string>('BUILDERS_SESSION_EVENT_ID')?.trim() ||
      undefined
    );
  }

  /**
   * The session event `userId` belongs to: their cohort's event when one is
   * configured, otherwise the `BUILDERS_SESSION_EVENT_ID` fallback, otherwise
   * undefined (caller skips).
   */
  private async resolveEventIdForUser(
    userId: string,
  ): Promise<string | undefined> {
    return (await this.safeCohortEventId(userId)) ?? this.fallbackEventId;
  }

  /**
   * Cohort event for a user, or null. Non-fatal by design: a groups failure
   * degrades to the env-var fallback rather than failing attendance or the
   * members endpoint.
   */
  private async safeCohortEventId(userId: string): Promise<string | null> {
    if (!this.memberGroups) {
      return null;
    }
    try {
      return await this.memberGroups.getSessionEventIdForUser(userId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to resolve cohort session event for user ${userId} (${message}) — falling back to BUILDERS_SESSION_EVENT_ID`,
      );
      return null;
    }
  }

  /**
   * Every cohort-scoped session event id configured server-wide, or `[]`.
   * Same best-effort contract as {@link safeCohortEventId}: on failure the read
   * path degrades to its pre-cohort behaviour (list everything) rather than
   * hiding sessions from members.
   */
  private async safeAllCohortEventIds(): Promise<string[]> {
    if (!this.memberGroups) {
      return [];
    }
    try {
      return await this.memberGroups.listSessionEventIds();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to list cohort session events (${message}) — listing sessions unscoped`,
      );
      return [];
    }
  }

  /**
   * List upcoming Builders sessions for `userId` over the next
   * {@link LOOKAHEAD_DAYS} days. Feature-off (Google unconfigured) returns `[]`
   * and logs once — the members endpoint stays responsive with a stable contract.
   *
   * The window, the returned shape and the cancelled-event filtering are
   * unchanged; the only addition is COHORT SCOPING (see {@link scopeToCohort}),
   * which is a no-op until some cohort configures its own event.
   *
   * The admin surface owns its own read path in `AdminSessionsService` rather
   * than widening this one — admins see every cohort's sessions, deliberately.
   */
  async listUpcomingSessions(userId: string): Promise<BuildersSession[]> {
    if (!this.isEnabledOrLogOnce()) {
      return [];
    }

    const now = new Date();
    const timeMax = new Date(
      now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000,
    );

    const result = await this.calendar.listEvents(now, timeMax);
    if (!result.ok) {
      this.logger.warn(
        `Failed to list Builders sessions (status: ${
          result.status ?? 'n/a'
        }): ${result.error ?? 'unknown error'}`,
      );
      return [];
    }

    const items = extractEventItems(result.json).filter(
      (event) => event.status !== 'cancelled',
    );
    const visible = await this.scopeToCohort(items, userId);
    return visible
      .map((event) => toBuildersSession(event))
      .filter((session): session is BuildersSession => session !== null);
  }

  /**
   * Hide the events that belong to a cohort OTHER than the caller's.
   *
   * The rule is subtractive on purpose. The calendar also carries events that
   * belong to no cohort at all — one-off AMAs, guest sessions — and those must
   * stay visible to everyone. So instead of keeping only the caller's own
   * series (which would hide every generic event the moment a single cohort was
   * configured), this drops only events that are demonstrably SOMEONE ELSE'S:
   * those whose id, or whose master `recurringEventId`, is a configured cohort
   * event that is not the caller's.
   *
   * Two consequences worth stating:
   *   - No cohort configures an event → the foreign set is empty → the list is
   *     byte-identical to the pre-cohort behaviour. That is the back-compat
   *     guarantee, and it holds by construction rather than by a feature flag.
   *   - The `recurringEventId` check is the load-bearing half. `listEvents`
   *     expands recurrences (`singleEvents=true`), so members see INSTANCES,
   *     whose ids differ from the master id stored on the cohort. Comparing
   *     only `id` would leak every occurrence of the other cohort's series.
   */
  private async scopeToCohort(
    events: GoogleCalendarEvent[],
    userId: string,
  ): Promise<GoogleCalendarEvent[]> {
    const allCohortEventIds = await this.safeAllCohortEventIds();
    if (allCohortEventIds.length === 0) {
      return events;
    }

    const own = await this.resolveEventIdForUser(userId);
    const foreign = new Set(allCohortEventIds.filter((id) => id !== own));
    if (foreign.size === 0) {
      return events;
    }

    return events.filter(
      (event) =>
        !foreign.has(event.id ?? '') &&
        !foreign.has(event.recurringEventId ?? ''),
    );
  }

  /**
   * Add `email` as an attendee on the session event for `userId` — their
   * cohort's event when configured, else `BUILDERS_SESSION_EVENT_ID`.
   * Best-effort + non-fatal + audited. No-ops when Google is disabled or no
   * event id resolves, or when the member is already invited.
   *
   * `userId` is REQUIRED rather than optional so a new call site cannot quietly
   * fall back to the server-wide event for a member who belongs to a cohort.
   */
  async addMemberToSessions(
    email: string,
    userId: string,
  ): Promise<SessionAttendeeResult> {
    return this.mutateAttendee(email, userId, 'add');
  }

  /**
   * Remove `email` from their session event. Semantics mirror
   * {@link addMemberToSessions}.
   *
   * Removal resolves the cohort the same way an add does, and that is sound:
   * cohort assignments are durable and deprovisioning never deletes them, so a
   * lapsing member still resolves to the event they were actually invited to.
   */
  async removeMemberFromSessions(
    email: string,
    userId: string,
  ): Promise<SessionAttendeeResult> {
    return this.mutateAttendee(email, userId, 'remove');
  }

  private async mutateAttendee(
    email: string,
    userId: string,
    op: 'add' | 'remove',
  ): Promise<SessionAttendeeResult> {
    if (!this.isEnabledOrLogOnce()) {
      return { ok: false, skipped: true };
    }
    const eventId = await this.resolveEventIdForUser(userId);
    if (!eventId) {
      this.logger.debug(
        `No session event resolved for user ${userId} (no cohort event, BUILDERS_SESSION_EVENT_ID unset) — skipping attendee ${op}`,
      );
      return { ok: false, skipped: true };
    }

    const normalized = email.toLowerCase();
    const action =
      op === 'add' ? 'sessions.attendee.add' : 'sessions.attendee.remove';

    try {
      const result = await this.calendar.patchEventAttendees(
        eventId,
        (attendees) => {
          const others = attendees.filter(
            (a) => (a.email ?? '').toLowerCase() !== normalized,
          );
          return op === 'add' ? [...others, { email: normalized }] : others;
        },
      );

      if (!result.ok) {
        this.logger.warn(
          `Session attendee ${op} did not succeed for ${normalized} (status: ${
            result.status ?? 'n/a'
          }): ${result.error ?? 'unknown error'}`,
        );
        await this.safeAudit(action, normalized, {
          email: normalized,
          // Recorded so an audit row says WHICH cohort's event was touched —
          // without it a two-cohort deployment cannot tell the difference.
          eventId,
          ok: false,
          status: result.status ?? null,
          error: result.error ?? null,
        });
        return {
          ok: false,
          status: result.status,
          skipped: result.skipped,
          error: result.error,
        };
      }

      this.logger.log(
        `Session attendee ${op} succeeded for ${normalized} on event ${eventId}`,
      );
      await this.safeAudit(action, normalized, {
        email: normalized,
        eventId,
        ok: true,
        status: result.status ?? null,
      });
      return { ok: true, status: result.status };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to ${op} session attendee for ${normalized}: ${message}`,
      );
      return { ok: false, error: message };
    }
  }

  private isEnabledOrLogOnce(): boolean {
    if (this.isEnabled()) {
      return true;
    }
    if (!this.loggedDisabled) {
      this.logger.log(
        'Google sessions integration disabled (GOOGLE_OAUTH_* unset) — sessions endpoint returns [] and attendance is a no-op',
      );
      this.loggedDisabled = true;
    }
    return false;
  }

  private async safeAudit(
    action: 'sessions.attendee.add' | 'sessions.attendee.remove',
    email: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.write({
        actorEmail: null,
        action,
        targetType: 'User',
        targetId: email,
        metadata,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to write session audit log (${action}) for ${email}: ${message}`,
      );
    }
  }
}
