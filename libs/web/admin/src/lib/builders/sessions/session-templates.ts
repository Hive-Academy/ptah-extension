import type { MemberGroup } from '../../services/admin-api.service';

/**
 * A draggable session template shown in the calendar's palette.
 *
 * Templates are DERIVED FROM COHORTS, not stored. Every cohort already carries
 * the two things a template needs — a display name and its own recurring
 * `sessionEventId` — so a separate template table would be a second, drifting
 * copy of a list the admin already maintains under People & Community. Adding
 * a cohort adds a chip; renaming one renames its chip.
 *
 * `durationMinutes` is the one value with no cohort field behind it. It seeds
 * the drop and nothing more: the admin resizes the event or edits the form
 * afterwards, so the default being wrong costs a drag, not a re-entry.
 */
export interface SessionTemplate {
  /** Cohort key — stable, unique, and what the colour is derived from. */
  id: string;
  /** Chip label and the title the created event is seeded with. */
  title: string;
  /** Cohort display name, shown as the chip's secondary line. */
  cohortName: string;
  /** How many members this cohort has, so the palette can say who it reaches. */
  memberCount: number;
  /** Seeded event length. */
  durationMinutes: number;
  /** Whether this cohort runs its own recurring series in Google Calendar. */
  hasOwnSeries: boolean;
  /** Deterministic accent, so a cohort looks the same on every visit. */
  color: string;
}

/** Default length of a dragged-in session, in minutes. */
export const DEFAULT_TEMPLATE_DURATION_MINUTES = 60;

/**
 * Accent palette for cohort chips and their events.
 *
 * Picked to stay legible on the `operator-admin` dark surfaces and to avoid
 * both the brand amber (which the "now" indicator and primary buttons own) and
 * the info blue (which already means "protected recurring series" everywhere in
 * this feature). Reusing either would make two unrelated things look alike.
 */
const TEMPLATE_COLORS = [
  '#34d399',
  '#a78bfa',
  '#f472b6',
  '#22d3ee',
  '#fb923c',
  '#4ade80',
] as const;

/**
 * Map cohorts to palette templates, in the order the server returned them.
 *
 * Cohorts are NOT filtered by `sessionEventId`: one without its own series
 * still runs sessions (it falls back to `BUILDERS_SESSION_EVENT_ID`), so
 * hiding it would remove a chip the admin has every reason to drag. The flag is
 * surfaced on the chip instead.
 */
export function toSessionTemplates(cohorts: MemberGroup[]): SessionTemplate[] {
  return cohorts.map((cohort) => ({
    id: cohort.key,
    title: `${cohort.name} — Live Session`,
    cohortName: cohort.name,
    memberCount: cohort.memberCount,
    durationMinutes: DEFAULT_TEMPLATE_DURATION_MINUTES,
    hasOwnSeries: cohort.sessionEventId !== null,
    color: colorForKey(cohort.key),
  }));
}

/**
 * Deterministic colour for a cohort key.
 *
 * Hashed rather than index-based so a cohort keeps its colour when another is
 * added, removed, or reordered — an index would reshuffle every chip the moment
 * the list changed, and the admin would have to relearn the mapping.
 */
export function colorForKey(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return TEMPLATE_COLORS[Math.abs(hash) % TEMPLATE_COLORS.length];
}
