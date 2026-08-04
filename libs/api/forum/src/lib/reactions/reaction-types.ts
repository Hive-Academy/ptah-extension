import {
  REACTION_TYPES,
  isReactionType,
  type ReactionCounts,
  type ReactionType,
} from '@ptah-contracts/community';

/**
 * The fixed four reaction types, RE-EXPORTED — R1.4.3, plan §2.5.
 *
 * ⚠️ THIS FILE DECLARES NOTHING. It re-exports `REACTION_TYPES` from
 * `@ptah-contracts/community` so this lib has ONE import path for the
 * vocabulary while the vocabulary itself still has exactly one definition.
 *
 * WHY THAT MATTERS CONCRETELY. A server-side copy of `['like', 'insightful',
 * 'celebrate', 'thanks']` would compile, pass every test, and drift the first
 * time a fifth type is added: the `ParseEnumPipe` on
 * `PUT posts/:id/reactions/:type` would accept a value the wire type does not
 * declare, or reject one it does. `PostReaction.type` is a Postgres `String`,
 * not an enum (§1.3), so nothing at the database layer would catch it either.
 * The plan's §2.5 lists this file as "the fixed 4 (R1.4.3)"; making it a
 * re-export rather than a declaration is what keeps that literally true.
 *
 * ⚠️ REACTIONS APPLY TO FORUM POSTS ONLY (A-8). Lesson comments use the separate
 * `answered` flag (R2.5.3) and must not grow a parallel reaction mechanism.
 */

export { REACTION_TYPES, isReactionType };
export type { ReactionType, ReactionCounts };

/**
 * The same four values shaped as an OBJECT, because that is what
 * `ParseEnumPipe` consumes (§3.3: "`:type` via `ParseEnumPipe`").
 *
 * ⚠️ DERIVED FROM {@link REACTION_TYPES}, NEVER RE-TYPED. `ParseEnumPipe`
 * validates with `Object.values(enumType).includes(value)`, so it needs an
 * object — and hand-writing `{ like: 'like', … }` beside the tuple above would
 * reintroduce, three lines later, exactly the second copy this file's docblock
 * exists to prevent. Built from the tuple, a fifth type appears here for free
 * and cannot appear here ONLY.
 *
 * `Record<ReactionType, ReactionType>` rather than a TypeScript `enum`: an
 * `enum` is a second declaration of the vocabulary, and its members would have
 * to be kept in step by hand.
 */
export const REACTION_TYPE_ENUM: Record<ReactionType, ReactionType> =
  Object.fromEntries(REACTION_TYPES.map((type) => [type, type])) as Record<
    ReactionType,
    ReactionType
  >;

/**
 * A zero-valued, TOTAL {@link ReactionCounts} — every type present.
 *
 * Re-exported from `common/post-view.ts`, where the tombstone rule also needs
 * it, so the "counts are total, never sparse" promise has one implementation.
 */
export { emptyReactionCounts } from '../common/post-view';
