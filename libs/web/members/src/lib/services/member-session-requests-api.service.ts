import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { z } from 'zod';

import {
  memberSessionRequestSchema,
  type MemberSessionRequest,
} from '@ptah-contracts/community';
import { validate } from '@ptah-web/core';

/**
 * MemberSessionRequestsApiService — `/api/v1/members/session-requests`, a
 * member's OWN private-session requests (§3.5, R4.2, R4.3, R4.8).
 *
 * ⚠️ PURE DATA ACCESS. No signals, no cached state, no routing — the same rule
 * `member-learning-api.service.ts` and `member-live-api.service.ts` follow.
 *
 * ── 🔴 OWN-ONLY IS THE SERVER'S GUARANTEE, NOT THIS FILE'S ─────────────────
 * R4.3. `SessionRequestsService.listOwn` puts `ctx.userId` INTO the query, and
 * there is nothing here to filter on even if it wanted to: `MemberSessionRequest`
 * HAS NO REQUESTER FIELD. That absence is what makes a leak invisible — another
 * member's request would render as one of your own with no anomaly to see —
 * which is why the exit-gate proof uses TWO seeded identities rather than
 * inspecting a payload. Measured 2026-08-09: identity A holds one pending
 * request; identity B's list is `[]`.
 *
 * ── 🔴 NFR-S4: FIELD ABSENCE IS THE CONTRACT ───────────────────────────────
 * `calendarEventId`, `paymentStatus`, `paddleTransactionId`, `isFreeSession`
 * and every requester field are absent from `MemberSessionRequest`. B12 proved
 * live that the server omits them from a fully-populated ACCEPTED row whose
 * admin view carried all of them. `z.object()` strips, so this client would
 * silently tolerate a server that started sending one — which is exactly why
 * the spec asserts the parsed object's own keys rather than trusting the parse.
 *
 * ── 🔴 THIS IS NOT THE MARKETING SITE'S REQUEST PATH ───────────────────────
 * `POST /v1/sessions/request` (+ `GET /v1/sessions/eligibility`) is the older
 * flow `libs/web/account/.../sessions-grid.component.ts` drives, and it runs a
 * Paddle checkout when the member has no free session left. THIS endpoint
 * consults no eligibility and takes no payment: `is_free_session` defaults to
 * `false` and `payment_status` to `'none'` in the column defaults (measured).
 * That is R4.10 working as written — Phase 4 adds a member-facing flow and
 * redesigns no monetization — but it means **the member panel must not promise
 * a free session and must not quote a price.** The open decision is recorded in
 * the batch report; nothing here invents an answer to it.
 *
 * URLs stay relative — `apiInterceptor` prepends the base URL and sets
 * `withCredentials: true`, so the `ptah_auth` COOKIE is attached. The server's
 * `JwtAuthGuard` reads that cookie and never looks at an `Authorization` header.
 */

const REQUESTS = '/api/v1/members/session-requests';

/**
 * The `DELETE` acknowledgement.
 *
 * ⚠️ `200 { canceled: true }`, NOT `204`. The controller says why: the member
 * surface renders the outcome, and a body is what lets a client update the row
 * it just changed. This client re-reads the list anyway (see {@link
 * MemberSessionRequestsApiService.cancel}), so the flag is asserted rather than
 * relied on.
 */
const canceledAckSchema = z.object({ canceled: z.boolean() });

/**
 * Body for `POST session-requests`.
 *
 * ⚠️ TWO FIELDS, AND `forbidNonWhitelisted` IS LIVE — measured 2026-08-09:
 * `POST` with a `status` key answered
 * `400 {"message":["property status should not exist"]}`. A third key here is
 * not ignored, it is a rejection, which is precisely the control that stops a
 * member scheduling their own session.
 */
export interface CreateSessionRequestBody {
  sessionTopicId: string;
  additionalNotes?: string | null;
}

