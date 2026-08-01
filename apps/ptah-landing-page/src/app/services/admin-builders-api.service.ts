import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { z } from 'zod';

import { validate } from './validate-response';

/**
 * AdminBuildersApiService — HTTP client for the Builders-content admin surface
 * (`/api/v1/admin/packs`, `/api/v1/admin/sessions`, `/api/v1/admin/community`,
 * `/api/v1/admin/groups/:id/members`).
 *
 * Split out of `AdminApiService` (which is the generic `:model` CRUD client and
 * is already ~600 lines) so each service owns one concern. Same conventions:
 * relative URLs only — `apiInterceptor` prepends `environment.apiBaseUrl` and
 * sets `withCredentials: true`; Zod at the HTTP boundary via the shared
 * `validate()` helper; all methods return `Observable<T>`; stateless.
 *
 * ⚠️ EVERY endpoint below is behind the server's `AdminGuard`. There is no
 * member-facing counterpart to any of them — in particular there is NO
 * member-facing packs endpoint (TASK_2026_169 Decision 3): packs reach Builders
 * through GitHub, never through Ptah. `members-api.service.ts` is deliberately
 * untouched by this feature.
 */

// --- Shared client-side validation mirrors (defense-in-depth) ---

/**
 * GitHub repo URL shape for `Pack.repoUrl` — MUST mirror the backend
 * `@Matches(...)` on `CreatePackDto` / `UpdatePackDto`. The server is the real
 * boundary (risk L4: a stored `javascript:` URI rendered as `<a [href]>` in the
 * admin console); this copy exists only so the form can refuse it before the
 * round-trip.
 */
export const PACK_REPO_URL_REGEX =
  /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/?$/;

/**
 * Lowercase slug shape for `Pack.slug`. Mirrors the `MemberGroup.key`
 * convention (`MEMBER_GROUP_KEY_REGEX`) since the backend DTO follows the same
 * house style. Client-side UX guard only — the server validates independently.
 */
export const PACK_SLUG_REGEX = /^[a-z0-9-]{2,64}$/;

// --- Request shapes (outbound — not validated) ---

/** Query for `GET /api/v1/admin/packs`. Both filters are optional. */
export interface ListPacksQuery {
  /** Case-insensitive match against `title` / `slug` (server-side, fixed columns). */
  search?: string;
  /** Narrow to one cohort label. Omit for every pack across every cohort. */
  cohortKey?: string;
}

/**
 * Body for `POST /api/v1/admin/packs`.
 *
 * `cohortKey` is a BOOKKEEPING LABEL and gates nothing — access to the repo is
 * granted on GitHub, outside Ptah entirely. `null`/omitted simply means the
 * repo is not tied to a particular cohort.
 */
export interface CreatePackRequest {
  slug: string;
  title: string;
  description: string;
  repoUrl: string;
  notes?: string;
  tags?: string[];
  cohortKey?: string | null;
}

/**
 * Body for `PATCH /api/v1/admin/packs/:id`. `null` clears `notes` / `cohortKey`;
 * `slug` is not patchable (stable identifier, mirroring `MemberGroup.key`).
 */
export interface UpdatePackRequest {
  title?: string;
  description?: string;
  repoUrl?: string;
  notes?: string | null;
  tags?: string[];
  cohortKey?: string | null;
}

/** Query for `GET /api/v1/admin/sessions`. `daysAhead` is 1–365, default 60. */
export interface ListSessionsQuery {
  daysAhead?: number;
}

/** Body for `POST /api/v1/admin/sessions`. `startsAt`/`endsAt` are ISO 8601. */
export interface CreateSessionRequest {
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  /** Mint a Google Meet link with the event (`conferenceDataVersion=1`). */
  createMeetLink?: boolean;
}

/** Body for `PATCH /api/v1/admin/sessions/:eventId` — all fields optional. */
export interface UpdateSessionRequest {
  title?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
}

/** Query for `GET /api/v1/admin/community/topics`. `limit` is 1–50, default 20. */
export interface ListCommunityTopicsQuery {
  limit?: number;
}

/** Query for `GET /api/v1/admin/groups/:id/members`. `pageSize` caps at 100. */
export interface ListGroupMembersQuery {
  page?: number;
  pageSize?: number;
  /** Case-insensitive match against the member's email. */
  search?: string;
}

// --- Response schemas (inbound — runtime boundary validation) ---

const packSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  repoUrl: z.string(),
  /** Freeform internal admin note — never shown to a member (no member surface exists). */
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  /** Bookkeeping label only — gates nothing. `null` = not tied to a cohort. */
  cohortKey: z.string().nullable(),
  /** Denormalised cohort display name for the admin table (null when unlabelled). */
  cohortName: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Pack = z.infer<typeof packSchema>;

const packsEnvelopeSchema = z.object({
  packs: z.array(packSchema),
});

