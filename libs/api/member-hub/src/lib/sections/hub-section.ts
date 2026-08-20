import type { HubSection } from '@ptah-contracts/community';
import type { MemberContext } from '@ptah-api/membership';

/**
 * THE SECTION RESOLVER PORT — the one shape `MemberHubService` composes.
 *
 * Every `*.section.ts` file exports exactly ONE class implementing this, with
 * exactly ONE public method. Adding a Phase-N section is therefore one new file
 * plus one line in the composer, which is how R6.6 holds the client at a single
 * request across four phases (plan §2.8, AD-4).
 *
 * ── WHY A CLASS AND NOT A BARE `resolve(ctx)` FUNCTION ─────────────────────
 * Plan §2.8 words this as "each `*.section.ts` exports one
 * `resolve(ctx: MemberContext): Promise<HubSection<T>>`". A free function
 * cannot receive `SessionsService`, and the `sessions` section is precisely the
 * one Phase 1 populates — it needs the Google Calendar collaborator, resolved
 * through Nest DI and `@Optional()` so an unregistered `GoogleSessionsModule`
 * degrades one card rather than failing construction. So the SIGNATURE from the
 * plan is kept verbatim and only its carrier is an injectable class. The
 * one-public-method rule is what preserves the plan's intent: a section is a
 * function of the member context, not a service that grows.
 *
 * ── THE RESOLVER DOES NOT CATCH FOR FAULT ISOLATION ────────────────────────
 * A resolver returns `'unavailable'` for a condition it can NAME — "the Google
 * integration is switched off" — and otherwise lets the failure propagate. The
 * composer's `Promise.allSettled` is the single fault boundary (R6.4); a
 * resolver that swallowed everything would make that boundary untestable and
 * would report a genuine outage as `'empty'`, which is the one distinction
 * `HubSectionStatus` exists to preserve.
 */
export interface HubSectionResolver<T> {
  /**
   * Resolve this section for an already-entitled caller.
   *
   * `ctx` is produced ONCE by `MemberGuard` (R7.3). A resolver never re-derives
   * entitlement or cohort keys from it — it reads `ctx.userId` and
   * `ctx.cohortKeys` and scopes its query by them.
   */
  resolve(ctx: MemberContext): Promise<HubSection<T>>;
}

/**
 * The `data` a section carries when it has nothing to show.
 *
 * ⚠️ IT IS THE SAME VALUE FOR `'empty'` AND FOR `'unavailable'`. An
 * `'unavailable'` array section sends `[]`, never `null`, so every section
 * renderer runs one code path (contract docblock on {@link HubSection}). These
 * constants exist so the composer's degradation path and the resolvers' own
 * empty path cannot disagree about what "nothing" looks like.
 *
 * A frozen object rather than a literal at each site: `EMPTY_NOTIFICATIONS` is
 * the only non-primitive here that a caller could mutate, and a mutated shared
 * empty would corrupt every later response in the process.
 */
export const EMPTY_NOTIFICATIONS = Object.freeze({ unreadCount: 0 });
