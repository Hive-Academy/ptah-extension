import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditLogService } from '../audit/audit-log.service';
import { GoogleCalendarProvider } from './google-calendar.provider';
import type {
  BuildersSession,
  GoogleCalendarEvent,
  SessionAttendeeResult,
} from './google-sessions.types';

/** Window of upcoming sessions surfaced to members. */
const LOOKAHEAD_DAYS = 60;

/**
 * SessionsService — maps the founder's Google Calendar into the Builders
 * sessions contract and manages member attendance on the recurring session.
 *
 * Read path (`listUpcomingSessions`): lists the next 60 days of events with
 * recurrences expanded, mapping each to the `{ id, title, startsAt, endsAt,
 * meetLink, recurring }` contract shape. Feature-off (Google unconfigured)
 * returns `[]` and logs once.
 *
 * Write path (`add/removeMemberFromSessions`): best-effort attendee add/remove
 * on `BUILDERS_SESSION_EVENT_ID`, driven by the Paddle provisioning fan-out.
 * NEVER rethrows — it must never fail the webhook — and is audited.
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
  ) {}

  /** True when the Google integration is configured. */
  isEnabled(): boolean {
    return this.calendar.isEnabled();
  }

  /** The recurring Builders session master event id, or undefined (skip). */
  private get sessionEventId(): string | undefined {
    return (
      this.configService.get<string>('BUILDERS_SESSION_EVENT_ID')?.trim() ||
      undefined
    );
  }

  /**
   * List upcoming Builders sessions for the next {@link LOOKAHEAD_DAYS} days.
   * Feature-off (Google unconfigured) returns `[]` and logs once — the members
   * endpoint stays responsive with a stable contract.
   */
  async listUpcomingSessions(): Promise<BuildersSession[]> {
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

    const items = this.extractItems(result.json);
    return items
      .filter((event) => event.status !== 'cancelled')
      .map((event) => this.toSession(event))
      .filter((session): session is BuildersSession => session !== null);
  }

  /**
   * Add `email` as an attendee on the recurring Builders session event.
   * Best-effort + non-fatal + audited. No-ops when Google is disabled or
   * BUILDERS_SESSION_EVENT_ID is unset, or when the member is already invited.
   */
  async addMemberToSessions(email: string): Promise<SessionAttendeeResult> {
    return this.mutateAttendee(email, 'add');
  }

  /**
   * Remove `email` from the recurring Builders session event. Semantics mirror
   * {@link addMemberToSessions}.
   */
  async removeMemberFromSessions(
    email: string,
  ): Promise<SessionAttendeeResult> {
    return this.mutateAttendee(email, 'remove');
  }

  private async mutateAttendee(
    email: string,
    op: 'add' | 'remove',
  ): Promise<SessionAttendeeResult> {
    if (!this.isEnabledOrLogOnce()) {
      return { ok: false, skipped: true };
    }
    const eventId = this.sessionEventId;
    if (!eventId) {
      this.logger.debug(
        `BUILDERS_SESSION_EVENT_ID unset — skipping session attendee ${op}`,
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

      this.logger.log(`Session attendee ${op} succeeded for ${normalized}`);
      await this.safeAudit(action, normalized, {
        email: normalized,
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

  /**
   * Map a raw Google Calendar event to the contract session shape, or null
   * when it lacks the minimum fields (id + resolvable start/end).
   */
  private toSession(event: GoogleCalendarEvent): BuildersSession | null {
    const id = event.id;
    const startsAt = this.resolveTimestamp(event.start);
    const endsAt = this.resolveTimestamp(event.end);
    if (!id || !startsAt || !endsAt) {
      return null;
    }

    return {
      id,
      title: event.summary ?? '',
      startsAt,
      endsAt,
      meetLink: this.resolveMeetLink(event),
      recurring: Boolean(event.recurringEventId || event.recurrence),
    };
  }

  /** Promote a Google start/end (dateTime or all-day date) to an ISO string. */
  private resolveTimestamp(
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
  private resolveMeetLink(event: GoogleCalendarEvent): string | null {
    if (event.hangoutLink) {
      return event.hangoutLink;
    }
    const video = event.conferenceData?.entryPoints?.find(
      (entry) => entry.entryPointType === 'video' && entry.uri,
    );
    return video?.uri ?? null;
  }

  private extractItems(json: unknown): GoogleCalendarEvent[] {
    if (
      typeof json === 'object' &&
      json !== null &&
      Array.isArray((json as { items?: unknown }).items)
    ) {
      return (json as { items: GoogleCalendarEvent[] }).items;
    }
    return [];
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
