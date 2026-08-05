import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { z } from 'zod';

import {
  MAX_PAGE_SIZE,
  VISIBILITIES,
  type AdminCategory,
  type AdminTopicSummary,
  type Paged,
} from '@ptah-contracts/community';
import { validate } from '@ptah-web/core';

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
  /** Guest list recorded on the event. Emails NOBODY — see `sendInvitations`. */
  attendees?: string[];
}

/** Body for `PATCH /api/v1/admin/sessions/:eventId` — all fields optional. */
export interface UpdateSessionRequest {
  title?: string;
  description?: string;
  startsAt?: string;
  endsAt?: string;
  /**
   * Attach a Meet link to an event that shipped without one. `false` does not
   * remove an existing link — Google needs an explicit null for that.
   */
  createMeetLink?: boolean;
  /**
   * REPLACES the guest list wholesale, so send the complete list the event
   * should end up with. Still emails nobody.
   */
  attendees?: string[];
  /**
   * ⚠️ SENDS EMAIL when true. Google mails the guest list about the change.
   *
   * Omitted (the default) keeps the patch silent, which is what a rescheduling
   * drag relies on. Set it only when notifying IS the intent — a real time
   * change, where everyone's plans just moved.
   */
  notifyGuests?: boolean;
}

/**
 * Body for `POST /api/v1/admin/sessions/:eventId/invitations`.
 *
 * ⚠️ THE ONLY REQUEST IN THIS CLIENT THAT SENDS EMAIL. Addresses are merged
 * into the existing guest list (not replacing it) and Google mails everyone on
 * the result, including guests already invited. Omit `attendees` to re-send to
 * the current list.
 */
export interface SendInvitationsRequest {
  attendees?: string[];
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
  /**
   * The event's guest list. Admin-only for the same reason `description` is —
   * on the member response it would publish every other member's email.
   * `responseStatus` is Google's own vocabulary, passed through unmapped.
   */
  attendees: z.array(
    z.object({
      email: z.string(),
      responseStatus: z.string().nullable(),
    }),
  ),
  /**
   * ⚠️ THESE, NOT `recurring`, DECIDE WHAT THE UI OFFERS.
   *
   * The server computes them from the same protected-id set its 409 guards
   * consult, so a control is shown exactly when the request behind it will be
   * accepted. `recurring` is true for EVERY instance of EVERY series — gating
   * on it locked an admin out of editing ordinary repeats they created
   * themselves and nothing depends on.
   *
   * `isProtectedMaster` blocks PATCH; `inProtectedSeries` blocks DELETE and
   * invitations, and is implied by the former.
   */
  isProtectedMaster: z.boolean(),
  inProtectedSeries: z.boolean(),
});
export type SessionAttendee = AdminSession['attendees'][number];
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

/* -------------------------------------------------------------------------- */
/* Community moderation — R8.2, R8.5, §3.3 admin table                         */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ THE TYPES COME FROM `@ptah-contracts/community`; THE SCHEMAS ARE DECLARED
 * HERE, AND THAT SPLIT IS THE CONTRACT LIB'S OWN DECISION.
 *
 * `admin-topic.contract.ts` ships TYPES ONLY, with no Zod, and says why: the
 * MEMBER schemas exist because the member panel parses them at its HTTP
 * boundary, while "the admin surface in `libs/web/admin` carries its own
 * response envelopes. Adding unparsed schemas there would be decoration that
 * drifts." This file is that admin surface, so this is where the parse lives.
 *
 * Every schema below is bound to its contract type with `satisfies
 * z.ZodType<T>`. That is not decoration: it is a COMPILE-TIME proof that the
 * runtime parse and the wire type agree, so renaming a field on the contract
 * breaks the build here instead of returning `undefined` in a template.
 *
 * ⚠️ THESE SHAPES CARRY `authorEmail`, `deletedAt` AND `deletedBy` — the three
 * fields deliberately absent from every member shape (NFR-S4, RK-8). They are
 * why the member/admin split exists at all. Nothing in this file may be reused
 * on a member surface, and `libs/web/members` imports none of it.
 */
const adminCategorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  visibility: z.enum(VISIBILITIES),
  /** `MemberGroup.key` values, ANY-match. Empty unless `visibility` is 'cohort'. */
  cohortKeys: z.array(z.string()),
  /** Denormalised `MemberGroup.name` per key, same order. */
  cohortNames: z.array(z.string()),
  sortOrder: z.number().int(),
  /** ⚠️ INCLUDES soft-deleted topics — unlike `MemberCategory.topicCount`. */
  topicCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<AdminCategory>;

const adminCategoriesEnvelopeSchema = z.object({
  categories: z.array(adminCategorySchema),
});

const adminTopicSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  authorName: z.string().nullable(),
  /** ⚠️ ADMIN-ONLY. The concrete leak the member/admin split prevents. */
  authorEmail: z.string().nullable(),
  pinned: z.boolean(),
  locked: z.boolean(),
  replyCount: z.number().int(),
  hasAcceptedAnswer: z.boolean(),
  /** Non-null means a tombstone. R8.5's window is measured from THIS. */
  deletedAt: z.string().nullable(),
  deletedBy: z.string().nullable(),
  lastPostedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  editedAt: z.string().nullable(),
}) satisfies z.ZodType<AdminTopicSummary>;

export type { AdminCategory, AdminTopicSummary };

/**
 * ⚠️ THERE IS NO `AdminPost` SCHEMA HERE, AND ITS ABSENCE IS A DECISION.
 *
 * Batch 6 shipped `AdminPost` as a contract type but gave it NO read endpoint:
 * the admin posts controller exposes `DELETE :id` and `POST :id/restore` and
 * nothing that returns a post (an unpaged scan of the largest table, serving a
 * screen nobody asked for — RK-1). A schema for a shape that never arrives on
 * any response would parse nothing and drift unnoticed, which is precisely the
 * "decoration that drifts" `admin-topic.contract.ts` declines to ship. It is
 * added the day a read endpoint exists.
 */

/**
 * The `Paged<T>` envelope, re-declared here over the admin item type.
 *
 * `pagedSchema()` from `@ptah-contracts/community` would do, and is used by the
 * member panel; it is not used here only because that factory returns an
 * inferred type that cannot carry the `satisfies z.ZodType<Paged<AdminTopicSummary>>`
 * proof at a generic instantiation (its own docblock explains the Zod 4 reason).
 * The five fields are the same five, and `Paged` is the single envelope for
 * every list endpoint in the domain.
 */
