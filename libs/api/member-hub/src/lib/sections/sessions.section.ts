import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { HubSection, HubSessionSummary } from '@ptah-contracts/community';
import type { MemberContext } from '@ptah-api/membership';
import {
  LiveFeedService,
  SessionRequestsService,
  SessionsService,
  type BuildersSession,
} from '@ptah-api/community';
import type { HubSectionResolver } from './hub-section';

/**
 * The hub's `sessions` section — "what is next", singular, across THREE sources.
 *
 * ── R6.6: THIS IS A DATA CHANGE, NOT A CONTRACT CHANGE ─────────────────────
 *
 * `HUB_SESSION_KINDS` has declared `'calendar' | 'live' | 'private'` since
 * Phase 1, precisely so Phase 4 could fill the other two in without touching
 * the envelope, the composer or the client. Nothing about `HubSectionSummary`,
 * `MemberHubResponse` or `MemberHubService` changes here — and Batch 3's
 * one-request assertion must still pass, four phases later.
 *
 * The three sources:
 *   - `calendar` — a Google Calendar cohort session (Phase 1, unchanged).
 *   - `live`     — the next visible `LiveSession` (R3.1), read through
 *                  `LiveFeedService` so it composes the SAME visibility rule the
 *                  full feed does. A second read here would be a second place
 *                  for `staff` and `cohort` to be evaluated.
 *   - `private`  — THIS MEMBER'S OWN next ACCEPTED private session (R4). Read
 *                  through `SessionRequestsService.listOwn`, which puts
 *                  `ctx.userId` in the `where` — so the own-only rule is the
 *                  same one the member's own list uses and cannot drift.
 *
 * ⚠️ A PRIVATE SESSION IS THE ONLY KIND THAT IS PER-MEMBER, AND THAT IS WHY IT
 * CANNOT COME FROM THE FEED. `LiveFeedItem` deliberately has no `'private'`
 * source: a feed answers "what is on the schedule" and must never contain
 * another member's session. The hub card answers "what is next FOR YOU", which
 * is a different question with a different privacy posture — which is exactly
 * why the two contracts are unrelated types.
 *
 * ── 🔴 `'unavailable'` IS NOW A PER-SOURCE QUESTION ────────────────────────
 *
 * With one source, "we could not look" and "there is nothing" were the only two
 * answers and the existing two-state logic was sufficient. With three it is not:
 * **Calendar being down must not hide a `LiveSession` that is genuinely next.**
 *
 * The truth table, spelled out because this is the one place the old logic was
 * genuinely insufficient:
 *
 * | answered | produced a session | status          | data |
 * | -------- | ------------------ | --------------- | ---- |
 * | none     | —                  | `'unavailable'` | null |
 * | ≥ 1      | yes                | `'ok'`          | the earliest |
 * | ≥ 1      | no                 | `'empty'`       | null |
 *
 * "Answered" means a source RETURNED A LIST — including an empty one. A source
 * that is unbound, switched off, or failed did NOT answer. So:
 *   - every source down ⇒ `'unavailable'`. We looked at nothing and may not
 *     claim the member has nothing scheduled (NFR-R1's rule, unchanged).
 *   - Calendar down but a `LiveSession` exists ⇒ `'ok'`. Reporting
 *     `'unavailable'` here would blank a card that has a true answer in it.
 *   - Calendar down and the other two answered empty ⇒ `'empty'`. This is the
 *     one row that is arguably lossy: the member is told "nothing scheduled"
 *     while one source was silent. It is still the right answer, because the
 *     alternative — `'unavailable'` whenever ANY source is down — makes the card
 *     permanently unavailable in this workspace, where `GOOGLE_OAUTH_*` is
 *     unset by default. The incident detail an operator needs is in the log.
 *
 * ── WHY ALL THREE ARE `@Optional()` ────────────────────────────────────────
 * The same posture `SessionsService` has had since Phase 1: an unregistered
 * module degrades THIS CARD rather than failing `MemberHubModule`'s
 * construction and taking the whole home screen with it. `LiveSessionsModule`
 * and `GoogleSessionsModule` are both registered in `app.module.ts`; the
 * `@Optional()` is what keeps a wiring mistake from being a 500 on `/hub`.
 *
 * ── THE FAILURES STAY VALUES, NOT THROWS ───────────────────────────────────
 * `readUpcomingSessions` reports `{ ok: false, reason }`. `LiveFeedService.read`
 * and `listOwn` can throw, so each is wrapped in its own `try` — a Postgres
 * hiccup on the live schedule must not take the private-session half down with
 * it, and vice versa. The composer's `Promise.allSettled` is still the outer
 * fault boundary (R6.4); this inner isolation is what makes the per-source truth
 * table above expressible at all.
 */
