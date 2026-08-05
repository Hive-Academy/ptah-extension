import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { z } from 'zod';

import {
  FIRST_PAGE,
  MAX_PAGE_SIZE,
  REACTION_TYPES,
  memberCategorySchema,
  memberPostSchema,
  memberTopicDetailSchema,
  memberTopicSummarySchema,
  pagedSchema,
  type MemberCategory,
  type MemberPost,
  type MemberTopicDetail,
  type MemberTopicSummary,
  type Paged,
  type ReactionCounts,
  type ReactionType,
} from '@ptah-contracts/community';
import { validate } from '@ptah-web/core';

/**
 * MemberCommunityApiService — the whole §3.3 member forum surface as one HTTP
 * client (`/api/v1/members/community/*`).
 *
 * ⚠️ PURE DATA ACCESS. No signals, no cached state, no routing, no error
 * classification beyond what the wire says. The pages own state; a service that
 * also held it would give two surfaces two different ideas of the current page.
 *
 * ⚠️ EVERY RESPONSE IS PARSED WITH A SCHEMA EXPORTED BY
 * `@ptah-contracts/community` — never a locally re-declared shape. A second copy
 * of the wire type on the client is exactly the drift the contracts lib exists
 * to remove, and `z.object()` STRIPS unknown keys, so a client schema that omits
 * a field tolerates a server that sends it. It does not work the other way:
 * never add a required field to a client schema before the server sends it.
 *
 * The only schemas declared locally are the small acknowledgement envelopes
 * (`{ deleted }`, `{ unreadCount }`, `{ counts, mine }`, …). Those are not
 * payload shapes the contracts lib models; declaring them here is not the
 * duplication the rule is about.
 *
 * ⚠️ ERRORS PROPAGATE UNCLASSIFIED, WITH ONE EXCEPTION. The server's status
 * codes already carry the meaning and the pages branch on them:
 *   · `404` — INVISIBLE OR ABSENT, indistinguishably (R1.1.3). Never render
 *     "you are not allowed to see this": that answer confirms the thing exists.
 *   · `403` — VISIBLE BUT FORBIDDEN, and the body carries a stable machine
 *     `reason` (`'topic_locked'`, `'membership_required'`) that a UI matches on
 *     rather than matching the sentence.
 *   · `400` — a client bug (a `pageSize` over the cap, an unknown reaction
 *     type), not a member-facing state.
 * The exception is `isMembershipRequiredError()` from `@ptah-web/core`, which
 * already parses the `403 { reason: 'membership_required' }` gate. Pages import
 * it from there directly. It is deliberately NOT re-exported here and
 * deliberately NOT reimplemented: a second parser for the same shape is how two
 * surfaces start disagreeing about whether a member is a member, and a
 * re-export would give one symbol two import paths.
 *
 * URLs stay relative — `apiInterceptor` prepends `environment.apiBaseUrl` and
 * sets `withCredentials: true`, so the `ptah_auth` cookie is attached. (The
 * server's `JwtAuthGuard` reads that COOKIE and never looks at an
 * `Authorization` header.)
 */

/* -------------------------------------------------------------------------- */
/* Request shapes — outbound, not validated here                              */
/* -------------------------------------------------------------------------- */

/** Feed sort. Mirrors the server's `TOPIC_SORTS`; `'recent'` is the default. */
export type TopicSort = 'recent' | 'unread';

