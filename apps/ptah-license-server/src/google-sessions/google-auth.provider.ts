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
}
