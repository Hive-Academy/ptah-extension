/**
 * Forum post reactions — R1.4.3.
 *
 * A FIXED, SMALL, SERVER-DEFINED SET. R1.4.3 forbids free-form emoji input,
 * so this tuple is the whole vocabulary: the API rejects anything not in it
 * (`400`, via `ParseEnumPipe` on `PUT posts/:id/reactions/:type`), and the UI
 * renders exactly these four buttons by iterating it.
 *
 * ⚠️ A reaction type is a WIRE VALUE, not a display string. Adding a member
 * here changes the API's accepted input set and the stored `PostReaction.type`
 * domain; it is a contract change, not a copy change. Labels and icons belong
 * in the frontend, keyed off these values.
 *
 * Reactions apply to forum posts ONLY (A-8). Lesson comments use the separate
 * `answered` flag (R2.5.3) and must not grow a parallel reaction mechanism.
 */

/** The runtime list, in the order the UI renders them. */
export const REACTION_TYPES = [
  'like',
  'insightful',
  'celebrate',
  'thanks',
] as const;

export type ReactionType = (typeof REACTION_TYPES)[number];

/**
 * Per-type reaction counts for one post (R1.4.2).
 *
 * ⚠️ TOTAL, not partial — every type is present, zero-valued when unreacted.
 * A sparse map would force every renderer to write `counts[t] ?? 0`, and the
 * one that forgot would render `undefined`.
 *
 * Counts are DERIVED from stored `PostReaction` rows (R1.4.4). A denormalised
 * counter is permitted only behind a consistency test and is not required at
 * the §1.3 scale — `Topic.postCount` is the single denormalisation this design
 * allows (AD-11).
 */
export type ReactionCounts = Record<ReactionType, number>;

/** Runtime narrowing for a `:type` path segment or a persisted column. */
export function isReactionType(value: unknown): value is ReactionType {
  return (REACTION_TYPES as readonly unknown[]).includes(value);
}