/** Query for `GET topics`. Every field optional. */
export interface ListTopicsQuery {
  categoryId?: string;
  sort?: TopicSort;
  /**
   * "My Threads" — restrict the feed to topics THIS member authored (R9.2).
   *
   * ⚠️ IT IS A BOOLEAN, NOT AN AUTHOR ID, AND THAT IS THE SERVER'S
   * AUTHORISATION DECISION RATHER THAN A CONVENIENCE. `MemberGuard` has already
   * resolved `req.memberContext.userId` before the handler runs, so the server
   * knows who is asking; a parameter that NAMED an author would let any
   * entitled member enumerate any other member's threads, and no downstream
   * visibility filter would refuse it because those topics genuinely are
   * visible to them. `ListTopicsQueryDto` has no such field — sending
   * `?authorId=…` is a `400`.
   *
   * ⚠️ IT COMPOSES WITH VISIBILITY AND SOFT-DELETE, IT DOES NOT REPLACE THEM.
   * `authorId` is spread into the SAME `where` as `NOT_DELETED` and the
   * visible-category restriction, so a member does not get back their own
   * soft-deleted topic, nor their own topic in a category they can no longer
   * see. Both verified live against the running server, not inferred.
   */
  mine?: boolean;
  page?: number;
  pageSize?: number;
}

/** Body for `POST topics`. Post #1 IS the body (AD-9) — hence `bodyMarkdown`. */
export interface CreateTopicRequest {
  categoryId: string;
  title: string;
  bodyMarkdown: string;
}

/** Body for `PATCH topics/:id`. Author-only, inside the edit window. */
export interface UpdateTopicRequest {
  title?: string;
  bodyMarkdown?: string;
}

/**
 * Body for `POST topics/:id/posts`.
 *
 * `parentId` omitted (or `null`) is a top-level reply. A `parentId` pointing at
 * something already two levels deep is REPAIRED server-side to depth 2, not
 * rejected (R1.3.3, RK-12) — the response reports the parent it actually got.
 */
export interface CreatePostRequest {
  bodyMarkdown: string;
  parentId?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Acknowledgement envelopes — declared here, see the class docblock           */
/* -------------------------------------------------------------------------- */

const deletedAckSchema = z.object({ deleted: z.boolean() });
const markReadAckSchema = z.object({ unreadCount: z.number().int() });
const markCategoryReadAckSchema = z.object({ topicsMarked: z.number().int() });
const acceptedAnswerAckSchema = z.object({
  acceptedPostId: z.string().nullable(),
});

/**
 * `PUT posts/:id/reactions/:type` returns the AUTHORITATIVE post-toggle state.
 * `counts` is total, never sparse — every reaction type is present, zero-valued
 * when unreacted — which is what lets a renderer read `counts.thanks` without
 * `?? 0`.
 */
const reactionToggleSchema = z.object({
  counts: z.record(z.enum(REACTION_TYPES), z.number().int()),
  mine: z.array(z.enum(REACTION_TYPES)),
});

export interface ReactionToggleResult {
  counts: ReactionCounts;
  mine: ReactionType[];
}

const BASE = '/api/v1/members/community';

@Injectable({ providedIn: 'root' })
export class MemberCommunityApiService {
  private readonly http = inject(HttpClient);

  /* ---------------------------------------------------------------------- */
  /* Categories                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * `GET categories` (R1.1).
   *
   * ⚠️ THE LIST IS ALREADY FILTERED SERVER-SIDE. Every category returned passed
   * `buildCategoryVisibilityWhere` in the SQL. The client does no visibility
   * filtering and must not: `MemberCategory.visibility` is a display LABEL so a
   * "cohort only" chip can be drawn, not an access rule to re-evaluate in the
   * browser (R1.1.3).
   *
   * ⚠️ `MemberCategory.unreadCount` COUNTS TOPICS, not posts —
   * `MemberTopicSummary.unreadCount` counts posts within one topic. The two are
   * bounded differently and are trivially confusable at a call site.
   */
  public listCategories(): Observable<MemberCategory[]> {
    return this.http
      .get<unknown>(`${BASE}/categories`)
      .pipe(
        map(
          validate(
            z.array(memberCategorySchema),
            'GET /members/community/categories',
          ),
        ),
      );
  }

  /** `POST categories/:id/read-all` — mark every visible topic in it read. */
  public markCategoryRead(
    categoryId: string,
  ): Observable<{ topicsMarked: number }> {
    return this.http
      .post<unknown>(`${BASE}/categories/${categoryId}/read-all`, {})
      .pipe(
        map(
          validate(
            markCategoryReadAckSchema,
            `POST /members/community/categories/${categoryId}/read-all`,
          ),
        ),
      );
  }

