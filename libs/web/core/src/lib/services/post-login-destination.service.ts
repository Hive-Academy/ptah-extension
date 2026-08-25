import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { MemberEntitlementService } from './member-entitlement.service';
import type { MemberContext } from '../state/member-session.store';

/** Where an admin lands when nothing more specific was asked for. */
export const ADMIN_DESTINATION = '/admin';
/** Where an entitled member lands when nothing more specific was asked for. */
export const MEMBER_DESTINATION = '/members';
/** The floor: everyone else, and every unknown state. */
export const DEFAULT_DESTINATION = '/profile';

/**
 * The post-login DEFAULT destination for a resolved identity.
 *
 * ⚠️ THIS IS A LANDING PREFERENCE, NOT AN AUTHORIZATION DECISION, AND IT IS NOT
 * A REDIRECT RULE. It answers exactly one question — "the visitor just
 * authenticated and asked for nothing in particular, so where do they start?"
 * It does not run on navigation, it is not consulted by any guard, and nothing
 * anywhere bounces `/members` → `/admin` on its say-so. An admin who types
 * `/members`, or clicks the member panel link in the admin sidebar, stays on
 * `/members`. Turning this into a guard would make the member panel unreachable
 * for every admin, which is precisely the failure this note exists to prevent.
 *
 * ⚠️ IT IS ONLY REACHED WHEN THERE IS NO `returnUrl`. A `returnUrl` is an
 * explicit request and always wins — `MemberGuard`'s 401 path sets
 * `?returnUrl=/members`, so an admin bounced off the member panel to sign in
 * must come back to the member panel and not be diverted to `/admin`. The
 * caller returns before this function is ever consulted; see
 * `auth-page.component.ts`'s `navigateAfterAuth`.
 *
 * Precedence, highest first:
 *
 * | Identity                        | Destination | Why |
 * | ------------------------------- | ----------- | --- |
 * | `isAdmin`                       | `/admin`    | Admin wins over member — an operator who is also a member opens on the operator surface. Both panels stay one click apart via the cross-panel nav links. |
 * | `entitled`, not admin           | `/members`  | The common case: a Builders member starts in the member panel. |
 * | neither, or state UNKNOWN (`null`) | `/profile` | The pre-existing default, unchanged. A failed probe must not strand a signed-in visitor. |
 *
 * `isAdmin` and `entitled` are ORTHOGONAL (R7.4) and stay that way here: the
 * founder holds a free `community` license and is an admin, so
 * `{ entitled: false, isAdmin: true }` is a real and supported identity that
 * lands on `/admin` without implying any Builders entitlement.
 */
export function defaultDestinationFor(context: MemberContext | null): string {
  if (context?.isAdmin) return ADMIN_DESTINATION;
  if (context?.entitled) return MEMBER_DESTINATION;
  return DEFAULT_DESTINATION;
}

/**
 * PostLoginDestinationService — resolves {@link defaultDestinationFor} against
 * the live session.
 *
 * It reads {@link MemberEntitlementService}, the SAME probe `MemberGuard` runs,
 * rather than introducing a second source of admin-ness. `isAdmin` already
 * reaches the frontend on that response — it is what draws the Admin badge in
 * the member panel's membership card — and one more origin for it would be one
 * more thing to keep in step with `ADMIN_EMAILS`.
 */
@Injectable({ providedIn: 'root' })
export class PostLoginDestinationService {
  private readonly entitlement = inject(MemberEntitlementService);

  /**
   * One probe, one answer. Never errors — an unknown state resolves to
   * {@link DEFAULT_DESTINATION} so a 500 on the entitlement endpoint cannot
   * leave a freshly-authenticated visitor on the login form.
   */
  public resolveDefault(): Observable<string> {
    return this.entitlement.probe().pipe(map(defaultDestinationFor));
  }
}
