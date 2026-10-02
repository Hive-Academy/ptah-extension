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
 *
 * `extractGhPrCreateUrl` (lane L7) finds the PR a `gh pr create` call created
 * and canonicalizes it through `parsePrUrl` — there is one canonicalizer.
 */
import type { SessionPrState } from '@ptah-extension/shared';

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

const GITHUB_HOSTS: ReadonlySet<string> = new Set([
  'github.com',
  'www.github.com',
]);

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
    // degradation-audit: reported - a malformed URL is a validation result, not
    // a lost failure: null is this function's documented answer, and every
    // caller turns it into a logged drop or a SessionOrganizationInputError.
    // Malformed URL: `new URL` throws a TypeError; there is nothing to keep.
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;

  const github = matchGithubPr(parsed);
  if (github) return github;
  return { url: trimmed, repo: null, number: null };
}

/** The PostToolUse fields {@link extractGhPrCreateUrl} reads. */
export interface GhPrCreateToolUse {
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly toolOutput: unknown;
  readonly success: boolean;
}

/** A PR that `gh pr create` reported creating. */
export interface GhPrCreateCapture {
  /** Canonical GitHub PR URL (from {@link parsePrUrl}). */
  url: string;
  state: Extract<SessionPrState, 'open' | 'draft'>;
}

/** `gh pr create` as a command word sequence, anywhere in a shell command. */
const GH_PR_CREATE = /(?:^|[\s;&|(])gh\s+pr\s+create(?=\s|$|[;&|)])/;
/**
 * The `--draft` flag as its own word, bare or with a value (`--draft=true`).
 * `--draft=false` and `--draft=0` turn it off, so they do not match.
 */
const DRAFT_FLAG = /(?:^|\s)--draft(?:=(?!(?:false|0)(?:\s|$))\S*)?(?=\s|$)/i;
/**
 * The `-d` shorthand of `--draft` as its own word. Case-sensitive: gh flags
 * are, so `-D` is not the draft flag.
 */
const DRAFT_SHORT_FLAG = /(?:^|\s)-d(?=\s|$)/;
/** A shell operator that ends the `gh pr create` invocation. */
const COMMAND_END = /[;&|)\n]/;
/** A GitHub PR URL candidate; {@link parsePrUrl} has the final word. */
const GITHUB_PR_URL_CANDIDATE =
  /https:\/\/(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/gi;

/**
 * Lane L7: the PR a successful `gh pr create` Bash call created, or null.
 *
 * Requires the `Bash` tool, a `command` containing `gh pr create`, and
 * success. Takes the FIRST GitHub PR URL in the output (the string itself, or
 * the JSON of a structured output) that {@link parsePrUrl} accepts as a GitHub
 * PR, so capture and manual adds canonicalize the same way. `state` is
 * `draft` when the `gh pr create` invocation itself passes `--draft` (not
 * `--draft=false`) or `-d`, else `open`; flags of other commands chained on
 * the same line are not read. Pure; never throws: a null, undefined or
 * non-object payload is null.
 */
export function extractGhPrCreateUrl(
  payload: GhPrCreateToolUse | null | undefined,
): GhPrCreateCapture | null {
  if (typeof payload !== 'object' || payload === null) return null;
  if (payload.toolName !== 'Bash' || payload.success !== true) return null;
  const command = commandOf(payload.toolInput);
  if (command === null) return null;
  const args = ghPrCreateArgs(command);
  if (args === null) return null;
  const output = outputText(payload.toolOutput);
  if (output === null) return null;
  for (const [candidate] of output.matchAll(GITHUB_PR_URL_CANDIDATE)) {
    const parsed = parsePrUrl(candidate);
    if (parsed !== null && parsed.number !== null) {
      return {
        url: parsed.url,
        state:
          DRAFT_FLAG.test(args) || DRAFT_SHORT_FLAG.test(args)
            ? 'draft'
            : 'open',
      };
    }
  }
  return null;
}

/**
 * The arguments of the first `gh pr create` in `command`, up to the next shell
 * operator; null when the command does not run `gh pr create`.
 */
function ghPrCreateArgs(command: string): string | null {
  const match = GH_PR_CREATE.exec(command);
  if (match === null) return null;
  const rest = command.slice(match.index + match[0].length);
  const end = rest.search(COMMAND_END);
  return end === -1 ? rest : rest.slice(0, end);
}

function commandOf(toolInput: unknown): string | null {
  if (typeof toolInput !== 'object' || toolInput === null) return null;
  const command: unknown = (toolInput as Record<string, unknown>)['command'];
  return typeof command === 'string' ? command : null;
}

function outputText(toolOutput: unknown): string | null {
  if (typeof toolOutput === 'string') return toolOutput;
  if (toolOutput === undefined || toolOutput === null) return null;
  try {
    return JSON.stringify(toolOutput) ?? null;
  } catch {
    // degradation-audit: optional-capability - PR capture is best-effort: an
    // output that cannot be serialized (a cycle, a BigInt) carries no URL we
    // could read, so the call simply links no PR.
    return null;
  }
}

function matchGithubPr(parsed: URL): ParsedPrUrl | null {
  // `URL` already lowercases the host.
  if (!GITHUB_HOSTS.has(parsed.hostname) || parsed.port !== '') {
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
