import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import {
  FIRST_PAGE,
  MAX_BULK_MARK_READ_IDS,
  MAX_PAGE_SIZE,
  hubNotificationSummarySchema,
  memberNotificationSchema,
  pagedSchema,
  type HubNotificationSummary,
  type MarkNotificationsReadRequest,
  type MemberNotification,
  type Paged,
} from '@ptah-contracts/community';
import { validate } from '@ptah-web/core';

/**
 * MemberNotificationsApiService — the five member notification endpoints
 * (§3.6, R9.7, R10.3, R10.4, R10.5, NFR-P5, NFR-S1).
 *
 * ⚠️ PURE DATA ACCESS, AND THE POLLING IS SOMEBODY ELSE'S JOB. Six sibling
 * services in this directory hold no state and this one holds none either. The
 * 60 s cadence, the unread count, the in-flight write flag and the route guard
 * all live in `MemberNotificationsStore` (Task 15.4) — one store, one count,
 * one timer. A service that also polled would be a second thing deciding when
 * a request happens, and R9.3's whole prohibition is about two things claiming
 * to be the unread count.
 *
 * ── 🔴 `unreadCount()` PARSES THROUGH THE HUB'S OWN SCHEMA ─────────────────
 * `hubNotificationSummarySchema` is the SAME schema the hub's `notifications`
 * section payload uses — the contract's docblock says so in terms: it is "the
 * hub's `notifications` section payload AND the body of
 * `GET /v1/members/notifications/unread-count`". One shape, one parse, two
 * callers. A second inline `z.object({ unreadCount: z.number() })` here is the
 * beginning of the drift R6.6 exists to prevent, and it would drift silently
 * because both copies would agree on day one.
 *
 * ── 🔴 THE THREE WRITES HAVE NO RESPONSE SCHEMA, AND THAT IS THE CONTRACT ──
 * `member-notification.contract.ts` states it explicitly: `POST :id/read`
 * returns `{ readAt }`, `POST read` and `POST read-all` both return
 * `{ marked }`, and NONE has a declared contract because the client treats all
 * three as FIRE-AND-REFETCH. The store decrements optimistically and then
 * re-reads `unread-count`, which is the only writer of the badge. Declaring
 * schemas here would add exported symbols guarding a boundary nothing crosses —
 * and, worse, would invite a caller to trust `{ marked }` as the new count,
 * which it is not: measured live, `read-all` answered `{"marked":0}`
 * immediately after a single notification had already been marked read
 * individually, and `POST read` returns "rows THIS CALL moved" with the same
 * field name and the same meaning.
 *
 * ── PAGE PARAMETERS ARE SENT ONLY WHEN SUPPLIED ───────────────────────────
 * The server ECHOES the effective `page`/`pageSize` it used, so a client that
 * sends nothing learns the defaults from the response rather than hard-coding
 * them. Measured live: no parameters → `{"page":1,"pageSize":25,…}`;
 * `?page=2&pageSize=10` → `{"page":2,"pageSize":10,…}`.
 *
 * ── 🔴 `pageSize > MAX_PAGE_SIZE` THROWS BEFORE THE REQUEST (NFR-P5) ───────
 * The server REJECTS an over-cap page size with `400` and does NOT clamp —
 * `list-notifications.query.dto.ts` says so in terms, and measured live
 * `?pageSize=51` answered `400`. A clamp would make a client that asked for 500
 * rows believe it received all of them. The guard is client-side so the failure
 * is a `RangeError` at the call site rather than an HTTP error the page would
 * have to render as "we could not load your notifications".
 *
 * URLs stay relative — `apiInterceptor` prepends the base and sets
 * `withCredentials: true`, so the `ptah_auth` cookie is attached.
 */

const NOTIFICATIONS = '/api/v1/members/notifications';

