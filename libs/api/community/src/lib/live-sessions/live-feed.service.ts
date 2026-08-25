import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService, type Prisma } from '@ptah-api/core';
import type { MemberContext } from '@ptah-api/membership';
import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  type LiveFeedItem,
  type LiveState,
  type MemberLiveResponse,
} from '@ptah-contracts/community';

import { SessionsService } from '../google-sessions/sessions.service';
import type { CalendarFeedEvent } from '../google-sessions/google-sessions.types';

import { buildLiveSessionVisibilityWhere } from './common/visibility';
import { NOT_DELETED } from './common/soft-delete';
import {
  LIVE_FALLBACK_MS,
  deriveLiveState,
  type LiveStateInput,
} from './live-feed-state';
import type { LiveSessionRow } from './live-sessions.service';

/**
 * ⚠️ NO LOCAL PAGE-SIZE CONSTANTS. `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE` and
 * `FIRST_PAGE` are single-sourced in `@ptah-contracts/community` so the DTO's
 * `@Max(MAX_PAGE_SIZE)`, the client's request builder and this read cannot drift
 * into three different numbers.
 *
 * 🔴 AND THIS SERVICE DOES NOT CLAMP. `MAX_PAGE_SIZE`'s own docblock is explicit
 * that an over-large `pageSize` is REJECTED with a `400` by the DTO and is NOT
 * silently clamped — "a silent clamp makes a client that asked for 500 rows
 * believe it received all of them and quietly drop the tail". A defensive clamp
 * here would re-introduce exactly that behaviour behind the DTO's back, so the
 * defaults below are applied and the bounds are trusted, the way
 * `libs/api/forum/src/lib/common/pagination.ts` trusts them.
 */

/**
 * `LiveFeedService` — the MEMBER read model for `GET /v1/members/live`
 * (AD-3, R3.3, R3.4, R3.6, plan §3.5).
 *
 * Folds two sources into one feed: `LiveSession` rows we own, and the Google
 * Calendar cohort sessions `SessionsService` already serves. R3.3 says the
 * member must not need to know which system produced an item — that is a
 * statement about the RENDERED surface, and it is only achievable if the SERVER
 * has already merged and de-duplicated them.
 *
 * ── 🔴 RISK-V: THE CLAIM SET MATCHES BOTH `id` AND `recurringEventId` ───────
 *
 * A `LiveSession` may CLAIM a Calendar event (`calendarEventId`, AD-3), and a
 * claimed event must be emitted EXACTLY ONCE — as `source: 'ptah'`, with the
 * Calendar's `meetLink` merged in.
 *
 * `listEvents` requests `singleEvents=true`, so Google expands recurrences and
 * members receive INSTANCES whose ids differ from the master series id an admin
 * copied into `calendarEventId`. Comparing only `event.id` therefore
 * de-duplicates NOTHING for a recurring series: the claiming `LiveSession`
 * appears, and so does every occurrence, and the member sees each session twice.
 * `SessionsService.scopeToCohort` documents the identical trap for cohort
 * scoping and matches both fields; this does the same. The spec carries a
 * fixture whose `id !== recurringEventId` and the arm is proven load-bearing by
 * deliberate failure.
 *
 * ── 🔴 R3.6: THE CALENDAR HALF DEGRADES, IT NEVER ERRORS ────────────────────
 *
 * `GOOGLE_OAUTH_*` unset is the DEFAULT state of this workspace and a legitimate
 * production posture (ASSUMPTION-10). The Calendar half then contributes
 * nothing, `calendarAvailable` is `false`, and the surface still renders every
 * Ptah-sourced session with NO ERROR SHOWN TO THE MEMBER. The reason is logged;
 * it is never surfaced. `SessionsService` is `@Optional()`-injected for the same
 * reason `SessionsSection` injects it that way — an unregistered
 * `GoogleSessionsModule` degrades this flag rather than failing module
 * construction and taking the whole surface with it.
 *
 * ⚠️ `calendarAvailable: false` MEANS "WE DO NOT HAVE A CALENDAR ANSWER", NOT
 * "GOOGLE IS SWITCHED OFF". Both non-answers (`disabled`, `fetch_failed`)
 * collapse into it, deliberately: the member needs to know the list may be
 * incomplete, and the operator needs to know why, which is what the log is for.
 *
 * ── 🔴 THIS FILE MUST NOT IMPORT `@ptah-api/youtube` (NFR-P6) ───────────────
 * Every video field it emits is a PERSISTED column written at authoring time by
 * `LiveSessionsService`. A member opening this feed makes zero third-party
 * calls. `live-sessions.module.spec.ts` asserts the importer set by name.
 *
 * ── ONE CLOCK READ PER REQUEST (RISK-W) ────────────────────────────────────
 * `now` is captured once in {@link read} and threaded into every classification
 * AND into both `where` clauses, so no item can be `'live'` in one list and
 * `'replay'` in another on the same screen.
 */