const deletedResponseSchema = z.object({
  deleted: z.boolean(),
});
export type DeletedResponse = z.infer<typeof deletedResponseSchema>;

/**
 * A calendar-backed Builders session as surfaced by `/api/v1/admin/sessions`.
 *
 * Mirrors the backend `AdminSession`, which is `BuildersSession` (the member
 * contract) plus `description`. The backend deliberately did NOT widen
 * `BuildersSession` itself — that would have changed a member-facing response
 * as a side effect of an admin feature — so `description` is admin-only and
 * must stay off every member-facing type.
 *
 * Declared locally rather than imported from `members-api.service.ts` so the
 * admin chunk carries no member-path code.
 */
const adminSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** ISO 8601 */
  startsAt: z.string(),
  /** ISO 8601 */
  endsAt: z.string(),
  meetLink: z.string().nullable(),
  /** True for the master recurring series (delete is refused server-side, 409). */
  recurring: z.boolean(),
  /** Admin-only. Absent from the member `BuildersSession` shape by design. */
  description: z.string().nullable(),
});
export type AdminSession = z.infer<typeof adminSessionSchema>;

const adminSessionsEnvelopeSchema = z.object({
  sessions: z.array(adminSessionSchema),
  /**
   * Whether the server's Google refresh-token grant carries a calendar write
   * scope. `false` → the UI renders read-only; there is nothing to click.
   */
  calendarWritable: z.boolean(),
});
export type AdminSessionsResponse = z.infer<typeof adminSessionsEnvelopeSchema>;

/**
 * One forum topic. Mirrors the `CommunityTopic` shape the member summary
 * endpoint returns; defined locally for the same isolation reason as above.
 */
const communityTopicSchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string(),
  postsCount: z.number(),
  /** ISO 8601, or null if never posted to after creation. */
  lastPostedAt: z.string().nullable(),
  categoryName: z.string().nullable(),
});
export type AdminCommunityTopic = z.infer<typeof communityTopicSchema>;

const communityTopicsEnvelopeSchema = z.object({
  /** Base Discourse URL, or null when the integration is unconfigured. */
  communityUrl: z.string().nullable(),
  topics: z.array(communityTopicSchema),
  /** False when Discourse is not configured on this server. */
  enabled: z.boolean(),
});
export type AdminCommunityTopicsResponse = z.infer<
  typeof communityTopicsEnvelopeSchema
>;

const reviewQueueItemSchema = z.object({
  id: z.number(),
  type: z.string(),
  topicTitle: z.string().nullable(),
  createdAt: z.string(),
});
export type ReviewQueueItem = z.infer<typeof reviewQueueItemSchema>;

const reviewQueueEnvelopeSchema = z.object({
  items: z.array(reviewQueueItemSchema),
  count: z.number(),
  /** Deep link to Discourse's own review queue, or null when unconfigured. */
  reviewUrl: z.string().nullable(),
});
export type ReviewQueueResponse = z.infer<typeof reviewQueueEnvelopeSchema>;

const groupMemberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  assignedAt: z.string(),
  source: z.string(),
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