  /* ---------------------------------------------------------------------- */
  /* Topics — read                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * `GET topics` — the feed, pinned first then `lastPostedAt` desc (R1.2.5).
   *
   * ⚠️ `mine: false` IS OMITTED FROM THE WIRE RATHER THAN SENT AS `mine=false`,
   * and the reason is the server's transform. `ListTopicsQueryDto.mine` accepts
   * only the affirmative spellings (`true` / `'true'` / `'1'`) precisely
   * because Express hands query values over as STRINGS and `'false'` is a
   * truthy string — so `?mine=false` resolves to `false` and is already
   * identical to omitting it (measured: both return the same unfiltered
   * total). Sending it anyway would put a parameter on every ordinary feed
   * request whose only effect is to look like it has one, and it would read
   * like a toggle a reader could flip to `'false'` and expect the opposite.
   */
  public listTopics(
    query: ListTopicsQuery = {},
  ): Observable<Paged<MemberTopicSummary>> {
    let params = pageParams(query.page, query.pageSize);
    if (query.categoryId) params = params.set('categoryId', query.categoryId);
    if (query.sort) params = params.set('sort', query.sort);
    if (query.mine) params = params.set('mine', 'true');

    return this.http
      .get<unknown>(`${BASE}/topics`, { params })
      .pipe(
        map(
          validate(
            pagedSchema(memberTopicSummarySchema),
            'GET /members/community/topics',
          ),
        ),
      );
  }

  /**
   * `GET topics/:slug` — one page of a thread.
   *
   * ⚠️ `:slug`, NOT `:id`. R1.2.2 makes the slug the topic's stable public
   * identifier; a title edit never changes it, so a bookmarked thread URL keeps
   * working. The WRITE routes below take the `id` — that asymmetry is the
   * server's and is not smoothed over here.
   *
   * ⚠️ THE ACCEPTED ANSWER ARRIVES TWICE and that is the design (§3.3, R1.5.1):
   * hoisted into `acceptedPost`, and again in its chronological position inside
   * `posts` carrying `accepted: true`. Do not filter the duplicate out — that
   * puts a hole in the chronology and detaches replies made to it.
   */
  public getTopic(
    slug: string,
    page?: number,
    pageSize?: number,
  ): Observable<MemberTopicDetail> {
    return this.http
      .get<unknown>(`${BASE}/topics/${encodeURIComponent(slug)}`, {
        params: pageParams(page, pageSize),
      })
      .pipe(
        map(
          validate(
            memberTopicDetailSchema,
            `GET /members/community/topics/${slug}`,
          ),
        ),
      );
  }

  /* ---------------------------------------------------------------------- */
  /* Topics — write                                                          */
  /* ---------------------------------------------------------------------- */

  /**
   * `POST topics` → `201 MemberTopicDetail`, composed by the SAME read model
   * that serves `GET topics/:slug` — so a freshly created thread is identical to
   * a re-fetched one and the caller can navigate straight into it.
   */
  public createTopic(body: CreateTopicRequest): Observable<MemberTopicDetail> {
    return this.http
      .post<unknown>(`${BASE}/topics`, body)
      .pipe(
        map(
          validate(memberTopicDetailSchema, 'POST /members/community/topics'),
        ),
      );
  }

  /** `PATCH topics/:id` — author-only, inside the 24-hour window. */
  public updateTopic(
    id: string,
    body: UpdateTopicRequest,
  ): Observable<MemberTopicDetail> {
    return this.http
      .patch<unknown>(`${BASE}/topics/${id}`, body)
      .pipe(
        map(
          validate(
            memberTopicDetailSchema,
            `PATCH /members/community/topics/${id}`,
          ),
        ),
      );
  }

  /** `DELETE topics/:id` — author-only soft delete (R1.2.7). */
  public deleteTopic(id: string): Observable<{ deleted: boolean }> {
    return this.http
      .delete<unknown>(`${BASE}/topics/${id}`)
      .pipe(
        map(
          validate(deletedAckSchema, `DELETE /members/community/topics/${id}`),
        ),
      );
  }

