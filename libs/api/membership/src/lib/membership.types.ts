/**
 * The 403 body every member-facing gate returns, and the ONLY shape the
 * frontend parses for it.
 *
 * `isMembershipRequiredError()` in
 * `libs/web/core/src/lib/services/members-api.service.ts` tests
 * `status === 403 && body.reason === 'membership_required'` to tell "logged in
 * but not a member" (route to the upgrade surface) from a genuine failure
 * (route to an error state). Inventing a second shape here would silently turn
 * the upgrade path into an error page, so this is a constant rather than a
 * string literal repeated at each throw site.
 */
export const MEMBERSHIP_REQUIRED = 'membership_required' as const;

/**
 * Everything a member-facing handler needs about its caller, resolved ONCE per
 * request by `MemberGuard` and attached to `req.memberContext`.
 *
 * Resolving it in the guard rather than per-service is R7.3: no service
 * re-derives entitlement, and no controller can forget to. All fields are
 * `readonly` — a handler reads this context, it never edits it.
 */
export interface MemberContext {
  readonly userId: string;
  readonly email: string;

  /**
   * A-2, ENTITLEMENT: may this person enter `/members` at all.
   *
   * Derived from `License` / `Subscription` and from NOTHING else — not from a
   * JWT claim (a stale token could then grant access) and not from admin
   * status (admin is a separate authorized path, never a loosening of this
   * gate).
   *
   * Always `true` on a context produced by `MemberGuard`, because the guard
   * throws before building one otherwise. It is carried explicitly anyway so
   * the same type can describe the `GET /members/entitlement` probe, which
   * deliberately answers `200 { entitled: false }` instead of 403 (R7.7).
   */
  readonly entitled: boolean;

  /**
   * A-2, COHORT: which gated content this member sees. Derived from
   * `MemberGroupAssignment` and from nothing else.
   *
   * **An empty array is normal and is never an error (R7.8.)** A member whom an
   * admin has not yet placed in a cohort still sees every `member`-visibility
   * surface; they simply match no `cohort`-visibility content. Downstream
   * matching is `hasSome` against a `String[]` column (AD-10), so an empty list
   * — and equally a stale key — matches nobody. The failure direction is
   * restrictive, which is why a data-entry omission degrades to "missing some
   * content" rather than "denied access".
   */
  readonly cohortKeys: readonly string[];

  /**
   * Informational ONLY — it exists so a member-facing response can render an
   * admin affordance. It is resolved AFTER the entitlement decision has been
   * made and enforced, and it never participates in that decision. Admin
   * surfaces keep their own authorized path (`AdminGuard` + `ADMIN_EMAILS`).
   */
  readonly isAdmin: boolean;
}

/**
 * Augment Express' `Request` with the guard-resolved member context.
 *
 * Mirrors the `req.user` augmentation in
 * `libs/api/identity/src/lib/interfaces/request-user.interface.ts`, including
 * its `no-namespace` justification: global augmentation of the ambient
 * `Express` namespace has no ES-module equivalent — `declare module 'express'`
 * would REPLACE the module's types rather than merge into `Express.Request`,
 * and the interface merging that makes `req.memberContext` typed at every
 * handler REQUIRES the namespace form.
 *
 * Optional on purpose: a route without `MemberGuard` genuinely has no context,
 * and the type should say so rather than lie.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      memberContext?: MemberContext;
    }
  }
}
