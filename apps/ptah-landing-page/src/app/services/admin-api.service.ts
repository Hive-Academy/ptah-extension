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
  | 'trial-reminders'
  | 'session-requests'
  | 'admin-audit-log'
  | 'marketing-campaigns'
  | 'marketing-campaign-templates';

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

export interface IssueComplimentaryLicenseRequest {
  userId: string;
  durationPreset: '30d' | '1y' | '5y' | 'custom' | 'never';
  customExpiresAt?: string;
  plan: 'pro';
  reason: string;
  sendEmail?: boolean;
  stackOnTopOfPaid?: boolean;
}

export type MarketingSegmentKey =
  | 'all'
  | 'proActive'
  | 'communityActive'
  | 'trialing'
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
  trialReminders: z.number(),
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
    plan: z.literal('pro'),
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
  proActive: marketingSegmentCountsSchema,
  communityActive: marketingSegmentCountsSchema,
  trialing: marketingSegmentCountsSchema,
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
   * Issues a complimentary Pro license to a user.
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
}