@Injectable()
export class SessionsSection implements HubSectionResolver<HubSessionSummary | null> {
  private readonly logger = new Logger(SessionsSection.name);

  constructor(
    @Optional()
    @Inject(SessionsService)
    private readonly sessions?: SessionsService,
    @Optional()
    @Inject(LiveFeedService)
    private readonly liveFeed?: LiveFeedService,
    @Optional()
    @Inject(SessionRequestsService)
    private readonly sessionRequests?: SessionRequestsService,
  ) {}

  async resolve(
    ctx: MemberContext,
  ): Promise<HubSection<HubSessionSummary | null>> {
    // Three independent reads, in parallel. Each returns `null` for "did not
    // answer" and a (possibly empty) list of candidates otherwise.
    const [calendar, live, priv] = await Promise.all([
      this.readCalendar(ctx),
      this.readLive(ctx),
      this.readPrivate(ctx),
    ]);

    const answered = [calendar, live, priv].filter(
      (result): result is HubSessionSummary[] => result !== null,
    );

    if (answered.length === 0) {
      // Nothing looked. Reporting `'empty'` would tell the member they have no
      // upcoming session on the strength of three requests that did not happen.
      return { status: 'unavailable', data: null };
    }

    const next = earliest(answered.flat());
    return next
      ? { status: 'ok', data: next }
      : { status: 'empty', data: null };
  }

  /**
   * The Google Calendar half — Phase 1's behaviour, unchanged.
   *
   * `null` for both non-answers (`'disabled'`, `'fetch_failed'`). The
   * distinction the member needs is "we could not look" vs "we looked and there
   * is nothing"; which of the two reasons stopped us is an operator's question
   * and goes to the log.
   */
  private async readCalendar(
    ctx: MemberContext,
  ): Promise<HubSessionSummary[] | null> {
    if (!this.sessions) {
      this.logger.warn(
        'SessionsService is unbound (GoogleSessionsModule not registered) — ' +
          'the hub sessions card omits the calendar source',
      );
      return null;
    }
    if (!this.sessions.isEnabled()) {
      return null;
    }

    const result = await this.sessions.readUpcomingSessions(ctx.userId);
    if (!result.ok) {
      this.logger.warn(
        `Upcoming calendar sessions unavailable for user ${ctx.userId} ` +
          `(${result.reason}) — the hub sessions card omits the calendar source`,
      );
      return null;
    }
    return result.sessions.map(toCalendarSummary);
  }

  /**
   * The Ptah-authored half — R3.1.
   *
   * ⚠️ IT READS `LiveFeedService`, NOT PRISMA. That service composes
   * `buildLiveSessionVisibilityWhere` and `NOT_DELETED`; a second read here
   * would be a second place `cohort` and `staff` are evaluated, and the two
   * would drift the first time either rule changed.
   *
   * ⚠️ `upcoming` AND `live` BOTH COUNT AS "NEXT". A session that started ten
   * minutes ago is more relevant to a member opening the hub than one starting
   * tomorrow, and `earliest()` orders by start instant, so a running session
   * naturally wins. Replays are excluded: a recording is not something that is
   * "next".
   */
  private async readLive(
    ctx: MemberContext,
  ): Promise<HubSessionSummary[] | null> {
    if (!this.liveFeed) {
      this.logger.warn(
        'LiveFeedService is unbound (LiveSessionsModule not registered) — ' +
          'the hub sessions card omits the live source',
      );
      return null;
    }

    try {
      const feed = await this.liveFeed.read(ctx, { pageSize: 1 });
      return [...feed.live, ...feed.upcoming].map(toLiveSummary);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Live sessions unavailable for user ${ctx.userId} (${message}) — the ` +
          `hub sessions card omits the live source`,
      );
      return null;
    }
  }

  /**
   * This member's own next ACCEPTED private session — R4.
   *
   * ⚠️ `status === 'scheduled'` ONLY. A `pending` request has no time and no
   * Meet link; putting it on a card that says "your next session" would promise
   * something no admin has agreed to. A `canceled` or `completed` one is not
   * next by definition.
   *
   * ⚠️ AND ONLY FUTURE ONES. `scheduledAt` in the past is a session that has
   * happened; `earliest()` would otherwise pin a member's card to a call from
   * last month, because a past instant is earlier than every future one.
   */
  private async readPrivate(
    ctx: MemberContext,
  ): Promise<HubSessionSummary[] | null> {
    if (!this.sessionRequests) {
      this.logger.warn(
        'SessionRequestsService is unbound (GoogleSessionsModule not ' +
          'registered) — the hub sessions card omits the private source',
      );
      return null;
    }

    try {
      const own = await this.sessionRequests.listOwn(ctx);
      const now = Date.now();
      return own
        .filter(
          (request) =>
            request.status === 'scheduled' &&
            request.scheduledAt !== null &&
            Date.parse(request.scheduledAt) >= now,
        )
        .map(toPrivateSummary);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Private sessions unavailable for user ${ctx.userId} (${message}) — ` +
          `the hub sessions card omits the private source`,
      );
      return null;
    }
  }
}

