/**
 * Cross-platform path assertion helper.
 *
 * Windows branches return `C:\Users\...` while the hard-coded Linux-style
 * fixtures used in many existing specs assume `/`. Normalizing both sides to
 * POSIX separators before comparison eliminates the Windows-only test failures
 * flagged in `implementation-plan.md` (Risk Register: Windows path handling).
 *
 * Use this in place of raw `expect(actual).toBe(expected)` wherever either
 * side can vary in slash style.
 */

import * as path from 'path';

/**
 * Normalize a path to forward-slash (POSIX) form.
 *
 * - Converts backslashes to forward slashes.
 * - Collapses redundant `.` / `..` segments via `path.posix.normalize`.
 * - Preserves Windows drive letters intact (e.g. `C:\foo` -> `C:/foo`).
 */
export function toPosixPath(value: string): string {
  // Replace backslashes first so `path.posix.normalize` does not misinterpret
  // them (it only knows about forward slashes).
  return path.posix.normalize(
    value.split(path.sep).join('/').replace(/\\/g, '/'),
  );
}

/**
 * Assert two paths are equivalent after POSIX normalization.
 *
 * Pattern:
 *
 *   expectNormalizedPath(actual, '/home/user/.ptah/plugins/foo.json');
 *
 * Works on both Windows and POSIX test runners. Returns `void` and throws via
 * Jest's `expect(...).toBe(...)` machinery on mismatch so existing spec
 * infrastructure picks up the failure location.
 */
export function expectNormalizedPath(actual: string, expected: string): void {
  expect(toPosixPath(actual)).toBe(toPosixPath(expected));
}
