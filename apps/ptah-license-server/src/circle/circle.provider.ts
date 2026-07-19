import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CircleInviteResult, CircleRemoveResult } from './circle.types';

/**
 * CircleProvider — thin, typed client for the Circle Admin API v2 (headless
 * member management).
 *
 * Base: https://app.circle.so/api/admin/v2
 * Auth: `Authorization: Bearer <CIRCLE_API_TOKEN>`
 *
 * Design rules:
 * - Reads all config via ConfigService (never `process.env` directly).
 * - Every method returns a typed result object and NEVER throws — upstream
 *   failures, timeouts and network errors are captured into `{ ok: false }`
 *   with a short sanitized `error`; raw upstream bodies are never surfaced.
 * - Feature-off mode: when `CIRCLE_API_TOKEN` or `CIRCLE_COMMUNITY_ID` is unset
 *   the client reports `isEnabled() === false` and returns `{ skipped: true }`
 *   without making any network call.
 * - Requests are bounded by an AbortController timeout so a hung Circle API
 *   can never wedge the Paddle webhook path.
 */
@Injectable()
export class CircleProvider {
  private readonly logger = new Logger(CircleProvider.name);
  private readonly baseUrl = 'https://app.circle.so/api/admin/v2';
  private readonly timeoutMs = 10_000;

  private readonly token: string | undefined;
  private readonly communityId: string | undefined;
  private readonly spaceGroupId: string | undefined;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {
    this.token =
      this.configService.get<string>('CIRCLE_API_TOKEN')?.trim() || undefined;
    this.communityId =
      this.configService.get<string>('CIRCLE_COMMUNITY_ID')?.trim() ||
      undefined;
    this.spaceGroupId =
      this.configService.get<string>('CIRCLE_DEFAULT_SPACE_GROUP_ID')?.trim() ||
      undefined;
  }

  /**
   * True when the integration is fully configured. When false, callers should
   * treat Circle as a no-op (feature-off) rather than an error.
   */
  isEnabled(): boolean {
    return Boolean(this.token && this.communityId);
  }

  /**
   * Invite a member into the Circle community.
   *
   * POST /community_members  { email, name?, community_id, space_group_id? }
   *
   * @returns `{ ok, memberId? }` on success, `{ skipped: true }` in feature-off
   *          mode, or `{ ok: false, error }` on any upstream/transport failure.
   */
  async inviteMember(
    email: string,
    name?: string,
  ): Promise<CircleInviteResult> {
    if (!this.isEnabled()) {
      return { ok: false, skipped: true };
    }

    const body: Record<string, unknown> = {
      email,
      community_id: this.communityId,
    };
    if (name) {
      body['name'] = name;
    }
    if (this.spaceGroupId) {
      body['space_group_id'] = this.spaceGroupId;
    }

    const res = await this.request('POST', '/community_members', body);
    if (!res.ok) {
      return { ok: false, status: res.status, error: res.error };
    }

    return {
      ok: true,
      status: res.status,
      memberId: this.extractMemberId(res.json),
    };
  }

  /**
   * Remove/deactivate a member from the Circle community.
   *
   * DELETE /community_members?community_member_id=<id>   (numeric member id)
   * DELETE /community_members?email=<email>              (email fallback)
   *
   * @param idOrEmail - stored Circle member id, or the member's email.
   * @returns `{ ok }` on success, `{ skipped: true }` in feature-off mode, or
   *          `{ ok: false, error }` on any upstream/transport failure.
   */
  async removeMember(idOrEmail: string): Promise<CircleRemoveResult> {
    if (!this.isEnabled()) {
      return { ok: false, skipped: true };
    }

    const query = idOrEmail.includes('@')
      ? `email=${encodeURIComponent(idOrEmail)}`
      : `community_member_id=${encodeURIComponent(idOrEmail)}`;
    const path = `/community_members?${query}&community_id=${encodeURIComponent(
      this.communityId as string,
    )}`;

    const res = await this.request('DELETE', path);
    if (!res.ok) {
      return { ok: false, status: res.status, error: res.error };
    }
    return { ok: true, status: res.status };
  }

  /**
   * Perform a single bounded HTTP request against the Circle Admin API.
   *
   * Never throws: transport errors, aborts (timeouts) and non-2xx responses are
   * all folded into `{ ok: false, error }`. The upstream response body is read
   * only to derive a JSON payload on success and a truncated, sanitized error
   * string on failure — full bodies are never propagated to callers.
   */
  private async request(
    method: 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    status?: number;
    json?: unknown;
    error?: string;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          `Circle API ${method} ${path.split('?')[0]} failed with status ${
            response.status
          }`,
        );
        return {
          ok: false,
          status: response.status,
          error: `Circle API returned status ${response.status}`,
        };
      }

      const json = await this.safeParseJson(response);
      return { ok: true, status: response.status, json };
    } catch (error: unknown) {
      const aborted =
        error instanceof Error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError');
      const message = aborted
        ? `Circle API request timed out after ${this.timeoutMs}ms`
        : error instanceof Error
          ? error.message
          : 'Unknown Circle API transport error';
      this.logger.warn(
        `Circle API ${method} ${path.split('?')[0]} error: ${message}`,
      );
      return { ok: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Best-effort JSON parse — a body that is empty or not valid JSON is not an
   * error for our purposes (e.g. a 204 on delete), so we return undefined.
   */
  private async safeParseJson(response: Response): Promise<unknown> {
    try {
      const text = await response.text();
      return text ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Extract the Circle community member id from a variety of response shapes
   * (`{ id }`, `{ community_member_id }`, `{ member: { id } }`). Returns
   * undefined when no id can be resolved. Numeric ids are stringified for
   * storage in `User.circleMemberId` (a String? column).
   */
  private extractMemberId(json: unknown): string | undefined {
    if (typeof json !== 'object' || json === null) {
      return undefined;
    }
    const record = json as Record<string, unknown>;
    const candidate =
      record['id'] ??
      record['community_member_id'] ??
      (typeof record['member'] === 'object' && record['member'] !== null
        ? (record['member'] as Record<string, unknown>)['id']
        : undefined);

    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate;
    }
    if (typeof candidate === 'number') {
      return String(candidate);
    }
    return undefined;
  }
}
