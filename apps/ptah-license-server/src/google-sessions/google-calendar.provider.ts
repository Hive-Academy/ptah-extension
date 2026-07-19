import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleAuthProvider } from './google-auth.provider';
import type {
  GoogleApiResult,
  GoogleCalendarEvent,
} from './google-sessions.types';

/**
 * GoogleCalendarProvider — thin, typed, non-throwing client for the Google
 * Calendar v3 REST API (events list + single-event patch) via `fetch`.
 *
 * Base: https://www.googleapis.com/calendar/v3
 * Auth: bearer access token minted by {@link GoogleAuthProvider}.
 *
 * Design rules (mirrors CircleProvider):
 * - Config via ConfigService only (GOOGLE_CALENDAR_ID, default 'primary').
 * - Every method returns a typed result and NEVER throws — transport errors,
 *   aborts (timeouts) and non-2xx responses fold into `{ ok:false, error }`
 *   with a sanitized reason. Raw upstream bodies are never surfaced.
 * - Feature-off: delegates to the auth provider; when Google is unconfigured
 *   the auth `getAccessToken()` returns `{ skipped:true }` and every call here
 *   short-circuits to `{ ok:false, skipped:true }` without a network round-trip.
 */
@Injectable()
export class GoogleCalendarProvider {
  private readonly logger = new Logger(GoogleCalendarProvider.name);
  private readonly baseUrl = 'https://www.googleapis.com/calendar/v3';
  private readonly timeoutMs = 10_000;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(GoogleAuthProvider) private readonly auth: GoogleAuthProvider,
  ) {}

  /** True when the underlying OAuth2 flow is configured. */
  isEnabled(): boolean {
    return this.auth.isEnabled();
  }

  /** Configured target calendar (defaults to the account's 'primary'). */
  private get calendarId(): string {
    return (
      this.configService.get<string>('GOOGLE_CALENDAR_ID')?.trim() || 'primary'
    );
  }

  /**
   * List events between `timeMin` and `timeMax`, expanding recurrences into
   * concrete instances (`singleEvents=true`, ordered by start time).
   *
   * @returns `{ ok, json }` where `json.items` is the raw events array on
   *          success; `{ skipped:true }` in feature-off mode; `{ ok:false }`
   *          on any failure.
   */
  async listEvents(timeMin: Date, timeMax: Date): Promise<GoogleApiResult> {
    const query = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
      showDeleted: 'false',
    });
    return this.request(
      'GET',
      `/calendars/${encodeURIComponent(this.calendarId)}/events?${query.toString()}`,
    );
  }

  /**
   * Fetch a single event (used for read-modify-write of attendees). The master
   * recurring event id (BUILDERS_SESSION_EVENT_ID) is a valid target here.
   */
  async getEvent(eventId: string): Promise<GoogleApiResult> {
    return this.request(
      'GET',
      `/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(
        eventId,
      )}`,
    );
  }

  /**
   * Read-modify-write the attendee list of `eventId`: fetch the event, apply
   * `mutate` to its attendees, and PATCH the result back. Uses the fetched
   * `etag` as an `If-Match` header for optimistic concurrency; a 412 (etag
   * mismatch) is surfaced as `{ ok:false }` for the best-effort caller to log.
   *
   * `sendUpdates=none` avoids spamming the whole invite list on every add.
   */
  async patchEventAttendees(
    eventId: string,
    mutate: (
      attendees: NonNullable<GoogleCalendarEvent['attendees']>,
    ) => NonNullable<GoogleCalendarEvent['attendees']>,
  ): Promise<GoogleApiResult> {
    const current = await this.getEvent(eventId);
    if (!current.ok) {
      return current;
    }

    const event = (current.json ?? {}) as GoogleCalendarEvent;
    const nextAttendees = mutate(event.attendees ?? []);

    const headers: Record<string, string> = {};
    if (current.etag) {
      headers['If-Match'] = current.etag;
    }

    return this.request(
      'PATCH',
      `/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(
        eventId,
      )}?sendUpdates=none`,
      { attendees: nextAttendees },
      headers,
    );
  }

  /**
   * Perform a single bounded, authenticated Calendar API request. Never throws:
   * a feature-off/failed token, transport error, abort, or non-2xx all fold
   * into `{ ok:false, error }` (or `{ skipped:true }` in feature-off mode).
   */
  private async request(
    method: 'GET' | 'PATCH',
    path: string,
    body?: Record<string, unknown>,
    extraHeaders?: Record<string, string>,
  ): Promise<GoogleApiResult> {
    const token = await this.auth.getAccessToken();
    if (!token.ok || !token.accessToken) {
      if (token.skipped) {
        return { ok: false, skipped: true };
      }
      return { ok: false, error: token.error ?? 'Google auth unavailable' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(extraHeaders ?? {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          `Google Calendar ${method} ${path.split('?')[0]} failed with status ${
            response.status
          }`,
        );
        return {
          ok: false,
          status: response.status,
          error: `Google Calendar API returned status ${response.status}`,
        };
      }

      const json = await this.safeParseJson(response);
      const etag =
        (typeof json === 'object' &&
          json !== null &&
          typeof (json as { etag?: unknown }).etag === 'string' &&
          (json as { etag: string }).etag) ||
        response.headers.get('etag') ||
        undefined;

      return { ok: true, status: response.status, json, etag };
    } catch (error: unknown) {
      const aborted =
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError');
      const message = aborted
        ? `Google Calendar request timed out after ${this.timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : 'Unknown Google Calendar transport error';
      this.logger.warn(
        `Google Calendar ${method} ${path.split('?')[0]} error: ${message}`,
      );
      return { ok: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  private async safeParseJson(response: Response): Promise<unknown> {
    try {
      const text = await response.text();
      return text ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      return undefined;
    }
  }
}
