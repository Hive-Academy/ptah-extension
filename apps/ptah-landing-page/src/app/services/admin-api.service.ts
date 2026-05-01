import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

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

export interface AdminListQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

export interface AdminListResponse<T = Record<string, unknown>> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminBulkEmailRequest {
  userIds: string[];
  subject: string;
  html: string;
}

export interface AdminBulkEmailResponse {
  sent: number;
  failed: Array<{ userId: string; error: string }>;
}

export interface DeletionPreviewResponse {
  userId: string;
  email: string;
  cascaded: {
    subscriptions: number;
    licenses: number;
    trialReminders: number;
    sessionRequests: number;
  };
  hasActivePaidSubscription: boolean;
  activePaddleSubscriptionId?: string;
  isAdminSelf: boolean;
}

export interface DeleteUserResponse {
  deleted: boolean;
  user: { id: string; email: string };
  cascaded: {
    subscriptions: number;
    licenses: number;
    trialReminders: number;
    sessionRequests: number;
  };
  auditLogId: string;
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

export interface IssueComplimentaryLicenseResponse {
  success: true;
  license: {
    id: string;
    userId: string;
    licenseKey: string;
    plan: 'pro';
    status: 'active';
    source: 'complimentary';
    expiresAt: string | null;
    createdAt: string;
    createdBy: string;
  };
  emailSent: boolean;
  emailError?: string;
  warning?: 'LICENSE_EMAIL_FAILED';
  auditLogId: string;
}

export interface MarketingSegmentCounts {
  total: number;
  optedIn: number;
}

export interface MarketingSegmentsResponse {
  all: MarketingSegmentCounts;
  proActive: MarketingSegmentCounts;
  communityActive: MarketingSegmentCounts;
  trialing: MarketingSegmentCounts;
  subscriptionPastDue: MarketingSegmentCounts;
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

export interface MarketingTemplate {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  variables: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SendCampaignRequest {
  name: string;
  templateId?: string;
  subject?: string;
  htmlBody?: string;
  segment?: MarketingSegmentKey;
  userIds?: string[];
}

export interface SendCampaignResponse {
  campaignId: string;
  recipientCount: number;
  skippedCount: number;
  status: 'in_progress';
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
    return this.http.get<AdminListResponse<T>>(`${this.base}/${model}`, {
      params,
    });
  }

  /**
   * Fetch a single record by ID. Backend returns 404 if missing.
   */
  public get<T = Record<string, unknown>>(
    model: AdminModelKey,
    id: string,
  ): Observable<T> {
    return this.http.get<T>(`${this.base}/${model}/${id}`);
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
    return this.http.patch<T>(`${this.base}/${model}/${id}`, patch);
  }

  /**
   * Bulk marketing email to a set of user IDs. Backend caps at 500 IDs per
   * request and runs `sendCustomEmail` in parallel via `Promise.allSettled`,
   * returning per-user success/failure details.
   */
  public bulkEmail(
    payload: AdminBulkEmailRequest,
  ): Observable<AdminBulkEmailResponse> {
    return this.http.post<AdminBulkEmailResponse>(
      `${this.base}/users/bulk-email`,
      payload,
    );
  }

  public getUserDeletionPreview(
    userId: string,
  ): Observable<DeletionPreviewResponse> {
    return this.http.get<DeletionPreviewResponse>(
      `${this.base}/users/${userId}/deletion-preview`,
    );
  }

  public deleteUser(
    userId: string,
    body: { confirmEmail: string; acknowledgePaidSubscription?: boolean },
  ): Observable<DeleteUserResponse> {
    return this.http.delete<DeleteUserResponse>(
      `${this.base}/users/${userId}`,
      { body },
    );
  }

  /**
   * Issues a complimentary Pro license to a user.
   * POST /api/v1/admin/licenses/complimentary
   */
  public issueComplimentaryLicense(
    body: IssueComplimentaryLicenseRequest,
  ): Observable<IssueComplimentaryLicenseResponse> {
    return this.http.post<IssueComplimentaryLicenseResponse>(
      `${this.base}/licenses/complimentary`,
      body,
    );
  }

  public getMarketingSegments(): Observable<MarketingSegmentsResponse> {
    return this.http.get<MarketingSegmentsResponse>(
      `${this.base}/marketing/segments`,
    );
  }

  public saveTemplate(
    body: SaveTemplateRequest,
  ): Observable<MarketingTemplate> {
    return this.http.post<MarketingTemplate>(
      `${this.base}/marketing/templates`,
      body,
    );
  }

  public sendCampaign(
    body: SendCampaignRequest,
  ): Observable<SendCampaignResponse> {
    return this.http.post<SendCampaignResponse>(
      `${this.base}/marketing/send`,
      body,
    );
  }
}