/**
 * True when `error` is the `403` a withdraw answers for a request that is not
 * cancellable.
 *
 * 🔴 THE SERVER ANSWERS `403` FOR "NOT YOURS", "ALREADY SCHEDULED" AND
 * "NONEXISTENT" INDISTINGUISHABLY, BY DESIGN. Splitting them into `404`/`409`
 * would let a member distinguish "this id does not exist" from "this id is
 * somebody else's" — an existence oracle over a table keyed on other members.
 *
 * ⚠️ SO THE UI COPY FOR THIS CASE MUST CONTAIN NO "forbidden", NO "not
 * allowed" and NO "permission": the overwhelmingly likely cause is that the
 * request was accepted or declined while the page was open, and telling a
 * member they lack permission to cancel their own request is both wrong and
 * alarming. B7's thread page has a spec asserting exactly that vocabulary and
 * this surface copies it.
 *
 * ⚠️ IT IS NOT `isMembershipRequiredError` AND MUST NOT BE CONFLATED WITH IT.
 * That `403` sends a member to `/pricing`; this one means "reload the list".
 */
export function isNotCancellableError(error: unknown): boolean {
  return error instanceof HttpErrorResponse && error.status === 403;
}

@Injectable({ providedIn: 'root' })
export class MemberSessionRequestsApiService {
  private readonly http = inject(HttpClient);

  /**
   * `GET` — this member's own requests (R4.3).
   *
   * ⚠️ A BARE ARRAY, NOT A `Paged<…>` ENVELOPE, and that is the server's shape:
   * `MemberSessionRequestsController.list` declares no `@Query()` at all. A
   * page parameter here would be a `400`, and a pager would be a control for a
   * page that cannot exist.
   *
   * ⚠️ ALREADY ORDERED SERVER-SIDE (newest first). Nothing is re-sorted here —
   * a client sort reorders only the rows this response happens to hold.
   */
  public list(): Observable<MemberSessionRequest[]> {
    return this.http
      .get<unknown>(REQUESTS)
      .pipe(
        map(
          validate(
            z.array(memberSessionRequestSchema),
            'GET /members/session-requests',
          ),
        ),
      );
  }

  /**
   * `POST` — submit a request. `201`, always `pending` (R4.2).
   *
   * 🔴 AN EMPTY `additionalNotes` IS OMITTED FROM THE WIRE, NOT SENT AS `null`
   * OR `''`. `CreateSessionRequestDto.additionalNotes` is
   * `@IsOptionalNotNull() @NullMeansAbsent() @IsString() @MaxLength(5000)`, so
   * "no notes" and "the key was omitted" are the same request — which
   * `undefined` is how JSON says. `member-learning-api.service.ts`'s
   * `createComment` makes the identical conversion for the identical reason,
   * and this is the one place it belongs, so no caller has to know.
   *
   * ⚠️ THE BODY CARRIES NOTHING ELSE. No `status`, no `scheduledAt`, no
   * `isFreeSession` — every one of which is decided by the server, and every
   * one of which is a `400` if sent.
   *
   * ⚠️ THROTTLED AT 10/min (`CONTENT_CREATION`). A `429` is a distinct outcome
   * from a validation failure and the page gives it its own sentence.
   */
  public submit(
    body: CreateSessionRequestBody,
  ): Observable<MemberSessionRequest> {
    const notes = body.additionalNotes?.trim();
    const payload: { sessionTopicId: string; additionalNotes?: string } =
      notes === undefined || notes === ''
        ? { sessionTopicId: body.sessionTopicId }
        : { sessionTopicId: body.sessionTopicId, additionalNotes: notes };

    return this.http
      .post<unknown>(REQUESTS, payload)
      .pipe(
        map(
          validate(
            memberSessionRequestSchema,
            'POST /members/session-requests',
          ),
        ),
      );
  }

  /**
   * `DELETE :id` — withdraw one's own PENDING request.
   *
   * ⚠️ THE CALLER RE-READS THE LIST AFTERWARDS RATHER THAN SPLICING THE ROW
   * OUT. The acknowledgement carries no row, the server may have changed the
   * request's status between the render and the click, and a `403` is a
   * first-class outcome here rather than a failure — so the list is the only
   * thing that can be authoritative about what happened.
   *
   * See {@link isNotCancellableError} for why `403` is not rendered as a
   * permission problem.
   */
  public cancel(id: string): Observable<{ canceled: boolean }> {
    return this.http
      .delete<unknown>(`${REQUESTS}/${encodeURIComponent(id)}`)
      .pipe(
        map(
          validate(canceledAckSchema, `DELETE /members/session-requests/${id}`),
        ),
      );
  }
}
