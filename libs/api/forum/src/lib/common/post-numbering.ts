/**
 * THE TWO UNITS A FORUM THREAD COUNTS IN, AND THE ONLY PLACE THEY MEET.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE THE TWO ARE ONE APART AND LOOK IDENTICAL. Both are
 * small non-negative integers describing "how far into a thread"; nothing in the
 * type system distinguishes them; and a subtraction between them compiles,
 * passes review, and is wrong by exactly one. It shipped that way (TASK_2026_177
 * F-1) and it under-reported every unread badge in the product for every topic a
 * member had ever opened:
 *
 *   TRUE UNREAD | server unreadCount | post_count | marker
 *        1      |         0          |     2      |   2
 *        2      |         1          |     3      |   2
 *        3      |         2          |     4      |   2
 *
 * A thread with ONE unread reply reported `0`, and `UnreadPill` renders nothing
 * at 0 — so the member saw no badge at all.
 *
 * ── THE UNITS ───────────────────────────────────────────────────────────────
 *
 *   POST NUMBER  — `Post.postNumber`, `TopicReadState.lastReadPostNumber`.
 *                  1-based and it COUNTS THE BODY: post #1 IS the topic body
 *                  (AD-9). A topic with two replies has post numbers 1, 2, 3.
 *
 *   REPLY COUNT  — `Topic.postCount`. It EXCLUDES post #1, because the body is
 *                  not a reply, and it excludes tombstones (AD-11). The same
 *                  topic has `postCount = 2`.
 *
 * So `postCount - lastReadPostNumber` is a category error. The functions below
 * are the conversion, and every site that needs to compare the two goes through
 * one of them: `unreadCount()` and `buildUnreadWhere()` read markers,
 * `CategoriesService.listForMember` reads markers, and
 * `ReadStateService.markCategoryRead` WRITES one.
 *
 * ⚠️ AND THE WRITE SIDE IS WHY A `- 1` AT ONE CALL SITE IS NOT THE FIX. The
 * conversion runs in BOTH directions — `markCategoryRead` has to turn a reply
 * count back into a post number to say "you have read all of these". Repairing
 * only the read would have left "mark all read" reporting 1 unread on every
 * topic with replies: a newer, louder defect created by the obvious one-liner.
 * `read-state/unread-units.spec.ts` holds the round-trip case that refuses it.
 *
 * ⚠️ NOT EXPORTED FROM THE LIB BARREL. `common/` never is (plan §2.5,
 * `forum.module.spec.ts` asserts it) — these are internal arithmetic, not API.
 */

/**
 * The post number of the opening post. AD-9: it IS the topic body.
 *
 * Named rather than written as a bare `1`, because every rule that treats the
 * opening post differently — it is not counted by `postCount`, it cannot be
 * replied-to-as-a-child at depth 3, it cannot be deleted through the post
 * endpoint, and it is the offset between the two units above — keys off this
 * number.
 */
export const FIRST_POST_NUMBER = 1;

/**
 * POST NUMBER → REPLY COUNT: how many REPLIES a read marker means have been
 * read.
 *
 * A marker of `0` (no read-state row — the "never opened" signal, R1.6.3) and a
 * marker of `1` (the member has read the body and no replies) both mean ZERO
 * replies read, and both must therefore report the topic's whole reply count.
 * That collapse is the reason this is a function with a floor rather than a bare
 * `n - 1`: `0 - 1` is `-1`, and a negative "replies read" would report MORE
 * unread replies than the topic has.
 */
export function repliesRead(lastReadPostNumber: number): number {
  return Math.max(0, lastReadPostNumber - FIRST_POST_NUMBER);
}

/**
 * REPLY COUNT → POST NUMBER: the marker that means "every reply in this topic
 * has been read" (R1.6.5, `markCategoryRead`).
 *
 * The inverse of {@link repliesRead}: `repliesRead(markerForAllRepliesRead(n))
 * === n` for every `n >= 0`, which is the property `unread-units.spec.ts`
 * asserts as a round trip rather than as two independent expectations.
 *
 * ⚠️ IT IS PER-TOPIC AND IT MUST STAY THAT WAY. A uniform large value (999)
 * would also produce 0 unread today and would be actively wrong tomorrow: the
 * next real reply computes `postCount - 998`, clamps to 0, and never shows as
 * new again.
 *
 * ⚠️ IT IS NOT NECESSARILY THE TOPIC'S HIGHEST `postNumber`. Tombstones keep
 * their numbers (R1.3.5) while leaving `postCount`, so a topic that has had
 * replies deleted has a higher maximum than this. That is harmless and
 * deliberate: the observable unread is `0` either way, and reading the true
 * maximum would cost a query per topic on a "mark all read" click.
 */
export function markerForAllRepliesRead(postCount: number): number {
  return postCount + FIRST_POST_NUMBER;
}
