/**
 * Ref guard (TASK_2026_576 RC14).
 *
 * A ref that reaches git's argv from a webview request must never be read as
 * an option: `--output=/tmp/x` makes `git log` write a file and `-b` turns a
 * checkout into a branch creation. Callers put `--end-of-options` before the
 * ref as well; this guard is the first line, refusing the value outright so
 * the caller can answer with its own "invalid" result.
 */

/** The only `@{` form allowed: the stash ordinal `GitInfoService` builds itself. */
const STASH_ORDINAL = /^stash@\{\d+\}$/;

/** Characters git forbids in a branch name (`git check-ref-format`). */
const FORBIDDEN_REF_CHARACTERS = /[~^:?*[\\]/;

/** Revision suffixes `assertSafeRevision` peels off: `~N`, `^N`, `^{commit}`. */
const REVISION_SUFFIX = /^(.*?)((?:~\d*|\^\d*|\^\{(?:commit)?\})*)$/;

/** Thrown when a ref or revision could be read as an option or is malformed. */
export class GitInvalidRefError extends Error {
  constructor(
    readonly ref: string,
    reason: string,
  ) {
    super(`Invalid git ref ${JSON.stringify(ref)}: ${reason}`);
    this.name = 'GitInvalidRefError';
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

/** The checks both guards share: present, not an option, printable, no spaces. */
function assertPlainToken(ref: string): void {
  if (typeof ref !== 'string' || ref.length === 0) {
    throw new GitInvalidRefError(String(ref), 'empty');
  }
  if (ref.startsWith('-')) {
    throw new GitInvalidRefError(ref, 'starts with "-"');
  }
  if (hasControlCharacter(ref)) {
    throw new GitInvalidRefError(ref, 'contains a control character');
  }
  if (/\s/.test(ref)) {
    throw new GitInvalidRefError(ref, 'contains whitespace');
  }
}

/**
 * A branch (or other ref) name. Refuses an empty value, a leading `-`,
 * control characters, whitespace, `..`, `@{` and any of `~^:?*[\`. The literal
 * `stash@{N}` is the one `@{` form allowed.
 */
export function assertSafeRef(ref: string): void {
  assertPlainToken(ref);
  if (STASH_ORDINAL.test(ref)) return;
  if (ref.includes('..')) {
    throw new GitInvalidRefError(ref, 'contains ".."');
  }
  if (ref.includes('@{')) {
    throw new GitInvalidRefError(ref, 'contains "@{"');
  }
  if (FORBIDDEN_REF_CHARACTERS.test(ref)) {
    throw new GitInvalidRefError(ref, 'contains one of ~^:?*[\\');
  }
}

/**
 * A revision for a read such as `git log -1`: a ref name that passes
 * `assertSafeRef` (so `HEAD`, a SHA, a branch or a tag), optionally followed by
 * `~N`, `^N` or `^{commit}` suffixes. Never a leading `-`.
 */
export function assertSafeRevision(revision: string): void {
  assertPlainToken(revision);
  const base = REVISION_SUFFIX.exec(revision)?.[1] ?? revision;
  if (base.length === 0) {
    throw new GitInvalidRefError(revision, 'has no ref before its suffix');
  }
  assertSafeRef(base);
}
