import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { z } from 'zod';

/**
 * URL slug for every admin-addressable Prisma model.
 *
 * MUST stay in sync with the backend `AdminModelKey` union at
 * `apps/ptah-license-server/src/admin/admin-models.config.ts`.
 * Any drift here manifests as a 400 "Unknown admin model" from the API.
 */
export type AdminModelKey =
  | 'users'
  | 'licenses'
  | 'subscriptions'
  | 'failed-webhooks'
  | 'session-requests'
  | 'admin-audit-log'
  | 'marketing-campaigns'
  | 'marketing-campaign-templates'
  | 'waitlist';

// --- Request shapes (outbound — not validated) ---

export interface AdminListQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

export interface AdminBulkEmailRequest {
  userIds: string[];
  subject: string;
  html: string;
}

/**
 * Body for `POST /api/v1/admin/licenses/complimentary`.
 *
 * Target the recipient by EITHER `userId` (user-detail path) OR `email`
 * (Early Adopter approval from a waitlist row, which has no `userId`). Both
 * are optional at the type level; the server enforces that exactly one is
 * supplied and resolves/creates the user from the email when needed.
 */
export interface IssueComplimentaryLicenseRequest {
  userId?: string;
  email?: string;
  durationPreset: '30d' | '1y' | '5y' | 'custom' | 'never';
  customExpiresAt?: string;
  plan: 'builders';
  reason: string;
  sendEmail?: boolean;
  stackOnTopOfPaid?: boolean;
}

export type MarketingSegmentKey =
  | 'all'
  | 'buildersActive'
  | 'communityActive'
  | 'subscriptionPastDue';

export interface SaveTemplateRequest {
  name: string;
  subject: string;
  htmlBody: string;
  variables?: string[];
}

export interface SendCampaignRequest {
  name: string;
  templateId?: string;
  subject?: string;
  htmlBody?: string;
  segment?: MarketingSegmentKey;
  userIds?: string[];
}

/**
 * POST /api/v1/admin/waitlist/invite — `ids` wins over `batchSize` when both
 * are provided (server semantics per the founding-invite contract); at least
 * one MUST be supplied.
 */
export interface AdminInviteWaitlistRequest {
  ids?: string[];
  batchSize?: number;
}

/**
 * Lowercase slug regex for `MemberGroup.key` — MUST mirror the backend
 * `GROUP_KEY_REGEX` at
 * `apps/ptah-license-server/src/member-groups/dto/member-group.dto.ts`.
 */
export const MEMBER_GROUP_KEY_REGEX = /^[a-z0-9-]{2,40}$/;

/** Body for POST /api/v1/admin/groups. `key` is immutable after create. */
export interface CreateMemberGroupRequest {
  key: string;
  name: string;
  description?: string;
  discourseGroup?: string;
  isDefault?: boolean;
}

/**
 * Body for PATCH /api/v1/admin/groups/:id. `null` clears
 * `description`/`discourseGroup`; `key` is not patchable.
 */
export interface UpdateMemberGroupRequest {
  name?: string;
  description?: string | null;
  discourseGroup?: string | null;
  isDefault?: boolean;
}

/**
 * Body for POST /api/v1/admin/groups/:id/assign. Either or both of
 * `userIds`/`emails` may be supplied; the server resolves + dedupes them.
 */
export interface AssignGroupMembersRequest {
  userIds?: string[];
  emails?: string[];
}

// --- Response schemas (inbound — runtime boundary validation) ---
//
// These Zod schemas are the single source of truth for every server response
// shape; the exported response *types* are inferred from them via z.infer. A
// server contract change now surfaces as a located parse error at the HTTP
// boundary (see `validate`) instead of an `undefined` crash deep in a template.
// Unknown server-side keys are stripped (default z.object behaviour), so a
// server response that is a superset of the client contract still validates.

const adminRecordSchema = z.record(z.string(), z.unknown());