@Injectable()
export class LiveFeedService {
  private readonly logger = new Logger(LiveFeedService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    // Optional for the same reason `SessionsSection` injects it optionally: an
    // unregistered GoogleSessionsModule must degrade `calendarAvailable` to
    // `false`, not fail this module's construction.
    @Optional()
    @Inject(SessionsService)
    private readonly sessions?: SessionsService,
  ) {}

  /**
   * The whole `GET /v1/members/live` envelope.
   *
   * FOUR DATABASE QUERIES AND AT MOST ONE CALENDAR CALL, whatever the size of
   * the archive:
   *   1. every visible session that has NOT yet ended (upcoming + live);
   *   2. one page of ended sessions that have a replay;
   *   3. the total for that page's `hasMore`;
   *   4. — and the Calendar list, issued IN PARALLEL with (1).
   *
   * ⚠️ THE POSTGRES READ AND THE CALENDAR READ RUN CONCURRENTLY, and the
   * Calendar half cannot fail the request: `readUpcomingCalendarFeed` is
   * non-throwing by contract, so `Promise.all` here is safe in a way it would
   * not be against a throwing collaborator.
   */
  async read(
    ctx: MemberContext,
    page: ReplayPageInput = {},
  ): Promise<MemberLiveResponse> {
    // 🔴 ONE CLOCK READ. Everything below is classified against this instant.
    const now = new Date();
    const visibility = buildLiveSessionVisibilityWhere(ctx);

    const [current, calendar] = await Promise.all([
      this.prisma.liveSession.findMany({
        where: {
          ...NOT_DELETED,
          // 🔴 `AND`, NOT TWO SPREADS. `buildLiveSessionVisibilityWhere`
          // returns `{ OR: branches }` and the window below is ALSO an `OR`, so
          // spreading both into one object silently DROPS the visibility
          // clause — the second `OR` key wins and every member sees every
          // cohort and staff session. `live-feed.service.spec.ts` caught
          // exactly that during this batch; the assertion that both reads carry
          // a `hasSome` branch is what keeps it caught.
          AND: [visibility, notEndedAt(now)],
        },
        orderBy: [{ startsAt: 'asc' }],
      }),
      this.readCalendar(ctx),
    ]);

    // ── The AD-3 claim set (RISK-V) ──────────────────────────────────────
    // Built from the sessions in play, keyed by the id they claim. A calendar
    // event is dropped when EITHER its own id OR its master series id is
    // claimed, and the claiming session inherits that event's Meet link.
    const claims = new Map<string, LiveSessionRow>();
    for (const session of current) {
      if (session.calendarEventId !== null) {
        claims.set(session.calendarEventId, session);
      }
    }

    const meetLinkBySessionId = new Map<string, string | null>();
    const unclaimedEvents: CalendarFeedEvent[] = [];
    for (const event of calendar.events) {
      // 🔴 BOTH ARMS. Dropping the second one is the RISK-V regression, and the
      // spec proves it by deliberate failure.
      const claimant =
        claims.get(event.id) ??
        (event.recurringEventId !== null
          ? claims.get(event.recurringEventId)
          : undefined);

      if (claimant === undefined) {
        unclaimedEvents.push(event);
        continue;
      }

      // ⚠️ FIRST LINK WINS, and for a recurring series that is the EARLIEST
      // occurrence — the events arrive in start order. A claimed series shares
      // one Meet link across its occurrences in practice, but "whichever
      // occurrence we merged last" would be an arbitrary answer where this one
      // is at least a stated one.
      if (!meetLinkBySessionId.has(claimant.id) && event.meetLink !== null) {
        meetLinkBySessionId.set(claimant.id, event.meetLink);
      }
    }

    const upcoming: LiveFeedItem[] = [];
    const live: LiveFeedItem[] = [];

    for (const session of current) {
      const item = toPtahItem(
        session,
        now,
        meetLinkBySessionId.get(session.id) ?? null,
      );
      if (item === null) continue;
      if (item.state === 'upcoming') upcoming.push(item);
      else if (item.state === 'live') live.push(item);
    }

    for (const event of unclaimedEvents) {
      const item = toCalendarItem(event, now);
      if (item === null) continue;
      if (item.state === 'upcoming') upcoming.push(item);
      else if (item.state === 'live') live.push(item);
    }

    // ⚠️ SORTED AFTER THE MERGE, NOT TRUSTED. Both sources arrive ordered and
    // the concatenation of two ordered lists is not ordered — the same reason
    // `SessionsSection.earliest()` computes rather than assumes.
    upcoming.sort(byStartAscending);
    // Live sessions read newest-first: the one that started most recently is
    // the one a member arriving now is most likely to want.
    live.sort((a, b) => byStartAscending(b, a));

    return {
      upcoming,
      live,
      replays: await this.readReplays(ctx, now, page),
      calendarAvailable: calendar.available,
    };
  }

