import { z } from 'zod';

import type { MemberCohortBadge } from '../shared/visibility';
import { continueLearningSchema } from './member-course.contract';
import type { ContinueLearning } from './member-course.contract';
import { hubSessionSummarySchema } from './member-live.contract';
import type { HubSessionSummary } from './member-live.contract';
import { hubNotificationSummarySchema } from './member-notification.contract';
import type { HubNotificationSummary } from './member-notification.contract';
import { memberPackSchema } from './member-pack.contract';
import type { MemberPack } from './member-pack.contract';
import { hubTopicSummarySchema } from './member-topic.contract';
import type { HubTopicSummary } from './member-topic.contract';

/**
 * THE MEMBER HUB ENVELOPE — `GET /api/v1/members/hub`. R6, AD-4, plan §3.2.
 *
 * ⚠️ THE ENVELOPE IS FROZEN FOR ALL FIVE PHASES. R6.6 is only satisfiable if
 * this shape never changes. Phases 2–5 change WHICH sections report `'ok'` and
 * what their `data` contains; they never add a section, never remove one,
 * never rename one, and NEVER add a second client request. R6.2 is asserted as
 * an e2e network-count test on `/members`, written in Phase 1 and re-run
 * UNCHANGED in every later phase — if a later batch needs a second fetch for
 * the initial render, it has broken this contract, not extended it.
 *
 * What each phase fills in (plan §3.2):
 *
 *   section         P1              P2            P3           P4            P5
 *   ------------------------------------------------------------------------------
 *   sessions        Calendar        —             —            + LiveSession —
 *                                                                + accepted
 *                                                                private
 *   community       empty           recent +      —            —             —
 *                                   unread topics
 *   learning        empty           —             current      —             —
 *                                                 course +
 *                                                 next lesson
 *   packs           empty           —             —            —             member-
 *                                                                            visible
 *   notifications   empty           —             —            —             unread
 *                                                                            count
 *
 * ⚠️ ALL FIVE SECTIONS ARE DECLARED NOW, in Phase 1, even though four of them
 * report `'empty'` until their phase lands. Declaring them late would make each
 * phase an envelope change; declaring them now makes each phase a data change.
 * That difference is the whole of R6.6.
 *
 * ⚠️ HOW LATER PHASES EXTEND THIS WITHOUT CHANGING IT. Additive growth happens
 * INSIDE a section's payload type (a new nullable field on
 * {@link HubSessionSummary}, say), never on `sections` itself. Every payload
 * type already declares the discriminants its later phases need — see
 * `HUB_SESSION_KINDS`, which declares `'live'` and `'private'` in Phase 1
 * although Phase 1 emits only `'calendar'`.
 *
 * COMPOSITION (AD-4): `MemberHubService.compose(userId)` resolves entitlement
 * and cohort keys once, then runs the five section resolvers concurrently with
 * `Promise.allSettled` — NOT `Promise.all`. That choice is what delivers R6.4:
 * a rejected resolver becomes `{ status: 'unavailable', data: <empty shape> }`
 * and the response is still `200`. A disabled Google Calendar integration
 * degrades one card; it must never blank the home screen.
 */

/** Section states — R6.3, R6.4. */
export const HUB_SECTION_STATUSES = ['ok', 'empty', 'unavailable'] as const;

/**
 * - `ok`          — the source answered and returned content.
 * - `empty`       — the source answered and there is genuinely nothing to show.
 *                   The UI renders the `EmptyState` primitive from
 *                   `@ptah-web/panel-ui`; it does NOT omit the section (R6.3).
 * - `unavailable` — the source failed or is disabled. The UI says so for that
 *                   card only, and the other four still render (R6.4, NFR-R3).
 *
 * ⚠️ `'empty'` and `'unavailable'` are NOT interchangeable. "You have no
 * unread topics" and "the forum is down" are different messages, and a client
 * that cannot tell them apart will show the wrong one at the worst time.
 */
export type HubSectionStatus = (typeof HUB_SECTION_STATUSES)[number];

/**
 * One hub section.
 *
 * ⚠️ `data` CARRIES THE EMPTY SHAPE, NEVER `null`, FOR ARRAY SECTIONS — even
 * when `status` is `'unavailable'`. An unavailable `community` section sends
 * `data: []`, not `data: null`. That is what lets every section renderer run
 * the same code path and render `EmptyState` uniformly (R6.3) instead of each
 * one guarding against `null` and one of them forgetting.
 *
 * For the two nullable-payload sections (`learning`, `sessions`) the empty
 * shape genuinely IS `null` — there is no such thing as an empty
 * {@link ContinueLearning}.
 *
 * ⚠️ Generic by TYPE ARGUMENT, never by `extends`. `HubSection<MemberPack[]>`
 * composes; `interface PacksSection extends HubSection<...>` would be the first
 * inheritance in this lib and the spec would reject it.
 */
export interface HubSection<T> {
  status: HubSectionStatus;
  data: T;
}