const adminListEnvelopeSchema = z.object({
  data: z.array(adminRecordSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
});

export interface AdminListResponse<T = Record<string, unknown>> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const adminBulkEmailResponseSchema = z.object({
  sent: z.number(),
  failed: z.array(z.object({ userId: z.string(), error: z.string() })),
});
export type AdminBulkEmailResponse = z.infer<
  typeof adminBulkEmailResponseSchema
>;

const userCascadedCountsSchema = z.object({
  subscriptions: z.number(),
  licenses: z.number(),
  sessionRequests: z.number(),
});

const deletionPreviewResponseSchema = z.object({
  userId: z.string(),
  email: z.string(),
  cascaded: userCascadedCountsSchema,
  hasActivePaidSubscription: z.boolean(),
  activePaddleSubscriptionId: z.string().optional(),
  isAdminSelf: z.boolean(),
});
export type DeletionPreviewResponse = z.infer<
  typeof deletionPreviewResponseSchema
>;

const deleteUserResponseSchema = z.object({
  deleted: z.boolean(),
  user: z.object({ id: z.string(), email: z.string() }),
  cascaded: userCascadedCountsSchema,
  auditLogId: z.string(),
});
export type DeleteUserResponse = z.infer<typeof deleteUserResponseSchema>;

const issueComplimentaryLicenseResponseSchema = z.object({
  license: z.object({
    id: z.string(),
    userId: z.string(),
    licenseKey: z.string(),
    plan: z.literal('builders'),
    status: z.literal('active'),
    source: z.literal('complimentary'),
    expiresAt: z.string().nullable(),
    createdAt: z.string(),
    createdBy: z.string().nullable(),
  }),
  warning: z
    .object({ code: z.literal('LICENSE_EMAIL_FAILED'), error: z.string() })
    .optional(),
});
export type IssueComplimentaryLicenseResponse = z.infer<
  typeof issueComplimentaryLicenseResponseSchema
>;

const marketingSegmentCountsSchema = z.object({
  total: z.number(),
  optedIn: z.number(),
});
export type MarketingSegmentCounts = z.infer<
  typeof marketingSegmentCountsSchema
>;

const marketingSegmentsResponseSchema = z.object({
  all: marketingSegmentCountsSchema,
  buildersActive: marketingSegmentCountsSchema,
  communityActive: marketingSegmentCountsSchema,
  subscriptionPastDue: marketingSegmentCountsSchema,
});
export type MarketingSegmentsResponse = z.infer<
  typeof marketingSegmentsResponseSchema
>;

const marketingSegmentsEnvelopeSchema = z.object({
  segments: marketingSegmentsResponseSchema,
});

const marketingTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  subject: z.string(),
  htmlBody: z.string(),
  variables: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MarketingTemplate = z.infer<typeof marketingTemplateSchema>;

const sendCampaignResponseSchema = z.object({
  campaignId: z.string(),
  recipientCount: z.number(),
  skippedCount: z.number(),
  status: z.literal('in_progress'),
});
export type SendCampaignResponse = z.infer<typeof sendCampaignResponseSchema>;

/**
 * Response for `POST /api/v1/admin/waitlist/invite` — the founding-invite
 * send. `skipped` counts rows already notified (or, in `ids` mode, ids that
 * did not resolve to an un-notified waitlist row).
 */
const adminInviteWaitlistResponseSchema = z.object({
  invited: z.number(),
  skipped: z.number(),
});
export type AdminInviteWaitlistResponse = z.infer<
  typeof adminInviteWaitlistResponseSchema
>;

const adminStatsWaitlistSchema = z.object({
  total: z.number(),
  notified: z.number(),
  converted: z.number(),
  last7Days: z.number(),
});

const adminStatsMembersSchema = z.object({
  builders: z.number(),
  community: z.number(),
});

const adminStatsGroupSchema = z.object({
  key: z.string(),
  name: z.string(),
  memberCount: z.number(),
});

/** Response for `GET /api/v1/admin/stats` — drives the Overview dashboard. */
const adminStatsResponseSchema = z.object({
  waitlist: adminStatsWaitlistSchema,
  members: adminStatsMembersSchema,
  groups: z.array(adminStatsGroupSchema),
  updatedAt: z.string(),
});
export type AdminStatsResponse = z.infer<typeof adminStatsResponseSchema>;

/**
 * A member cohort ("group") as surfaced by `/api/v1/admin/groups`. Mirrors
 * backend `MemberGroupResponse` at
 * `apps/ptah-license-server/src/member-groups/member-groups.controller.ts`.
 */
const memberGroupSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  discourseGroup: z.string().nullable(),
  isDefault: z.boolean(),
  memberCount: z.number(),
  createdAt: z.string(),
});
export type MemberGroup = z.infer<typeof memberGroupSchema>;

const memberGroupsEnvelopeSchema = z.object({
  groups: z.array(memberGroupSchema),
});

