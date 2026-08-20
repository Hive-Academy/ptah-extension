import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import {
  FIRST_PAGE,
  MAX_PAGE_SIZE,
  memberSearchResultsSchema,
  type MemberSearchResults,
  type SearchKind,
} from '@ptah-contracts/community';
import { validate } from '@ptah-web/core';

/**
 * MemberSearchApiService — `GET /api/v1/members/search` (R1.7).
 *
 * ⚠️ ITS OWN SERVICE, MIRRORING ITS OWN CONTROLLER. Search is not a route under
 * `v1/members/community`: it spans three domains and only one of them is the
 * forum (`?kinds=topics,posts,lessons`). Hanging it off the community client
 * would tie a cross-surface capability to the forum's lifetime, which is the
 * same reason `MemberSearchController` is a separate class server-side.
 *
 * ⚠️ EXCERPTS ARE PLAIN TEXT PLUS OFFSETS, NEVER HTML (R1.7.5). The API returns
 * `{ text, matches: { start, length }[] }` and produces no `<mark>` of any kind,
 * so highlighting is a DOM operation over text nodes the client already owns —
 * `HighlightTextPipe` — and there is nothing to sanitize because nothing is
 * markup. If this ever starts returning highlighted HTML, every search result
 * becomes an XSS sink that bypasses the ONE sanitizer in the product (PRE-4,
 * AD-1). The schema is what makes that a parse failure rather than a rendering.
 *
 * ⚠️ `kinds=lessons` RETURNS AN EMPTY PAGE, NOT A `400`. All three groups are
 * always present in the response; `lessons` is a well-formed empty `Paged` until
 * Batch 9 fills it (Task 6.11). So a caller reads `results.lessons.total`
 * unconditionally and Batch 9 is a change in VALUES, not in SHAPE.
 *
 * ⚠️ `q` IS SENT AS THE MEMBER TYPED IT. The server caps it at 2..200 characters
 * through `dtoPipe`, and re-validating member-typed input here would be a second
 * definition of what a valid query is — the two would disagree the first time
 * either moved. The caller's job is a UI affordance (a disabled search button
 * under two characters), not a client-side rejection. `page`/`pageSize` are
 * different: they are constants the page chooses, never typed, and an over-cap
 * value is a programmer error the guard below refuses to express.
 */

/** Query for `GET /api/v1/members/search`. Only `q` is required. */
export interface MemberSearchQuery {
  q: string;
  /**
   * A subset of `SEARCH_KINDS`, comma-joined on the wire. Omit to search all
   * three. An empty array is NOT sent — the server's `@ArrayMinSize(1)` would
   * `400` on it, and "search nothing" is not a thing a caller means.
   */
  kinds?: readonly SearchKind[];
  page?: number;
  pageSize?: number;
}

const SEARCH_URL = '/api/v1/members/search';

@Injectable({ providedIn: 'root' })
export class MemberSearchApiService {
  private readonly http = inject(HttpClient);

  public search(query: MemberSearchQuery): Observable<MemberSearchResults> {
    let params = new HttpParams().set('q', query.q);

    if (query.kinds && query.kinds.length > 0) {
      // Comma-joined, matching the server DTO's `@Transform` which splits on
      // ',' and trims. Repeated `?kinds=a&kinds=b` params would arrive as an
      // array that skips the transform and reads differently.
      params = params.set('kinds', query.kinds.join(','));
    }

    if (query.page !== undefined) {
      if (!Number.isInteger(query.page) || query.page < FIRST_PAGE) {
        throw new RangeError(
          `page must be an integer >= ${FIRST_PAGE} (1-based); received ${query.page}.`,
        );
      }
      params = params.set('page', String(query.page));
    }

    if (query.pageSize !== undefined) {
      if (
        !Number.isInteger(query.pageSize) ||
        query.pageSize < 1 ||
        query.pageSize > MAX_PAGE_SIZE
      ) {
        throw new RangeError(
          `pageSize must be an integer in 1..${MAX_PAGE_SIZE} (NFR-P5); received ${query.pageSize}. ` +
            'The server rejects an over-cap request with 400 rather than clamping it.',
        );
      }
      params = params.set('pageSize', String(query.pageSize));
    }

    return this.http
      .get<unknown>(SEARCH_URL, { params })
      .pipe(map(validate(memberSearchResultsSchema, 'GET /members/search')));
  }
}
