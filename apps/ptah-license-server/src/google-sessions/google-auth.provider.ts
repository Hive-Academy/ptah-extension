import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GoogleTokenResult } from './google-sessions.types';

/**
 * GoogleAuthProvider — headless OAuth2 access-token minter for the founder's
 * Google account, using the standard refresh-token grant against the Google
 * OAuth token endpoint via `fetch` (NO googleapis npm package).
 *
 * Design rules (mirrors CircleProvider):
 * - Reads all config via ConfigService (never `process.env` directly).
 * - NEVER throws: transport/upstream failures fold into `{ ok:false, error }`
 *   with a short sanitized reason — raw upstream bodies are never surfaced.
 * - Feature-off: when GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET /
 *   GOOGLE_OAUTH_REFRESH_TOKEN are unset, `isEnabled() === false` and no token
 *   is requested (`{ skipped:true }`).
 * - In-memory access-token cache keyed by expiry (refreshed ~60s early). A hung
 *   token endpoint is bounded by an AbortController timeout.
 */
@Injectable()
export class GoogleAuthProvider {
  /**
   * Scopes that permit `events.insert` / `events.patch` / `events.delete`.
   * Google's ladder distinguishes read from write but not write-verb from
   * write-verb: both of these allow all three. A `.readonly` variant allows
   * none of them.
   */
  private static readonly CALENDAR_WRITE_SCOPES = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
  ];

  private readonly logger = new Logger(GoogleAuthProvider.name);
  private readonly tokenUrl = 'https://oauth2.googleapis.com/token';
  private readonly timeoutMs = 10_000;
  /** Refresh this many ms before real expiry to avoid edge-of-expiry races. */
  private readonly expiryBufferMs = 60_000;

  private readonly clientId: string | undefined;
  private readonly clientSecret: string | undefined;
  private readonly refreshToken: string | undefined;

  private cachedToken: string | undefined;
  private cachedExpiresAt = 0;

  /**
   * Scopes carried by the last successful refresh-token grant. `undefined`
   * until a refresh has succeeded at least once since boot.
   */
  private grantedScopes: string[] | undefined;

  /** Guard so the scope verdict is logged once, not on every token refresh. */
  private loggedScopeVerdict = false;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.clientId =
      this.configService.get<string>('GOOGLE_OAUTH_CLIENT_ID')?.trim() ||
      undefined;
    this.clientSecret =
      this.configService.get<string>('GOOGLE_OAUTH_CLIENT_SECRET')?.trim() ||
      undefined;
    this.refreshToken =
      this.configService.get<string>('GOOGLE_OAUTH_REFRESH_TOKEN')?.trim() ||
      undefined;
  }

  /**
   * True when the OAuth2 refresh-token flow is fully configured. When false,
   * callers treat Google as a no-op (feature-off) rather than an error.
   */
  isEnabled(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.refreshToken);
  }

  /**
   * Return a valid bearer access token, refreshing via the refresh-token grant
   * when the cache is empty or within the expiry buffer.
   *
   * @returns `{ ok, accessToken }` on success, `{ skipped:true }` in feature-off
   *          mode, or `{ ok:false, error }` on any upstream/transport failure.
   */
  async getAccessToken(): Promise<GoogleTokenResult> {
    if (!this.isEnabled()) {
      return { ok: false, skipped: true };
    }

    if (this.cachedToken && Date.now() < this.cachedExpiresAt) {
      return { ok: true, accessToken: this.cachedToken };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const body = new URLSearchParams({
        client_id: this.clientId as string,
        client_secret: this.clientSecret as string,
        refresh_token: this.refreshToken as string,
        grant_type: 'refresh_token',
      });

      const response = await fetch(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          `Google token refresh failed with status ${response.status}`,
        );
        return {
          ok: false,
          error: `Google token endpoint returned status ${response.status}`,
        };
      }

      const json = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
        /** Space-delimited list of scopes actually granted for this token. */
        scope?: string;
      };
      if (!json.access_token) {
        return {
          ok: false,
          error: 'Google token response missing access_token',
        };
      }

      const expiresInMs = (json.expires_in ?? 3600) * 1000;
      this.cachedToken = json.access_token;
      this.cachedExpiresAt = Date.now() + expiresInMs - this.expiryBufferMs;
      this.recordGrantedScopes(json.scope);

      return { ok: true, accessToken: json.access_token };
    } catch (error: unknown) {
      const aborted =
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError');
      const message = aborted
        ? `Google token refresh timed out after ${this.timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : 'Unknown Google token transport error';
      this.logger.warn(`Google token refresh error: ${message}`);
      return { ok: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Whether the refresh-token grant carries a scope permitting event writes
   * (`events.insert` / `events.patch` / `events.delete`).
   *
   * `undefined` = not yet determined — no successful refresh since boot, so no
   * grant has been observed. A `true`/`false` verdict is only meaningful after
   * `getAccessToken()` has succeeded at least once. Callers surface `undefined`
   * as "unknown", never as "no".
   *
   * This is the CHEAP verification mechanism. The authoritative one is the live
   * create+delete smoke (`scripts/google-calendar-write-smoke.mjs`) — a grant
   * can name a scope the calendar ACL still refuses.
   */
  hasCalendarWriteScope(): boolean | undefined {
    if (this.grantedScopes === undefined) {
      return undefined;
    }
    return this.grantedScopes.some((scope) =>
      GoogleAuthProvider.CALENDAR_WRITE_SCOPES.includes(scope),
    );
  }

  /**
   * Cache the scopes returned alongside a fresh access token and log the write
   * verdict once.
   *
   * Google omits `scope` on some refresh-grant responses; when it does, a
   * previously observed grant is retained rather than being downgraded to
   * "unknown" — an absent field is not evidence of a narrowed grant.
   *
   * Scopes are not secrets, but only the boolean verdict and the matched scope
   * name are logged — never the token.
   */
  private recordGrantedScopes(scope: string | undefined): void {
    const scopes = (scope ?? '').split(' ').filter(Boolean);
    if (scopes.length === 0 && this.grantedScopes !== undefined) {
      return;
    }
    this.grantedScopes = scopes;

    if (this.loggedScopeVerdict) {
      return;
    }
    this.loggedScopeVerdict = true;
    const matched = scopes.find((s) =>
      GoogleAuthProvider.CALENDAR_WRITE_SCOPES.includes(s),
    );
    this.logger.log(
      matched
        ? `Google Calendar write scope present (granted: ${matched})`
        : `Google Calendar write scope ABSENT — event create/update/delete will be refused upstream (granted scope count: ${scopes.length})`,
    );
  }
}
