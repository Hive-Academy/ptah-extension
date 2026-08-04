import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Observable, map } from 'rxjs';

import { MemberEntitlementService } from '../services/member-entitlement.service';

/** Where an unauthenticated or unentitled visitor is sent. */
const LOGIN_ROUTE = '/login';
const UPGRADE_ROUTE = '/pricing';
const RETURN_URL = '/members';

/**
 * MemberGuard — the frontend entitlement probe for `/members/*`.
 *
 * ⚠️ IT LIVES IN `@ptah-web/core`, AND THAT IS A ROUTING CONSTRAINT, NOT
 * FILING PREFERENCE. `app.routes.ts` lazy-loads `@ptah-web/members` via
 * `loadChildren`, and `@nx/enforce-module-boundaries` errors — "Static imports
 * of lazy-loaded libraries are forbidden" — the moment that same file also
 * statically imports a symbol from it. So a guard that ships inside the member
 * lib cannot be named on the `/members` route that loads it; it has to hide on
 * `MEMBER_ROUTES[0]`, one level below the route it belongs to, where nobody
 * reading `app.routes.ts` can see that `/members` is guarded at all.
 * `AdminAuthGuard` never had that problem because it sits in this lib, which is
 * eagerly imported by the app and therefore never lazy. `MemberGuard` now sits
 * beside it, and `MemberSessionStore` — the only reason the guard was ever in
 * the member lib — came with it.
 *
 * Modelled on `admin-auth.guard.ts` (same folder), with one deliberate
 * difference: it reads a BODY, not a status.
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
 * composes five sections and would then run on every navigation. The request
 * itself, the contract parse and the store seed now live in
 * {@link MemberEntitlementService}, because the post-login landing decision
 * needs the same three facts and a second copy of this call would give
 * `isAdmin` two origins. What stays here is only the routing decision.
 *
 * ⚠️ IT NEVER SENDS AN ADMIN ANYWHERE. `isAdmin` rides along in the probe body
 * and is read by the chrome (the membership card's Admin badge, the Admin nav
 * item), but this guard's three outcomes turn on `entitled` alone. An admin who
 * navigates to `/members` — directly, or from the admin panel's Member Panel
 * link — must LAND on `/members`. A bounce to `/admin` here would make the
 * member panel unreachable for every admin, including the person testing it.
 */
export const MemberGuard: CanActivateFn = (): Observable<boolean> => {
  const router = inject(Router);
  const entitlement = inject(MemberEntitlementService);

  return entitlement.probe().pipe(
    map((context) => {
      // `null` is UNKNOWN, not "unentitled": a 401, a 5xx, a network failure or
      // a body that fails the contract parse all arrive here. The conservative
      // reading of unknown is "not authenticated", which is the same fallback
      // `admin-auth.guard.ts` takes. Routing an unknown-state visitor to
      // /pricing instead would tell someone who is already paying that they
      // have not paid.
      if (context === null) {
        void router.navigate([LOGIN_ROUTE], {
          queryParams: { returnUrl: RETURN_URL },
        });
        return false;
      }
      if (!context.entitled) {
        void router.navigate([UPGRADE_ROUTE]);
        return false;
      }
      return true;
    }),
  );
};
