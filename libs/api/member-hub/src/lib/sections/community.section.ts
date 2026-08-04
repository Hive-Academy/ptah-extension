import { Injectable } from '@nestjs/common';
import type { HubSection, HubTopicSummary } from '@ptah-contracts/community';
import type { MemberContext } from '@ptah-api/membership';
import type { HubSectionResolver } from './hub-section';

/**
 * The hub's `community` section — recent and unread forum topics (R6.1).
 *
 * ── PHASE 1: `{ status: 'empty', data: [] }` ───────────────────────────────
 * `Category`, `Topic` and `Post` do not exist yet — Batch 6 (P2-BE) creates
 * them together with `libs/api/forum`. The external forum this replaces was
 * removed outright rather than proxied (TASK_2026_177 P1b), so there is
 * deliberately no interim source to read from here.
 *
 * ⚠️ `data: []`, NEVER `null`. The contract requires array sections to carry
 * the empty ARRAY in every non-`'ok'` state so one renderer handles all three
 * statuses (R6.3).
 *
 * ⚠️ WHEN BATCH 6 FILLS THIS IN, the topic query must be cohort-scoped from
 * `ctx.cohortKeys` (`hasSome` against the category's `String[]`, AD-10) and
 * must never re-derive entitlement (R7.3). A `staff`-visibility category is
 * invisible here — the hub simply does not return it; `404` versus `403` is a
 * question for the topic endpoints, not for this summary.
 */
@Injectable()
export class CommunitySection implements HubSectionResolver<HubTopicSummary[]> {
  async resolve(_ctx: MemberContext): Promise<HubSection<HubTopicSummary[]>> {
    return { status: 'empty', data: [] };
  }
}
