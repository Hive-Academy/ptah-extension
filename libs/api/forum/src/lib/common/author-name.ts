/**
 * Author display names for MEMBER-facing responses — A-4, NFR-S4.
 *
 * ⚠️ THIS FILE EXISTS SO THAT `authorName` IS DERIVED IN EXACTLY ONE PLACE, AND
 * SO THAT THE PLACE IT IS DERIVED IN CANNOT SEE AN EMAIL ADDRESS.
 *
 * `User` carries `email`, `firstName` and `lastName`. Every member-facing shape
 * in `@ptah-contracts/community` carries `authorName: string | null` and NONE
 * of them carries an email — `authorEmail` lives on the ADMIN shapes only, and
 * plan RK-8/NFR-S4 names it as the single concrete leak the member/admin
 * contract split exists to prevent.
 *
 * {@link toAuthorName} takes a parameter type that has no `email` property at
 * all, so a `select` that forgot to omit `email` still cannot get one onto the
 * wire through this function. That is a weaker guarantee than a compile error
 * on the select itself, but it is the one that survives a copy-pasted `select`
 * three services from now.
 *
 * ⚠️ `null` IS A NORMAL, EXPECTED VALUE — NOT AN ERROR AND NOT A FALLBACK
 * SENTINEL. It means one of four things, and the wire cannot tell them apart on
 * purpose:
 *   - migrated / system content whose author is not a `User` row (A-4);
 *   - a post whose author's account was deleted (`onDelete: SetNull`);
 *   - a user row with no name recorded (both name columns are nullable);
 *   - a TOMBSTONE, where the author is withheld deliberately (R1.3.5) — that
 *     one is applied in `post-view.ts`, not here.
 *
 * A string like `'Deleted user'` or `'Anonymous'` must NOT be produced here.
 * It would be an untranslatable English literal minted on the server, and it
 * would be indistinguishable from a member who actually chose that name. The
 * client renders the placeholder, which is where the copy and the i18n live.
 */

/**
 * The narrowest projection this module accepts.
 *
 * Deliberately NOT `User` — see the file docblock. A caller passes
 * `select: { firstName: true, lastName: true }` and nothing else.
 */
export interface AuthorNameSource {
  readonly firstName: string | null;
  readonly lastName: string | null;
}

/**
 * `"Ada Lovelace"`, `"Ada"`, or `null`.
 *
 * Whitespace-only name columns are treated as absent: a `firstName` of `'   '`
 * is data entry, not a name, and joining it would produce a leading space on
 * every rendered byline.
 */
export function toAuthorName(
  author: AuthorNameSource | null | undefined,
): string | null {
  if (!author) return null;

  const parts = [author.firstName, author.lastName]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0);

  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * Index a batch of user rows by id, for the ONE `user.findMany` a list read
 * performs instead of a per-row author lookup (NFR-P4).
 *
 * The map's value is the resolved NAME, not the row — so nothing downstream of
 * this call holds a user record it might widen a response with later.
 */
export function toAuthorNameMap(
  users: readonly (AuthorNameSource & { readonly id: string })[],
): ReadonlyMap<string, string | null> {
  return new Map(users.map((user) => [user.id, toAuthorName(user)]));
}