/**
 * The composed hub response.
 *
 * `member.firstName` is `null` for a member who never supplied one — the UI
 * falls back to a generic greeting rather than rendering "Welcome back, null".
 * `member.cohorts` is `[]` for an entitled member with no `MemberGroupAssignment`,
 * which is a valid state that must render normally and never error (R7.8, A-2).
 */
export interface MemberHubResponse {
  member: {
    firstName: string | null;
    cohorts: MemberCohortBadge[];
  };
  sections: {
    /** Phase 1: `{ status: 'empty', data: null }`. Filled by Batch 9 (P3). */
    learning: HubSection<ContinueLearning | null>;
    /** Phase 1: `{ status: 'empty', data: [] }`. Filled by Batch 6 (P2). */
    community: HubSection<HubTopicSummary[]>;
    /** Phase 1: POPULATED from Google Calendar. Extended by Batch 12 (P4). */
    sessions: HubSection<HubSessionSummary | null>;
    /** Phase 1: `{ status: 'empty', data: [] }`. Filled by Batch 14 (P5). */
    packs: HubSection<MemberPack[]>;
    /** Phase 1: `{ status: 'empty', data: { unreadCount: 0 } }`. Batch 14 (P5). */
    notifications: HubSection<HubNotificationSummary>;
  };
}

/**
 * The entitlement probe — `GET /api/v1/members/entitlement`. R7.6, R7.7.
 *
 * ⚠️ ANSWERS `200 { entitled: false }`, NOT `403`. The frontend `MemberGuard`
 * must distinguish "not logged in" (→ `/login?returnUrl=/members`) from
 * "logged in, not a member" (→ the upgrade surface) WITHOUT parsing an
 * exception body. `401` means the first; `200 { entitled: false }` means the
 * second. Conflating them is how an entitled-but-lapsed member lands on a login
 * page instead of a renewal page.
 *
 * ⚠️ It is a deliberately CHEAP two-query endpoint. It is probed on every
 * `/members/*` navigation, which is why it does not reuse a heavy handler —
 * the same warning `admin-auth.guard.ts` carries about probing heavy handlers.
 *
 * Declared in THIS file rather than its own because the entitlement probe and
 * the hub are the two endpoints of one lib (`libs/api/member-hub`, plan §3.7)
 * and are consumed by the same frontend guard + shell. Plan Task 2.3's file
 * list names only `member-hub.contract.ts`; declaring `MemberEntitlementResponse`
 * anywhere else would leave Batch 3 (server) and Batch 4 (guard) each writing
 * their own copy — precisely the drift this lib exists to prevent.
 */
export interface MemberEntitlementResponse {
  /**
   * A-2: derives from `License`/`Subscription` ONLY. It is NOT "has a cohort" —
   * an entitled member with no `MemberGroupAssignment` is `true` here with `[]`
   * cohorts (R7.8).
   */
  entitled: boolean;
  cohorts: MemberCohortBadge[];
  /**
   * ⚠️ ORTHOGONAL TO `entitled` (R7.4). An admin who never bought Builders is
   * `{ entitled: false, isAdmin: true }`. This flag drives admin-only affordances
   * inside `/members` (moderation controls); it is NOT an entitlement bypass and
   * the server never treats it as one.
   */
  isAdmin: boolean;
}

/* -------------------------------------------------------------------------- */
/* Runtime schemas — the client's HTTP boundary parse                         */
/* -------------------------------------------------------------------------- */

const memberCohortBadgeSchema = z.object({
  key: z.string(),
  name: z.string(),
}) satisfies z.ZodType<MemberCohortBadge>;

/**
 * `HubSection<T>` is generic, and Zod schemas are values — so this is a factory,
 * not a constant. `hubSectionSchema(z.array(memberPackSchema))`.
 *
 * ⚠️ Return type INFERRED, not annotated, and no cast — see the same note on
 * `pagedSchema`. `contract-boundary.spec.ts` carries the concrete-instantiation
 * witnesses that make the correspondence to {@link HubSection} a proof rather
 * than an assertion.
 */
export function hubSectionSchema<T extends z.ZodType>(data: T) {
  return z.object({
    status: z.enum(HUB_SECTION_STATUSES),
    data,
  });
}

export const memberHubResponseSchema = z.object({
  member: z.object({
    firstName: z.string().nullable(),
    cohorts: z.array(memberCohortBadgeSchema),
  }),
  sections: z.object({
    learning: hubSectionSchema(continueLearningSchema.nullable()),
    community: hubSectionSchema(z.array(hubTopicSummarySchema)),
    sessions: hubSectionSchema(hubSessionSummarySchema.nullable()),
    packs: hubSectionSchema(z.array(memberPackSchema)),
    notifications: hubSectionSchema(hubNotificationSummarySchema),
  }),
}) satisfies z.ZodType<MemberHubResponse>;

export const memberEntitlementResponseSchema = z.object({
  entitled: z.boolean(),
  cohorts: z.array(memberCohortBadgeSchema),
  isAdmin: z.boolean(),
}) satisfies z.ZodType<MemberEntitlementResponse>;
