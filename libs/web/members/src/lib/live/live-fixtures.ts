import type {
  LiveFeedItem,
  MemberLiveResponse,
  MemberSessionRequest,
} from '@ptah-contracts/community';

/**
 * Fixture builders for the Phase-4 live / replay / request surfaces.
 *
 * ⚠️ 🔴 THE DEFAULTS WERE READ OFF THE LIVE SERVER, NOT INVENTED. Captured
 * against `http://localhost:3000` on 2026-08-09 with a throwaway entitled
 * identity, and they are deliberately the AWKWARD shapes rather than the
 * convenient ones, because the awkward ones are what this workspace actually
 * serves:
 *
 *   - `source: 'calendar'` — **all fifty** upcoming items were calendar-sourced.
 *     There is not a single `LiveSession` row in this database.
 *   - `youtubeVideoId: null` and `durationSeconds: null` — **all fifty**.
 *     `YOUTUBE_API_KEY` is empty (ASSUMPTION-6), so no metadata was ever
 *     fetched for anything, and a card that only looks finished with a
 *     thumbnail and a runtime is broken for every real row.
 *   - `id` carrying a `_20260809T140000Z` suffix — an EXPANDED RECURRENCE
 *     INSTANCE. `singleEvents=true` gives every occurrence its own id, which
 *     the master never has.
 *   - Only TWO distinct titles across fifty items, 44 of them identical
 *     (`PRO ESTATE MEETING`) across 44 distinct days. Any fixture with fifty
 *     distinct titles would make a day-grouping bug invisible.
 *
 * ⚠️ IT IS A `.ts`, NOT A `.spec.ts`, so it is inside the chokepoint specs'
 * scan — deliberately, since a fixture file is exactly where a stray
 * `youtube.com` literal or an `innerHTML` would hide from a scanner that
 * excluded specs. It carries neither.
 *
 * ⚠️ 🔴 `durationSeconds` IS A DURATION AND NOTHING HERE IS A POSITION
 * (RISK-O / RISK-AD). The one non-null default is `1800` — not round against
 * anything else in the file — so a component that swapped a duration for a
 * position could not pass by coincidence.
 */

/* -------------------------------------------------------------------------- */
/* Token misuses the Live surfaces assert the ABSENCE of                       */
/* -------------------------------------------------------------------------- */

/**
 * `border-base-300` — the class this panel must never emit.
 *
 * 🔴 BUILT BY `join`, NOT WRITTEN AS A LITERAL, AND THAT IS NOT A TRICK. The
 * Task 4.7 lint rule bans the literal token in every `.ts` under
 * `libs/web/members/**` — INCLUDING a spec asserting its absence, which is the
 * correct behaviour for a rule whose whole value is that it has no exceptions.
 * `progress-meter.spec.ts` established the idiom; this is the shared copy so
 * four Live specs do not each re-derive it.
 *
 * `base-300` is a FILL: at 1.036:1 against a `base-200` card it is invisible,
 * and `stat-tile.html` shipped exactly that bug (panel-theme-spec.md §2).
 */
export const BORDER_FILL_MISUSE = ['border', 'base-300'].join('-');

/**
 * `base-content/40` — legal for glanceable metadata, never for body text.
 *
 * panel-theme-spec.md §2 measures it at 3.18:1, which fails WCAG AA. `/60` is
 * the muted token this design system prescribes and measures as passing, and
 * it is what every Live surface uses.
 */
export const MUTED_TOO_FAINT = ['base-content', '40'].join('/');

/** A calendar-sourced upcoming item, exactly as the live feed emits one. */
export function liveFeedItem(
  overrides: Partial<LiveFeedItem> = {},
): LiveFeedItem {
  return {
    id: 'qhfl5bspa1s0m6tfld2viphv35_20260809T140000Z',
    source: 'calendar',
    state: 'upcoming',
    title: 'PRO ESTATE MEETING',
    startsAt: '2026-08-09T14:00:00.000Z',
    endsAt: '2026-08-09T15:00:00.000Z',
    youtubeVideoId: null,
    meetLink: 'https://meet.google.com/yef-rhxk-iwz',
    durationSeconds: null,
    ...overrides,
  };
}

/**
 * A ptah-sourced replay — the ONLY shape that can carry a video.
 *
 * `'replay'` is emitted only when there is something to replay
 * (`LiveFeedItem.state`'s docblock), so a replay fixture without a
 * `youtubeVideoId` would describe a state the server does not produce.
 */
