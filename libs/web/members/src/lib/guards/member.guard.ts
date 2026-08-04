import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';

import { memberEntitlementResponseSchema } from '@ptah-contracts/community';
import { validate } from '@ptah-web/core';

import { MemberSessionStore } from '../state/member-session.store';

/** Where an unauthenticated or unentitled visitor is sent. */
const LOGIN_ROUTE = '/login';
const UPGRADE_ROUTE = '/pricing';
const RETURN_URL = '/members';

/**
 * MemberGuard — the frontend entitlement probe for `/members/*`.
 *
 * Modelled on `libs/web/core/src/lib/guards/admin-auth.guard.ts`, with one
 * deliberate difference: it reads a BODY, not a status.
 * `GET /api/v1/members/entitlement` answers `200 { entitled: false }` for a
 * logged-in non-member rather than `403`, because "not logged in" and "logged
 * in, not a member" need different destinations and a client should not have to
 * parse an exception body to tell them apart. Conflating them is how a member
 * whose subscription lapsed lands on a login page instead of a renewal page.
 *
 * | Probe result                 | Destination                          | Why |
 * | ---------------------------- | ------------------------------------ | --- |
 * | `401`                        | `/login?returnUrl=/members`          | No session at all. |
 * | `200 { entitled: false }`    | `/pricing`                           | R7.7's upgrade surface. NEVER an empty panel and never a raw 403 — a paying-capable visitor is shown how to buy, not an error. |
 * | `200 { entitled: true }`     | seeds {@link MemberSessionStore}, allows | The cohort list rides along, so the shell needs no second call. |
 *
 * ⚠️ THIS GUARD IS COSMETIC (NFR-S8). It decides what to DRAW. The server-side
 * `MemberGuard` in `libs/api/membership` is the only thing that decides what a
 * member may READ, and every member endpoint runs behind it. Nothing may be
 * exposed on the strength of this returning `true`.
 *
 * ⚠️ THE PROBE PATH IS LOAD-BEARING. It fires on every `/members/*` activation,
 * which is why the server keeps it to a deliberately cheap two-query handler.
 * Do not repoint it at `GET /members/hub` to "save a request" — the hub
 * composes five sections and would then run on every navigation.
 */
export const MemberGuard: CanActivateFn = (): Observable<boolean> => {
  const http = inject(HttpClient);
  const router = inject(Router);
  const session = inject(MemberSessionStore);

  return http.get<unknown>('/api/v1/members/entitlement').pipe(
    map(validate(memberEntitlementResponseSchema, 'GET /members/entitlement')),
    map((entitlement) => {
      if (!entitlement.entitled) {
        void router.navigate([UPGRADE_ROUTE]);
        return false;
      }
      session.set(entitlement);
      return true;
    }),
    catchError(() => {
      // 401 is the documented "no session" answer. Anything else — a 5xx, a
      // network failure, a response that fails the contract parse — is an
      // UNKNOWN state, and the conservative reading of unknown is "not
      // authenticated", which is the same fallback `admin-auth.guard.ts` takes.
      // Routing an unknown-state visitor to /pricing instead would tell someone
      // who is already paying that they have not paid.
      void router.navigate([LOGIN_ROUTE], {
        queryParams: { returnUrl: RETURN_URL },
      });
      return of(false);
    }),
  );
};
