import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';

import { memberEntitlementResponseSchema } from '@ptah-contracts/community';

import { validate } from './validate-response';
import {
  MemberSessionStore,
  type MemberContext,
} from '../state/member-session.store';

/**
 * ⚠️ THE ONE CALL SITE FOR THE ENTITLEMENT PROBE. Adding a second — even one
 * that hits the same URL with the same schema — is how "is this person a
 * Builders member" acquires two answers that disagree the first time one of
 * them is missed. `MemberGuard` and `PostLoginDestinationService` both route
 * through here.
 */
export const MEMBER_ENTITLEMENT_URL = '/api/v1/members/entitlement';

/**
 * MemberEntitlementService — `GET /api/v1/members/entitlement`, parsed, seeded
 * and reduced to one three-way answer.
 *
 * Extracted from `member.guard.ts` when the post-login landing decision needed
 * the SAME facts the guard reads. The guard still owns what to do with them —
 * this owns only the request, the contract parse and the store seed, so
 * `isAdmin` and `entitled` continue to have exactly one origin on the frontend
 * (the member panel's Admin badge and both cross-panel nav links read the store
 * this fills).
 *
 * ⚠️ IT ANSWERS THREE STATES, NOT TWO, AND `null` IS NOT "UNENTITLED".
 *
 * | Wire result                          | Returns                       |
 * | ------------------------------------ | ----------------------------- |
 * | `200 { entitled: true, … }`          | the context, store seeded     |
 * | `200 { entitled: false, … }`         | the context, store NOT seeded |
 * | `401` / `5xx` / contract parse failure | `null` — state UNKNOWN      |
 *
 * `null` collapses every failure mode into "we do not know", which is the only
 * honest reading of a 500 or a malformed body, and callers must treat it as
 * such: the guard sends it to `/login` rather than `/pricing`, because telling
 * a paying member they have not paid is worse than asking them to sign in
 * again.
 *
 * ⚠️ THE STORE IS SEEDED ONLY WHEN ENTITLED, DELIBERATELY. `MemberSessionStore`
 * is the MEMBER session; a logged-in non-member has none, and seeding it with
 * `{ entitled: false }` would let member chrome render cohort/identity state for
 * somebody who is not a member. `member.guard.spec.ts` asserts
 * `store.context()` stays `null` on the `{ entitled: false }` path.
 *
 * ⚠️ COSMETIC (NFR-S8). Nothing may be exposed on the strength of what this
 * returns. `MemberGuard` in `libs/api/membership` decides what a member may
 * READ; `AdminGuard` in `libs/api/identity` decides what an admin may DO.
 * `isAdmin` here authorizes nothing — it only says what to draw and where to
 * land.
 */
@Injectable({ providedIn: 'root' })
export class MemberEntitlementService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(MemberSessionStore);

  /**
   * Probes the server and seeds {@link MemberSessionStore} on the entitled
   * path. Never throws: an unknown state surfaces as `null`.
   */
  public probe(): Observable<MemberContext | null> {
    return this.http.get<unknown>(MEMBER_ENTITLEMENT_URL).pipe(
      map(
        validate(memberEntitlementResponseSchema, 'GET /members/entitlement'),
      ),
      tap((context) => {
        if (context.entitled) {
          this.session.set(context);
        }
      }),
      catchError(() => of(null)),
    );
  }
}