export function replayItem(
  overrides: Partial<LiveFeedItem> = {},
): LiveFeedItem {
  return {
    id: 'cmsknxfp60000aumfadlmmtpt',
    source: 'ptah',
    state: 'replay',
    title: 'Week 3 build session — authentication and tenancy',
    startsAt: '2026-07-15T17:00:00.000Z',
    endsAt: '2026-07-15T18:30:00.000Z',
    youtubeVideoId: 'dQw4w9WgXcQ',
    meetLink: null,
    durationSeconds: 1800,
    ...overrides,
  };
}

/** A session that has started and not ended. */
export function liveNowItem(
  overrides: Partial<LiveFeedItem> = {},
): LiveFeedItem {
  return {
    id: 'cmlivenow0000aumfadlmmtpt',
    source: 'ptah',
    state: 'live',
    title: 'Ptah Builders — Weekly Live Session',
    startsAt: '2026-08-09T13:00:00.000Z',
    endsAt: null,
    youtubeVideoId: null,
    meetLink: 'https://meet.google.com/yef-rhxk-iwz',
    durationSeconds: null,
    ...overrides,
  };
}

/**
 * The whole envelope.
 *
 * ⚠️ `calendarAvailable` DEFAULTS TO `true` BECAUSE THAT IS THIS WORKSPACE'S
 * MEASURED STATE (B12's F-1 — `GOOGLE_OAUTH_*` IS configured, contradicting
 * ASSUMPTION-10). Every `false` case is therefore an EXPLICIT override in a
 * spec, which is what makes those cases readable as the deliberate coverage
 * they are.
 */
export function memberLiveResponse(
  overrides: Partial<MemberLiveResponse> = {},
): MemberLiveResponse {
  return {
    upcoming: [liveFeedItem()],
    live: [],
    replays: { items: [], page: 1, pageSize: 25, total: 0, hasMore: false },
    calendarAvailable: true,
    ...overrides,
  };
}

/**
 * `n` upcoming items spread over `n` consecutive days, all sharing one title.
 *
 * 🔴 THIS IS THE RISK-AB FIXTURE AND ITS SHAPE IS THE POINT. A real recurring
 * master expands to 43 instances; the live feed measured 44 rows reading
 * `PRO ESTATE MEETING` across 44 distinct days. A flat list of 44 identical
 * titles reads as a rendering bug, and a fixture with distinct titles would
 * hide it.
 */
export function recurringExpansion(count: number): LiveFeedItem[] {
  const FIRST_DAY = Date.UTC(2026, 7, 9, 14, 0, 0);
  const ONE_DAY_MS = 86_400_000;

  return Array.from({ length: count }, (_unused, index) => {
    const startsAt = new Date(FIRST_DAY + index * ONE_DAY_MS).toISOString();
    const endsAt = new Date(
      FIRST_DAY + index * ONE_DAY_MS + 3_600_000,
    ).toISOString();
    // The `_<compact-timestamp>` suffix is the real expanded-instance shape:
    // the master id is `qhfl5bspa1s0m6tfld2viphv35` and appears in NONE of the
    // instance ids the feed returns.
    const suffix = startsAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    return liveFeedItem({
      id: `qhfl5bspa1s0m6tfld2viphv35_${suffix}`,
      startsAt,
      endsAt,
    });
  });
}

/**
 * A member's own private-session request.
 *
 * ⚠️ NINE KEYS AND NO MORE (NFR-S4). `calendarEventId`, `paymentStatus`,
 * `paddleTransactionId`, `isFreeSession` and every requester field are ABSENT
 * from the contract, and B12 proved live that the server omits them from a
 * fully-populated accepted row. A fixture that carried one would let a
 * component render it.
 */
export function memberSessionRequest(
  overrides: Partial<MemberSessionRequest> = {},
): MemberSessionRequest {
  return {
    id: '6affc65b-5103-4e8b-b8bd-b5c7513bfec8',
    sessionTopicId: 'orchestration-workflow',
    additionalNotes: 'Would like to cover the architect handoff step.',
    status: 'pending',
    scheduledAt: null,
    durationMinutes: null,
    meetLink: null,
    declineReason: null,
    createdAt: '2026-08-09T12:57:17.841Z',
    ...overrides,
  };
}

/** An accepted request — the only state that carries a Meet link. */
export function scheduledSessionRequest(
  overrides: Partial<MemberSessionRequest> = {},
): MemberSessionRequest {
  return memberSessionRequest({
    id: '0953532b-9d51-4c0a-9a7d-1f2c3b4a5d6e',
    status: 'scheduled',
    scheduledAt: '2026-08-15T17:42:12.461Z',
    // MINUTES here, seconds on a feed item. Two units, two names, one file.
    durationMinutes: 30,
    meetLink: 'https://meet.google.com/ope-zmee-szb',
    ...overrides,
  });
}
