import {
  REACTION_TYPES,
  type MemberPost,
  type ReactionCounts,
  type ReactionType,
} from '@ptah-contracts/community';

import { toAuthorName, type AuthorNameSource } from './author-name';

/**
 * The `Post` row → `MemberPost` wire mapping — R1.3.5, R1.4.2, AD-9.
 *
 * ⚠️ THIS FILE IS THE ONE PLACE THE TOMBSTONE RULE IS APPLIED, AND IT IS A
 * SECURITY BOUNDARY, NOT A FORMATTING CONCERN.
 *
 * A soft-deleted post is NOT removed from the thread (R1.3.5): the row stays,
 * it keeps its `postNumber`, and its children stay attached beneath it —
 * removing it would renumber the thread and orphan every reply to it. What is
 * removed is the CONTENT: `bodyMarkdown` becomes `''` and `authorName` becomes
 * `null`, at the read model, before the row can reach a response.
 *
 * Doing this at each call site instead would mean the rule is re-implemented in
 * the thread read, in the create response, in the edit response and in every
 * later surface — and the first one that forgets ships the deleted body. So
 * every `MemberPost` in this lib is built HERE, and a `Post` row is never spread
 * into a response literal.
 *
 * ⚠️ THE WITHHELD BODY IS `''`, NOT `null`. `MemberPost.bodyMarkdown` is
 * `string`; the empty string is the documented tombstone signal (see the
 * contract). `null` would widen the wire type for every post in the product to
 * express a state that only tombstones have.
 *
 * ⚠️ NOTHING HERE RENDERS MARKDOWN. `bodyMarkdown` is raw member-authored text
 * on the wire and is rendered by `libs/frontend/markdown`'s `'member'` preset —
 * the one sanitizer (PRE-4, AD-1). A `bodyHtml` produced here would be an XSS
 * sink that bypasses that chokepoint.
 */

/** The `Post` projection this mapper needs. Nothing wider is accepted. */
export interface PostRow {
  readonly id: string;
  readonly postNumber: number;
  readonly parentId: string | null;
  readonly bodyMarkdown: string;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly authorId: string | null;
}

/** Everything the mapper needs that is not on the row itself. */
export interface PostViewContext {
  /**
   * `Topic.acceptedPostId`. Compared by identity rather than passed as a
   * boolean so a caller cannot get the flag onto the wrong post (R1.5.2 permits
   * at most one per topic, and this is where that shows up on the wire).
   */
  readonly acceptedPostId: string | null;
  /** Resolved display names by author id — see `author-name.ts`. */
  readonly authorNames: ReadonlyMap<string, string | null>;
  /** Per-post, per-type counts derived by `groupBy` (R1.4.4). */
  readonly reactions: ReadonlyMap<string, ReactionCounts>;
  /** The REQUESTING member's own reactions, by post id (R1.4.1). */
  readonly myReactions: ReadonlyMap<string, ReactionType[]>;
}

/**
 * A zero-valued, TOTAL {@link ReactionCounts}.
 *
 * Total rather than sparse (see the contract): every {@link ReactionType} key is
 * present. A renderer reading `counts.thanks` must never get `undefined`, and
 * `?? 0` at each of four call sites in the UI is the bug this prevents.
 *
 * A fresh object every call — a shared frozen constant would be aliased into
 * every post in a 25-row response, and one `counts.like++` anywhere would then
 * change all of them.
 */
export function emptyReactionCounts(): ReactionCounts {
  const counts = {} as ReactionCounts;
  for (const type of REACTION_TYPES) counts[type] = 0;
  return counts;
}

/**
 * Map one `Post` row to its member wire shape, applying the tombstone rule.
 *
 * ⚠️ A TOMBSTONE CARRIES NO REACTIONS EITHER. The stored `PostReaction` rows are
 * untouched — they simply are not reported. A removed post is not a reactable
 * object, and returning live counts on one invites the UI to render a reaction
 * bar under a body that says "this post was removed". If the post is ever
 * restored (R8.5) the counts come back with it, because nothing was deleted.
 */
export function toMemberPost(
  row: PostRow,
  context: PostViewContext,
): MemberPost {
  const deleted = row.deletedAt !== null;

  return {
    id: row.id,
    postNumber: row.postNumber,
    parentId: row.parentId,
    bodyMarkdown: deleted ? '' : row.bodyMarkdown,
    authorName: deleted
      ? null
      : row.authorId !== null
        ? (context.authorNames.get(row.authorId) ?? null)
        : null,
    accepted:
      context.acceptedPostId !== null && context.acceptedPostId === row.id,
    deleted,
    reactions: deleted
      ? emptyReactionCounts()
      : (context.reactions.get(row.id) ?? emptyReactionCounts()),
    myReactions: deleted ? [] : [...(context.myReactions.get(row.id) ?? [])],
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
  };
}

/**
 * The `authorId → name` lookup shape, built from the ONE `user.findMany` a
 * batched read performs. Re-exported here so a caller assembling a
 * {@link PostViewContext} does not have to import from two modules.
 */
export type { AuthorNameSource };
export { toAuthorName };