const groupMembersEnvelopeSchema = z.object({
  members: z.array(groupMemberSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});
export type GroupMembersPage = z.infer<typeof groupMembersEnvelopeSchema>;

@Injectable({ providedIn: 'root' })
export class AdminBuildersApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/admin';

  // --- Packs (admin-only registry; no member endpoint exists) ---

  /**
   * Lists every pack across every cohort, newest first. `search` matches
   * `title`/`slug` server-side; `cohortKey` narrows to one cohort label.
   */
  public listPacks(q: ListPacksQuery = {}): Observable<Pack[]> {
    let params = new HttpParams();
    if (q.search) params = params.set('search', q.search);
    if (q.cohortKey) params = params.set('cohortKey', q.cohortKey);
    return this.http.get<unknown>(`${this.base}/packs`, { params }).pipe(
      map(validate(packsEnvelopeSchema, 'GET /admin/packs')),
      map((res) => res.packs),
    );
  }

  /** Fetches a single pack. The server returns 404 when the id is unknown. */
  public getPack(id: string): Observable<Pack> {
    return this.http
      .get<unknown>(`${this.base}/packs/${id}`)
      .pipe(map(validate(packSchema, `GET /admin/packs/${id}`)));
  }

  /**
   * Creates a pack registry row. Does NOT grant anyone access to the repo —
   * that happens on GitHub. A duplicate `slug` yields 409; an unknown
   * `cohortKey` yields 400 (the column is a real FK to `member_groups.key`).
   */
  public createPack(body: CreatePackRequest): Observable<Pack> {
    return this.http
      .post<unknown>(`${this.base}/packs`, body)
      .pipe(map(validate(packSchema, 'POST /admin/packs')));
  }

  /** Patches a pack's mutable fields (`slug` is immutable after creation). */
  public updatePack(id: string, body: UpdatePackRequest): Observable<Pack> {
    return this.http
      .patch<unknown>(`${this.base}/packs/${id}`, body)
      .pipe(map(validate(packSchema, `PATCH /admin/packs/${id}`)));
  }

  /**
   * Deletes the registry row. The GitHub repository and everyone's access to
   * it are entirely unaffected — this only forgets the bookkeeping record.
   */
  public deletePack(id: string): Observable<DeletedResponse> {
    return this.http
      .delete<unknown>(`${this.base}/packs/${id}`)
      .pipe(map(validate(deletedResponseSchema, `DELETE /admin/packs/${id}`)));
  }

  // --- Sessions (Google Calendar write path) ---

  /**
   * Upcoming Builders sessions plus the `calendarWritable` verdict. Reads the
   * same Google Calendar events as `GET /api/v1/members/sessions`, but through
   * the admin authorization path — that pairing is this feature's whole premise.
   */
  public listSessions(
    q: ListSessionsQuery = {},
  ): Observable<AdminSessionsResponse> {
    let params = new HttpParams();
    if (q.daysAhead != null) {
      params = params.set('daysAhead', String(q.daysAhead));
    }
    return this.http
      .get<unknown>(`${this.base}/sessions`, { params })
      .pipe(map(validate(adminSessionsEnvelopeSchema, 'GET /admin/sessions')));
  }

  /** Creates a calendar event. 503 `calendar_write_unavailable` if the grant lacks a write scope. */
  public createSession(body: CreateSessionRequest): Observable<AdminSession> {
    return this.http
      .post<unknown>(`${this.base}/sessions`, body)
      .pipe(map(validate(adminSessionSchema, 'POST /admin/sessions')));
  }

  /**
   * Patches a calendar event. Targeting the master recurring series yields
   * 409 `protected_recurring_event` — member provisioning depends on it.
   */
  public updateSession(
    eventId: string,
    body: UpdateSessionRequest,
  ): Observable<AdminSession> {
    return this.http
      .patch<unknown>(`${this.base}/sessions/${eventId}`, body)
      .pipe(
        map(validate(adminSessionSchema, `PATCH /admin/sessions/${eventId}`)),
      );
  }

  /**
   * Deletes a calendar event. The server refuses the master recurring series
   * with 409 `protected_recurring_event`; individual instances delete fine.
   */
  public deleteSession(eventId: string): Observable<DeletedResponse> {
    return this.http
      .delete<unknown>(`${this.base}/sessions/${eventId}`)
      .pipe(
        map(
          validate(deletedResponseSchema, `DELETE /admin/sessions/${eventId}`),
        ),
      );
  }

  // --- Community (READ-ONLY — moderation lives in Discourse's admin panel) ---

  /**
   * Recent forum topics. Degrades to `{ topics: [], enabled: false }` when
   * Discourse is unconfigured and to an empty list (never a 500) on any
   * upstream failure, so an empty list means "nothing to show", not "broken".
   */
  public listCommunityTopics(
    q: ListCommunityTopicsQuery = {},
  ): Observable<AdminCommunityTopicsResponse> {
    let params = new HttpParams();
    if (q.limit != null) params = params.set('limit', String(q.limit));
    return this.http
      .get<unknown>(`${this.base}/community/topics`, { params })
      .pipe(
        map(
          validate(
            communityTopicsEnvelopeSchema,
            'GET /admin/community/topics',
          ),
        ),
      );
  }

  /**
   * Pending Discourse review-queue items — an awareness count answering "does
   * anything need me?". Acting on an item happens in Discourse via `reviewUrl`.
   */
  public getReviewQueue(): Observable<ReviewQueueResponse> {
    return this.http
      .get<unknown>(`${this.base}/community/review-queue`)
      .pipe(
        map(
          validate(
            reviewQueueEnvelopeSchema,
            'GET /admin/community/review-queue',
          ),
        ),
      );
  }

  // --- Cohort members drill-down ---

  /**
   * Paginated members of one cohort. Closes the gap flagged in the
   * `GroupsList` docblock: the API previously exposed remove-by-id with no way
   * to browse who was in a group. Removal still goes through
   * `AdminApiService.unassignGroupMember()`.
   */
  public listGroupMembers(
    groupId: string,
    q: ListGroupMembersQuery = {},
  ): Observable<GroupMembersPage> {
    let params = new HttpParams();
    if (q.page != null) params = params.set('page', String(q.page));
    if (q.pageSize != null) params = params.set('pageSize', String(q.pageSize));
    if (q.search) params = params.set('search', q.search);
    return this.http
      .get<unknown>(`${this.base}/groups/${groupId}/members`, { params })
      .pipe(
        map(
          validate(
            groupMembersEnvelopeSchema,
            `GET /admin/groups/${groupId}/members`,
          ),
        ),
      );
  }
}
