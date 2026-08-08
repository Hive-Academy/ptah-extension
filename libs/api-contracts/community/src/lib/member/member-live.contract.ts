import { z } from 'zod';

import { pagedSchema, type Paged } from '../shared/paged';

/**
 * MEMBER-facing live/scheduled session contracts.
 *
 * ⚠️ No `admin/*` type may `extend` anything here, and nothing here may extend
 * an `admin/*` type. `contract-boundary.spec.ts` enforces both directions.
 *
 * PHASE 4 (Batch 12) COMPLETED THIS FILE, exactly where Phase 1 said it would.
 * {@link HubSessionSummary} is the hub's one-card `sessions` section;
 * {@link LiveFeedItem} and {@link MemberLiveResponse} are the full
 * `GET /v1/members/live` surface. The two are DELIBERATELY UNRELATED TYPES —
 * see {@link LiveFeedItem}'s docblock for why the hub card is not a
 * `LiveFeedItem`.
 */

/**
 * Where the session came from.
 *
 * All three values are declared NOW even though Phase 1 only ever emits
 * `'calendar'`. That is the point: Phase 4 merges `LiveSession` rows and
 * accepted private sessions into the same hub slot, and it must do so WITHOUT
 * changing the envelope (R6.6). Declaring the discriminant up front makes that
 * a data change; discovering it in Phase 4 would make it a contract change.
 */
export const HUB_SESSION_KINDS = ['calendar', 'live', 'private'] as const;

/**
 * - `calendar` — an existing Google Calendar cohort session (Phase 1).
 * - `live`     — a Ptah-scheduled `LiveSession` stream (Phase 4, R3.1).
 * - `private`  — this member's own ACCEPTED private session (Phase 4, R4).
 */
export type HubSessionKind = (typeof HUB_SESSION_KINDS)[number];

/**
 * The single next upcoming session for this member — the hub's `sessions`
 * section (R6.1 "next upcoming live or private session").
 *
 * ⚠️ SINGULAR. The hub answers "what is next", not "show me the calendar".
 * The full feed is `GET /v1/members/live`.
 *
 * ⚠️ When Google OAuth is unconfigured this section reports
 * `{ status: 'unavailable', data: null }` and the hub still returns `200`
 * (R6.4, NFR-R1/R3). A disabled Calendar integration must never blank the home
 * screen, and it must never surface as an error to the member (R3.6).
 */
export interface HubSessionSummary {
  /**
   * Opaque and NOT globally unique across kinds — a Calendar event id, a
   * `LiveSession` cuid or a `SessionRequest` uuid. Pair it with {@link kind}
   * before using it as a key.
   */
  id: string;
  kind: HubSessionKind;
  title: string;
  /** ISO 8601. */
  startsAt: string;
  /** ISO 8601, or `null` when the source records no end. */
  endsAt: string | null;
  /**
   * Resolved from the event's `hangoutLink` / `conferenceData` (R4.1, PRE-5).
   * NEVER from a Meet API — none is called and none is built. `null` when the
   * event carries no conference.
   */
  meetLink: string | null;
  /**
   * The unlisted stream id for a `kind: 'live'` session (R3.1). Always `null`
   * for `'calendar'` and `'private'`. Declared in Phase 1 so Phase 4 adds data,
   * not a field.
   */
  youtubeVideoId: string | null;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const hubSessionSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(HUB_SESSION_KINDS),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  meetLink: z.string().nullable(),
  youtubeVideoId: z.string().nullable(),
}) satisfies z.ZodType<HubSessionSummary>;

/* -------------------------------------------------------------------------- */
/* Phase 4 — the full Live feed (R3, AD-3, plan §3.5)                          */
/* -------------------------------------------------------------------------- */

/**
 * WHICH SYSTEM PRODUCED THIS ITEM — AD-3's discriminant.
 *
 * - `ptah`     — a `LiveSession` row we own. It may ALSO claim a Google
 *                Calendar event (`LiveSession.calendarEventId`), in which case
 *                the Calendar's `meetLink` is merged in and the event is NOT
 *                emitted a second time as `'calendar'`.
 * - `calendar` — a Google Calendar cohort session that no `LiveSession` claims.
 *
 * ⚠️ R3.3 SAYS THE MEMBER MUST NOT NEED TO KNOW WHICH SYSTEM PRODUCED AN ITEM.
 * That is a statement about the RENDERED SURFACE, not about this field. The
 * discriminant is here because the two sources carry genuinely different
 * capabilities — only a `ptah` item can have a replay attached — and because a
 * feed that could not tell them apart could not de-duplicate them either. The
 * client is expected to use it for behaviour, not for a "source: Google" badge.
 */
export const LIVE_SOURCES = ['ptah', 'calendar'] as const;
export type LiveSource = (typeof LIVE_SOURCES)[number];

export function isLiveSource(value: unknown): value is LiveSource {
  return (
    typeof value === 'string' &&
    (LIVE_SOURCES as readonly string[]).includes(value)
  );
}

