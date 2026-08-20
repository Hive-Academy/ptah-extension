import { Inject, Injectable } from '@nestjs/common';
import type {
  HubSection,
  HubTopicSummary,
  MemberTopicSummary,
} from '@ptah-contracts/community';
import { TopicsReadService } from '@ptah-api/forum';
import type { MemberContext } from '@ptah-api/membership';
import type { HubSectionResolver } from './hub-section';

/**
 * How many topics the community card carries.
 *
 * ⚠️ A CARD, NOT A FEED. The full list is `GET /v1/members/community/topics`,
 * and `slug` is what each row links to. Five is what fits above the fold next to
 * four other cards; raising it costs the hub response size, not a query, because
 * the feed's cost is bounded by NFR-P4 rather than by page size.
 */
const HUB_TOPIC_COUNT = 5;

/**
 * The hub's `community` section — recent community activity, with each row's
 * unread count (R6.1, R6.3, R6.4, AD-4).
 *
 * ── PHASE 2: `'empty'` → `'ok'` (§3.2 phase table, R6.6) ───────────────────
 * Phase 1 returned a hard-coded `{ status: 'empty', data: [] }` because
 * `Category`, `Topic` and `Post` did not exist. Batch 6 created them and
 * `libs/api/forum`. **The envelope does not change and the composer gains no
 * line** — this file already returned a `HubSection<HubTopicSummary[]>` and
 * still does. R6.6's whole claim is that a phase changes WHICH sections report
 * `'ok'`, never the shape and never the request count.
 *
 * ── R6.2: THE HUB IS STILL EXACTLY ONE REQUEST ─────────────────────────────
 * `HubTopicSummary` is a launcher row — no body, no posts, no author. That is
 * why `member-topic.contract.ts` keeps it DISTINCT from `MemberTopicSummary`
 * rather than unifying them: the feed row carries the author, the lock state and
 * the accepted flag, and pushing that shape into the hub would inflate the one
 * request R6.2 caps at one. Nothing here makes a client want a second call.
 *
 * ── WHY IT INJECTS ONLY `TopicsReadService` ────────────────────────────────
 * `ForumModule` exports two services and `MemberHubModule` imports it for both,
 * but the unread number this card renders is ALREADY on `MemberTopicSummary`:
 * `TopicsReadService.listFeed` computes it inside its five-query budget
 * (NFR-P4) from the same read-state markers `ReadStateService` would return.
 * Injecting `ReadStateService` here would issue a second query for a number
 * already in hand, and — worse — would derive the same value twice, so the card
 * and the feed could disagree. The second export stays for the consumers §2.5
 * anticipates; this section does not need it.
 *
 * ── VISIBILITY IS THE SERVICE'S JOB, AND R7.3 IS WHY ───────────────────────
 * `ctx` is passed through untouched. `listFeed` builds the category visibility
 * clause from `ctx.cohortKeys` and `ctx.isAdmin` (`hasSome` against the
 * category's `String[]`, AD-10) INSIDE the SQL, so a `cohort` or `staff`
 * category the member cannot see is not a row that is filtered here — it is a
 * row this code never receives. Nothing in this file re-derives entitlement or
 * cohorts.
 *
 * ── `'empty'` AND `'unavailable'` ARE NOT INTERCHANGEABLE (R6.4) ───────────
 * `'empty'` means the query ran and there is nothing; `'unavailable'` means a
 * source failed. This resolver returns `'empty'` for the first and DOES NOT
 * CATCH for the second: a throw propagates to `MemberHubService`'s
 * `Promise.allSettled` round, which logs it and degrades this section to
 * `{ status: 'unavailable', data: [] }` inside a `200` hub (AD-4).
 *
 * ⚠️ CATCHING HERE AND RETURNING `'empty'` WOULD BE THE BUG. It reads as
 * defensive and it destroys R6.4's fault signal: the member is told "no
 * community activity" on the strength of a query that failed, the hub looks
 * healthy, and nothing is logged. The one legitimate reason to catch would be to
 * return `'unavailable'` from here — which is exactly what the composer already
 * does, one layer up, for every section.
 */
@Injectable()
export class CommunitySection implements HubSectionResolver<HubTopicSummary[]> {
  constructor(
    @Inject(TopicsReadService) private readonly topics: TopicsReadService,
  ) {}

  async resolve(ctx: MemberContext): Promise<HubSection<HubTopicSummary[]>> {
    const feed = await this.topics.listFeed(ctx, {
      // `sort: 'recent'` is pinned-first then `lastPostedAt` descending — the
      // ordering the feed itself uses, so the card is a genuine window onto the
      // top of the list rather than a differently-ordered sample.
      //
      // `sort: 'unread'` was the alternative and is deliberately NOT used: it
      // FILTERS to topics with unread activity, so a fully caught-up member
      // would see an empty community card. "You are up to date" is a fine
      // message; "there is no community" is not the same claim, and `'empty'`
      // is the only status this section could report for it.
      sort: 'recent',
      pageSize: HUB_TOPIC_COUNT,
    });

    if (feed.items.length === 0) {
      // ⚠️ `data: []`, NEVER `null`. The contract requires array sections to
      // carry the empty ARRAY in every non-`'ok'` state so one renderer handles
      // all three statuses (R6.3).
      return { status: 'empty', data: [] };
    }

    return { status: 'ok', data: feed.items.map(toHubTopicSummary) };
  }
}

/**
 * `MemberTopicSummary` (the feed row) → `HubTopicSummary` (the card row).
 *
 * ⚠️ IT DROPS FIELDS RATHER THAN SPREADING. `authorName`, `categoryId`,
 * `locked`, `hasAcceptedAnswer` and `createdAt` are all present on the input and
 * all absent from the output: NFR-S4/S5 say a member-facing response carries
 * what the surface renders and nothing else, and a `{ ...row }` here would put
 * every one of them into the hub the moment the feed row grows a field.
 */
function toHubTopicSummary(topic: MemberTopicSummary): HubTopicSummary {
  return {
    id: topic.id,
    slug: topic.slug,
    title: topic.title,
    categoryName: topic.categoryName,
    replyCount: topic.replyCount,
    unreadCount: topic.unreadCount,
    lastPostedAt: topic.lastPostedAt,
    pinned: topic.pinned,
  };
}
