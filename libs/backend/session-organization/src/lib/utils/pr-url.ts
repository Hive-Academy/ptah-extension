/**
 * Pull-request URL parsing (lane L14) — pure, no I/O.
 *
 * Rules:
 *  - only `https:` URLs of at most {@link PR_URL_MAX_LENGTH} characters (after
 *    trimming) are accepted; URLs carrying credentials (`user:pass@`) are
 *    rejected so a secret is never stored or echoed back;
 *  - a GitHub pull-request URL is canonicalized to
 *    `https://github.com/<owner>/<repo>/pull/<n>`: lowercase host, no port,
 *    trailing slash, sub-path (`/files`, `/commits`), query or fragment. The
 *    store keys PR links on the exact URL string (binary collation), so the
 *    canonical form is what keeps one PR from being stored twice;
 *  - any other `https:` URL (any host is allowed for manual links) is kept
 *    trimmed and otherwise unchanged, with `repo` and `number` null.
 */

/** Longest PR URL accepted, in characters. */
export const PR_URL_MAX_LENGTH = 2048;

/** An accepted PR URL: the value to store plus the GitHub fields when known. */
export interface ParsedPrUrl {
  /** Canonical GitHub PR URL, or the trimmed input for any other host. */
  url: string;
  /** `owner/repo` for a GitHub PR URL; null otherwise. */
  repo: string | null;
  /** PR number for a GitHub PR URL; null otherwise. */
  number: number | null;
}

const GITHUB_HOSTS: readonly string[] = ['github.com', 'www.github.com'];

/**
 * `/<owner>/<repo>/pull/<n>` with an optional sub-path. Owner: GitHub's
 * alphanumerics and hyphens. Repo: alphanumerics, `.`, `_`, `-`. The number is
 * capped at 9 digits so it always fits a safe integer.
 */
const GITHUB_PR_PATH =
  /^\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)\/pull\/(\d{1,9})(?:\/.*)?$/;

/**
 * Validate and canonicalize a PR URL. Returns null when the URL is not
 * acceptable (not a string, not `https:`, too long, malformed, or carrying
 * credentials). Never throws: the input crosses a trust boundary untyped.
 */
export function parsePrUrl(raw: unknown): ParsedPrUrl | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > PR_URL_MAX_LENGTH) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Malformed URL: `new URL` throws a TypeError; there is nothing to keep.
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;

  const github = matchGithubPr(parsed);
  if (github) return github;
  return { url: trimmed, repo: null, number: null };
}

function matchGithubPr(parsed: URL): ParsedPrUrl | null {
  // `URL` already lowercases the host.
  if (!GITHUB_HOSTS.includes(parsed.hostname) || parsed.port !== '') {
    return null;
  }
  const match = GITHUB_PR_PATH.exec(parsed.pathname);
  if (!match) return null;
  const [, owner, repo, digits] = match;
  const number = Number(digits);
  if (number < 1 || repo === '.' || repo === '..') return null;
  return {
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
    repo: `${owner}/${repo}`,
    number,
  };
}
