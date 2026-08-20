/**
 * `owner/repo` slug guard — the single definition.
 *
 * Two independent features validate a user-supplied GitHub source against this
 * exact shape: `skillsSh:install` (which shells `npx skills add <owner/repo>`)
 * and the external plugin marketplace registry (which builds
 * `raw.githubusercontent.com` and `api.github.com` URLs from it). Both are
 * command/URL construction from free text, so they must not drift apart.
 *
 * It lives in `shared` rather than in either consumer because `rpc-handlers`
 * (home of the skills.sh schema) sits ABOVE the marketplace lib in the
 * dependency graph — importing it the other way would close a cycle.
 *
 * `libs/backend/rpc-handlers/.../skills-sh-rpc.schema.ts` re-exports this under
 * its original name; that file's EXTRACTION CONTRACT comment still holds, the
 * literal simply moved.
 */
export const SAFE_SOURCE_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;

/**
 * Single-path-segment guard.
 *
 * Applied to every `owner`, `repo` and plugin-name token before it is joined
 * into a filesystem path. Deliberately excludes `/`, `\` and `:` so a token can
 * never introduce a path separator, and excludes a leading `.` case via
 * {@link isSafePathToken} so `.` and `..` cannot slip through.
 */
export const SAFE_PATH_TOKEN_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/**
 * True when `token` is safe to use as exactly one filesystem path segment.
 *
 * Rejects `.` and `..` explicitly: both match {@link SAFE_PATH_TOKEN_PATTERN}
 * but are traversal, not names.
 */
export function isSafePathToken(token: string): boolean {
  if (token === '.' || token === '..') return false;
  return SAFE_PATH_TOKEN_PATTERN.test(token);
}

/**
 * Split an `owner/repo` slug, or return null when it is not one.
 *
 * Both halves are additionally checked with {@link isSafePathToken} because
 * this result is used to build paths, not just URLs.
 */
export function parseSourceSlug(
  source: string,
): { owner: string; repo: string } | null {
  if (!SAFE_SOURCE_PATTERN.test(source)) return null;
  const [owner, repo] = source.split('/');
  if (!isSafePathToken(owner) || !isSafePathToken(repo)) return null;
  return { owner, repo };
}
