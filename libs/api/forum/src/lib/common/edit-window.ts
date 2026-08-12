import { ForbiddenException } from '@nestjs/common';

/**
 * The post/topic edit window — R1.2.3, plan §3.3.
 *
 * ⚠️ ASSUMPTION-5, AND IT IS AN ASSUMPTION. R1.2.3 says an author may edit
 * "within an editable window" and never states a duration. §3.3's error table
 * proves a window exists — `PATCH topics/:id` and `PATCH posts/:id` both answer
 * `403 (not author / window closed)` — but not how long it is.
 *
 * 24 hours is this task's chosen value. It is long enough to cover "I came back
 * the next morning and spotted a typo", and short enough that a thread someone
 * has already replied to does not silently change out from under the reply.
 *
 * ⚠️ IT IS DECLARED HERE, ONCE, SO IT CAN BE OVERRULED IN ONE PLACE. If the
 * value is wrong, the fix is this constant and nothing else — not a hunt
 * through two services for a hard-coded `24 * 60 * 60 * 1000`. That is the
 * whole reason it is a named export in `common/` rather than a literal at the
 * call site.
 *
 * ADMINS ARE EXEMPT. An admin edit goes through the moderation surface
 * (`PATCH /v1/admin/community/topics/:id`, R8.2), which does not consult this
 * constant at all and writes an audit row instead. The exemption is therefore
 * structural — a different endpoint behind `AdminGuard` — rather than an
 * `if (isAdmin)` branch inside the member path. That matters: it means the
 * member path has no admin escape hatch to get wrong, and every admin edit is
 * audited, which an inline branch would not be.
 */

/**
 * How long after creation an author may edit their own topic title or post
 * body (R1.2.3). Milliseconds, to compare directly against a `Date` delta.
 *
 * Measured from `createdAt`, NOT from `editedAt` — otherwise each edit would
 * restart the clock and the window would never close.
 */
export const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Human form of {@link EDIT_WINDOW_MS}, for error messages and docs. */
export const EDIT_WINDOW_HOURS = 24;

/**
 * Is `createdAt` still inside the edit window at `now`?
 *
 * `now` is a parameter rather than an internal `new Date()` so the rule is
 * testable without faking the clock. Exactly at the boundary the window is
 * CLOSED (`>=`), so the two branches cannot both be true for one instant.
 */
export function isWithinEditWindow(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < EDIT_WINDOW_MS;
}

/**
 * The window check as a GUARD — the single place in this lib that turns a
 * closed window into a `403` (plan §3.3: `403 (not author / window closed)`).
 *
 * ⚠️ ADDED IN BATCH 6B (Tasks 6.7 and 6.8). §3.3 gives BOTH `PATCH topics/:id`
 * and `PATCH posts/:id` the same "window closed" `403`, so without this the
 * rule would be decided in two services and the two would drift — one of them
 * eventually comparing against `editedAt`, or answering `400`. With it,
 * {@link EDIT_WINDOW_MS} keeps exactly one consumer
 * ({@link isWithinEditWindow}), and the `403` has exactly one construction
 * site.
 *
 * ⚠️ THERE IS NO `isAdmin` PARAMETER, AND THERE MUST NEVER BE ONE. Admins are
 * exempt STRUCTURALLY — an admin edit is a different endpoint
 * (`PATCH /v1/admin/community/topics/:id`) behind `AdminGuard`, which does not
 * call this function and writes an audit row instead. Adding a bypass flag here
 * would put an admin escape hatch on the member path AND make admin edits
 * unaudited, which is precisely the trade the structural exemption avoids.
 *
 * The message is FIXED and sanitized (NFR-S7): it states the policy and the
 * duration, and it discloses nothing about the row.
 */
export function assertWithinEditWindow(createdAt: Date, now: Date): void {
  if (!isWithinEditWindow(createdAt, now)) {
    throw new ForbiddenException(
      `The ${EDIT_WINDOW_HOURS}-hour edit window for this content has closed`,
    );
  }
}