/**
 * The paged list envelope.
 *
 * ⚠️ BUILT WITH THE CONTRACT'S `pagedSchema` FACTORY, not hand-written. The
 * envelope is generic and the five envelope fields are declared in exactly one
 * place; six sibling surfaces already page through the same factory.
 */
const notificationPageSchema = pagedSchema(memberNotificationSchema);

@Injectable({ providedIn: 'root' })
export class MemberNotificationsApiService {
  private readonly http = inject(HttpClient);

  /**
   * `GET notifications` — the member's own inbox, newest first (R10.3).
   *
   * ⚠️ "THE MEMBER'S OWN" IS A SERVER-SIDE `where`, NOT A CLIENT FILTER. The
   * controller derives the user from the authenticated context; there is no
   * user id on the wire in either direction (NFR-S4) and nothing here to
   * filter on.
   *
   * @throws RangeError before issuing a request the server would answer `400`.
   */
  public list(
    page?: number,
    pageSize?: number,
  ): Observable<Paged<MemberNotification>> {
    return this.http
      .get<unknown>(NOTIFICATIONS, { params: pageParams(page, pageSize) })
      .pipe(
        map(validate(notificationPageSchema, 'GET /members/notifications')),
      );
  }

  /**
   * `GET notifications/unread-count` — the ≥60 s poll target (R10.4, R10.5,
   * AD-14).
   *
   * ⚠️ A COUNT, NOT A LIST, AND THE CONTRACT EXPLAINS WHY: the poll runs every
   * 60 s for every open tab, and sending notification bodies on that cadence
   * would make the cheapest endpoint in the product the most expensive one.
   */
  public unreadCount(): Observable<HubNotificationSummary> {
    return this.http
      .get<unknown>(`${NOTIFICATIONS}/unread-count`)
      .pipe(
        map(
          validate(
            hubNotificationSummarySchema,
            'GET /members/notifications/unread-count',
          ),
        ),
      );
  }

  /**
   * `POST notifications/:id/read` — mark one read (R10.3).
   *
   * ⚠️ IT IS A `200`, NOT A `201`, AND THE SERVER PINS IT WITH `@HttpCode(200)`.
   * Nothing is created; this is a state transition on an existing row. Measured
   * live: `200 {"readAt":"2026-08-10T14:02:49.470Z"}`.
   *
   * ⚠️ ANOTHER MEMBER'S ID IS INDISTINGUISHABLE FROM A NONEXISTENT ONE
   * (RISK-AH). Both answer `200 {"readAt":null}` and neither writes. There is
   * no `404`, so the endpoint is not an existence oracle over guessable cuids —
   * which means this method can never be used to probe for a row and callers
   * must not read a `200` as "it was mine".
   *
   * ⚠️ THE BODY IS UNPARSED BY DESIGN — see the class docblock. The return type
   * is `void` so no caller can grow a dependency on a shape with no contract.
   */
  public markRead(id: string): Observable<void> {
    return this.http
      .post<unknown>(`${NOTIFICATIONS}/${encodeURIComponent(id)}/read`, {})
      .pipe(map(() => undefined));
  }

  /**
   * `POST notifications/read` — mark EXACTLY the named notifications read
   * (R9.7).
   *
   * ── 🔴 THIS IS THE ENDPOINT "MARK THESE N" ALWAYS NEEDED AND NEVER HAD ────
   * Until it landed the server offered only ONE ROW (`POST :id/read`) and THE
   * WHOLE INBOX (`POST read-all`). A selection toolbar — a control whose entire
   * semantic is "act on the N things I selected" — could be served by neither:
   * `read-all` marks rows the member never selected, including rows on pages
   * they have never seen, and there is NO mark-unread endpoint, so that
   * over-reach is PERMANENT. N separate `:id/read` calls were correct and cost
   * N round trips. This is one request that means exactly what the toolbar
   * says.
   *
   * ⚠️ `{ marked }` IS "ROWS THIS CALL MOVED", NOT THE NEW UNREAD COUNT, and it
   * is unparsed for exactly that reason (see the class docblock). An id that
   * does not exist, is already read, or belongs to another member contributes
   * ZERO to it and is NOT an error — the contract says so in terms, because a
   * per-id failure report would tell a caller which of the cuids they guessed
   * are real.
   *
   * @throws RangeError before issuing a request the server would answer `400`.
   */
  public markManyRead(ids: readonly string[]): Observable<void> {
    const body: MarkNotificationsReadRequest = { ids: bulkReadIds(ids) };

    return this.http
      .post<unknown>(`${NOTIFICATIONS}/read`, body)
      .pipe(map(() => undefined));
  }

