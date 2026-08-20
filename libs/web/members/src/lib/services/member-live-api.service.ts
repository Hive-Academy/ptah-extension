import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import {
  FIRST_PAGE,
  MAX_PAGE_SIZE,
  memberLiveResponseSchema,
  type LiveFeedItem,
  type MemberLiveResponse,
} from '@ptah-contracts/community';
import { validate } from '@ptah-web/core';

/**
 * MemberLiveApiService — `GET /api/v1/members/live`, the whole merged Live feed
 * (§3.5, R3.3, R3.6, AD-3).
 *
 * ⚠️ PURE DATA ACCESS, exactly as `member-learning-api.service.ts` is. No
 * signals, no cached state, no routing. Three surfaces read this endpoint
 * (Live, Replays, and the Replays pager) and a service that also held state
 * would give them three different ideas of the current page.
 *
 * ⚠️ EVERY RESPONSE IS PARSED WITH THE SCHEMA EXPORTED BY
 * `@ptah-contracts/community`. A second copy of the wire type on the client is
 * exactly the drift the contracts lib exists to remove.
 *
 * ── 🔴 ONE REQUEST SERVES THREE LISTS, AND ONLY ONE OF THEM IS PAGED ────────
 * `MemberLiveResponse` carries `upcoming`, `live` and `replays`. The first two
 * are bare arrays bounded by the schedule itself; `replays` is the only
 * {@link import('@ptah-contracts/community').Paged} one because a replay
 * archive accumulates for ever. There is therefore NO page parameter that
 * affects `upcoming` — the Live page's "show more" is a CLIENT-SIDE reveal over
 * a list it already holds, and inventing `?page` for it would be a `400`
 * (`ListLiveQueryDto` runs under `forbidNonWhitelisted`).
 *
 * ── 🔴 `calendarAvailable` IS NOT AN ERROR AND MUST NEVER BE RENDERED AS ONE ─
 * R3.6. `false` means "we do not have a Calendar answer" — either the
 * integration is unconfigured, or it is configured and did not answer. The
 * member is told the list may be incomplete; they are never shown a failure.
 * This service does not interpret the flag at all; it simply carries it, and
 * `LivePage` owns the branch.
 *
 * ⚠️ IN THIS WORKSPACE THE FLAG IS `true` AND THE FEED IS POPULATED WITH REAL
 * CALENDAR DATA. Measured 2026-08-09: 50 upcoming items, every one
 * `source: 'calendar'`, every one with a real `meetLink`, every one with
 * `durationSeconds: null` and `youtubeVideoId: null`, across 44 distinct days
 * but only TWO distinct titles — 44 of them are expanded instances of one
 * recurring master. Anything here that assumes a short list of distinct titles
 * is wrong about the only data this product actually has.
 *
 * URLs stay relative — `apiInterceptor` prepends `environment.apiBaseUrl` and
 * sets `withCredentials: true`, so the `ptah_auth` COOKIE is attached. The
 * server's `JwtAuthGuard` reads that cookie and never looks at an
 * `Authorization` header.
 */

const LIVE = '/api/v1/members/live';

/**
 * A stable `@for` key for a feed item.
 *
 * 🔴 `LiveFeedItem.id` IS NOT UNIQUE ACROSS SOURCES AND THE CONTRACT SAYS SO IN
 * TERMS: *"`id` IS NOT GLOBALLY UNIQUE ACROSS SOURCES — a `LiveSession` cuid or
 * a Google Calendar event id. Pair it with `source` before using it as a key."*
 *
 * Tracking a concatenated list by `item.id` alone is an Angular duplicate-key
 * error at best and a silently wrong DOM re-use at worst. The collision is not
 * theoretical: a `LiveSession` may CLAIM a calendar event id, and the same
 * feed carries both kinds of identifier in the same field.
 *
 * ⚠️ THE SEPARATOR IS `':'` AND `source` COMES FIRST. `source` is drawn from a
 * two-value union that contains no colon, so the encoding is unambiguous in the
 * direction that matters — no pair of distinct `(source, id)` tuples can
 * produce the same key.
 */
export function feedItemKey(item: LiveFeedItem): string {
  return `${item.source}:${item.id}`;
}

/**
 * A persisted video runtime, rendered.
 *
 * 🔴 THE PARAMETER IS NAMED FOR ITS UNIT (RISK-O / B6.1). A POSITION in seconds
 * and a DURATION in seconds are both non-negative integers ending in `Seconds`
 * and swap at a call site without a type error — B6.1's whole finding was that
 * four such sites were consistently wrong and no single-site test could see it.
 * This function takes a DURATION. Nothing on the Live surfaces holds a
 * position; the only component that does is `CoursePlayerStore`, in another
 * directory, and it does not call this.
 *
 * ⚠️ `null` IS NOT ACCEPTED. `LiveFeedItem.durationSeconds` is nullable and
 * `null` is the DEFAULT case in this workspace (`YOUTUBE_API_KEY` is empty, so
 * no metadata was ever fetched for anything). The caller branches on absence
 * and renders nothing — a "0:00" runtime on every card would be a fact the
 * server never asserted.
 */
export function formatDuration(durationSeconds: number): string {
  const total = Math.max(0, Math.floor(durationSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

@Injectable({ providedIn: 'root' })
export class MemberLiveApiService {
  private readonly http = inject(HttpClient);

  /**
   * `GET live` — upcoming, live-now and the paged replay archive in one
   * response (R3.3).
   *
   * ⚠️ THE PAGE PARAMETERS REACH ONLY `replays`. Passing them does not narrow
   * `upcoming` or `live`, which is why `LivePage` calls this with no arguments
   * and `ReplaysPage` calls it with a page.
   *
   * ⚠️ OMITTED PARAMETERS ARE NOT SENT. The server echoes the EFFECTIVE `page`
   * and `pageSize` it used, so a client that sends nothing learns the defaults
   * from the response rather than hard-coding them — which is the property
   * `Paged`'s docblock exists to preserve.
   *
   * ⚠️ ALREADY ORDERED AND ALREADY FILTERED SERVER-SIDE. Cohort visibility,
   * the `staff` branch and the time window are all in the server's `where`;
   * there is no field here to re-filter on and there must not be. `state` is
   * derived from a SINGLE server-side clock read and is never recomputed here
   * (RISK-AC) — two clocks make an item `'live'` in one place and `'upcoming'`
   * in another on the same screen.
   *
   * @throws RangeError before issuing a request the server would answer `400`.
   */
  public read(
    page?: number,
    pageSize?: number,
  ): Observable<MemberLiveResponse> {
    return this.http
      .get<unknown>(LIVE, { params: pageParams(page, pageSize) })
      .pipe(map(validate(memberLiveResponseSchema, 'GET /members/live')));
  }
}

/**
 * `?page` / `?pageSize` for the replay archive, validated BEFORE the request.
 *
 * ⚠️ THE GUARD IS CLIENT-SIDE ON PURPOSE AND MIRRORS
 * `member-community-api.service.ts`'s `pageParams` DELIBERATELY RATHER THAN
 * IMPORTING IT. That function is private to its own service (the two files
 * would otherwise need a shared module for nine lines), and both copies carry
 * this note so the pair changes together.
 *
 * The server REJECTS `pageSize > MAX_PAGE_SIZE` with a `400` and does NOT
 * clamp — `list-live.query.dto.ts` says so in terms, and a clamp would make a
 * client that asked for 500 rows believe it received all of them.
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