const adminTopicsPageSchema = z.object({
  items: z.array(adminTopicSummarySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  hasMore: z.boolean(),
}) satisfies z.ZodType<Paged<AdminTopicSummary>>;

export type AdminTopicsPage = z.infer<typeof adminTopicsPageSchema>;

/**
 * `{ id, changed }` from a moderation PATCH — the fields the server ACTUALLY
 * applied, which after a partial patch is not the same as the fields sent.
 */
const moderationResultSchema = z.object({
  id: z.string(),
  changed: z.array(z.string()),
});
export type ModerationResult = z.infer<typeof moderationResultSchema>;

const restoredResponseSchema = z.object({
  restored: z.boolean(),
});
export type RestoredResponse = z.infer<typeof restoredResponseSchema>;

/** Query for `GET /api/v1/admin/community/topics`. Every field optional. */
export interface ListAdminTopicsQuery {
  /** The ONLY way to see a tombstone (AD-5's declared exemption). */
  includeDeleted?: boolean;
  categoryId?: string;
  search?: string;
  /** 1-based. */
  page?: number;
  /** 1..50. Rejected above the cap, not clamped. */
  pageSize?: number;
}

/**
 * Body for `PATCH /api/v1/admin/community/topics/:id`. Every field optional;
 * `categoryId` is the "move" operation.
 */
export interface ModerateTopicRequest {
  pinned?: boolean;
  locked?: boolean;
  categoryId?: string;
  title?: string;
  bodyMarkdown?: string;
}

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
   * ⚠️ SENDS EMAIL. Merges `attendees` into the event's guest list and asks
   * Google to notify everyone on the result (`sendUpdates=all`) — including
   * guests already invited, who receive the invitation again.
   *
   * Deliberately a separate call rather than a flag on create/update: as a flag
   * it could ride along on a rescheduling drag and turn "I moved this by an
   * hour" into "I emailed the whole cohort". Callers MUST confirm with the
   * admin, showing the recipient count, before invoking this.
   *
   * 400 `no_recipients` when the event has no guests and none were supplied.
   */
  public sendInvitations(
    eventId: string,
    body: SendInvitationsRequest = {},
  ): Observable<AdminSession> {
    return this.http
      .post<unknown>(`${this.base}/sessions/${eventId}/invitations`, body)
      .pipe(
        map(
          validate(
            adminSessionSchema,
            `POST /admin/sessions/${eventId}/invitations`,
          ),
        ),
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

  // --- Community moderation (R8.2, R8.5) ---
  //
  // ⚠️ A NEW API, NOT A RESTORATION. `listCommunityTopics()` and
  // `getReviewQueue()` used to sit here, proxying the external forum's
  // `GET /admin/community/{topics,review-queue}`. TASK_2026_177 P1b deleted both
  // endpoints with the forum itself, and the methods went with them rather than
  // being left to 404. What follows reads Batch 6's THREE native admin
  // controllers (`…/categories`, `…/topics`, `…/posts` — three disjoint literal
  // prefixes, not one) and, unlike the read-only surface it replaces, it WRITES:
  // pin, lock, move, soft-delete and restore. Structural test G5, which asserted
  // the old surface was read-only, was deleted in P1b for exactly this reason
  // and must not be restored.

  /**
   * `GET /admin/community/categories` — every category, unfiltered.
   *
   * ⚠️ NO VISIBILITY FILTER APPLIES TO AN ADMIN. The member endpoint hides
   * cohort- and staff-scoped categories in the SQL; this one returns all of
   * them, because moderating content requires seeing where it lives.
   */
  public listCommunityCategories(): Observable<AdminCategory[]> {
    return this.http.get<unknown>(`${this.base}/community/categories`).pipe(
      map(
        validate(
          adminCategoriesEnvelopeSchema,
          'GET /admin/community/categories',
        ),
      ),
      map((response) => response.categories),
    );
  }

  /**
   * `GET /admin/community/topics` — the moderation queue.
   *
   * ⚠️ `includeDeleted` IS THE ONLY WAY TO SEE A TOMBSTONE. Every other read in
   * the forum filters `deletedAt IS NULL` (AD-5); this one flag is the declared
   * exemption, and the rows it adds carry `deletedAt` + `deletedBy` so an
   * operator can judge R8.5's ≥30-day restore window from the deletion
   * timestamp rather than from `updatedAt`.
   *
   * `pageSize` is capped at {@link MAX_PAGE_SIZE} server-side and REJECTED, not
   * clamped, above it.
   */
  public listCommunityTopics(
    q: ListAdminTopicsQuery = {},
  ): Observable<AdminTopicsPage> {
    let params = new HttpParams();
    if (q.includeDeleted) params = params.set('includeDeleted', 'true');
    if (q.categoryId) params = params.set('categoryId', q.categoryId);
    if (q.search) params = params.set('search', q.search);
    if (q.page != null) params = params.set('page', String(q.page));
    if (q.pageSize != null) {
      if (q.pageSize < 1 || q.pageSize > MAX_PAGE_SIZE) {
        throw new RangeError(
          `pageSize must be 1..${MAX_PAGE_SIZE} (NFR-P5); received ${q.pageSize}. ` +
            'The server rejects an over-cap request with 400 rather than clamping it.',
        );
      }
      params = params.set('pageSize', String(q.pageSize));
    }

    return this.http
      .get<unknown>(`${this.base}/community/topics`, { params })
      .pipe(
        map(validate(adminTopicsPageSchema, 'GET /admin/community/topics')),
      );
  }

  /**
   * `PATCH /admin/community/topics/:id` — pin, lock, move, retitle, rewrite.
   *
   * Returns `{ id, changed }` rather than the row: `changed` is the list of
   * fields the server actually applied, which is what the caller needs to know
   * after a partial patch, and re-reading the list is a cheaper way to get the
   * new row than trusting an echo.
   *
   * ⚠️ EVERY CALL WRITES AN AUDIT ROW server-side, inside the mutation's own
   * transaction (PRE-6). That is the whole reason an admin edits here rather
   * than through the member `PATCH` route, which has no `isAdmin` escape hatch
   * and would 403 them like anyone else.
   */
  public moderateCommunityTopic(
    id: string,
    body: ModerateTopicRequest,
  ): Observable<ModerationResult> {
    return this.http
      .patch<unknown>(`${this.base}/community/topics/${id}`, body)
      .pipe(
        map(
          validate(
            moderationResultSchema,
            `PATCH /admin/community/topics/${id}`,
          ),
        ),
      );
  }

  /** `DELETE /admin/community/topics/:id` — soft delete (AD-5), reversible. */
  public deleteCommunityTopic(id: string): Observable<DeletedResponse> {
    return this.http
      .delete<unknown>(`${this.base}/community/topics/${id}`)
      .pipe(
        map(
          validate(
            deletedResponseSchema,
            `DELETE /admin/community/topics/${id}`,
          ),
        ),
      );
  }

  /** `POST /admin/community/topics/:id/restore` — R8.5's undo. */
  public restoreCommunityTopic(id: string): Observable<RestoredResponse> {
    return this.http
      .post<unknown>(`${this.base}/community/topics/${id}/restore`, {})
      .pipe(
        map(
          validate(
            restoredResponseSchema,
            `POST /admin/community/topics/${id}/restore`,
          ),
        ),
      );
  }

  /**
   * `DELETE /admin/community/posts/:id` — soft delete one post.
   *
   * ⚠️ THERE IS NO ADMIN POST LIST ENDPOINT, DELIBERATELY (Batch 6). An unpaged
   * scan of the largest table would serve a screen nobody asked for (RK-1);
   * moderating a post is something an operator does from a thread. So these two
   * take an id the caller already has.
   */
  public deleteCommunityPost(id: string): Observable<DeletedResponse> {
    return this.http
      .delete<unknown>(`${this.base}/community/posts/${id}`)
      .pipe(
        map(
          validate(
            deletedResponseSchema,
            `DELETE /admin/community/posts/${id}`,
          ),
        ),
      );
  }

  /** `POST /admin/community/posts/:id/restore`. */
  public restoreCommunityPost(id: string): Observable<RestoredResponse> {
    return this.http
      .post<unknown>(`${this.base}/community/posts/${id}/restore`, {})
      .pipe(
        map(
          validate(
            restoredResponseSchema,
            `POST /admin/community/posts/${id}/restore`,
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
