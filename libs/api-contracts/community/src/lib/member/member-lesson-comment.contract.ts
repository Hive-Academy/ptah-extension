import { z } from 'zod';

/**
 * MEMBER-facing lesson comment contract — R2.5, A-8, plan §3.4.
 *
 * ⚠️ No `admin/*` type may `extend` anything here, and nothing here may extend
 * an `admin/*` type. `contract-boundary.spec.ts` enforces both directions.
 *
 * 🔴 A LESSON COMMENT IS A DISTINCT MODEL FROM A FORUM POST, AND THIS TYPE IS
 * NOT `MemberPost`. That was a Checkpoint-0 decision: no polymorphic comment
 * table shared with `Post`. The two carry the SAME one-level nesting rule
 * (R2.5.2 defers to R1.3) and the same server-side enforcement, and they are
 * otherwise different — different model, different 404 semantics, different
 * moderation surface, and, most visibly, different affordances:
 *
 * ⚠️ NO REACTIONS. A-8 gives lesson comments the "Answered" treatment INSTEAD
 * of reactions, matching the `course_learning` screens. There is no
 * `reactions`, no `myReactions`, and no import of `REACTION_TYPES` in this file
 * — nor anywhere in `@ptah-api/learning`. {@link MemberLessonComment.answered}
 * is the whole vocabulary, and it is set by an admin or the lesson's author
 * (R2.5.3), not by whoever clicks first.
 *
 * ⚠️ DEPTH IS CAPPED AT 2, SERVER-SIDE, BY REPAIR RATHER THAN REJECTION
 * (R2.5.2 → R1.3.3, RK-12). {@link MemberLessonComment.parentId} is either
 * `null` (a top-level comment) or the id of a comment whose own `parentId` is
 * `null`. A depth-3 attempt is not refused — it is re-pointed to the parent's
 * parent and saved, because a `400` there loses a member's writing over an
 * implementation detail they cannot see. So a client renders exactly two levels
 * and never has to handle a third; if it sees one, the server is broken.
 */

/**
 * One comment on a lesson — returned inside `MemberLessonDetail.comments`,
 * `POST /v1/members/lesson-comments`, `PATCH .../:id`.
 *
 * ⚠️ THE THREAD IS FLAT ON THE WIRE. Children are not nested inside their
 * parents; every comment appears once, in `createdAt` order, carrying
 * {@link parentId}. Two levels is a fixed, small depth, so the client's group-by
 * is three lines — and a flat list keeps the tombstone rule below expressible
 * without a special "deleted parent with live children" branch in the shape.
 */
export interface MemberLessonComment {
  id: string;
  /** The lesson this comment belongs to. Never crosses lessons. */
  lessonId: string;
  /** `null` for a top-level comment. See the file docblock for the depth cap. */
  parentId: string | null;
  /**
   * RAW MARKDOWN, never HTML — rendered through the `'member'` preset (PRE-4).
   *
   * ⚠️ THE EMPTY STRING IS NOT THE TOMBSTONE REPRESENTATION HERE. When
   * {@link deleted} is `true` this carries a stated placeholder sentence rather
   * than `''`: Batch 7 found that handing `''` to the markdown renderer
   * produces a silently blank row that reads as a rendering bug rather than as
   * a removal. The withheld text never reaches the wire either way.
   */
  bodyMarkdown: string;
  /**
   * Display name. `null` for a deleted comment (the tombstone withholds it),
   * and for a comment whose author's account was removed
   * (`LessonComment.author` is `onDelete: SetNull`).
   *
   * ⚠️ NAME ONLY, NEVER AN EMAIL (NFR-S4). There is no admin counterpart of
   * this type in Phase 3 — the moderation surface for lesson comments is
   * deferred — and if one is ever added it RE-DECLARES its fields rather than
   * extending this one.
   */
  authorName: string | null;
  /**
   * R2.5.3 — the "Answered" mark, set by an admin or the lesson's author.
   *
   * ⚠️ THIS IS A-8's REPLACEMENT FOR REACTIONS, NOT AN ADDITION TO THEM. It is
   * a boolean and not a count, because it answers "was this resolved" and not
   * "how popular is this".
   */
  answered: boolean;
  /**
   * A TOMBSTONE, not a removal (AD-5, R2.5.4). The comment stays in the list
   * with its children attached beneath it, carrying a placeholder body and no
   * author. `LessonComment.parent` is `onDelete: Restrict`, so a child can
   * never be orphaned by the database either.
   */
  deleted: boolean;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601, or `null` if never edited. */
  editedAt: string | null;
}

/** Runtime schema for the client's HTTP boundary parse. */
export const memberLessonCommentSchema = z.object({
  id: z.string(),
  lessonId: z.string(),
  parentId: z.string().nullable(),
  bodyMarkdown: z.string(),
  authorName: z.string().nullable(),
  answered: z.boolean(),
  deleted: z.boolean(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
}) satisfies z.ZodType<MemberLessonComment>;
