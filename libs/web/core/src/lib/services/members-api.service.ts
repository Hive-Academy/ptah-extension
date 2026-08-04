import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { z } from 'zod';

/**
 * MembersApiService — Thin HTTP client for `/api/v1/members/*`
 *
 * All URLs are kept relative — `apiInterceptor` prepends
 * `environment.apiBaseUrl` and sets `withCredentials: true` so the
 * `ptah_auth` cookie is attached cross-origin.
 *
 * Pattern mirrors `AdminApiService`: Zod schemas at the HTTP boundary are the
 * single source of truth for response shapes, with `validate()` throwing a
 * single, located error on drift instead of letting `undefined` reach a
 * template.
 */

// --- Response schemas (inbound — runtime boundary validation) ---

const buildersSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** ISO 8601 */
  startsAt: z.string(),
  /** ISO 8601 */
  endsAt: z.string(),
  meetLink: z.string().nullable(),
  recurring: z.boolean(),
});
export type BuildersSession = z.infer<typeof buildersSessionSchema>;

const memberGroupBadgeSchema = z.object({
  key: z.string(),
  name: z.string(),
});

/**
 * ⚠️ `communityUrl` IS DELIBERATELY ABSENT, AND THE ORDER MATTERS (RISK-C).
 *
 * The external forum was replaced by the native community under `/members`, so
 * this field went away on both sides. It was dropped HERE FIRST (`cdc1a1ef5`,
 * Batch 4) and on the server SECOND (Batch 5), because the two directions are
 * not symmetric: `z.object()` STRIPS unknown keys, so a client that has already
 * dropped the field parses a server that still sends it without complaint,
 * while a client still REQUIRING the field breaks the moment the server stops
 * sending it.
 *
 * ✅ BOTH HALVES HAVE NOW LANDED — the server no longer sends the field. The
 * rule is kept because it is not about this field: any cross-side field removal
 * drops the client requirement first and the server payload second, and the
 * reverse order is a live incident. Do not compress the two into one change.
 */
const membersSessionsResponseSchema = z.object({
  sessions: z.array(buildersSessionSchema),
  /**
   * Cohort/group memberships. Optional so older/mocked responses without the
   * field still validate — callers should default to `[]`.
   */
  memberGroups: z.array(memberGroupBadgeSchema).optional(),
});
export type MembersSessionsResponse = z.infer<
  typeof membersSessionsResponseSchema
>;

/**
 * Validates an HTTP response body against a Zod schema at the API boundary.
 * On mismatch it throws a single, located error (`<path>: <message>`) that
 * propagates through the Observable error channel, so callers surface a clear
 * "malformed response" instead of dereferencing `undefined` later.
 */
function validate<S extends z.ZodType>(schema: S, endpoint: string) {
  return (raw: unknown): z.infer<S> => {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`Malformed response from ${endpoint} — ${detail}`);
  };
}

@Injectable({ providedIn: 'root' })
export class MembersApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/members';

  /**
   * GET /api/v1/members/sessions — Builders-only.
   *
   * Non-members receive a 403 `{ reason: 'membership_required' }`; use
   * {@link isMembershipRequiredError} to distinguish that gate from a real
   * failure and route it into the waitlist pitch instead of an error state.
   */
  public getSessions(): Observable<MembersSessionsResponse> {
    return this.http
      .get<unknown>(`${this.base}/sessions`)
      .pipe(
        map(validate(membersSessionsResponseSchema, 'GET /members/sessions')),
      );
  }
}

/**
 * True when `error` is the 403 `{ reason: 'membership_required' }` gate
 * returned by `GET /api/v1/members/sessions` for non-Builders callers.
 */
export function isMembershipRequiredError(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;
  const body = error.error as { reason?: unknown } | null | undefined;
  return error.status === 403 && body?.reason === 'membership_required';
}