  /**
   * The paged replay archive — ended sessions that have a recording (R3.4).
   *
   * ⚠️ PTAH-SOURCED ONLY, AND THAT IS NOT AN OVERSIGHT. A replay is a
   * `replayYoutubeVideoId` on a `LiveSession`; a Google Calendar event carries
   * no recording and `SessionsService` only reads FORWARD from now, so there is
   * no calendar-sourced past to page through. The archive is therefore a pure
   * Postgres read and pages deterministically — which a merged, partly-remote
   * list could not.
   *
   * ⚠️ `hasMore` COMES FROM A `count` UNDER THE SAME `where`, NOT FROM
   * `rows.length === take`. The latter reports "no more" for an archive whose
   * size is an exact multiple of the page size.
   */
  private async readReplays(
    ctx: MemberContext,
    now: Date,
    page: ReplayPageInput,
  ): Promise<MemberLiveResponse['replays']> {
    const pageSize = page.pageSize ?? DEFAULT_PAGE_SIZE;
    const pageNumber = page.page ?? FIRST_PAGE;

    // 🔴 `AND`, NOT TWO SPREADS — see the note in {@link read}.
    const where = {
      ...NOT_DELETED,
      replayYoutubeVideoId: { not: null },
      AND: [buildLiveSessionVisibilityWhere(ctx), endedAt(now)],
    };

    const [rows, total] = await Promise.all([
      this.prisma.liveSession.findMany({
        where,
        orderBy: [{ startsAt: 'desc' }],
        skip: (pageNumber - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.liveSession.count({ where }),
    ]);

    return {
      items: rows
        .map((row) => toPtahItem(row, now, null))
        .filter((item): item is LiveFeedItem => item !== null),
      total,
      page: pageNumber,
      pageSize,
      hasMore: pageNumber * pageSize < total,
    };
  }

  /**
   * The Calendar half — never throws, never surfaces (R3.6).
   *
   * Returns `available: false` with an EMPTY event list for every non-answer:
   * the module being unregistered, `GOOGLE_OAUTH_*` being unset, and a Calendar
   * request that failed. All three mean "we do not have a Calendar answer", and
   * the member is shown the Ptah-sourced feed with no error either way.
   */
  private async readCalendar(
    ctx: MemberContext,
  ): Promise<{ available: boolean; events: CalendarFeedEvent[] }> {
    if (!this.sessions) {
      this.logger.warn(
        'SessionsService is unbound (GoogleSessionsModule not registered) — ' +
          'the live feed reports calendarAvailable: false and serves the ' +
          'Ptah-sourced sessions only',
      );
      return { available: false, events: [] };
    }

    const result = await this.sessions.readUpcomingCalendarFeed(ctx.userId);
    if (!result.ok) {
      this.logger.warn(
        `Calendar sessions unavailable for user ${ctx.userId} ` +
          `(${result.reason}) — the live feed degrades to Ptah-sourced ` +
          `sessions and shows the member no error (R3.6)`,
      );
      return { available: false, events: [] };
    }

    return { available: true, events: result.events };
  }
}

/* -------------------------------------------------------------------------- */
/* Mappers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A `LiveSession` row as a feed item, or `null` when it must not appear at all
 * (over, with nothing to replay).
 *
 * 🔴 `youtubeVideoId` IS RESOLVED PER STATE, WHICH IS THE WHOLE REASON THE
 * CONTRACT CARRIES ONE FIELD RATHER THAN TWO. The row keeps the stream id and
 * the replay id apart so a re-uploaded recording cannot overwrite the stream
 * reference (R3.4); a client rendering a player wants THE video for the state
 * the item is in, and making every consumer reimplement that choice identically
 * is how they come to disagree.
 *
 * ⚠️ `meetLink` IS THE MERGED CALENDAR LINK OR `null` — never a Meet API call
 * (PRE-5). A ptah-sourced session that claims no calendar event has no Meet
 * link, and that is a true statement rather than a missing feature.
 */
export function toPtahItem(
  session: LiveSessionRow,
  now: Date,
  mergedMeetLink: string | null,
): LiveFeedItem | null {
  const state = deriveLiveState(stateInputOf(session), now);
  if (state === null) return null;

  return {
    id: session.id,
    source: 'ptah',
    state,
    title: session.title,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt?.toISOString() ?? null,
    youtubeVideoId: resolveVideoId(session, state),
    meetLink: mergedMeetLink,
    durationSeconds: session.videoDurationSeconds,
  };
}

/**
 * An unclaimed Calendar event as a feed item, or `null`.
 *
 * ⚠️ A CALENDAR EVENT HAS NO VIDEO AND NO DURATION, and both fields are `null`
 * rather than absent — the contract declares them nullable precisely so a
 * calendar item is representable without a second shape. `deriveLiveState` will
 * therefore never answer `'replay'` for one (no replay ⇒ `null` ⇒ dropped),
 * which is correct: a past meeting with no recording is not a replay.
 */
export function toCalendarItem(
  event: CalendarFeedEvent,
  now: Date,
): LiveFeedItem | null {
  const startsAt = new Date(event.startsAt);
  const endsAt = event.endsAt ? new Date(event.endsAt) : null;

  const state = deriveLiveState({ startsAt, endsAt, hasReplay: false }, now);
  if (state === null) return null;

  return {
    id: event.id,
    source: 'calendar',
    state,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    youtubeVideoId: null,
    meetLink: event.meetLink,
    durationSeconds: null,
  };
}

/** The three fields `deriveLiveState` reads, off a row. */
function stateInputOf(session: LiveSessionRow): LiveStateInput {
  return {
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    hasReplay: session.replayYoutubeVideoId !== null,
  };
}

/**
 * The ONE video id this item should play.
 *
 * `'replay'` ⇒ the recording (the state is only reachable when one exists).
 * `'upcoming'` / `'live'` ⇒ the scheduled unlisted stream, or `null`.
 */
function resolveVideoId(
  session: LiveSessionRow,
  state: LiveState,
): string | null {
  return state === 'replay'
    ? session.replayYoutubeVideoId
    : session.youtubeVideoId;
}

/** Ascending by start instant. Ties keep their relative order. */
function byStartAscending(a: LiveFeedItem, b: LiveFeedItem): number {
  return Date.parse(a.startsAt) - Date.parse(b.startsAt);
}

/**
 * "Has NOT ended at `now`", as a `where` fragment.
 *
 * 🔴 IT IS THE SAME ARITHMETIC `effectiveEnd` PERFORMS, and that is why
 * `LIVE_FALLBACK_MS` is imported rather than re-spelled: two independently
 * written boundaries is how the query and the classifier come to disagree about
 * which sessions are still running, and the disagreement shows up as a session
 * the feed fetched and then refused to classify.
 */
function notEndedAt(now: Date): Prisma.LiveSessionWhereInput {
  return {
    OR: [
      { endsAt: { gte: now } },
      {
        endsAt: null,
        startsAt: { gte: new Date(now.getTime() - LIVE_FALLBACK_MS) },
      },
    ],
  };
}

/** The exact complement of {@link notEndedAt}. */
function endedAt(now: Date): Prisma.LiveSessionWhereInput {
  return {
    OR: [
      { endsAt: { lt: now } },
      {
        endsAt: null,
        startsAt: { lt: new Date(now.getTime() - LIVE_FALLBACK_MS) },
      },
    ],
  };
}

/** Caller-supplied paging for the replay archive. */
export interface ReplayPageInput {
  readonly page?: number;
  readonly pageSize?: number;
}