/** Response for `POST /api/v1/admin/groups/:id/assign`. */
const assignGroupMembersResponseSchema = z.object({
  assigned: z.number(),
  skipped: z.number(),
});
export type AssignGroupMembersResponse = z.infer<
  typeof assignGroupMembersResponseSchema
>;

/** Response for `DELETE /api/v1/admin/groups/:id/members/:userId`. */
const unassignGroupMemberResponseSchema = z.object({
  removed: z.boolean(),
});
export type UnassignGroupMemberResponse = z.infer<
  typeof unassignGroupMemberResponseSchema
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

/**
 * AdminApiService - Thin HTTP client for `/api/v1/admin/*`
 *
 * All URLs are kept relative — `apiInterceptor` prepends
 * `environment.apiBaseUrl` and sets `withCredentials: true` so the
 * `ptah_auth` cookie is attached cross-origin.
 *
 * Angular 21 patterns:
 * - `inject()` DI
 * - `providedIn: 'root'` singleton
 * - All methods return `Observable<T>` (no Promises)
 * - Stateless — no signals, no BehaviorSubject
 */
@Injectable({ providedIn: 'root' })
export class AdminApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/admin';

  /**
   * List records for a model with pagination, sort, and full-text search.
   *
   * HttpParams are only set when the query value is non-nullish; omitting
   * keeps the URL clean and lets the backend apply its `ListQueryDto`
   * defaults (page=1, pageSize=25, sortOrder=desc).
   */
  public list<T = Record<string, unknown>>(
    model: AdminModelKey,
    q: AdminListQuery = {},
  ): Observable<AdminListResponse<T>> {
    let params = new HttpParams();
    if (q.page != null) params = params.set('page', String(q.page));
    if (q.pageSize != null) params = params.set('pageSize', String(q.pageSize));
    if (q.sortBy) params = params.set('sortBy', q.sortBy);
    if (q.sortOrder) params = params.set('sortOrder', q.sortOrder);
    if (q.search) params = params.set('search', q.search);
    return this.http.get<unknown>(`${this.base}/${model}`, { params }).pipe(
      map(validate(adminListEnvelopeSchema, `GET /${model}`)),
      map(
        (res): AdminListResponse<T> => ({
          ...res,
          data: res.data as unknown as T[],
        }),
      ),
    );
  }

  /**
   * Fetch a single record by ID. Backend returns 404 if missing.
   */
  public get<T = Record<string, unknown>>(
    model: AdminModelKey,
    id: string,
  ): Observable<T> {
    return this.http.get<unknown>(`${this.base}/${model}/${id}`).pipe(
      map(validate(adminRecordSchema, `GET /${model}/${id}`)),
      map((rec) => rec as unknown as T),
    );
  }

  /**
   * Patch a record. Body keys not in the backend editable-field allowlist
   * are silently dropped server-side; a body with zero editable keys
   * yields a 400. Read-only models respond with 405.
   */
  public update<T = Record<string, unknown>>(
    model: AdminModelKey,
    id: string,
    patch: Record<string, unknown>,
  ): Observable<T> {
    return this.http.patch<unknown>(`${this.base}/${model}/${id}`, patch).pipe(
      map(validate(adminRecordSchema, `PATCH /${model}/${id}`)),
      map((rec) => rec as unknown as T),
    );
  }

  /**
   * Bulk marketing email to a set of user IDs. Backend caps at 500 IDs per
   * request and runs `sendCustomEmail` in parallel via `Promise.allSettled`,
   * returning per-user success/failure details.
   */
  public bulkEmail(
    payload: AdminBulkEmailRequest,
  ): Observable<AdminBulkEmailResponse> {
    return this.http
      .post<unknown>(`${this.base}/users/bulk-email`, payload)
      .pipe(
        map(validate(adminBulkEmailResponseSchema, 'POST /users/bulk-email')),
      );
  }

  public getUserDeletionPreview(
    userId: string,
  ): Observable<DeletionPreviewResponse> {
    return this.http
      .get<unknown>(`${this.base}/users/${userId}/deletion-preview`)
      .pipe(
        map(
          validate(
            deletionPreviewResponseSchema,
            `GET /users/${userId}/deletion-preview`,
          ),
        ),
      );
  }

  public deleteUser(
    userId: string,
    body: { confirmEmail: string; acknowledgePaidSubscription?: boolean },
  ): Observable<DeleteUserResponse> {
    return this.http
      .delete<unknown>(`${this.base}/users/${userId}`, { body })
      .pipe(map(validate(deleteUserResponseSchema, `DELETE /users/${userId}`)));
  }

  /**
   * Issues a complimentary Builders license to a user.
   * POST /api/v1/admin/licenses/complimentary
   */
  public issueComplimentaryLicense(
    body: IssueComplimentaryLicenseRequest,
  ): Observable<IssueComplimentaryLicenseResponse> {
    return this.http
      .post<unknown>(`${this.base}/licenses/complimentary`, body)
      .pipe(
        map(
          validate(
            issueComplimentaryLicenseResponseSchema,
            'POST /licenses/complimentary',
          ),
        ),
      );
  }

  public getMarketingSegments(): Observable<MarketingSegmentsResponse> {
    return this.http.get<unknown>(`${this.base}/marketing/segments`).pipe(
      map(validate(marketingSegmentsEnvelopeSchema, 'GET /marketing/segments')),
      map((res) => res.segments),
    );
  }

  public saveTemplate(
    body: SaveTemplateRequest,
  ): Observable<MarketingTemplate> {
    return this.http
      .post<unknown>(`${this.base}/marketing/templates`, body)
      .pipe(
        map(validate(marketingTemplateSchema, 'POST /marketing/templates')),
      );
  }

  public sendCampaign(
    body: SendCampaignRequest,
  ): Observable<SendCampaignResponse> {
    return this.http
      .post<unknown>(`${this.base}/marketing/send`, body)
      .pipe(map(validate(sendCampaignResponseSchema, 'POST /marketing/send')));
  }

  /**
   * Sends the founding-invite email (checkout links carrying the discount
   * env IDs) to explicit waitlist ids, or the N oldest un-notified rows when
   * `batchSize` is used instead. `ids` wins when both are supplied.
   */
  public inviteWaitlist(
    body: AdminInviteWaitlistRequest,
  ): Observable<AdminInviteWaitlistResponse> {
    return this.http
      .post<unknown>(`${this.base}/waitlist/invite`, body)
      .pipe(
        map(
          validate(adminInviteWaitlistResponseSchema, 'POST /waitlist/invite'),
        ),
      );
  }

  /** Overview dashboard stat tiles — waitlist funnel + member counts by tier. */
  public getStats(): Observable<AdminStatsResponse> {
    return this.http
      .get<unknown>(`${this.base}/stats`)
      .pipe(map(validate(adminStatsResponseSchema, 'GET /stats')));
  }

  /** Lists every member cohort (group) with its current member count. */
  public listGroups(): Observable<MemberGroup[]> {
    return this.http.get<unknown>(`${this.base}/groups`).pipe(
      map(validate(memberGroupsEnvelopeSchema, 'GET /groups')),
      map((res) => res.groups),
    );
  }

  /**
   * Creates a member cohort. `isDefault: true` atomically clears the
   * previous default group server-side.
   */
  public createGroup(body: CreateMemberGroupRequest): Observable<MemberGroup> {
    return this.http
      .post<unknown>(`${this.base}/groups`, body)
      .pipe(map(validate(memberGroupSchema, 'POST /groups')));
  }

  /** Patches a member cohort's mutable fields (`key` is immutable). */
  public updateGroup(
    id: string,
    body: UpdateMemberGroupRequest,
  ): Observable<MemberGroup> {
    return this.http
      .patch<unknown>(`${this.base}/groups/${id}`, body)
      .pipe(map(validate(memberGroupSchema, `PATCH /groups/${id}`)));
  }

  /**
   * Bulk-assigns users (by id and/or pasted email) to a cohort. Skipped
   * counts already-assigned or unresolved ids/emails — the server does not
   * return per-item reasons.
   */
  public assignGroupMembers(
    id: string,
    body: AssignGroupMembersRequest,
  ): Observable<AssignGroupMembersResponse> {
    return this.http
      .post<unknown>(`${this.base}/groups/${id}/assign`, body)
      .pipe(
        map(
          validate(
            assignGroupMembersResponseSchema,
            `POST /groups/${id}/assign`,
          ),
        ),
      );
  }

  /** Removes a single user from a cohort. Idempotent — a missing assignment is a no-op. */
  public unassignGroupMember(
    id: string,
    userId: string,
  ): Observable<UnassignGroupMemberResponse> {
    return this.http
      .delete<unknown>(`${this.base}/groups/${id}/members/${userId}`)
      .pipe(
        map(
          validate(
            unassignGroupMemberResponseSchema,
            `DELETE /groups/${id}/members/${userId}`,
          ),
        ),
      );
  }
}