  /**
   * `POST notifications/read-all` — mark the member's ENTIRE INBOX read
   * (R9.7, R10.3).
   *
   * ⚠️ 🔴 "ALL" MEANS ALL, ACROSS EVERY PAGE — NOT "everything on screen".
   * This is the one write whose blast radius is larger than the rows the member
   * can see, and nothing can un-read a row. {@link markManyRead} is what a
   * SELECTION uses; this is only correct when the member asked for the whole
   * inbox, or when a selection is PROVABLY equivalent to it
   * (`MemberNotificationsStore.markSelectedRead`).
   */
  public markAllRead(): Observable<void> {
    return this.http
      .post<unknown>(`${NOTIFICATIONS}/read-all`, {})
      .pipe(map(() => undefined));
  }
}

/**
 * The `ids` array, validated BEFORE the request — the same client-side
 * discipline {@link pageParams} applies to paging.
 *
 * ⚠️ 🔴 AN EMPTY ARRAY THROWS RATHER THAN BEING SENT OR BEING SILENTLY
 * SWALLOWED. The server answers `400 "ids should not be empty"`, and it does
 * that deliberately: "mark these, where THESE is empty" is the one phrasing
 * that could ever be re-read as "mark ALL", and conflating those two is the
 * irreversible mistake this endpoint exists to prevent. Turning that `400` into
 * a client-side no-op would re-open the door from this side. It throws instead,
 * so the bug is loud at the call site.
 *
 * ⚠️ THE CAP IS IMPORTED, NOT HARD-CODED AS 50, and it is DERIVED server-side
 * from `MAX_PAGE_SIZE`: the only honest way a member produces a selection is by
 * ticking rows on screen, and the inbox renders at most one page. Importing it
 * means a client guarding on the page ceiling and a client guarding on the cap
 * agree by construction.
 *
 * @throws RangeError when a caller passes a selection the API cannot serve.
 */
function bulkReadIds(ids: readonly string[]): string[] {
  if (ids.length === 0) {
    throw new RangeError(
      'markManyRead requires at least one id. The server rejects an empty ' +
        'array with 400 rather than treating it as "mark all" — see ' +
        'MarkNotificationsReadRequest.',
    );
  }

  if (ids.length > MAX_BULK_MARK_READ_IDS) {
    throw new RangeError(
      `markManyRead accepts at most ${MAX_BULK_MARK_READ_IDS} ids (it is ` +
        `derived from MAX_PAGE_SIZE = ${MAX_PAGE_SIZE}); received ${ids.length}. ` +
        'A selection larger than the largest page this API will serve is not a ' +
        'selection. Use markAllRead() for the whole inbox.',
    );
  }

  return [...ids];
}

/**
 * `?page` / `?pageSize`, validated BEFORE the request.
 *
 * ⚠️ IT MIRRORS `member-live-api.service.ts`'s AND
 * `member-community-api.service.ts`'s `pageParams` DELIBERATELY RATHER THAN
 * IMPORTING EITHER. Both are private to their own service — the files would
 * otherwise need a shared module for nine lines — and all three copies carry
 * this note so the set changes together. If a fourth appears, extract them.
 *
 * @throws RangeError when a caller passes a page or page size the API cannot
 *   serve.
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