  /* ---------------------------------------------------------------------- */
  /* Posts                                                                   */
  /* ---------------------------------------------------------------------- */

  /**
   * `POST topics/:id/posts` → `201 MemberPost`. `403` on a locked topic.
   *
   * ⚠️ A `null` `parentId` IS OMITTED FROM THE WIRE, NOT SENT AS `null`, AND
   * THAT IS A WORKAROUND FOR A LIVE SERVER DEFECT — verified against the running
   * stack on 2026-08-05, not inferred:
   *
   *   POST …/topics/:id/posts  { bodyMarkdown, parentId: null }  → 500
   *   POST …/topics/:id/posts  { bodyMarkdown }                  → 201
   *
   * `CreatePostDto.parentId` is `@IsOptional() @IsString() @MinLength(1)`, and
   * class-validator's `@IsOptional()` skips validation for BOTH `undefined` and
   * `null` — so an explicit `null` passes the DTO untouched and then fails
   * somewhere below it, as an unhandled exception rather than a `400`.
   *
   * Omitting the key is the right client behaviour regardless ("no parent" and
   * "parent unspecified" are the same statement, and `undefined` is how JSON
   * says it). The signature still ACCEPTS `null` because a caller holding
   * `MemberPost.parentId` — which is `string | null` — should not have to
   * convert; this is the one place that conversion belongs.
   *
   * The server-side defect is reported separately: a `null` here should be a
   * `400` at worst, never a `500`.
   */
  public createPost(
    topicId: string,
    body: CreatePostRequest,
  ): Observable<MemberPost> {
    const payload: { bodyMarkdown: string; parentId?: string } =
      body.parentId == null
        ? { bodyMarkdown: body.bodyMarkdown }
        : { bodyMarkdown: body.bodyMarkdown, parentId: body.parentId };

    return this.http
      .post<unknown>(`${BASE}/topics/${topicId}/posts`, payload)
      .pipe(
        map(
          validate(
            memberPostSchema,
            `POST /members/community/topics/${topicId}/posts`,
          ),
        ),
      );
  }

  /** `PATCH posts/:id` — author-only, inside the edit window. */
  public updatePost(id: string, bodyMarkdown: string): Observable<MemberPost> {
    return this.http
      .patch<unknown>(`${BASE}/posts/${id}`, { bodyMarkdown })
      .pipe(
        map(validate(memberPostSchema, `PATCH /members/community/posts/${id}`)),
      );
  }

  /**
   * `DELETE posts/:id` — author-only TOMBSTONE, not a removal (R1.3.5, AD-5).
   * The row keeps its `postNumber` and its children stay attached; the body and
   * author are withheld at the read model.
   */
  public deletePost(id: string): Observable<{ deleted: boolean }> {
    return this.http
      .delete<unknown>(`${BASE}/posts/${id}`)
      .pipe(
        map(
          validate(deletedAckSchema, `DELETE /members/community/posts/${id}`),
        ),
      );
  }

  /* ---------------------------------------------------------------------- */
  /* Reactions                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * `PUT posts/:id/reactions/:type` — toggle MY reaction of this type (R1.4.1).
   *
   * ⚠️ `PUT`, NOT `POST`, AND THAT IS THE CONTRACT. The request expresses "my
   * reaction of this type on this post should flip"; a retried request CONVERGES
   * rather than double-toggling back, so a dropped response and a re-tap are not
   * the same event. Callers may toggle optimistically, but must reconcile from
   * this response — it returns the authoritative counts.
   *
   * `type` is typed `ReactionType`, so an unknown value cannot be expressed
   * here. The server rejects one anyway with a `400` from `ParseEnumPipe`.
   */
  public toggleReaction(
    postId: string,
    type: ReactionType,
  ): Observable<ReactionToggleResult> {
    return this.http
      .put<unknown>(`${BASE}/posts/${postId}/reactions/${type}`, {})
      .pipe(
        map(
          validate(
            reactionToggleSchema,
            `PUT /members/community/posts/${postId}/reactions/${type}`,
          ),
        ),
      );
  }

