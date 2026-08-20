/**
 * ONE LEVEL OF NESTING, ENFORCED BY REPAIR RATHER THAN REJECTION — R2.5.2,
 * which defers to R1.3.3, and RK-12.
 *
 * 🔴 SIBLING: `libs/api/forum/src/lib/posts/posts.service.ts:244-263`
 * (`PostsService.resolveParentId`). THE TWO MUST CHANGE TOGETHER. That one is a
 * PRIVATE method scoped by `topicId` and filtering `Post`; this one is scoped by
 * `lessonId` and filters `LessonComment`. What they share is the three lines of
 * pure decision below, and this file exists so that a `grep` for the
 * requirement finds both.
 *
 * ── THE REUSE-VS-REIMPLEMENT DECISION, AND WHY IT WENT THIS WAY ─────────────
 *
 * **Verdict: re-implement locally. Do not extract and share.** Both are
 * defensible; three reasons for this one:
 *
 *  1. `resolveParentId` is a PRIVATE method on `PostsService`, and
 *     `forum.module.spec.ts` asserts BY EXACT ARRAY EQUALITY that the forum
 *     barrel exports two services and none of `common/` — with a stated reason
 *     (a consumer that can reach `NOT_DELETED` can hand-build a `where` and
 *     read the forum past every visibility clause). Extracting means widening
 *     that barrel and deleting that assertion, for six lines.
 *  2. **The two are not actually the same function.** Forum's is scoped by
 *     `topicId` and filters `Post`; this one is scoped by `lessonId` and
 *     filters `LessonComment`. The models differ, the 404 semantics differ, and
 *     — because lesson comments inherit MODULE LOCKING (R2.5.1) — this one sits
 *     behind a `403` the forum's has no equivalent of. The genuinely shared
 *     part is the single expression below.
 *  3. A third home (`libs/api/core`, or a new lib) for a three-line pure
 *     function is scope inflation of exactly the kind RK-1 rejects, and AD-6's
 *     lib split is already deferred.
 *
 * The mitigation for the duplication is not optional and it is this file: the
 * decision is a NAMED function with the sibling named in its docblock, and
 * `comment-depth.spec.ts` carries the SAME RK-12 case in the SAME WORDS as
 * `posts.service.spec.ts`.
 *
 * ── WHY REPAIR AND NOT A 400 ────────────────────────────────────────────────
 *
 * A `400` here would lose a member's writing over an implementation detail they
 * cannot see. The client renders two levels; the "reply" control under a
 * depth-2 comment is a reasonable thing for a UI to offer and a reasonable
 * thing for a member to click. Refusing it discards what they typed and tells
 * them nothing actionable. Re-pointing the new comment at the parent's parent
 * saves the content, puts it exactly where the thread reads correctly, and is
 * invisible. Batch 6 made this call for R1.3.3 and the reasoning transfers
 * unchanged.
 */

/**
 * Given the comment a member replied to, return the id the new comment's
 * `parentId` must actually be set to.
 *
 * - Replying to a TOP-LEVEL comment (`parentId === null`) ⇒ that comment's id.
 *   The reply lands at depth 2, which is where it was asked to be.
 * - Replying to a DEPTH-2 comment ⇒ that comment's OWN parent's id. The reply
 *   becomes its SIBLING at depth 2 rather than a depth-3 child.
 *
 * ⚠️ ONE HOP IS ENOUGH, AND THE INDUCTION IS WHY. Every `parentId` this
 * function ever writes is either `null` or the id of a comment whose own
 * `parentId` is `null` — so no stored comment is ever deeper than 2, so the
 * parent handed in here is at depth 1 or 2 and never deeper. A loop that walked
 * to the root would be dead code dressed as caution, and would hide the
 * invariant rather than rest on it. `comment-depth.spec.ts` asserts the
 * induction directly.
 *
 * ⚠️ PURE, AND IT TAKES THE ROW RATHER THAN AN ID. The caller has already read
 * the parent — scoped to the lesson and filtered by `NOT_DELETED`, which is
 * where a parent in another lesson or a tombstoned parent becomes a `404`, and
 * those are NOT depth questions. Keeping the read out of here is what makes the
 * decision testable without a mock and what keeps the query count visible at
 * the call site.
 */
export function resolveParentForDepthTwo(parent: {
  id: string;
  parentId: string | null;
}): string {
  return parent.parentId ?? parent.id;
}

/**
 * Did {@link resolveParentForDepthTwo} move the reply?
 *
 * ⚠️ REPORTED ON THE CREATE RESULT SO A CLIENT *CAN* SAY "replying to the
 * thread", AND NOTHING DEPENDS ON IT. It is deliberately not on the wire
 * contract (`MemberLessonComment` has no such field): a client that ignores it
 * renders a correct thread, and one that uses it renders a slightly kinder one.
 * Batch 6's D-6.8c made the same call for posts.
 */
export function wasDepthRepaired(
  parent: { id: string; parentId: string | null },
  resolved: string,
): boolean {
  return resolved !== parent.id;
}
