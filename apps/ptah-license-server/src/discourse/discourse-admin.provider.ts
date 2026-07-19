import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DiscourseSyncResult } from './discourse.types';

/**
 * DiscourseAdminProvider — thin, non-throwing client for the Discourse admin
 * API, scoped to `builders` group membership sync via `fetch`.
 *
 * Auth headers: `Api-Key: <DISCOURSE_API_KEY>`, `Api-Username: <DISCOURSE_API_USERNAME>`.
 *
 * Design rules (mirrors CircleProvider):
 * - Config via ConfigService only.
 * - NEVER throws: transport errors, aborts and non-2xx fold into
 *   `{ ok:false, error }` with a sanitized reason.
 * - A user not present in Discourse (404 on lookup) is a TOLERATED no-op
 *   (`{ ok:true, skipped:true }`) — SSO creates the account on first login, so
 *   group membership is asserted then; the admin sync only touches existing users.
 * - Feature-off: when DISCOURSE_URL / DISCOURSE_API_KEY / DISCOURSE_API_USERNAME
 *   are unset, `isEnabled() === false` and every call short-circuits.
 */
@Injectable()
export class DiscourseAdminProvider {
  private readonly logger = new Logger(DiscourseAdminProvider.name);
  private readonly timeoutMs = 10_000;

  private readonly baseUrl: string | undefined;
  private readonly apiKey: string | undefined;
  private readonly apiUsername: string | undefined;
  private readonly groupName: string;

  /** Resolved numeric group id for `groupName`, cached across calls. */
  private groupIdCache: number | undefined;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.baseUrl =
      this.configService
        .get<string>('DISCOURSE_URL')
        ?.trim()
        .replace(/\/+$/, '') || undefined;
    this.apiKey =
      this.configService.get<string>('DISCOURSE_API_KEY')?.trim() || undefined;
    this.apiUsername =
      this.configService.get<string>('DISCOURSE_API_USERNAME')?.trim() ||
      undefined;
    this.groupName =
      this.configService.get<string>('DISCOURSE_BUILDERS_GROUP')?.trim() ||
      'builders';
  }

  /** True when the admin API is fully configured. */
  isEnabled(): boolean {
    return Boolean(this.baseUrl && this.apiKey && this.apiUsername);
  }

  /**
   * Add/remove a member (resolved from email + external id) to/from the
   * `builders` group. A user not found in Discourse yields a tolerated no-op.
   */
  async syncGroupMembership(
    email: string,
    externalId: string,
    isMember: boolean,
  ): Promise<DiscourseSyncResult> {
    if (!this.isEnabled()) {
      return { ok: false, skipped: true };
    }

    const username = await this.lookupUsername(email, externalId);
    if (!username.ok) {
      return { ok: false, status: username.status, error: username.error };
    }
    if (!username.username) {
      // User has never logged into Discourse — SSO will assert the group on
      // first login. Nothing to do here.
      return { ok: true, skipped: true };
    }

    const groupId = await this.resolveGroupId();
    if (groupId === undefined) {
      return {
        ok: false,
        error: `Discourse group '${this.groupName}' not found`,
      };
    }

    const path = `/groups/${groupId}/members.json`;
    const res = isMember
      ? await this.request('PUT', path, { usernames: username.username })
      : await this.request('DELETE', path, { usernames: username.username });

    if (!res.ok) {
      return { ok: false, status: res.status, error: res.error };
    }
    return { ok: true, status: res.status };
  }

  /**
   * Resolve a Discourse username from the user's stable external id, falling
   * back to email lookup. A 404 on the external-id route is treated as
   * "user not yet in Discourse" (returns `ok:true` with no username).
   */
  private async lookupUsername(
    email: string,
    externalId: string,
  ): Promise<{
    ok: boolean;
    username?: string;
    status?: number;
    error?: string;
  }> {
    const byExternal = await this.request(
      'GET',
      `/u/by-external/${encodeURIComponent(externalId)}.json`,
    );
    if (byExternal.ok) {
      const username = this.extractUsername(byExternal.json);
      if (username) {
        return { ok: true, username };
      }
    } else if (byExternal.status && byExternal.status !== 404) {
      return { ok: false, status: byExternal.status, error: byExternal.error };
    }

    // Fallback: admin email filter.
    const byEmail = await this.request(
      'GET',
      `/admin/users/list/active.json?email=${encodeURIComponent(
        email,
      )}&filter=${encodeURIComponent(email)}&show_emails=true`,
    );
    if (!byEmail.ok) {
      if (byEmail.status === 404) {
        return { ok: true }; // not found — tolerated no-op
      }
      return { ok: false, status: byEmail.status, error: byEmail.error };
    }
    return {
      ok: true,
      username: this.extractUsernameFromList(byEmail.json, email),
    };
  }

  /** Resolve (and cache) the numeric id of the configured builders group. */
  private async resolveGroupId(): Promise<number | undefined> {
    if (this.groupIdCache !== undefined) {
      return this.groupIdCache;
    }
    const res = await this.request(
      'GET',
      `/groups/${encodeURIComponent(this.groupName)}.json`,
    );
    if (!res.ok || typeof res.json !== 'object' || res.json === null) {
      return undefined;
    }
    const group = (res.json as { group?: { id?: unknown } }).group;
    if (group && typeof group.id === 'number') {
      this.groupIdCache = group.id;
      return group.id;
    }
    return undefined;
  }

  private extractUsername(json: unknown): string | undefined {
    if (typeof json !== 'object' || json === null) {
      return undefined;
    }
    const user = (json as { user?: { username?: unknown } }).user;
    if (user && typeof user.username === 'string') {
      return user.username;
    }
    const username = (json as { username?: unknown }).username;
    return typeof username === 'string' ? username : undefined;
  }

  private extractUsernameFromList(
    json: unknown,
    email: string,
  ): string | undefined {
    if (!Array.isArray(json)) {
      return undefined;
    }
    const target = email.toLowerCase();
    const match =
      json.find(
        (u) =>
          typeof u === 'object' &&
          u !== null &&
          typeof (u as { email?: unknown }).email === 'string' &&
          ((u as { email: string }).email || '').toLowerCase() === target,
      ) ?? json[0];
    if (
      typeof match === 'object' &&
      match !== null &&
      typeof (match as { username?: unknown }).username === 'string'
    ) {
      return (match as { username: string }).username;
    }
    return undefined;
  }

  /**
   * Single bounded, authenticated admin API request. Never throws; folds every
   * failure mode into a plain result object with a sanitized error.
   */
  private async request(
    method: 'GET' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ ok: boolean; status?: number; json?: unknown; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'Api-Key': this.apiKey as string,
          'Api-Username': this.apiUsername as string,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        // 404 is meaningful for lookups (surfaced to the caller), not logged loud.
        if (response.status !== 404) {
          this.logger.warn(
            `Discourse admin ${method} ${path.split('?')[0]} failed with status ${
              response.status
            }`,
          );
        }
        return {
          ok: false,
          status: response.status,
          error: `Discourse admin API returned status ${response.status}`,
        };
      }

      const json = await this.safeParseJson(response);
      return { ok: true, status: response.status, json };
    } catch (error: unknown) {
      const aborted =
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError');
      const message = aborted
        ? `Discourse admin request timed out after ${this.timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : 'Unknown Discourse admin transport error';
      this.logger.warn(
        `Discourse admin ${method} ${path.split('?')[0]} error: ${message}`,
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
