import type { Visibility } from '../shared/visibility';

/**
 * ADMIN-facing live-session contract — R3, R8, plan §2.10, §3.5.
 *
 * ⚠️ THE THIRD RK-8 PAIR. {@link AdminLiveSession} and the member-side
 * `LiveFeedItem` (`../member/member-live.contract.ts`) are adjacent,
 * independent declarations with NO `extends` between them, for the same reason
 * `MemberPack`/`AdminPack` and `MemberSessionRequest`/`AdminSessionRequest`
 * are. `contract-boundary.spec.ts` enforces it in both directions.
 *
 * ⚠️ NOTE WHAT THIS FILE DOES **NOT** IMPORT. `Visibility` comes from
 * `../shared/visibility`, not from any member contract that also uses it — a
 * string union is a VOCABULARY and lives in `shared/`; an object type is a
 * PAYLOAD and is re-declared on each side.
 *
 * ⚠️ AND THE TWO ARE NOT EVEN THE SAME SHAPE OF THING, WHICH IS WHY
 * INHERITANCE WOULD HAVE BEEN WRONG RATHER THAN MERELY RISKY. A
 * `LiveFeedItem` is a MERGE PRODUCT — it may have been produced from a Google
 * Calendar event that has no row in our database at all, it carries a
 * server-derived `state` and a single resolved `youtubeVideoId`. An
 * `AdminLiveSession` is a ROW: it always exists, it has no `state` (an admin
 * edits a schedule, they do not watch it), and it keeps the stream id and the
 * replay id apart because editing one must not overwrite the other. There is no
 * subset relation in either direction to express.
 */

/**
 * One `live_sessions` row as the authoring surface sees it —
 * `GET /v1/admin/live-sessions` and the body returned by create / update /
 * delete / restore.
 *
 * ⚠️ EVERYTHING HERE THAT IS NOT ON `LiveFeedItem` IS DELIBERATE:
 *   - {@link visibility} / {@link cohortKeys} — the gate itself. A member never
 *     receives the rule that decided whether they may see something; they
 *     receive the things they may see.
 *   - {@link replayYoutubeVideoId} — kept separate from {@link youtubeVideoId}
 *     so a re-uploaded recording does not overwrite the stream reference
 *     (R3.4). The member feed resolves the pair down to one id per item.
 *   - {@link calendarEventId} — the internal Google handle claimed under AD-3.
 *     Its `@unique` index is what makes "two live sessions claiming one event"
 *     unrepresentable, and it is what the feed de-duplicates on.
 *   - the `video*` block — provenance for the authoring UI, so an admin can
 *     tell metadata that came from the Data API from metadata they typed
 *     themselves when `YOUTUBE_API_KEY` was unset.
 *   - {@link deletedAt} / {@link deletedBy} — the R8.5 restore window. A member
 *     surface never sees a tombstone at all.
 */
export interface AdminLiveSession {
  id: string;
  title: string;
  description: string | null;
  /** ISO 8601. */
  startsAt: string;
  /** ISO 8601, or `null` when the session records no end. */
  endsAt: string | null;
  visibility: Visibility;
  /**
   * AD-10: a `String[]` column, not a join table. Empty unless
   * {@link visibility} is `'cohort'`.
   */
  cohortKeys: string[];
  /**
   * Display labels for {@link cohortKeys}, resolved from `MemberGroup.name`.
   *
   * ⚠️ A KEY THAT NAMES NO GROUP RESOLVES TO NOTHING AND IS THE REASON THIS
   * FIELD EXISTS. `cohortKeys` has no foreign key, so a typo saves cleanly and
   * produces a session visible to nobody; showing the admin the resolved NAMES
   * beside the raw keys is what makes that visible in the surface rather than
   * in a support ticket.
   */
  cohortNames: string[];
  /** R3.1 — the scheduled unlisted stream. */
  youtubeVideoId: string | null;
  /** R3.4 — the recording. Often the same id; never the same field. */
  replayYoutubeVideoId: string | null;
  videoTitle: string | null;
  videoDurationSeconds: number | null;
  videoThumbnailUrl: string | null;
  /** ISO 8601. */
  videoMetadataFetchedAt: string | null;
  /** `'api'` | `'manual'` — `'manual'` is the `YOUTUBE_API_KEY`-unset path. */
  videoMetadataSource: string | null;
  /** AD-3. `null` when this session claims no Google Calendar event. */
  calendarEventId: string | null;
  /** The admin `User.id` that created the row. */
  createdBy: string | null;
  /** ISO 8601. Non-null means this row is a tombstone. */
  deletedAt: string | null;
  /** The admin `User.id` that soft-deleted it. */
  deletedBy: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}
