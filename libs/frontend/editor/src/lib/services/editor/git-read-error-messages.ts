import type { GitBlobRead, GitReadErrorCode } from '@ptah-extension/shared';

/**
 * The frontend's fixed `GitReadErrorCode` -> user-facing copy table (A3 AC3/AC4).
 *
 * The backend deliberately never ships raw stderr or absolute paths to the
 * client — it ships a closed set of machine-readable codes plus a short,
 * already-sanitized detail string. All user-visible wording lives here, which
 * is also what makes the copy translatable and testable without a git repo.
 *
 * `ambiguous-ref` is present for completeness: it is part of the shared union
 * but the backend's exit-code ladder does not currently produce it. Keeping a
 * string for it means a future producer cannot fall through to a blank message.
 */
export const GIT_READ_ERROR_MESSAGES: Readonly<
  Record<GitReadErrorCode, string>
> = {
  'not-a-repo': 'This folder is not a git repository.',
  'no-commits':
    'This repository has no commits yet, so there is nothing to compare against.',
  'ambiguous-ref': 'The git reference for this comparison is ambiguous.',
  'git-missing':
    'Git was not found. Install git and make sure it is on your PATH.',
  timeout: 'Git took too long to respond. Try again.',
  'permission-denied': 'Permission denied while reading this file from git.',
  unknown: 'Git could not read this file.',
};

/** Copy shown when the backend could not be reached at all (transport failure). */
export const GIT_READ_TRANSPORT_MESSAGE =
  'Could not reach the git backend. Showing the last successful comparison.';

/** Map a code to user-facing copy, falling back to `unknown` for a stranger. */
export function describeGitReadError(code: GitReadErrorCode): string {
  return GIT_READ_ERROR_MESSAGES[code] ?? GIT_READ_ERROR_MESSAGES.unknown;
}

/**
 * First failed side of a diff read, or `null` when both sides are readable.
 *
 * `absent` and `binary` are SUCCESSFUL outcomes — a missing path and a binary
 * blob are both things git can tell us truthfully. Only `error` is a failure,
 * and it must never be rendered as empty content.
 */
export function firstReadError(
  ...sides: readonly GitBlobRead[]
): { code: GitReadErrorCode; message: string } | null {
  for (const side of sides) {
    if (side.outcome === 'error') {
      return { code: side.code, message: side.message };
    }
  }
  return null;
}

/** Text for one side of a diff. Absent, binary and failed sides carry no text. */
export function readSideText(side: GitBlobRead): string {
  return side.outcome === 'content' ? side.content : '';
}