  /* ---------------------------------------------------------------------- */
  /* Accepted answer                                                         */
  /* ---------------------------------------------------------------------- */

  /** `PUT topics/:id/accepted-answer` — topic author or admin only (R1.5.3). */
  public acceptAnswer(
    topicId: string,
    postId: string,
  ): Observable<{ acceptedPostId: string | null }> {
    return this.http
      .put<unknown>(`${BASE}/topics/${topicId}/accepted-answer`, { postId })
      .pipe(
        map(
          validate(
            acceptedAnswerAckSchema,
            `PUT /members/community/topics/${topicId}/accepted-answer`,
          ),
        ),
      );
  }

  /** `DELETE topics/:id/accepted-answer` — idempotent by design. */
  public clearAcceptedAnswer(
    topicId: string,
  ): Observable<{ acceptedPostId: string | null }> {
    return this.http
      .delete<unknown>(`${BASE}/topics/${topicId}/accepted-answer`)
      .pipe(
        map(
          validate(
            acceptedAnswerAckSchema,
            `DELETE /members/community/topics/${topicId}/accepted-answer`,
          ),
        ),
      );
  }

  /* ---------------------------------------------------------------------- */
  /* Read state                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * `POST topics/:id/read` — advance MY read marker (R1.6.1). Monotonic: a
   * lower number never moves it backwards, so a caller may post the highest
   * `postNumber` it rendered without first checking what the marker was.
   */
  public markRead(
    topicId: string,
    lastReadPostNumber: number,
  ): Observable<{ unreadCount: number }> {
    return this.http
      .post<unknown>(`${BASE}/topics/${topicId}/read`, { lastReadPostNumber })
      .pipe(
        map(
          validate(
            markReadAckSchema,
            `POST /members/community/topics/${topicId}/read`,
          ),
        ),
      );
  }
}

/* -------------------------------------------------------------------------- */

/**
 * Builds `?page&pageSize`, refusing values the server would reject.
 *
 * ⚠️ THIS IS A PROGRAMMER-ERROR GUARD, NOT INPUT VALIDATION, AND THE
 * DISTINCTION IS DELIBERATE. `pageSize` on these surfaces is never member input
 * — it is a constant the calling page chooses. NFR-P5 caps it at
 * {@link MAX_PAGE_SIZE} and the server REJECTS an over-cap request with a `400`
 * rather than clamping it, precisely so a client that asked for 500 rows does
 * not believe it received all of them. Throwing here surfaces that same bug one
 * stack frame from its cause instead of as an opaque `400` in the network tab,
 * and — unlike a clamp — it cannot silently drop the tail of a list.
 *
 * It does NOT re-implement the server's validation of member-supplied input:
 * nothing a member types reaches this function. Batch 6C's advice ("mirror the
 * caps as UI affordances, do not re-validate") is about `q` and about anything
 * a member can type; it is honoured by the search service, which sends what the
 * member typed and lets the server judge it.
 *
 * @throws RangeError when a caller passes a page or page size the API cannot serve.
 */
function pageParams(page?: number, pageSize?: number): HttpParams {
  let params = new HttpParams();

  if (page !== undefined) {
    if (!Number.isInteger(page) || page < FIRST_PAGE) {
      throw new RangeError(
        `page must be an integer >= ${FIRST_PAGE} (1-based); received ${page}.`,
      );
    }
    params = params.set('page', String(page));
  }

  if (pageSize !== undefined) {
    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MAX_PAGE_SIZE
    ) {
      throw new RangeError(
        `pageSize must be an integer in 1..${MAX_PAGE_SIZE} (NFR-P5); received ${pageSize}. ` +
          'The server rejects an over-cap request with 400 rather than clamping it.',
      );
    }
    params = params.set('pageSize', String(pageSize));
  }

  return params;
}
