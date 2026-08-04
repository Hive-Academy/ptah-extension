import { Injectable, computed, signal } from '@angular/core';
import type {
  MemberCohortBadge,
  MemberEntitlementResponse,
} from '@ptah-contracts/community';

/**
 * The member's resolved entitlement for this browser session.
 *
 * An ALIAS of the wire type, not a re-declaration. `MemberEntitlementResponse`
 * already carries exactly the three facts the shell needs, and a parallel
 * frontend interface would be one more shape to keep in step with the server —
 * the drift `@ptah-contracts/community` exists to prevent.
 */
export type MemberContext = MemberEntitlementResponse;

/**
 * MemberSessionStore — the entitlement probe's result, seeded once by
 * `MemberGuard` and read by the shell.
 *
 * ⚠️ THIS IS PRESENTATION STATE, NOT AUTHORIZATION (NFR-S8). It says what the
 * server told us a moment ago so the chrome can render the right cohort chip
 * and the right admin affordances. Every actual permission decision is made
 * server-side by `MemberGuard` in `libs/api/membership`. Nothing in the panel
 * may read `entitled` or `isAdmin` and conclude it is therefore allowed to do
 * something — it may only conclude what to draw.
 *
 * `set` is idempotent per navigation: the guard runs on every `/members/*`
 * activation, so this is refreshed with each probe rather than frozen at first
 * load. That matters for a membership that lapses mid-session.
 */
@Injectable({ providedIn: 'root' })
export class MemberSessionStore {
  private readonly _context = signal<MemberContext | null>(null);

  public readonly context = this._context.asReadonly();

  /**
   * `[]` for an entitled member with no `MemberGroupAssignment`. That is a
   * VALID state (R7.8, A-2), not an error and not a reason to hide the panel:
   * such a member sees all `member`-visibility content and no cohort-gated
   * content. Conflating entitlement with cohort membership would lock out every
   * member who has not been assigned a cohort yet.
   */
  public readonly cohorts = computed<readonly MemberCohortBadge[]>(
    () => this._context()?.cohorts ?? [],
  );

  /** The cohort chip shown beside the panel title. `null` when uncohorted. */
  public readonly primaryCohortName = computed<string | null>(
    () => this.cohorts()[0]?.name ?? null,
  );

  /**
   * ⚠️ ORTHOGONAL TO ENTITLEMENT (R7.4). An admin who never bought Builders is
   * `{ entitled: false, isAdmin: true }` and never reaches this panel at all.
   * This flag only drives admin-only affordances for an admin who IS a member.
   */
  public readonly isAdmin = computed(() => this._context()?.isAdmin ?? false);

  public set(context: MemberContext): void {
    this._context.set(context);
  }

  /** Clears the cached context — used on sign-out. */
  public clear(): void {
    this._context.set(null);
  }
}
