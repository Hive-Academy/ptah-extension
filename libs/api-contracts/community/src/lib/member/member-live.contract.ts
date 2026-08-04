import { z } from 'zod';

/**
 * MEMBER-facing live/scheduled session contracts.
 *
 * ⚠️ No `admin/*` type may `extend` anything here, and nothing here may extend
 * an `admin/*` type. `contract-boundary.spec.ts` enforces both directions.
 *
 * PHASE 1 SCOPE. Only {@link HubSessionSummary} is declared — the hub's
 * `sessions` section, and the ONE section that is genuinely populated in Phase 1
 * (from Google Calendar). `LiveFeedItem` and the replay list are added by
 * Batch 12 (P4-BE), in THIS file.
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