/**
 * WHERE THIS ITEM SITS RELATIVE TO NOW.
 *
 * 🔴 DERIVED SERVER-SIDE FROM A SINGLE CLOCK READ, NEVER RECOMPUTED BY THE
 * CLIENT. Two independent clocks produce a feed where an item is `'live'` in
 * one place and `'upcoming'` in another on the same screen, and the
 * disagreement is invisible in every test that fixes one of them.
 *
 * - `upcoming` — starts in the future.
 * - `live`     — started, and has not ended. A session with no `endsAt` is
 *                treated as live for a bounded fallback window rather than for
 *                ever; the server owns that constant.
 * - `replay`   — over. An item is only ever `'replay'` when there is something
 *                to replay, which is why a past session with no recording drops
 *                out of the feed rather than appearing as an empty `'replay'`.
 */
export const LIVE_STATES = ['upcoming', 'live', 'replay'] as const;
export type LiveState = (typeof LIVE_STATES)[number];

export function isLiveState(value: unknown): value is LiveState {
  return (
    typeof value === 'string' &&
    (LIVE_STATES as readonly string[]).includes(value)
  );
}

/**
 * One entry in the merged Live feed — `GET /v1/members/live` (AD-3, R3.3).
 *
 * ⚠️ THIS IS NOT A WIDER {@link HubSessionSummary} AND MUST NOT BECOME ONE.
 * The two answer different questions: the hub card answers "what is next",
 * singular, across three KINDS including this member's own private session; a
 * feed item answers "what is on the schedule", plural, across two SOURCES and
 * never including a private session. Their discriminants (`kind` vs `source`)
 * are different vocabularies over different sets — relating them by `extends`
 * or by widening one union would make a private session representable in a feed
 * that must never contain another member's, and would put a `state` on a card
 * that has no notion of replays.
 *
 * ⚠️ `id` IS NOT GLOBALLY UNIQUE ACROSS SOURCES — a `LiveSession` cuid or a
 * Google Calendar event id. Pair it with {@link source} before using it as a
 * key, exactly as {@link HubSessionSummary.id} must be paired with `kind`.
 */
export interface LiveFeedItem {
  id: string;
  source: LiveSource;
  state: LiveState;
  title: string;
  /** ISO 8601. */
  startsAt: string;
  /** ISO 8601, or `null` when the source records no end. */
  endsAt: string | null;
  /**
   * The unlisted stream id (R3.1) or, for a past session, the recording
   * (R3.4). `null` for a calendar-sourced item with no stream.
   *
   * ⚠️ ONE FIELD, RESOLVED SERVER-SIDE, NOT A `youtubeVideoId` +
   * `replayYoutubeVideoId` PAIR. `LiveSession` stores both separately — so a
   * re-uploaded recording cannot overwrite the stream reference — but a client
   * rendering a player wants THE video for the state it is in, and choosing
   * between two ids per item is a branch every consumer would have to
   * reimplement identically.
   */
  youtubeVideoId: string | null;
  /**
   * Resolved from the event's `hangoutLink` / `conferenceData` (R4.1, PRE-5) —
   * NEVER from a Meet API, none of which is called and none of which is built.
   * `null` for a ptah-sourced item that claims no calendar event.
   */
  meetLink: string | null;
  /** Persisted video duration. `null` when no metadata was ever resolved. */
  durationSeconds: number | null;
}

export const liveFeedItemSchema = z.object({
  id: z.string(),
  source: z.enum(LIVE_SOURCES),
  state: z.enum(LIVE_STATES),
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  youtubeVideoId: z.string().nullable(),
  meetLink: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
}) satisfies z.ZodType<LiveFeedItem>;

/**
 * The whole `GET /v1/members/live` response (plan §3.5).
 *
 * ⚠️ THREE LISTS, AND ONLY ONE OF THEM IS PAGED. `upcoming` and `live` are
 * bounded by the schedule itself — there are never many — while `replays`
 * accumulates for ever and is the only one that needs {@link Paged}. Paging all
 * three uniformly would put a page cursor on two lists that can never have a
 * second page, and the client would have to decide, per list, whether to
 * believe `hasMore`.
 *
 * 🔴 `calendarAvailable` IS AN ENVELOPE FIELD, NOT A PER-ITEM ONE, AND IT IS
 * THE WHOLE OF R3.6. When `GOOGLE_OAUTH_*` is unset — which is the default
 * state of a development workspace and a legitimate production posture — the
 * Calendar half of the merge contributes nothing, this flag is `false`, and the
 * surface STILL RENDERS the Ptah-sourced sessions with NO ERROR SHOWN TO THE
 * MEMBER. A per-item flag could not express this, because the items that are
 * missing are precisely the ones that would have carried it.
 *
 * ⚠️ IT ALSO COVERS "CONFIGURED BUT DID NOT ANSWER". `false` means "we do not
 * have a Calendar answer", not "Google is switched off" — the same conflation
 * `SessionsSection` makes deliberately, and for the same reason: the member
 * needs to know the list may be incomplete, and the operator needs to know why,
 * which is what the server log is for.
 */
export interface MemberLiveResponse {
  upcoming: LiveFeedItem[];
  live: LiveFeedItem[];
  replays: Paged<LiveFeedItem>;
  calendarAvailable: boolean;
}

export const memberLiveResponseSchema = z.object({
  upcoming: z.array(liveFeedItemSchema),
  live: z.array(liveFeedItemSchema),
  replays: pagedSchema(liveFeedItemSchema),
  calendarAvailable: z.boolean(),
}) satisfies z.ZodType<MemberLiveResponse>;