/**
 * The earliest session by start time, or `null`.
 *
 * ⚠️ SORTED HERE RATHER THAN TRUSTED, AND THIS BATCH IS WHY. Phase 1's docblock
 * predicted it: "a future merge (Batch 12 folds `LiveSession` rows and accepted
 * private sessions into this same slot) will concatenate two ordered lists into
 * an unordered one". That is now three ordered lists, concatenated. "Next
 * upcoming" is the section's entire meaning, so it is computed, not assumed.
 *
 * Entries with an unparseable `startsAt` are skipped rather than compared: a
 * `NaN` in a comparator makes the ordering non-transitive and can hand back an
 * arbitrary element, which would silently show the WRONG session.
 */
function earliest(
  sessions: readonly HubSessionSummary[],
): HubSessionSummary | null {
  let best: HubSessionSummary | null = null;
  let bestAt = Number.POSITIVE_INFINITY;

  for (const session of sessions) {
    const at = Date.parse(session.startsAt);
    if (!Number.isFinite(at)) continue;
    if (at < bestAt) {
      best = session;
      bestAt = at;
    }
  }
  return best;
}

/**
 * `BuildersSession` (the Calendar-shaped internal type) → `HubSessionSummary`.
 *
 * `recurring` is deliberately DROPPED. It is a Calendar implementation detail
 * that the other two kinds have no analogue for, and NFR-S4/S5 say a
 * member-facing response carries what the surface renders and nothing else.
 */
function toCalendarSummary(session: BuildersSession): HubSessionSummary {
  return {
    id: session.id,
    kind: 'calendar',
    title: session.title,
    startsAt: session.startsAt,
    endsAt: session.endsAt || null,
    meetLink: session.meetLink,
    youtubeVideoId: null,
  };
}

/**
 * A `LiveFeedItem` → `HubSessionSummary`.
 *
 * ⚠️ THE TWO ARE UNRELATED TYPES AND THIS IS THE ONLY BRIDGE BETWEEN THEM.
 * `AdminLiveSession`'s docblock explains why relating them by `extends` would be
 * wrong rather than merely risky: a feed item carries a server-derived `state`
 * and a `source`, a card carries a `kind`, and the two vocabularies range over
 * different sets. A mapper is the honest translation; inheritance would make a
 * private session representable in a feed.
 *
 * `state` and `durationSeconds` are dropped — a card is not a player — and
 * `source` becomes `kind: 'live'`, which is what the client switches on.
 */
function toLiveSummary(item: {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  meetLink: string | null;
  youtubeVideoId: string | null;
}): HubSessionSummary {
  return {
    id: item.id,
    kind: 'live',
    title: item.title,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    meetLink: item.meetLink,
    youtubeVideoId: item.youtubeVideoId,
  };
}

/**
 * A `MemberSessionRequest` → `HubSessionSummary`.
 *
 * ⚠️ THE SOURCE IS ALREADY THE MEMBER-FACING SHAPE, which is the point of
 * reading through `listOwn` rather than the admin queue: `toMemberSessionRequest`
 * is the NFR-S4 chokepoint, so nothing this mapper can reach carries a requester
 * identity or a billing internal — there is no `userId` on its input to leak.
 *
 * ⚠️ `endsAt` IS RECONSTRUCTED FROM `durationMinutes`, not stored. The request
 * row has no end column; it has a start and a length precisely so the end is
 * derivable, and a card that showed no end for a private session and an end for
 * every other kind would look like missing data.
 *
 * ⚠️ `title` IS THE TOPIC, and it is the only thing there is. A private session
 * has no admin-authored title — the member chose a topic and wrote notes, and
 * the notes are theirs rather than a heading.
 */
function toPrivateSummary(request: {
  id: string;
  sessionTopicId: string;
  scheduledAt: string | null;
  durationMinutes: number | null;
  meetLink: string | null;
}): HubSessionSummary {
  const startsAt = request.scheduledAt ?? '';
  const endsAt =
    request.scheduledAt !== null && request.durationMinutes !== null
      ? new Date(
          Date.parse(request.scheduledAt) + request.durationMinutes * 60 * 1000,
        ).toISOString()
      : null;

  return {
    id: request.id,
    kind: 'private',
    title: request.sessionTopicId,
    startsAt,
    endsAt,
    meetLink: request.meetLink,
    youtubeVideoId: null,
  };
}
